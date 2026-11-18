// Clip media (thumbnail, small preview, temporary full file for Instagram) in MongoDB GridFS.
import mongoose from "mongoose";
import { Readable } from "node:stream";

let bucket;
export function media() {
  if (!bucket) bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "media" });
  return bucket;
}
export function resetMedia() { bucket = undefined; }

export function saveBuffer(buffer, filename, contentType) {
  return new Promise((resolve, reject) => {
    const up = media().openUploadStream(filename, { metadata: { contentType } });
    Readable.from(buffer).pipe(up).on("error", reject).on("finish", () => resolve(up.id));
  });
}

export async function removeFile(id) {
  if (!id) return;
  try { await media().delete(new mongoose.Types.ObjectId(id)); } catch { /* already gone */ }
}

/** Remove a file once no clip uses it any more (several users' copies of a moment share thumbnail/preview).
 *  Call AFTER the clip that let go of it was saved or deleted. */
export async function releaseFile(id) {
  if (!id) return;
  const { Clip } = await import("./models.js");
  const used = await Clip.exists({ $or: [{ thumbFile: id }, { previewFile: id }, { publishFile: id }] });
  if (!used) await removeFile(id);
}

/** Stream a GridFS file with HTTP Range support (video seeking). */
export async function streamFile(id, req, res) {
  const _id = new mongoose.Types.ObjectId(id);
  const [file] = await media().find({ _id }).toArray();
  if (!file) return res.status(404).json({ error: "file not found" });
  const type = file.metadata?.contentType || "application/octet-stream";
  const size = file.length;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "private, max-age=3600");
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
    res.status(206).setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.setHeader("Content-Length", end - start + 1);
    return media().openDownloadStream(_id, { start, end: end + 1 }).pipe(res);
  }
  res.setHeader("Content-Length", size);
  media().openDownloadStream(_id).pipe(res);
}
