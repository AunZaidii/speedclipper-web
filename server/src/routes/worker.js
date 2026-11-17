// API for the laptop worker (Python engine). Authenticated with the X-Worker-Key header.
import crypto from "node:crypto";
import express from "express";
import multer from "multer";
import { config } from "../config.js";
import { safeEqual } from "../crypto.js";
import { removeFile, saveBuffer } from "../media.js";
import { Account, Clip, Command, Creator, LiveSession, Setting, WorkerStatus, getSettings } from "../models.js";
import { decrypt } from "../crypto.js";
import { logEvent, notify } from "../events.js";
import { HttpError, canPublish, countPublish, ensureCredit } from "../util.js";
import { youtubeAccessToken } from "./accounts.js";

export const worker = express.Router();

worker.use((req, res, next) => {
  if (!safeEqual(req.get("x-worker-key"), config.workerKey)) return res.status(401).json({ error: "bad worker key" });
  next();
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxPublishFileBytes, files: 3 } });

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

// ---------------------------------------------------------------- config + heartbeat
worker.get("/config", async (req, res) => {
  const [creators, settings, raw, ws] = await Promise.all([Creator.find({ enabled: true }).lean(), getSettings(),
    Setting.findById("global").select("secrets").lean(), WorkerStatus.findById("worker").select("paused").lean()]);
  let secrets = {};
  try { secrets = raw?.secrets ? decrypt(raw.secrets) : {}; } catch { secrets = {}; }
  res.json({
    anthropicKey: secrets.anthropicKey || "",
    paused: !!ws?.paused,
    creators: creators.map((c) => ({ id: String(c._id), name: c.name, platform: c.platform, handle: c.handle,
      channelUrl: c.channelUrl, liveUrl: c.liveUrl, creditLine: c.creditLine, tags: c.tags, hashtags: c.hashtags,
      layout: c.layout, autoUpload: c.autoUpload })),
    settings,
  });
});

worker.post("/heartbeat", async (req, res) => {
  const b = req.body || {};
  const sessions = Array.isArray(b.sessions) ? b.sessions.slice(0, 20) : [];
  await WorkerStatus.updateOne({ _id: "worker" }, { $set: {
    lastSeen: new Date(), state: String(b.state || "running").slice(0, 40), sessions,
    editQueue: Number(b.editQueue) || 0, editing: Number(b.editing) || 0, freeGb: Number(b.freeGb) || null,
    version: String(b.version || "").slice(0, 40), hostname: String(b.hostname || "").slice(0, 80),
    log: Array.isArray(b.log) ? b.log.slice(-200).map((l) => String(l).slice(0, 400)) : [],
  } }, { upsert: true });
  const prev = await WorkerStatus.findById("worker").select("online").lean();
  if (prev && prev.online === false) logEvent("worker", "Laptop worker is back online", { level: "success" });
  await WorkerStatus.updateOne({ _id: "worker" }, { $set: { online: true, paused: !!b.paused } });
  await trackSessions(sessions);
  const cmds = await Command.find({ status: "pending" }).sort({ createdAt: 1 }).limit(10).lean();
  if (cmds.length) await Command.updateMany({ _id: { $in: cmds.map((c) => c._id) } }, { $set: { status: "sent", sentAt: new Date() } });
  notify("worker");
  res.json({ ok: true, commands: cmds.map((c) => ({ id: String(c._id), type: c.type, payload: c.payload })) });
});

async function trackSessions(sessions) {
  const now = new Date();
  const ids = [];
  for (const s of sessions) {
    if (!s.videoId) continue;
    ids.push(String(s.videoId));
    const creatorId = s.creatorId && /^[0-9a-f]{24}$/.test(s.creatorId) ? s.creatorId : null;
    if (creatorId) await Creator.updateOne({ _id: creatorId }, { $set: { lastLiveAt: now, lastLiveTitle: String(s.title || "").slice(0, 200) } });
    const set = { lastSeenAt: now, endedAt: null, title: String(s.title || "").slice(0, 200), chatMessages: Number(s.chatMessages) || 0,
      chatBackend: String(s.chatBackend || ""), moments: Number(s.moments) || 0,
      recordedSeconds: s.recordedUntil && s.since ? Math.max(0, s.recordedUntil - s.since) : 0 };
    const existing = await LiveSession.findOneAndUpdate({ videoId: String(s.videoId) }, { $set: set }).lean();
    if (!existing) {
      await LiveSession.create({ videoId: String(s.videoId), creator: creatorId, creatorName: s.creator, platform: s.platform,
        startedAt: s.since ? new Date(s.since * 1000) : now, ...set });
      logEvent("live", `${s.creator} went live: ${s.title || ""}`.trim(), { level: "success", creator: creatorId, platform: s.platform });
    } else if (existing.endedAt) {
      logEvent("live", `Recording ${s.creator} again (resumed)`, { creator: creatorId });
    }
  }
  const ended = await LiveSession.find({ endedAt: null, videoId: { $nin: ids } }).lean();
  for (const e of ended) {
    await LiveSession.updateOne({ _id: e._id }, { $set: { endedAt: now } });
    logEvent("ended", `${e.creatorName} stream ended · ${Math.round((e.recordedSeconds || 0) / 60)} min recorded, ${e.moments || 0} moments`,
      { creator: e.creator });
  }
}

/** Worker reports what happened with a command. */
worker.post("/commands/:id/result", async (req, res) => {
  if (!/^[0-9a-f]{24}$/.test(req.params.id)) throw new HttpError(404, "no such command");
  const ok = !!req.body?.ok;
  const c = await Command.findByIdAndUpdate(req.params.id, { $set: { status: ok ? "done" : "failed",
    result: String(req.body?.result || "").slice(0, 500), doneAt: new Date() } }, { returnDocument: "after" }).lean();
  if (!c) throw new HttpError(404, "no such command");
  if (ok && (c.type === "pause" || c.type === "resume")) await WorkerStatus.updateOne({ _id: "worker" }, { $set: { paused: c.type === "pause" } });
  logEvent("command", `${c.type.replace("_", " ")}: ${c.result || (ok ? "done" : "failed")}`, { level: ok ? "info" : "warn" });
  notify("commands");
  res.json({ ok: true });
});

// ---------------------------------------------------------------- clips from the worker
worker.post("/clips", upload.fields([{ name: "thumb", maxCount: 1 }, { name: "preview", maxCount: 1 }]), async (req, res) => {
  let meta;
  try { meta = JSON.parse(req.body.meta || "{}"); } catch { throw new HttpError(400, "meta must be JSON"); }
  if (!meta.clipId || !/^[\w.-]{3,120}$/.test(meta.clipId)) throw new HttpError(400, "clipId missing or invalid");
  const creator = meta.creatorId && /^[0-9a-f]{24}$/.test(meta.creatorId) ? await Creator.findById(meta.creatorId) : null;
  const settings = await getSettings();
  let clip = await Clip.findOne({ clipId: meta.clipId });
  const isNew = !clip;
  if (!clip) clip = new Clip({ clipId: meta.clipId });
  if (!isNew && clip.publications.some((p) => p.status === "published" || p.status === "uploading")) {
    return res.json({ id: clip._id, status: clip.status, unchanged: true });
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
  const files = req.files || {};
  if (files.thumb?.[0]) { await removeFile(clip.thumbFile); clip.thumbFile = await saveBuffer(files.thumb[0].buffer, `${meta.clipId}.jpg`, "image/jpeg"); }
  if (files.preview?.[0]) {
    if (files.preview[0].size > config.maxPreviewBytes) throw new HttpError(413, "preview too large");
    await removeFile(clip.previewFile);
    clip.previewFile = await saveBuffer(files.preview[0].buffer, `${meta.clipId}.mp4`, "video/mp4");
  }
  // clips the laptop already published before it was linked to this server (migration): record, never re-upload
  const already = Array.isArray(meta.alreadyPublished) ? meta.alreadyPublished.filter((p) => ["youtube", "instagram"].includes(p.platform)) : [];
  if (already.length) {
    clip.publications = already.map((p) => ({ platform: p.platform, status: "published", externalId: p.externalId, url: p.url,
      privacy: p.privacy, updatedAt: new Date() }));
    clip.status = "published";
    clip.approved = true;
    await clip.save();
    return res.status(isNew ? 201 : 200).json({ id: clip._id, status: clip.status });
  }
  // decide what happens to it
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
  await clip.save();
  if (isNew) {
    const what = clip.status === "ready" ? "queued to publish" : clip.status === "pending" ? "needs approval" : "rejected";
    logEvent("clip", `New clip from ${clip.creatorName || "a stream"}: ${clip.title} (${what})`,
      { level: clip.status === "rejected" ? "info" : "success", clip: clip._id, creator: clip.creator });
  }
  notify("clips");
  res.status(isNew ? 201 : 200).json({ id: clip._id, status: clip.status });
});

// ---------------------------------------------------------------- publishing jobs
/** Next YouTube job for the worker (it has the video file). Best score first, limits respected. */
worker.get("/jobs/next", async (req, res) => {
  if (!(await Account.exists({ platform: "youtube" }))) return res.json({ job: null, reason: "YouTube is not connected" });
  const can = await canPublish("youtube");
  if (!can.ok) return res.json({ job: null, reason: can.reason, waitMs: can.waitMs });
  const clip = await Clip.findOne({ status: "ready", publications: { $elemMatch: { platform: "youtube", status: "queued" } } })
    .sort({ priority: -1, score: -1, createdAt: 1 }).populate("creator");
  if (!clip) return res.json({ job: null });
  const settings = await getSettings();
  const pub = clip.publications.find((p) => p.platform === "youtube");
  pub.status = "uploading"; pub.attempts += 1; pub.updatedAt = new Date();
  await clip.save();
  res.json({ job: {
    clipId: clip.clipId, platform: "youtube", title: clip.title, description: ensureCredit(clip.description, clip.creator?.creditLine),
    tags: [...new Set([...(clip.tags || []), ...(settings.defaultTags || [])])], privacy: settings.privacy, categoryId: "20",
  } });
});

worker.post("/youtube-token", async (req, res) => {
  res.json(await youtubeAccessToken());
});

worker.post("/jobs/:clipId/result", async (req, res) => {
  const { platform = "youtube", ok, externalId, url, privacy, error, retry } = req.body || {};
  const clip = await Clip.findOne({ clipId: req.params.clipId });
  if (!clip) throw new HttpError(404, "clip not found");
  const pub = clip.publications.find((p) => p.platform === platform);
  if (!pub) throw new HttpError(400, "no such publication");
  Object.assign(pub, ok ? { status: "published", externalId, url, privacy, error: undefined }
    : { status: retry ? "queued" : "failed", error: String(error || "failed").slice(0, 500) });
  pub.updatedAt = new Date();
  if (ok) await countPublish(platform);
  if (clip.publications.every((p) => p.status === "published")) clip.status = "published";
  else if (clip.publications.some((p) => p.status === "failed") && !clip.publications.some((p) => ["queued", "uploading"].includes(p.status))) clip.status = "failed";
  await clip.save();
  if (ok) logEvent("published", `Published to ${platform === "youtube" ? "YouTube" : "Instagram"}: ${clip.title}`, { level: "success", clip: clip._id, platform, url });
  else logEvent("failed", `${platform} upload ${retry ? "will retry" : "failed"}: ${clip.title} (${String(error || "").slice(0, 120)})`,
    { level: retry ? "warn" : "error", clip: clip._id, platform });
  notify("clips");
  res.json({ ok: true, status: clip.status });
});

/** Instagram needs to download the video from a public URL: the worker hands us the file,
 *  we publish it with a one-time URL and delete it afterwards. */
worker.get("/instagram/next", async (req, res) => {
  if (!(await Account.exists({ platform: "instagram" }))) return res.json({ clipId: null, reason: "Instagram is not connected" });
  if (await Clip.exists({ publishFile: { $ne: null } })) return res.json({ clipId: null, reason: "an Instagram upload is in progress" });
  const clip = await Clip.findOne({ status: "ready", publications: { $elemMatch: { platform: "instagram", status: "queued" } } })
    .sort({ priority: -1, score: -1, createdAt: 1 }).lean();
  const can = await canPublish("instagram");
  res.json({ clipId: clip && can.ok ? clip.clipId : null, reason: can.ok ? undefined : can.reason });
});

worker.post("/instagram/:clipId/file", upload.single("file"), async (req, res) => {
  const clip = await Clip.findOne({ clipId: req.params.clipId });
  if (!clip || !req.file) throw new HttpError(400, "clip or file missing");
  await removeFile(clip.publishFile);
  clip.publishFile = await saveBuffer(req.file.buffer, `${clip.clipId}-full.mp4`, "video/mp4");
  clip.publishToken = crypto.randomBytes(24).toString("hex");
  await clip.save();
  const { publishToInstagram } = await import("../instagram.js");
  publishToInstagram(clip._id).catch(() => {});   // runs in the background; result lands on the clip
  res.json({ ok: true });
});
