// API for the worker (the Python engine, on a server or a laptop). Authenticated with the X-Worker-Key header.
//
// Multi-user model: the worker sees each CHANNEL once (id = channelId(platform, handle)), however many users follow it,
// records it once and sends each clip once. The website then gives every follower their own copy of the clip
// (sharing the thumbnail/preview files), which they approve, edit and publish to their own accounts.
import crypto from "node:crypto";
import express from "express";
import multer from "multer";
import { config } from "../config.js";
import { decrypt, safeEqual } from "../crypto.js";
import { logEvent, logEventFor, notify } from "../events.js";
import { releaseFile, saveBuffer } from "../media.js";
import {
  Account, Clip, Command, Creator, LiveSession, Setting, User, WorkerStatus, getPlatformSettings, getUserSettings,
} from "../models.js";
import { HttpError, canPublish, countPublish, ensureCredit } from "../util.js";
import { youtubeAccessToken } from "./accounts.js";

export const worker = express.Router();

worker.use((req, res, next) => {
  if (!safeEqual(req.get("x-worker-key"), config.workerKey)) return res.status(401).json({ error: "bad worker key" });
  next();
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxPublishFileBytes, files: 3 } });
const HEX24 = /^[0-9a-f]{24}$/;

/** Add a queued publication for each target platform the clip should go to (idempotent). */
export function queuePublications(clip, platforms) {
  const targets = platforms?.length ? platforms
    : Object.entries(clip.creator?.targets?.toObject?.() || clip.creator?.targets || { youtube: true })
      .filter(([, on]) => on).map(([p]) => p);
  for (const p of targets) {
    if (!["youtube", "instagram"].includes(p)) continue;
    if (!clip.publications.some((x) => x.platform === p && x.status !== "failed")) {
      clip.publications = clip.publications.filter((x) => x.platform !== p);
      clip.publications.push({ platform: p, status: "queued" });
    }
  }
}

async function adminId() {
  return (await User.findOne({ role: "admin" }).select("_id").lean())?._id
    || (await User.findOne().sort({ createdAt: 1 }).select("_id").lean())?._id;
}

/** Users whose monitoring is on. */
async function activeOwners() {
  return new Set((await User.find({ paused: { $ne: true } }).select("_id").lean()).map((u) => String(u._id)));
}

// ---------------------------------------------------------------- config + heartbeat
worker.get("/config", async (req, res) => {
  const [creators, platform, raw, ws, active, users] = await Promise.all([
    Creator.find({ enabled: true }).sort({ createdAt: 1 }).lean(), getPlatformSettings(),
    Setting.findById("platform").select("secrets").lean(), WorkerStatus.findById("worker").select("paused").lean(),
    activeOwners(), User.find().select("_id").lean()]);
  let secrets = {};
  try { secrets = raw?.secrets ? decrypt(raw.secrets) : {}; } catch { secrets = {}; }
  const channels = new Map();
  for (const c of creators) {
    if (!active.has(String(c.owner))) continue;
    const ch = channels.get(c.channel);
    if (ch) { ch.followers += 1; ch.autoUpload ||= c.autoUpload; continue; }
    channels.set(c.channel, { id: c.channel, name: c.name, platform: c.platform, handle: c.handle, channelUrl: c.channelUrl,
      liveUrl: c.liveUrl, creditLine: c.creditLine, tags: c.tags, hashtags: c.hashtags, layout: c.layout,
      autoUpload: c.autoUpload, followers: 1 });
  }
  // the engine drops clips below min score before sending them: use the lowest any user accepts, each user filters after
  const mins = await Promise.all(users.map((u) => getUserSettings(u._id).then((s) => s.minScoreToPublish)));
  res.json({
    anthropicKey: secrets.anthropicKey || "",
    paused: !!ws?.paused,
    creators: [...channels.values()],
    settings: { ...platform, minScoreToPublish: mins.length ? Math.min(...mins) : 1, requireApproval: false, privacy: "private" },
  });
});

worker.post("/heartbeat", async (req, res) => {
  const b = req.body || {};
  const sessions = Array.isArray(b.sessions) ? b.sessions.slice(0, 50) : [];
  await WorkerStatus.updateOne({ _id: "worker" }, { $set: {
    lastSeen: new Date(), state: String(b.state || "running").slice(0, 40), sessions,
    editQueue: Number(b.editQueue) || 0, editing: Number(b.editing) || 0, freeGb: Number(b.freeGb) || null,
    version: String(b.version || "").slice(0, 40), hostname: String(b.hostname || "").slice(0, 80),
    log: Array.isArray(b.log) ? b.log.slice(-200).map((l) => String(l).slice(0, 400)) : [],
  } }, { upsert: true });
  const prev = await WorkerStatus.findById("worker").select("online").lean();
  if (prev && prev.online === false) logEvent("worker", "Clipping worker is back online", { level: "success" });
  await WorkerStatus.updateOne({ _id: "worker" }, { $set: { online: true, paused: !!b.paused } });
  await trackSessions(sessions);
  const cmds = await Command.find({ status: "pending" }).sort({ createdAt: 1 }).limit(10).lean();
  if (cmds.length) await Command.updateMany({ _id: { $in: cmds.map((c) => c._id) } }, { $set: { status: "sent", sentAt: new Date() } });
  notify("worker");
  res.json({ ok: true, commands: cmds.map((c) => ({ id: String(c._id), type: c.type, payload: c.payload })) });
});

async function followersOf(channel) {
  return channel ? Creator.find({ channel }).select("owner name").lean() : [];
}

async function trackSessions(sessions) {
  const now = new Date();
  const ids = [];
  for (const s of sessions) {
    if (!s.videoId) continue;
    ids.push(String(s.videoId));
    const channel = s.creatorId && HEX24.test(s.creatorId) ? s.creatorId : null;
    if (channel) await Creator.updateMany({ channel }, { $set: { lastLiveAt: now, lastLiveTitle: String(s.title || "").slice(0, 200) } });
    const set = { lastSeenAt: now, endedAt: null, title: String(s.title || "").slice(0, 200), chatMessages: Number(s.chatMessages) || 0,
      chatBackend: String(s.chatBackend || ""), moments: Number(s.moments) || 0,
      recordedSeconds: s.recordedUntil && s.since ? Math.max(0, s.recordedUntil - s.since) : 0 };
    const existing = await LiveSession.findOneAndUpdate({ videoId: String(s.videoId) }, { $set: set }).lean();
    const owners = (await followersOf(channel)).map((f) => f.owner);
    if (!existing) {
      await LiveSession.create({ videoId: String(s.videoId), channel, creatorName: s.creator, platform: s.platform,
        startedAt: s.since ? new Date(s.since * 1000) : now, ...set });
      await logEventFor(owners, "live", `${s.creator} went live: ${s.title || ""}`.trim(), { level: "success", platform: s.platform });
    } else if (existing.endedAt) {
      await logEventFor(owners, "live", `Recording ${s.creator} again (resumed)`);
    }
  }
  const ended = await LiveSession.find({ endedAt: null, videoId: { $nin: ids } }).lean();
  for (const e of ended) {
    await LiveSession.updateOne({ _id: e._id }, { $set: { endedAt: now } });
    const owners = (await followersOf(e.channel)).map((f) => f.owner);
    await logEventFor(owners, "ended", `${e.creatorName} stream ended · ${Math.round((e.recordedSeconds || 0) / 60)} min recorded, ${e.moments || 0} moments`);
    await Creator.updateMany({ channel: e.channel, skipVideoId: e.videoId }, { $unset: { skipVideoId: 1 } });
  }
}

/** Worker reports what happened with a command. */
worker.post("/commands/:id/result", async (req, res) => {
  if (!HEX24.test(req.params.id)) throw new HttpError(404, "no such command");
  const ok = !!req.body?.ok;
  const c = await Command.findByIdAndUpdate(req.params.id, { $set: { status: ok ? "done" : "failed",
    result: String(req.body?.result || "").slice(0, 500), doneAt: new Date() } }, { returnDocument: "after" }).lean();
  if (!c) throw new HttpError(404, "no such command");
  if (ok && (c.type === "pause" || c.type === "resume")) await WorkerStatus.updateOne({ _id: "worker" }, { $set: { paused: c.type === "pause" } });
  logEvent("command", `${c.type.replace("_", " ")}: ${c.result || (ok ? "done" : "failed")}`, { level: ok ? "info" : "warn", owner: c.owner });
  notify("commands", { owner: c.owner });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- clips from the worker
/** Who gets a copy of this moment: followers of the channel (live), or whoever asked for the VOD. */
async function recipients(meta) {
  const id = meta.creatorId && HEX24.test(meta.creatorId) ? meta.creatorId : null;
  if (meta.source === "vod" && meta.videoId) {
    const cmds = await Command.find({ type: "vod", "payload.videoId": String(meta.videoId) }).select("owner payload").lean();
    if (cmds.length) {
      const out = [];
      for (const cmd of cmds) {
        if (out.some((r) => String(r.owner) === String(cmd.owner))) continue;
        const creator = cmd.payload?.creator && HEX24.test(cmd.payload.creator)
          ? await Creator.findOne({ _id: cmd.payload.creator, owner: cmd.owner }) : null;
        out.push({ owner: cmd.owner, creator });
      }
      return out;
    }
  }
  if (id) {
    const active = await activeOwners();
    let followers = await Creator.find({ channel: id, enabled: true });
    if (!followers.length) followers = await Creator.find({ _id: id });       // an older worker sent a creator id
    followers = followers.filter((f) => active.has(String(f.owner)) && f.skipVideoId !== String(meta.videoId || ""));
    if (followers.length) return followers.map((f) => ({ owner: f.owner, creator: f }));
    return [];
  }
  return [{ owner: await adminId(), creator: null }];   // test clips, or clips made before linking: the admin's
}

worker.post("/clips", upload.fields([{ name: "thumb", maxCount: 1 }, { name: "preview", maxCount: 1 }]), async (req, res) => {
  let meta;
  try { meta = JSON.parse(req.body.meta || "{}"); } catch { throw new HttpError(400, "meta must be JSON"); }
  if (!meta.clipId || !/^[\w.-]{3,120}$/.test(meta.clipId)) throw new HttpError(400, "clipId missing or invalid");
  const files = req.files || {};
  if (files.preview?.[0]?.size > config.maxPreviewBytes) throw new HttpError(413, "preview too large");

  // clips the worker already published before it was linked (migration): the admin's, recorded and never re-uploaded
  const already = Array.isArray(meta.alreadyPublished) ? meta.alreadyPublished.filter((p) => ["youtube", "instagram"].includes(p.platform)) : [];
  let targets = already.length ? [{ owner: await adminId(), creator: null }] : await recipients(meta);
  if (already.length && meta.creatorId && HEX24.test(meta.creatorId)) {
    const c = await Creator.findOne({ owner: targets[0].owner, $or: [{ channel: meta.creatorId }, { _id: meta.creatorId }] });
    targets = [{ owner: targets[0].owner, creator: c }];
  }
  if (!targets.length) return res.json({ status: "rejected", copies: 0, reason: "nobody follows this channel any more" });

  const thumb = files.thumb?.[0] ? await saveBuffer(files.thumb[0].buffer, `${meta.clipId}.jpg`, "image/jpeg") : null;
  const preview = files.preview?.[0] ? await saveBuffer(files.preview[0].buffer, `${meta.clipId}.mp4`, "video/mp4") : null;
  const released = [];
  const results = [];
  for (const { owner, creator } of targets) {
    let clip = await Clip.findOne({ owner, clipId: meta.clipId });
    const isNew = !clip;
    if (!clip) clip = new Clip({ owner, clipId: meta.clipId });
    if (!isNew && clip.publications.some((p) => p.status === "published" || p.status === "uploading")) {
      results.push({ id: clip._id, status: clip.status, unchanged: true });
      continue;
    }
    Object.assign(clip, {
      creator: creator?._id, creatorName: creator?.name || meta.creatorName, videoId: meta.videoId, source: meta.source || "live",
      title: String(meta.title || "").slice(0, 100), tags: (meta.tags || []).slice(0, 30), hookText: meta.hookText,
      description: ensureCredit(meta.description, creator?.creditLine), score: meta.score, scoreReason: meta.scoreReason,
      scoreSource: meta.scoreSource, transcript: String(meta.transcript || "").slice(0, 20000), emojis: meta.emojis || [],
      duration: meta.duration, streamTitle: meta.streamTitle, streamUrl: meta.streamUrl,
      peakAt: meta.peakEpoch ? new Date(meta.peakEpoch * 1000) : undefined,
      zChat: meta.zChat, zAudio: meta.zAudio, combined: meta.combined,
    });
    if (thumb) { if (clip.thumbFile && String(clip.thumbFile) !== String(thumb)) released.push(clip.thumbFile); clip.thumbFile = thumb; }
    if (preview) { if (clip.previewFile && String(clip.previewFile) !== String(preview)) released.push(clip.previewFile); clip.previewFile = preview; }

    if (already.length) {
      clip.publications = already.map((p) => ({ platform: p.platform, status: "published", externalId: p.externalId, url: p.url,
        privacy: p.privacy, updatedAt: new Date() }));
      clip.status = "published";
      clip.approved = true;
    } else {
      const settings = await getUserSettings(owner);
      if (meta.rejectReason) {
        clip.status = "rejected"; clip.rejectReason = meta.rejectReason;
      } else if (meta.score != null && meta.score < settings.minScoreToPublish) {
        clip.status = "rejected"; clip.rejectReason = `score ${meta.score} < ${settings.minScoreToPublish}`;
      } else if (clip.approved) {
        clip.status = "ready";
      } else if (settings.requireApproval || !creator?.autoUpload || clip.source !== "live") {
        clip.status = "pending";       // VOD / test clips always need approval
      } else {
        clip.status = "ready"; clip.approved = true;
      }
      if (clip.status === "ready") { await clip.populate("creator"); queuePublications(clip); }
    }
    await clip.save();
    if (isNew && !already.length) {
      const what = clip.status === "ready" ? "queued to publish" : clip.status === "pending" ? "needs approval" : "rejected";
      logEvent("clip", `New clip from ${clip.creatorName || "a stream"}: ${clip.title} (${what})`,
        { level: clip.status === "rejected" ? "info" : "success", owner, clip: clip._id, creator: clip.creator });
    }
    notify("clips", { owner });
    results.push({ id: clip._id, status: clip.status });
  }
  for (const f of released) await releaseFile(f);
  if (!results.some((r) => !r.unchanged)) { await releaseFile(thumb); await releaseFile(preview); }
  const best = results.find((r) => r.status === "ready") || results.find((r) => r.status === "pending") || results[0];
  const unchanged = results.every((r) => r.unchanged);
  res.status(unchanged ? 200 : 201).json({ id: best.id, status: best.status, copies: results.length, ...(unchanged ? { unchanged } : {}) });
});

// ---------------------------------------------------------------- publishing jobs
/** Find the publication's clip: by job id (this version) or by the worker's clip id (older workers). */
async function jobClip(idOrClipId, platform, statuses) {
  if (HEX24.test(idOrClipId)) {
    const c = await Clip.findById(idOrClipId);
    if (c) return c;
  }
  return Clip.findOne({ clipId: idOrClipId, publications: { $elemMatch: { platform, status: { $in: statuses } } } });
}

/** First queued clip (best first) whose owner may publish to `platform` now; claims it. */
async function nextFor(platform, claim) {
  const candidates = await Clip.find({ status: "ready", publications: { $elemMatch: { platform, status: "queued" } } })
    .sort({ priority: -1, score: -1, createdAt: 1 }).limit(300).select("owner").lean();
  const checked = new Map();
  let reason;
  for (const c of candidates) {
    const o = String(c.owner);
    if (!checked.has(o)) {
      const acc = await Account.exists({ owner: c.owner, platform });
      checked.set(o, acc ? await canPublish(c.owner, platform) : { ok: false, reason: `${platform === "youtube" ? "YouTube" : "Instagram"} is not connected` });
    }
    const can = checked.get(o);
    if (!can.ok) { reason ||= can.reason; continue; }
    const got = await claim(c._id);
    if (got) return { clip: got };
  }
  return { clip: null, reason };
}

/** Next YouTube job for the worker (it has the video file). Best score first, every user's limits respected. */
worker.get("/jobs/next", async (req, res) => {
  const { clip, reason } = await nextFor("youtube", (id) => Clip.findOneAndUpdate(
    { _id: id, publications: { $elemMatch: { platform: "youtube", status: "queued" } } },
    { $set: { "publications.$.status": "uploading", "publications.$.updatedAt": new Date() }, $inc: { "publications.$.attempts": 1 } },
    { returnDocument: "after" }).populate("creator"));
  if (!clip) return res.json({ job: null, reason });
  const settings = await getUserSettings(clip.owner);
  res.json({ job: {
    jobId: String(clip._id), clipId: clip.clipId, platform: "youtube", title: clip.title,
    description: ensureCredit(clip.description, clip.creator?.creditLine),
    tags: [...new Set([...(clip.tags || []), ...(settings.defaultTags || [])])], privacy: settings.privacy, categoryId: "20",
  } });
});

worker.post("/youtube-token", async (req, res) => {
  const jobId = String(req.body?.jobId || "");
  const clip = HEX24.test(jobId) ? await Clip.findById(jobId).select("owner").lean() : null;
  res.json(await youtubeAccessToken(clip?.owner || await adminId()));
});

worker.post("/jobs/:clipId/result", async (req, res) => {
  const { platform = "youtube", ok, externalId, url, privacy, error, retry } = req.body || {};
  const clip = await jobClip(req.params.clipId, platform, ["uploading", "queued"]);
  if (!clip) throw new HttpError(404, "clip not found");
  const pub = clip.publications.find((p) => p.platform === platform);
  if (!pub) throw new HttpError(400, "no such publication");
  Object.assign(pub, ok ? { status: "published", externalId, url, privacy, error: undefined }
    : { status: retry ? "queued" : "failed", error: String(error || "failed").slice(0, 500) });
  pub.updatedAt = new Date();
  if (ok) await countPublish(clip.owner, platform);
  if (clip.publications.every((p) => p.status === "published")) clip.status = "published";
  else if (clip.publications.some((p) => p.status === "failed") && !clip.publications.some((p) => ["queued", "uploading"].includes(p.status))) clip.status = "failed";
  await clip.save();
  if (ok) logEvent("published", `Published to ${platform === "youtube" ? "YouTube" : "Instagram"}: ${clip.title}`, { level: "success", owner: clip.owner, clip: clip._id, platform, url });
  else logEvent("failed", `${platform} upload ${retry ? "will retry" : "failed"}: ${clip.title} (${String(error || "").slice(0, 120)})`,
    { level: retry ? "warn" : "error", owner: clip.owner, clip: clip._id, platform });
  notify("clips", { owner: clip.owner });
  res.json({ ok: true, status: clip.status });
});

/** Instagram needs to download the video from a public URL: the worker hands us the file,
 *  we publish it with a one-time URL and delete it afterwards. */
worker.get("/instagram/next", async (req, res) => {
  if (await Clip.exists({ publishFile: { $ne: null } })) return res.json({ clipId: null, reason: "an Instagram upload is in progress" });
  const { clip, reason } = await nextFor("instagram", (id) => Clip.findById(id).lean());
  res.json({ clipId: clip?.clipId || null, jobId: clip ? String(clip._id) : null, reason });
});

worker.post("/instagram/:clipId/file", upload.single("file"), async (req, res) => {
  const jobId = String(req.query.jobId || "");
  const clip = await jobClip(HEX24.test(jobId) ? jobId : req.params.clipId, "instagram", ["queued"]);
  if (!clip || !req.file) throw new HttpError(400, "clip or file missing");
  const old = clip.publishFile;
  clip.publishFile = await saveBuffer(req.file.buffer, `${clip.clipId}-full.mp4`, "video/mp4");
  clip.publishToken = crypto.randomBytes(24).toString("hex");
  await clip.save();
  await releaseFile(old);
  const { publishToInstagram } = await import("../instagram.js");
  publishToInstagram(clip._id).catch(() => {});   // runs in the background; result lands on the clip
  res.json({ ok: true });
});
