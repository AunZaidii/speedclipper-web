// Dashboard API (owner session required).
import express from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireUser } from "../auth.js";
import { removeFile, streamFile } from "../media.js";
import { Account, Clip, Creator, DEFAULT_SETTINGS, Quota, Setting, WorkerStatus, getSettings } from "../models.js";
import { HttpError, buildCreator, canPublish, ensureCredit, pacificDay } from "../util.js";
import { queuePublications } from "./worker.js";
import { logEvent, notify } from "../events.js";

export const api = express.Router();
api.use(requireUser);

const oid = (id) => {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, "not found");
  return id;
};

// ---------------------------------------------------------------- overview
api.get("/overview", async (req, res) => {
  const [worker, statusCounts, creators, accounts, settings] = await Promise.all([
    WorkerStatus.findById("worker").lean(),
    Clip.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    Creator.find().lean(),
    Account.find().select("platform displayName connectedAt expiresAt").lean(),
    getSettings(),
  ]);
  const day = pacificDay();
  const quotas = await Quota.find({ _id: { $in: [`youtube:${day}`, `instagram:${day}`] } }).lean();
  const online = !!worker?.lastSeen && Date.now() - new Date(worker.lastSeen) < 90_000;
  res.json({
    worker: worker ? { ...worker, online } : { online: false },
    clips: Object.fromEntries(statusCounts.map((c) => [c._id, c.n])),
    creators: creators.length, creatorsEnabled: creators.filter((c) => c.enabled).length,
    uploadsToday: Object.fromEntries(["youtube", "instagram"].map((p) => [p, quotas.find((q) => q._id === `${p}:${day}`)?.uploads || 0])),
    maxUploadsPerDay: settings.maxUploadsPerDay,
    accounts: Object.fromEntries(accounts.map((a) => [a.platform, { displayName: a.displayName, connectedAt: a.connectedAt, expiresAt: a.expiresAt }])),
    canPublish: { youtube: await canPublish("youtube"), instagram: await canPublish("instagram") },
    privacy: settings.privacy,
    paused: !!worker?.paused,
  });
});

// ---------------------------------------------------------------- creators
api.get("/creators", async (req, res) => {
  const list = await Creator.find().sort({ createdAt: 1 }).lean();
  const counts = await Clip.aggregate([{ $group: { _id: { c: "$creator", s: "$status" }, n: { $sum: 1 } } }]);
  const worker = await WorkerStatus.findById("worker").lean();
  const live = new Map((worker?.sessions || []).map((s) => [String(s.creatorId), s]));
  res.json(list.map((c) => ({
    ...c,
    clips: counts.filter((x) => String(x._id.c) === String(c._id)).reduce((a, x) => a + x.n, 0),
    published: counts.find((x) => String(x._id.c) === String(c._id) && x._id.s === "published")?.n || 0,
    live: live.get(String(c._id)) || null,
  })));
});

api.post("/creators", async (req, res) => {
  const data = buildCreator(req.body || {});
  if (await Creator.exists({ platform: data.platform, handle: new RegExp(`^${data.handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") })) {
    throw new HttpError(400, `${data.handle} is already in the list`);
  }
  const c = await Creator.create(data);
  logEvent("creator", `Now monitoring ${c.name} (${c.platform})`, { level: "success", creator: c._id });
  notify("creators");
  res.status(201).json(c);
});

const creatorPatch = z.object({
  name: z.string().trim().min(1).max(80), enabled: z.boolean(), autoUpload: z.boolean(),
  creditLine: z.string().trim().min(1, "credit line is required").max(300),
  tags: z.union([z.array(z.string()), z.string()]).transform((t) => (Array.isArray(t) ? t : t.split(",")).map((x) => x.trim()).filter(Boolean).slice(0, 30)),
  hashtags: z.string().max(300), layout: z.enum(["", "blur_background", "center_crop"]),
  targets: z.object({ youtube: z.boolean(), instagram: z.boolean() }).partial(),
}).partial().strict();

api.patch("/creators/:id", async (req, res) => {
  const r = creatorPatch.safeParse(req.body || {});
  if (!r.success) throw new HttpError(400, r.error.issues[0].message);
  const c = await Creator.findById(oid(req.params.id));
  if (!c) throw new HttpError(404, "creator not found");
  const { targets, ...rest } = r.data;
  Object.assign(c, rest);
  if (targets) c.targets = { ...c.targets.toObject(), ...targets };
  await c.save();
  res.json(c);
});

api.delete("/creators/:id", async (req, res) => {
  const c = await Creator.findByIdAndDelete(oid(req.params.id)).lean();
  if (c) logEvent("creator", `Stopped monitoring ${c.name}`, { creator: c._id });
  notify("creators");
  res.json({ ok: true });
});

// ---------------------------------------------------------------- clips
api.get("/clips", async (req, res) => {
  const q = {};
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
  const c = await Clip.findById(oid(req.params.id)).lean();
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
  const c = await Clip.findById(oid(req.params.id)).populate("creator");
  if (!c) throw new HttpError(404, "clip not found");
  await lockedCheck(c);
  Object.assign(c, r.data);
  if (r.data.description !== undefined) c.description = ensureCredit(c.description, c.creator?.creditLine); // credit can't be removed
  await c.save();
  res.json(c);
});

api.post("/clips/:id/approve", async (req, res) => {
  const c = await Clip.findById(oid(req.params.id)).populate("creator");
  if (!c) throw new HttpError(404, "clip not found");
  await lockedCheck(c);
  c.approved = true;
  c.status = "ready";
  c.rejectReason = undefined;
  queuePublications(c, req.body?.platforms);
  await c.save();
  logEvent("approved", `Approved: ${c.title}`, { clip: c._id, creator: c.creator?._id });
  notify("clips");
  res.json(c);
});

api.post("/clips/:id/reject", async (req, res) => {
  const c = await Clip.findById(oid(req.params.id));
  if (!c) throw new HttpError(404, "clip not found");
  await lockedCheck(c);
  c.status = "rejected";
  c.approved = false;
  c.rejectReason = c.rejectReason || "rejected in dashboard";
  c.publications = c.publications.filter((p) => p.status === "published");
  await c.save();
  logEvent("rejected", `Rejected: ${c.title}`, { clip: c._id });
  notify("clips");
  res.json(c);
});

api.delete("/clips/:id", async (req, res) => {
  const c = await Clip.findById(oid(req.params.id));
  if (!c) throw new HttpError(404, "clip not found");
  await lockedCheck(c);
  await Promise.all([removeFile(c.thumbFile), removeFile(c.previewFile), removeFile(c.publishFile)]);
  await c.deleteOne();
  res.json({ ok: true });
});

for (const kind of ["thumb", "preview"]) {
  api.get(`/clips/:id/${kind}`, async (req, res) => {
    const c = await Clip.findById(oid(req.params.id)).select("thumbFile previewFile").lean();
    const fid = c && (kind === "thumb" ? c.thumbFile : c.previewFile);
    if (!fid) throw new HttpError(404, "no media yet");
    await streamFile(fid, req, res);
  });
}

// ---------------------------------------------------------------- settings
const settingsSchema = z.object({
  privacy: z.enum(["private", "unlisted", "public"]),
  maxUploadsPerDay: z.coerce.number().int().min(0).max(100),
  minMinutesBetweenUploads: z.coerce.number().min(0).max(1440),
  requireApproval: z.boolean(), uploadsEnabled: z.boolean(),
  spikeZThreshold: z.coerce.number().min(0.5).max(10),
  maxClipsPerHour: z.coerce.number().int().min(1).max(60),
  preRollSeconds: z.coerce.number().min(0).max(60), postRollSeconds: z.coerce.number().min(0).max(60),
  minScoreToPublish: z.coerce.number().min(1).max(10),
  layout: z.enum(["blur_background", "center_crop"]),
  emoji: z.boolean(), hookText: z.boolean(), captions: z.boolean(),
  watermarkText: z.string().max(40),
  defaultTags: z.union([z.array(z.string()), z.string()]).transform((t) => (Array.isArray(t) ? t : t.split(",")).map((x) => x.trim()).filter(Boolean).slice(0, 20)),
  instagramCaptionHashtags: z.string().max(300),
}).partial().strict();

api.get("/settings", async (req, res) => res.json(await getSettings()));

api.patch("/settings", async (req, res) => {
  const r = settingsSchema.safeParse(req.body || {});
  if (!r.success) throw new HttpError(400, `${r.error.issues[0].path.join(".")}: ${r.error.issues[0].message}`);
  const cur = await getSettings();
  const values = { ...cur, ...r.data };
  for (const k of Object.keys(values)) if (!(k in DEFAULT_SETTINGS)) delete values[k];
  await Setting.updateOne({ _id: "global" }, { $set: { values } }, { upsert: true });
  logEvent("settings", `Settings changed: ${Object.keys(r.data).join(", ")}`);
  notify("settings");
  res.json(values);
});
