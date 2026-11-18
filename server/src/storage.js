// Keeps the free MongoDB Atlas tier (512 MB) from filling up with clip previews.
// Previews (small 360p MP4s) are only needed while a clip is being reviewed; thumbnails are tiny and kept.
//  - published / rejected / failed clips: preview removed after KEEP_DONE_DAYS
//  - any clip: preview removed after KEEP_ANY_DAYS
//  - if media still exceeds SOFT_CAP_MB, the oldest previews go first until it's back under TARGET_MB
// Users following the same channel share preview files; a file is deleted only when no clip uses it.
import mongoose from "mongoose";
import { releaseFile } from "./media.js";
import { Clip } from "./models.js";

const DAY = 86400000;
export const LIMITS = { KEEP_DONE_DAYS: 3, KEEP_ANY_DAYS: 14, SOFT_CAP_MB: 300, TARGET_MB: 250 };

async function mediaBytes() {
  const db = mongoose.connection.db;
  const [r] = await db.collection("media.files").aggregate([{ $group: { _id: null, n: { $sum: "$length" } } }]).toArray();
  return r?.n || 0;
}

async function dropPreviews(filter, limit = 500) {
  const clips = await Clip.find({ ...filter, previewFile: { $ne: null } }).sort({ createdAt: 1 }).limit(limit).select("previewFile");
  for (const c of clips) {
    await Clip.updateOne({ _id: c._id }, { $unset: { previewFile: 1 } });
    await releaseFile(c.previewFile);
  }
  return clips.length;
}

/** One cleanup pass. Returns what it removed (for logs and tests). */
export async function cleanupStorage(now = Date.now(), limits = LIMITS) {
  let removed = 0;
  removed += await dropPreviews({ status: { $in: ["published", "rejected", "failed"] }, updatedAt: { $lt: new Date(now - limits.KEEP_DONE_DAYS * DAY) } });
  removed += await dropPreviews({ createdAt: { $lt: new Date(now - limits.KEEP_ANY_DAYS * DAY) } });
  let bytes = await mediaBytes();
  while (bytes > limits.SOFT_CAP_MB * 1048576) {
    const n = await dropPreviews({ status: { $ne: "pending" } }, 20) || await dropPreviews({}, 20);   // review queue last
    if (!n) break;
    removed += n;
    bytes = await mediaBytes();
    if (bytes <= limits.TARGET_MB * 1048576) break;
  }
  return { removed, mediaMB: Math.round(bytes / 104857.6) / 10 };
}

export function startStorageJanitor(everyMs = 3600000) {
  const run = () => cleanupStorage().then((r) => {
    if (r.removed) console.log(`storage: removed ${r.removed} old preview(s); media now ${r.mediaMB} MB`);
  }).catch(() => { /* db hiccup: next hour */ });
  setTimeout(run, 60000);
  return setInterval(run, everyMs);
}
