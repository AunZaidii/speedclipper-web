// Real-time stream, activity, streams history, remote commands, publishing queue, analytics, bulk actions, secrets.
// Everything is limited to the signed-in user's own data; worker/platform internals are admin-only.
import express from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireAdmin, requireUser } from "../auth.js";
import { decrypt, encrypt } from "../crypto.js";
import { bus, logEvent, notify, visibleTo } from "../events.js";
import { Account, Clip, Command, Creator, Event, LiveSession, Setting, User, WorkerStatus, getSettings } from "../models.js";
import { HttpError, lastUploadAt, uploadsToday } from "../util.js";
import { deleteClip, workerView } from "./api.js";
import { queuePublications } from "./worker.js";

export const insights = express.Router();
insights.use(requireUser);

const mine = (req, extra = {}) => ({ owner: req.user._id, ...extra });
const isAdmin = (req) => req.user.role === "admin";
const myChannels = async (req) => (await Creator.find(mine(req)).select("channel").lean()).map((c) => c.channel);

// ---------------------------------------------------------------- Server-Sent Events
insights.get("/stream", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive",
    "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write("retry: 5000\n\n");
  const send = (e) => { if (visibleTo(e, req.user)) res.write(`data: ${JSON.stringify(e)}\n\n`); };
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  bus.on("event", send);
  req.on("close", () => { clearInterval(ping); bus.off("event", send); });
});

// ---------------------------------------------------------------- activity
insights.get("/events", async (req, res) => {
  const q = isAdmin(req) ? { $or: [{ owner: req.user._id }, { owner: null }] } : mine(req);
  if (req.query.type) q.type = { $in: String(req.query.type).split(",") };
  if (req.query.before) q.at = { $lt: new Date(String(req.query.before)) };
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  res.json(await Event.find(q).sort({ at: -1 }).limit(limit).lean());
});

// ---------------------------------------------------------------- streams history (streams of channels you follow)
insights.get("/sessions", async (req, res) => {
  const creators = await Creator.find(mine(req)).select("channel name").lean();
  let channels = creators.map((c) => c.channel);
  if (req.query.creator && mongoose.isValidObjectId(req.query.creator)) {
    channels = creators.filter((c) => String(c._id) === String(req.query.creator)).map((c) => c.channel);
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const list = await LiveSession.find({ channel: { $in: channels } }).sort({ startedAt: -1 }).limit(limit).lean();
  const clipCounts = await Clip.aggregate([{ $match: mine(req, { videoId: { $in: list.map((s) => s.videoId) } }) },
    { $group: { _id: { v: "$videoId", s: "$status" }, n: { $sum: 1 } } }]);
  res.json(list.map((s) => {
    const c = creators.find((x) => x.channel === s.channel);
    const counts = clipCounts.filter((x) => x._id.v === s.videoId);
    return { ...s, creator: c?._id || null, live: !s.endedAt, clips: counts.reduce((a, x) => a + x.n, 0),
      published: counts.find((x) => x._id.s === "published")?.n || 0 };
  }));
});

// ---------------------------------------------------------------- remote commands
const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("check_now"), payload: z.object({ creatorId: z.string().regex(/^[0-9a-f]{24}$/) }) }),
  z.object({ type: z.literal("stop_session"), payload: z.object({ creatorId: z.string().regex(/^[0-9a-f]{24}$/) }) }),
  z.object({ type: z.literal("pause"), payload: z.object({}).optional() }),
  z.object({ type: z.literal("resume"), payload: z.object({}).optional() }),
  z.object({ type: z.literal("vod"), payload: z.object({
    url: z.string().regex(/^https:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{6,}/, "paste a YouTube video link"),
    maxMinutes: z.coerce.number().min(1).max(720).optional(),
    creatorId: z.string().regex(/^[0-9a-f]{24}$/).optional() }) }),
]);

const videoIdOf = (url) => (/(?:v=|youtu\.be\/)([\w-]{6,})/.exec(url) || [])[1];

insights.post("/commands", async (req, res) => {
  const r = commandSchema.safeParse(req.body || {});
  if (!r.success) throw new HttpError(400, r.error.issues[0].message);
  const { type, payload = {} } = r.data;
  const owner = req.user._id;
  const creator = payload.creatorId ? await Creator.findOne(mine(req, { _id: payload.creatorId })).lean() : null;
  if (payload.creatorId && !creator) throw new HttpError(404, "creator not found");

  // pausing: a user pauses their own monitoring; the admin pauses the whole worker
  if ((type === "pause" || type === "resume") && !isAdmin(req)) {
    await User.updateOne({ _id: owner }, { $set: { paused: type === "pause" } });
    logEvent("command", type === "pause" ? "Monitoring paused (your creators are not watched until you resume)" : "Monitoring resumed", { owner });
    notify("worker", { owner });
    return res.status(201).json({ type, status: "done" });
  }

  // "stop recording" just for you when other people follow the same channel
  if (type === "stop_session") {
    const w = await WorkerStatus.findById("worker").lean();
    const live = (w?.sessions || []).find((s) => s.creatorId === creator.channel);
    if (!live) throw new HttpError(409, "that creator is not being recorded");
    await Creator.updateOne({ _id: creator._id }, { $set: { skipVideoId: String(live.videoId) } });
    const others = await Creator.exists({ channel: creator.channel, _id: { $ne: creator._id }, enabled: true,
      skipVideoId: { $ne: String(live.videoId) } });
    if (others) {
      logEvent("command", `Stopped clipping ${creator.name} for you (others still follow this stream)`, { owner });
      notify("creators", { owner });
      return res.status(201).json({ type, status: "done" });
    }
  }

  const workerPayload = { ...payload };
  if (creator) { workerPayload.creatorId = creator.channel; workerPayload.creator = String(creator._id); }
  if (type === "vod") workerPayload.videoId = videoIdOf(payload.url);
  const dup = await Command.findOne({ owner, type, "payload.creator": workerPayload.creator, "payload.url": payload.url, status: { $in: ["pending", "sent"] } }).lean();
  if (dup) return res.json(dup);
  const cmd = await Command.create({ owner, type, payload: workerPayload });
  const what = { check_now: "Check if live now", stop_session: "Stop recording", pause: "Pause the worker", resume: "Resume the worker",
    vod: `Process past stream ${payload.url}` }[type];
  logEvent("command", `${what}: sent to the clipping worker`, { owner });
  notify("commands", { owner });
  res.status(201).json(cmd);
});

insights.get("/commands", async (req, res) => {
  res.json(await Command.find(mine(req)).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit) || 20, 100)).lean());
});

// ---------------------------------------------------------------- publishing queue with ETAs
insights.get("/queue", async (req, res) => {
  const s = await getSettings(req.user._id);
  const gap = s.minMinutesBetweenUploads * 60000;
  const accounts = new Set((await Account.find(mine(req)).select("platform").lean()).map((a) => a.platform));
  const clips = await Clip.find(mine(req, { status: "ready", "publications.status": { $in: ["queued", "uploading"] } }))
    .sort({ priority: -1, score: -1, createdAt: 1 }).select("title score creatorName thumbFile publications createdAt priority").lean();
  const out = {};
  for (const platform of ["youtube", "instagram"]) {
    const today = await uploadsToday(req.user._id, platform);
    const last = await lastUploadAt(req.user._id, platform);
    let slot = Math.max(Date.now(), last ? new Date(last).getTime() + gap : 0);
    let usedToday = today;
    const items = [];
    for (const c of clips) {
      const pub = c.publications.find((p) => p.platform === platform && ["queued", "uploading"].includes(p.status));
      if (!pub) continue;
      if (usedToday >= s.maxUploadsPerDay) {      // roll to the next Pacific day (approximate: +24 h from now at midnight PT)
        const now = new Date(slot);
        const pt = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
        slot += (24 * 3600 - (pt.getHours() * 3600 + pt.getMinutes() * 60 + pt.getSeconds())) * 1000;
        usedToday = 0;
      }
      items.push({ clipId: c._id, title: c.title, score: c.score, creatorName: c.creatorName, thumb: !!c.thumbFile, pinned: (c.priority || 0) > 0,
        status: pub.status, attempts: pub.attempts, error: pub.error, eta: pub.status === "uploading" ? null : new Date(slot) });
      if (pub.status !== "uploading") { slot += gap; usedToday += 1; }
    }
    out[platform] = { connected: accounts.has(platform), uploadsToday: today, maxPerDay: s.maxUploadsPerDay, items, enabled: s.uploadsEnabled };
  }
  const failed = await Clip.find(mine(req, { "publications.status": "failed" })).sort({ updatedAt: -1 }).limit(30)
    .select("title score creatorName publications updatedAt").lean();
  res.json({ ...out, failed });
});

// ---------------------------------------------------------------- clip actions
insights.post("/clips/:id/retry", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, "clip not found");
  const c = await Clip.findOne(mine(req, { _id: req.params.id }));
  if (!c) throw new HttpError(404, "clip not found");
  let n = 0;
  for (const p of c.publications) if (p.status === "failed") { p.status = "queued"; p.error = undefined; p.attempts = 0; n++; }
  if (!n) throw new HttpError(400, "nothing to retry");
  c.status = "ready";
  await c.save();
  logEvent("approved", `Retrying ${n} upload(s): ${c.title}`, { owner: req.user._id, clip: c._id });
  notify("clips", { owner: req.user._id });
  res.json(c);
});

insights.post("/clips/:id/priority", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, "clip not found");
  const pin = req.body?.pin !== false;
  const c = await Clip.findOneAndUpdate(mine(req, { _id: req.params.id }), { $set: { priority: pin ? Date.now() : 0 } }, { returnDocument: "after" }).lean();
  if (!c) throw new HttpError(404, "clip not found");
  if (pin) logEvent("approved", `Moved to the front of the queue: ${c.title}`, { owner: req.user._id, clip: c._id });
  notify("clips", { owner: req.user._id });
  res.json(c);
});

insights.post("/clips/bulk", async (req, res) => {
  const { ids, action } = req.body || {};
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || !ids.every((x) => mongoose.isValidObjectId(x))) throw new HttpError(400, "select 1-200 clips");
  if (!["approve", "reject", "delete"].includes(action)) throw new HttpError(400, "unknown action");
  const clips = await Clip.find(mine(req, { _id: { $in: ids } })).populate("creator");
  let done = 0, skipped = 0;
  for (const c of clips) {
    if (c.publications.some((p) => ["uploading", "published"].includes(p.status))) { skipped++; continue; }
    if (action === "approve") { c.approved = true; c.status = "ready"; c.rejectReason = undefined; queuePublications(c); await c.save(); }
    if (action === "reject") { c.status = "rejected"; c.approved = false; c.rejectReason = c.rejectReason || "rejected in dashboard"; c.publications = []; await c.save(); }
    if (action === "delete") await deleteClip(c);
    done++;
  }
  logEvent(action === "approve" ? "approved" : action === "reject" ? "rejected" : "clip",
    `${action === "delete" ? "Deleted" : action === "approve" ? "Approved" : "Rejected"} ${done} clip(s)${skipped ? ` (${skipped} already published, skipped)` : ""}`,
    { owner: req.user._id });
  notify("clips", { owner: req.user._id });
  res.json({ done, skipped });
});

// ---------------------------------------------------------------- analytics
const dayKey = { $dateToString: { format: "%Y-%m-%d", date: "$at" } };
insights.get("/analytics", async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 90);
  const since = new Date(Date.now() - days * 86400000);
  const owner = req.user._id;
  const recent = { owner, createdAt: { $gte: since } };
  const channels = await myChannels(req);
  const [clipsByDay, pubsByDay, scoreHist, perCreator, topClips, sessions, totals, statusCounts] = await Promise.all([
    Clip.aggregate([{ $match: recent },
      { $group: { _id: { d: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, s: "$status" }, n: { $sum: 1 } } }]),
    Event.aggregate([{ $match: { owner, type: "published", at: { $gte: since } } }, { $group: { _id: { d: dayKey, p: "$platform" }, n: { $sum: 1 } } }]),
    Clip.aggregate([{ $match: { ...recent, score: { $ne: null } } }, { $group: { _id: { $floor: "$score" }, n: { $sum: 1 } } }]),
    Clip.aggregate([{ $match: recent }, { $group: { _id: "$creatorName", clips: { $sum: 1 },
      published: { $sum: { $cond: [{ $eq: ["$status", "published"] }, 1, 0] } }, avgScore: { $avg: "$score" } } }, { $sort: { clips: -1 } }, { $limit: 10 }]),
    Clip.find(recent).sort({ score: -1 }).limit(5).select("title score creatorName status thumbFile publications").lean(),
    LiveSession.aggregate([{ $match: { channel: { $in: channels }, startedAt: { $gte: since } } }, { $group: { _id: null, n: { $sum: 1 }, seconds: { $sum: "$recordedSeconds" },
      moments: { $sum: "$moments" }, chat: { $sum: "$chatMessages" } } }]),
    Clip.aggregate([{ $match: recent }, { $group: { _id: null, n: { $sum: 1 }, avg: { $avg: "$score" } } }]),
    Clip.aggregate([{ $match: recent }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
  ]);
  const dates = Array.from({ length: days }, (_, i) => new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().slice(0, 10));
  res.json({
    days, dates,
    clipsByDay: dates.map((d) => ({ date: d, ...Object.fromEntries(clipsByDay.filter((x) => x._id.d === d).map((x) => [x._id.s, x.n])) })),
    publishedByDay: dates.map((d) => ({ date: d, youtube: pubsByDay.find((x) => x._id.d === d && x._id.p === "youtube")?.n || 0,
      instagram: pubsByDay.find((x) => x._id.d === d && x._id.p === "instagram")?.n || 0 })),
    scoreHistogram: Array.from({ length: 10 }, (_, i) => ({ score: i + 1, n: scoreHist.find((x) => x._id === i + 1)?.n || 0 })),
    perCreator: perCreator.map((c) => ({ name: c._id || "unknown", clips: c.clips, published: c.published, avgScore: c.avgScore })),
    topClips,
    totals: { clips: totals[0]?.n || 0, avgScore: totals[0]?.avg || null, sessions: sessions[0]?.n || 0,
      hoursRecorded: (sessions[0]?.seconds || 0) / 3600, moments: sessions[0]?.moments || 0, chatMessages: sessions[0]?.chat || 0,
      byStatus: Object.fromEntries(statusCounts.map((s) => [s._id, s.n])),
      published: pubsByDay.reduce((a, x) => a + x.n, 0) },
  });
});

// ---------------------------------------------------------------- AI key (platform-wide, admin) + worker status
async function readSecrets() {
  const doc = await Setting.findById("platform").select("secrets").lean();
  try { return doc?.secrets ? decrypt(doc.secrets) : {}; } catch { return {}; }
}

insights.get("/secrets", async (req, res) => {
  const s = await readSecrets();
  res.json({ anthropicKey: s.anthropicKey ? (isAdmin(req) ? `${s.anthropicKey.slice(0, 10)}…${s.anthropicKey.slice(-4)}` : "set") : null,
    canEdit: isAdmin(req) });
});

insights.put("/secrets/anthropic", requireAdmin, async (req, res) => {
  const key = String(req.body?.key || "").trim();
  if (key && !/^sk-ant-[\w-]{20,}$/.test(key)) throw new HttpError(400, "That key doesn't look right. Anthropic keys start with sk-ant- and are long, so copy the whole key and try again.");
  const s = await readSecrets();
  if (key) s.anthropicKey = key; else delete s.anthropicKey;
  await Setting.updateOne({ _id: "platform" }, { $set: { secrets: encrypt(s) } }, { upsert: true });
  logEvent("settings", key ? "AI scoring key saved (the worker picks it up within a minute)" : "AI scoring key removed", { owner: req.user._id });
  res.json({ anthropicKey: key ? `${key.slice(0, 10)}…${key.slice(-4)}` : null, canEdit: true });
});

insights.get("/worker-status", async (req, res) => {
  res.json(workerView(await WorkerStatus.findById("worker").lean(), req));
});

/** Background: notice when the worker stops sending heartbeats. */
export function startMonitor(everyMs = 30000) {
  return setInterval(async () => {
    try {
      const w = await WorkerStatus.findById("worker").lean();
      if (w?.online && w.lastSeen && Date.now() - new Date(w.lastSeen) > 120000) {
        await WorkerStatus.updateOne({ _id: "worker" }, { $set: { online: false, sessions: [] } });
        // recordings can't continue without the worker; a heartbeat after it's back marks them "resumed"
        const open = await LiveSession.updateMany({ endedAt: null }, { $set: { endedAt: new Date() } });
        logEvent("worker", `Clipping worker went offline (no heartbeat for 2 min)${open.modifiedCount ? `; ${open.modifiedCount} recording(s) interrupted` : ""}`, { level: "warn" });
        notify("worker");
      }
    } catch { /* db hiccup */ }
  }, everyMs);
}
