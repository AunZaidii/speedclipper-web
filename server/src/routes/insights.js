// Real-time stream, activity, streams history, remote commands, publishing queue, analytics, bulk actions, secrets.
import express from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireUser } from "../auth.js";
import { decrypt, encrypt } from "../crypto.js";
import { bus, logEvent, notify } from "../events.js";
import { removeFile } from "../media.js";
import { Account, Clip, Command, Creator, Event, LiveSession, Quota, Setting, WorkerStatus, getSettings } from "../models.js";
import { HttpError, pacificDay } from "../util.js";
import { queuePublications } from "./worker.js";

export const insights = express.Router();
insights.use(requireUser);

// ---------------------------------------------------------------- Server-Sent Events
insights.get("/stream", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive",
    "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write("retry: 5000\n\n");
  const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  bus.on("event", send);
  req.on("close", () => { clearInterval(ping); bus.off("event", send); });
});

// ---------------------------------------------------------------- activity
insights.get("/events", async (req, res) => {
  const q = {};
  if (req.query.type) q.type = { $in: String(req.query.type).split(",") };
  if (req.query.before) q.at = { $lt: new Date(String(req.query.before)) };
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  res.json(await Event.find(q).sort({ at: -1 }).limit(limit).lean());
});

// ---------------------------------------------------------------- streams history
insights.get("/sessions", async (req, res) => {
  const q = {};
  if (req.query.creator && mongoose.isValidObjectId(req.query.creator)) q.creator = req.query.creator;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const list = await LiveSession.find(q).sort({ startedAt: -1 }).limit(limit).lean();
  const clipCounts = await Clip.aggregate([{ $match: { videoId: { $in: list.map((s) => s.videoId) } } },
    { $group: { _id: { v: "$videoId", s: "$status" }, n: { $sum: 1 } } }]);
  res.json(list.map((s) => {
    const mine = clipCounts.filter((c) => c._id.v === s.videoId);
    return { ...s, live: !s.endedAt, clips: mine.reduce((a, c) => a + c.n, 0), published: mine.find((c) => c._id.s === "published")?.n || 0 };
  }));
});

// ---------------------------------------------------------------- remote commands for the laptop
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

insights.post("/commands", async (req, res) => {
  const r = commandSchema.safeParse(req.body || {});
  if (!r.success) throw new HttpError(400, r.error.issues[0].message);
  const { type, payload = {} } = r.data;
  if (payload.creatorId && !(await Creator.exists({ _id: payload.creatorId }))) throw new HttpError(404, "creator not found");
  const dup = await Command.findOne({ type, "payload.creatorId": payload.creatorId, "payload.url": payload.url, status: { $in: ["pending", "sent"] } }).lean();
  if (dup) return res.json(dup);
  const cmd = await Command.create({ type, payload });
  const what = { check_now: "Check if live now", stop_session: "Stop recording", pause: "Pause monitoring", resume: "Resume monitoring",
    vod: `Process past stream ${payload.url}` }[type];
  logEvent("command", `${what}: sent to the laptop`);
  notify("commands");
  res.status(201).json(cmd);
});

insights.get("/commands", async (req, res) => {
  res.json(await Command.find().sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit) || 20, 100)).lean());
});

// ---------------------------------------------------------------- publishing queue with ETAs
insights.get("/queue", async (req, res) => {
  const s = await getSettings();
  const gap = s.minMinutesBetweenUploads * 60000;
  const accounts = new Set((await Account.find().select("platform").lean()).map((a) => a.platform));
  const clips = await Clip.find({ status: "ready", "publications.status": { $in: ["queued", "uploading"] } })
    .sort({ priority: -1, score: -1, createdAt: 1 }).select("title score creatorName thumbFile publications createdAt priority").lean();
  const out = {};
  for (const platform of ["youtube", "instagram"]) {
    const q = await Quota.findById(`${platform}:${pacificDay()}`).lean();
    const last = (await Quota.find({ _id: new RegExp(`^${platform}:`) }).sort({ lastAt: -1 }).limit(1).lean())[0]?.lastAt;
    let slot = Math.max(Date.now(), last ? new Date(last).getTime() + gap : 0);
    let usedToday = q?.uploads || 0;
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
    out[platform] = { connected: accounts.has(platform), uploadsToday: q?.uploads || 0, maxPerDay: s.maxUploadsPerDay, items,
      enabled: s.uploadsEnabled };
  }
  const failed = await Clip.find({ "publications.status": "failed" }).sort({ updatedAt: -1 }).limit(30)
    .select("title score creatorName publications updatedAt").lean();
  res.json({ ...out, failed });
});

// ---------------------------------------------------------------- clip actions
insights.post("/clips/:id/retry", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, "clip not found");
  const c = await Clip.findById(req.params.id);
  if (!c) throw new HttpError(404, "clip not found");
  let n = 0;
  for (const p of c.publications) if (p.status === "failed") { p.status = "queued"; p.error = undefined; p.attempts = 0; n++; }
  if (!n) throw new HttpError(400, "nothing to retry");
  c.status = "ready";
  await c.save();
  logEvent("approved", `Retrying ${n} upload(s): ${c.title}`, { clip: c._id });
  notify("clips");
  res.json(c);
});

insights.post("/clips/:id/priority", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, "clip not found");
  const pin = req.body?.pin !== false;
  const c = await Clip.findByIdAndUpdate(req.params.id, { $set: { priority: pin ? Date.now() : 0 } }, { returnDocument: "after" }).lean();
  if (!c) throw new HttpError(404, "clip not found");
  if (pin) logEvent("approved", `Moved to the front of the queue: ${c.title}`, { clip: c._id });
  notify("clips");
  res.json(c);
});

insights.post("/clips/bulk", async (req, res) => {
  const { ids, action } = req.body || {};
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || !ids.every((x) => mongoose.isValidObjectId(x))) throw new HttpError(400, "select 1-200 clips");
  if (!["approve", "reject", "delete"].includes(action)) throw new HttpError(400, "unknown action");
  const clips = await Clip.find({ _id: { $in: ids } }).populate("creator");
  let done = 0, skipped = 0;
  for (const c of clips) {
    if (c.publications.some((p) => ["uploading", "published"].includes(p.status))) { skipped++; continue; }
    if (action === "approve") { c.approved = true; c.status = "ready"; c.rejectReason = undefined; queuePublications(c); await c.save(); }
    if (action === "reject") { c.status = "rejected"; c.approved = false; c.rejectReason = c.rejectReason || "rejected in dashboard"; c.publications = []; await c.save(); }
    if (action === "delete") { await Promise.all([removeFile(c.thumbFile), removeFile(c.previewFile), removeFile(c.publishFile)]); await c.deleteOne(); }
    done++;
  }
  logEvent(action === "approve" ? "approved" : action === "reject" ? "rejected" : "clip", `${action === "delete" ? "Deleted" : action === "approve" ? "Approved" : "Rejected"} ${done} clip(s)${skipped ? ` (${skipped} already published, skipped)` : ""}`);
  notify("clips");
  res.json({ done, skipped });
});

// ---------------------------------------------------------------- analytics
const dayKey = { $dateToString: { format: "%Y-%m-%d", date: "$at" } };
insights.get("/analytics", async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 90);
  const since = new Date(Date.now() - days * 86400000);
  const [clipsByDay, pubsByDay, scoreHist, perCreator, topClips, sessions, totals, statusCounts] = await Promise.all([
    Clip.aggregate([{ $match: { createdAt: { $gte: since } } },
      { $group: { _id: { d: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, s: "$status" }, n: { $sum: 1 } } }]),
    Event.aggregate([{ $match: { type: "published", at: { $gte: since } } }, { $group: { _id: { d: dayKey, p: "$platform" }, n: { $sum: 1 } } }]),
    Clip.aggregate([{ $match: { createdAt: { $gte: since }, score: { $ne: null } } }, { $group: { _id: { $floor: "$score" }, n: { $sum: 1 } } }]),
    Clip.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: "$creatorName", clips: { $sum: 1 },
      published: { $sum: { $cond: [{ $eq: ["$status", "published"] }, 1, 0] } }, avgScore: { $avg: "$score" } } }, { $sort: { clips: -1 } }, { $limit: 10 }]),
    Clip.find({ createdAt: { $gte: since } }).sort({ score: -1 }).limit(5).select("title score creatorName status thumbFile publications").lean(),
    LiveSession.aggregate([{ $match: { startedAt: { $gte: since } } }, { $group: { _id: null, n: { $sum: 1 }, seconds: { $sum: "$recordedSeconds" },
      moments: { $sum: "$moments" }, chat: { $sum: "$chatMessages" } } }]),
    Clip.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: null, n: { $sum: 1 }, avg: { $avg: "$score" } } }]),
    Clip.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
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

// ---------------------------------------------------------------- secrets (AI key) + worker pause state
async function readSecrets() {
  const doc = await Setting.findById("global").select("secrets").lean();
  try { return doc?.secrets ? decrypt(doc.secrets) : {}; } catch { return {}; }
}

insights.get("/secrets", async (req, res) => {
  const s = await readSecrets();
  res.json({ anthropicKey: s.anthropicKey ? `${s.anthropicKey.slice(0, 10)}…${s.anthropicKey.slice(-4)}` : null });
});

insights.put("/secrets/anthropic", async (req, res) => {
  const key = String(req.body?.key || "").trim();
  if (key && !/^sk-ant-[\w-]{20,}$/.test(key)) throw new HttpError(400, "That key doesn't look right. Anthropic keys start with sk-ant- and are long, so copy the whole key and try again.");
  const s = await readSecrets();
  if (key) s.anthropicKey = key; else delete s.anthropicKey;
  await Setting.updateOne({ _id: "global" }, { $set: { secrets: encrypt(s) } }, { upsert: true });
  logEvent("settings", key ? "AI scoring key saved (the laptop picks it up within a minute)" : "AI scoring key removed");
  res.json({ anthropicKey: key ? `${key.slice(0, 10)}…${key.slice(-4)}` : null });
});

insights.get("/worker-status", async (req, res) => {
  const w = await WorkerStatus.findById("worker").lean();
  res.json({ ...(w || {}), online: !!w?.lastSeen && Date.now() - new Date(w.lastSeen) < 90000 });
});

/** Background: notice when the laptop stops sending heartbeats. */
export function startMonitor(everyMs = 30000) {
  return setInterval(async () => {
    try {
      const w = await WorkerStatus.findById("worker").lean();
      if (w?.online && w.lastSeen && Date.now() - new Date(w.lastSeen) > 120000) {
        await WorkerStatus.updateOne({ _id: "worker" }, { $set: { online: false, sessions: [] } });
        // recordings can't continue without the laptop; a heartbeat after it's back marks them "resumed"
        const open = await LiveSession.updateMany({ endedAt: null }, { $set: { endedAt: new Date() } });
        logEvent("worker", `Laptop worker went offline (no heartbeat for 2 min)${open.modifiedCount ? `; ${open.modifiedCount} recording(s) interrupted` : ""}`, { level: "warn" });
        notify("worker");
      }
    } catch { /* db hiccup */ }
  }, everyMs);
}
