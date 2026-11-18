// Dashboard API (signed-in user). Every query is limited to the user's own data (`owner`).
import express from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireUser } from "../auth.js";
import { logEvent, notify } from "../events.js";
import { releaseFile, streamFile } from "../media.js";
import {
  Account, Clip, Creator, DEFAULT_PLATFORM_SETTINGS, DEFAULT_USER_SETTINGS, Setting, WorkerStatus,
  getPlatformSettings, getSettings, getUserSettings,
} from "../models.js";
import { HttpError, buildCreator, canPublish, ensureCredit, uploadsToday } from "../util.js";
import { queuePublications } from "./worker.js";

export const api = express.Router();
api.use(requireUser);

const oid = (id) => {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, "not found");
  return id;
};
const mine = (req, extra = {}) => ({ owner: req.user._id, ...extra });
const isAdmin = (req) => req.user.role === "admin";

/** Worker status as a user sees it (the admin also gets host, disk and log details). */
export function workerView(w, req) {
  const online = !!w?.lastSeen && Date.now() - new Date(w.lastSeen) < 90_000;
  if (!w) return { online: false };
  if (isAdmin(req)) return { ...w, online };
  return { online, lastSeen: w.lastSeen, state: w.state, paused: w.paused, editQueue: w.editQueue, editing: w.editing,
    sessions: [], version: w.version };
}

// ---------------------------------------------------------------- overview
api.get("/overview", async (req, res) => {
  const [worker, statusCounts, creators, accounts, settings] = await Promise.all([
    WorkerStatus.findById("worker").lean(),
    Clip.aggregate([{ $match: mine(req) }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    Creator.find(mine(req)).lean(),
    Account.find(mine(req)).select("platform displayName connectedAt expiresAt").lean(),
    getSettings(req.user._id),
  ]);
  const channels = new Set(creators.map((c) => c.channel));
  const view = workerView(worker, req);
  if (!isAdmin(req)) view.sessions = (worker?.sessions || []).filter((s) => channels.has(s.creatorId)).map((s) => mapSession(s, creators));
  else view.sessions = (worker?.sessions || []).map((s) => mapSession(s, creators));
  res.json({
    worker: view,
    clips: Object.fromEntries(statusCounts.map((c) => [c._id, c.n])),
    creators: creators.length, creatorsEnabled: creators.filter((c) => c.enabled).length,
    uploadsToday: { youtube: await uploadsToday(req.user._id, "youtube"), instagram: await uploadsToday(req.user._id, "instagram") },
    maxUploadsPerDay: settings.maxUploadsPerDay,
    accounts: Object.fromEntries(accounts.map((a) => [a.platform, { displayName: a.displayName, connectedAt: a.connectedAt, expiresAt: a.expiresAt }])),
    canPublish: { youtube: await canPublish(req.user._id, "youtube"), instagram: await canPublish(req.user._id, "instagram") },
    privacy: settings.privacy,
    paused: !!req.user.paused,
    workerPaused: !!worker?.paused,
    role: req.user.role,
  });
});

/** Worker sessions carry the channel id; show them against this user's own creator (id + name). */
function mapSession(s, creators) {
  const c = creators.find((x) => x.channel === s.creatorId);
  return { ...s, creatorId: c ? String(c._id) : null, creator: c?.name || s.creator };
}

// ---------------------------------------------------------------- creators
api.get("/creators", async (req, res) => {
  const list = await Creator.find(mine(req)).sort({ createdAt: 1 }).lean();
  const counts = await Clip.aggregate([{ $match: mine(req) }, { $group: { _id: { c: "$creator", s: "$status" }, n: { $sum: 1 } } }]);
  const worker = await WorkerStatus.findById("worker").lean();
  const live = new Map((worker?.sessions || []).map((s) => [String(s.creatorId), s]));
  res.json(list.map((c) => ({
    ...c,
    clips: counts.filter((x) => String(x._id.c) === String(c._id)).reduce((a, x) => a + x.n, 0),
    published: counts.find((x) => String(x._id.c) === String(c._id) && x._id.s === "published")?.n || 0,
    live: live.has(c.channel) && !(c.skipVideoId && c.skipVideoId === String(live.get(c.channel).videoId)) ? mapSession(live.get(c.channel), [c]) : null,
  })));
});

api.post("/creators", async (req, res) => {
  const data = buildCreator(req.body || {});
  if (await Creator.exists(mine(req, { platform: data.platform, handle: new RegExp(`^${data.handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }))) {
    throw new HttpError(400, `${data.handle} is already in your list`);
  }
  const c = await Creator.create({ ...data, owner: req.user._id });
  logEvent("creator", `Now monitoring ${c.name} (${c.platform})`, { level: "success", owner: req.user._id, creator: c._id });
  notify("creators", { owner: req.user._id });
  res.status(201).json(c);
});

const creatorPatch = z.object({
  name: z.string().trim().min(1).max(80), enabled: z.boolean(), autoUpload: z.boolean(),
  creditLine: z.string().trim().min(1, "credit line is required").max(300),
  tags: z.union([z.array(z.string()), z.string()]).transform((t) => (Array.isArray(t) ? t : t.split(",")).map((x) => x.trim()).filter(Boolean).slice(0, 30)),
  hashtags: z.string().max(300), layout: z.enum(["", "facecam_split", "center_crop", "blur_background"]),
  targets: z.object({ youtube: z.boolean(), instagram: z.boolean() }).partial(),
}).partial().strict();

api.patch("/creators/:id", async (req, res) => {
  const r = creatorPatch.safeParse(req.body || {});
  if (!r.success) throw new HttpError(400, r.error.issues[0].message);
  const c = await Creator.findOne(mine(req, { _id: oid(req.params.id) }));
  if (!c) throw new HttpError(404, "creator not found");
  const { targets, ...rest } = r.data;
  Object.assign(c, rest);
  if (targets) c.targets = { ...c.targets.toObject(), ...targets };
  await c.save();
  res.json(c);
});

api.delete("/creators/:id", async (req, res) => {
  const c = await Creator.findOneAndDelete(mine(req, { _id: oid(req.params.id) })).lean();
  if (c) logEvent("creator", `Stopped monitoring ${c.name}`, { owner: req.user._id, creator: c._id });
  notify("creators", { owner: req.user._id });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- clips
api.get("/clips", async (req, res) => {
  const q = mine(req);
  if (req.query.status) q.status = String(req.query.status);
  if (req.query.creator) q.creator = oid(String(req.query.creator));
  const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200);
  if (req.query.q) {
    const escaped = String(req.query.q).slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);
    q.title = { $regex: escaped, $options: "i" };
  }
  const sort = req.query.sort === "score" ? { score: -1, createdAt: -1 } : { createdAt: -1 };
  const skip = Math.max(Number(req.query.skip) || 0, 0);
  if (req.query.before && req.query.sort !== "score") q.createdAt = { $lt: new Date(String(req.query.before)) };
  const clips = await Clip.find(q).sort(sort).skip(req.query.sort === "score" ? skip : 0).limit(limit).select("-transcript").lean();
  res.json(clips);
});

api.get("/clips/:id", async (req, res) => {
  const c = await Clip.findOne(mine(req, { _id: oid(req.params.id) })).lean();
  if (!c) throw new HttpError(404, "clip not found");
  res.json(c);
});

const clipPatch = z.object({
  title: z.string().trim().min(1, "title is required").max(100),
  description: z.string().max(4900),
  tags: z.union([z.array(z.string()), z.string()]).transform((t) => (Array.isArray(t) ? t : t.split(",")).map((x) => x.trim()).filter(Boolean).slice(0, 30)),
}).partial().strict();

async function lockedCheck(c) {
  if (c.publications.some((p) => p.status === "uploading" || p.status === "published")) {
    throw new HttpError(409, "already published (or uploading); edit it on the platform instead");
  }
}

api.patch("/clips/:id", async (req, res) => {
  const r = clipPatch.safeParse(req.body || {});
  if (!r.success) throw new HttpError(400, r.error.issues[0].message);
  const c = await Clip.findOne(mine(req, { _id: oid(req.params.id) })).populate("creator");
  if (!c) throw new HttpError(404, "clip not found");
  await lockedCheck(c);
  Object.assign(c, r.data);
  if (r.data.description !== undefined) c.description = ensureCredit(c.description, c.creator?.creditLine); // credit can't be removed
  await c.save();
  res.json(c);
});

api.post("/clips/:id/approve", async (req, res) => {
  const c = await Clip.findOne(mine(req, { _id: oid(req.params.id) })).populate("creator");
  if (!c) throw new HttpError(404, "clip not found");
  await lockedCheck(c);
  c.approved = true;
  c.status = "ready";
  c.rejectReason = undefined;
  queuePublications(c, req.body?.platforms);
  await c.save();
  logEvent("approved", `Approved: ${c.title}`, { owner: req.user._id, clip: c._id, creator: c.creator?._id });
  notify("clips", { owner: req.user._id });
  res.json(c);
});

api.post("/clips/:id/reject", async (req, res) => {
  const c = await Clip.findOne(mine(req, { _id: oid(req.params.id) }));
  if (!c) throw new HttpError(404, "clip not found");
  await lockedCheck(c);
  c.status = "rejected";
  c.approved = false;
  c.rejectReason = c.rejectReason || "rejected in dashboard";
  c.publications = c.publications.filter((p) => p.status === "published");
  await c.save();
  logEvent("rejected", `Rejected: ${c.title}`, { owner: req.user._id, clip: c._id });
  notify("clips", { owner: req.user._id });
  res.json(c);
});

export async function deleteClip(c) {
  const files = [c.thumbFile, c.previewFile, c.publishFile];
  await c.deleteOne();
  for (const f of files) await releaseFile(f);   // other users' copies may still use them
}

api.delete("/clips/:id", async (req, res) => {
  const c = await Clip.findOne(mine(req, { _id: oid(req.params.id) }));
  if (!c) throw new HttpError(404, "clip not found");
  await lockedCheck(c);
  await deleteClip(c);
  res.json({ ok: true });
});

for (const kind of ["thumb", "preview"]) {
  api.get(`/clips/:id/${kind}`, async (req, res) => {
    const c = await Clip.findOne(mine(req, { _id: oid(req.params.id) })).select("thumbFile previewFile").lean();
    const fid = c && (kind === "thumb" ? c.thumbFile : c.previewFile);
    if (!fid) throw new HttpError(404, "no media yet");
    await streamFile(fid, req, res);
  });
}

// ---------------------------------------------------------------- settings
const tagList = z.union([z.array(z.string()), z.string()])
  .transform((t) => (Array.isArray(t) ? t : t.split(",")).map((x) => x.trim()).filter(Boolean).slice(0, 20));
const userSchema = z.object({
  privacy: z.enum(["private", "unlisted", "public"]),
  maxUploadsPerDay: z.coerce.number().int().min(0).max(100),
  minMinutesBetweenUploads: z.coerce.number().min(0).max(1440),
  requireApproval: z.boolean(), uploadsEnabled: z.boolean(),
  minScoreToPublish: z.coerce.number().min(1).max(10),
  defaultTags: tagList,
  instagramCaptionHashtags: z.string().max(300),
}).partial().strict();
const platformSchema = z.object({
  spikeZThreshold: z.coerce.number().min(0.5).max(10),
  maxClipsPerHour: z.coerce.number().int().min(1).max(60),
  preRollSeconds: z.coerce.number().min(0).max(60), postRollSeconds: z.coerce.number().min(0).max(60),
  layout: z.enum(["facecam_split", "center_crop", "blur_background"]),
  emoji: z.boolean(), hookText: z.boolean(), captions: z.boolean(),
  watermarkText: z.string().max(40),
}).partial().strict();

api.get("/settings", async (req, res) => res.json({ ...(await getSettings(req.user._id)), canEditPlatform: isAdmin(req) }));

api.patch("/settings", async (req, res) => {
  const body = { ...(req.body || {}) };
  delete body.canEditPlatform;
  const userPart = Object.fromEntries(Object.entries(body).filter(([k]) => k in DEFAULT_USER_SETTINGS));
  const platformPart = Object.fromEntries(Object.entries(body).filter(([k]) => k in DEFAULT_PLATFORM_SETTINGS));
  const unknown = Object.keys(body).filter((k) => !(k in DEFAULT_USER_SETTINGS) && !(k in DEFAULT_PLATFORM_SETTINGS));
  if (unknown.length) throw new HttpError(400, `${unknown[0]}: unknown setting`);
  const u = userSchema.safeParse(userPart);
  if (!u.success) throw new HttpError(400, `${u.error.issues[0].path.join(".")}: ${u.error.issues[0].message}`);
  const p = platformSchema.safeParse(platformPart);
  if (!p.success) throw new HttpError(400, `${p.error.issues[0].path.join(".")}: ${p.error.issues[0].message}`);
  const curPlatform = await getPlatformSettings();
  const platformChanged = Object.keys(p.data).filter((k) => JSON.stringify(p.data[k]) !== JSON.stringify(curPlatform[k]));
  if (platformChanged.length && !isAdmin(req)) throw new HttpError(403, "only the site admin can change detection and video style");
  if (Object.keys(u.data).length) {
    await Setting.updateOne({ _id: String(req.user._id) }, { $set: { values: { ...(await getUserSettings(req.user._id)), ...u.data } } }, { upsert: true });
  }
  if (platformChanged.length) {
    await Setting.updateOne({ _id: "platform" }, { $set: { values: { ...curPlatform, ...p.data } } }, { upsert: true });
  }
  const changed = [...Object.keys(u.data), ...platformChanged];
  if (changed.length) logEvent("settings", `Settings changed: ${changed.join(", ")}`, { owner: req.user._id });
  notify("settings", { owner: req.user._id });
  res.json({ ...(await getSettings(req.user._id)), canEditPlatform: isAdmin(req) });
});
