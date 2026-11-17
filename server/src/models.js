import mongoose from "mongoose";

const { Schema, model } = mongoose;

const UserSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  tokenVersion: { type: Number, default: 0 },   // bump to log out every session
}, { timestamps: true });

const CreatorSchema = new Schema({
  name: { type: String, required: true, trim: true },
  platform: { type: String, enum: ["youtube", "twitch"], required: true },
  handle: { type: String, required: true },
  channelUrl: { type: String, required: true },
  liveUrl: { type: String, required: true },
  enabled: { type: Boolean, default: true },
  autoUpload: { type: Boolean, default: true },
  creditLine: { type: String, required: true },
  tags: { type: [String], default: [] },
  hashtags: { type: String, default: "" },
  layout: { type: String, enum: ["", "facecam_split", "center_crop", "blur_background"], default: "" },
  targets: {
    youtube: { type: Boolean, default: true },
    instagram: { type: Boolean, default: false },
  },
  lastLiveAt: Date,
  lastLiveTitle: String,
}, { timestamps: true });
CreatorSchema.index({ platform: 1, handle: 1 }, { unique: true });

const PublicationSchema = new Schema({
  platform: { type: String, enum: ["youtube", "instagram"], required: true },
  status: { type: String, enum: ["queued", "uploading", "published", "failed"], default: "queued" },
  externalId: String,
  url: String,
  privacy: String,
  error: String,
  attempts: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now },
}, { _id: false });

const ClipSchema = new Schema({
  clipId: { type: String, required: true, unique: true },   // id from the worker (moment id)
  creator: { type: Schema.Types.ObjectId, ref: "Creator" },
  creatorName: String,
  videoId: String,
  source: { type: String, enum: ["live", "vod", "test"], default: "live" },
  status: { type: String, enum: ["pending", "ready", "rejected", "published", "failed"], default: "pending", index: true },
  approved: { type: Boolean, default: false },
  priority: { type: Number, default: 0 },          // > 0 = "publish next" (newest pin first)
  title: String,
  description: String,
  tags: { type: [String], default: [] },
  hookText: String,
  score: Number,
  scoreReason: String,
  scoreSource: String,
  rejectReason: String,
  transcript: String,
  emojis: { type: [String], default: [] },
  duration: Number,
  streamTitle: String,
  streamUrl: String,
  peakAt: Date,
  zChat: Number, zAudio: Number, combined: Number,
  thumbFile: Schema.Types.ObjectId,     // GridFS ids
  previewFile: Schema.Types.ObjectId,
  publishFile: Schema.Types.ObjectId,   // full-quality mp4, kept only while Instagram fetches it
  publishToken: String,                 // random token for the public Instagram fetch URL
  publications: { type: [PublicationSchema], default: [] },
}, { timestamps: true });
ClipSchema.index({ createdAt: -1 });
ClipSchema.index({ status: 1, createdAt: -1 });                                     // Clips tabs, Review queue
ClipSchema.index({ creator: 1, createdAt: -1 });                                    // creator filter
ClipSchema.index({ "publications.platform": 1, "publications.status": 1 });         // publish queue, failed uploads
ClipSchema.index({ publishToken: 1 }, { sparse: true });                            // one-time Instagram fetch URL

const AccountSchema = new Schema({
  platform: { type: String, enum: ["youtube", "instagram"], required: true, unique: true },
  displayName: String,      // channel title / IG username
  externalId: String,       // channel id / IG user id
  tokens: String,           // encrypted JSON
  expiresAt: Date,
  connectedAt: Date,
}, { timestamps: true });

const SettingSchema = new Schema({ _id: { type: String, default: "global" }, values: { type: Object, default: {} }, secrets: String });

const WorkerStatusSchema = new Schema({
  _id: { type: String, default: "worker" },
  lastSeen: Date,
  state: String,
  sessions: { type: Array, default: [] },
  editQueue: Number,
  editing: Number,
  freeGb: Number,
  version: String,
  hostname: String,
  log: { type: [String], default: [] },
  paused: { type: Boolean, default: false },
  online: { type: Boolean, default: false },
});

const EventSchema = new Schema({
  type: { type: String, required: true },          // live | ended | clip | approved | rejected | published | failed | creator | command | worker | settings
  level: { type: String, enum: ["info", "success", "warn", "error"], default: "info" },
  message: { type: String, required: true },
  creator: { type: Schema.Types.ObjectId, ref: "Creator" },
  clip: { type: Schema.Types.ObjectId, ref: "Clip" },
  platform: String,
  url: String,
  at: { type: Date, default: Date.now },
});
EventSchema.index({ at: -1 });
EventSchema.index({ type: 1, at: -1 });                                             // Activity filters
EventSchema.index({ at: 1 }, { expireAfterSeconds: 60 * 86400 });   // keep 60 days

const LiveSessionSchema = new Schema({
  videoId: { type: String, required: true, unique: true },
  creator: { type: Schema.Types.ObjectId, ref: "Creator" },
  creatorName: String,
  platform: String,
  title: String,
  startedAt: Date,
  lastSeenAt: Date,
  endedAt: Date,
  recordedSeconds: Number,
  chatMessages: Number,
  chatBackend: String,
  moments: Number,
});
LiveSessionSchema.index({ startedAt: -1 });
LiveSessionSchema.index({ endedAt: 1 });                                            // streams still recording

const CommandSchema = new Schema({
  type: { type: String, enum: ["check_now", "stop_session", "pause", "resume", "vod"], required: true },
  payload: { type: Object, default: {} },
  status: { type: String, enum: ["pending", "sent", "done", "failed"], default: "pending", index: true },
  result: String,
  createdAt: { type: Date, default: Date.now },
  sentAt: Date,
  doneAt: Date,
});

const QuotaSchema = new Schema({ _id: String /* platform:YYYY-MM-DD (Pacific) */, uploads: { type: Number, default: 0 }, lastAt: Date });

export const User = model("User", UserSchema);
export const Creator = model("Creator", CreatorSchema);
export const Clip = model("Clip", ClipSchema);
export const Account = model("Account", AccountSchema);
export const Setting = model("Setting", SettingSchema);
export const WorkerStatus = model("WorkerStatus", WorkerStatusSchema);
export const Quota = model("Quota", QuotaSchema);
export const Event = model("Event", EventSchema);
export const LiveSession = model("LiveSession", LiveSessionSchema);
export const Command = model("Command", CommandSchema);

export const DEFAULT_SETTINGS = {
  privacy: "private",              // YouTube privacy for new uploads
  maxUploadsPerDay: 6,             // per platform
  minMinutesBetweenUploads: 30,
  requireApproval: false,
  uploadsEnabled: true,
  spikeZThreshold: 2.5,
  maxClipsPerHour: 6,
  preRollSeconds: 20,
  postRollSeconds: 10,
  minScoreToPublish: 7,
  layout: "facecam_split",          // facecam on top + gameplay below, no blur
  emoji: true,
  hookText: true,
  captions: true,
  watermarkText: "",
  defaultTags: ["shorts", "stream clips", "funny moments"],
  instagramCaptionHashtags: "#reels #clips",
};

export async function getSettings() {
  const doc = await Setting.findById("global").lean();
  return { ...DEFAULT_SETTINGS, ...(doc?.values || {}) };
}
