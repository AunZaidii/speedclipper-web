import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetMedia, saveBuffer } from "../src/media.js";
import { Clip } from "../src/models.js";
import { cleanupStorage } from "../src/storage.js";

let mem;
const DAY = 86400000;
beforeAll(async () => { mem = await MongoMemoryServer.create(); await mongoose.connect(mem.getUri("storage")); });
afterAll(async () => { await mongoose.disconnect(); await mem.stop(); });
beforeEach(async () => { await mongoose.connection.db.dropDatabase(); resetMedia(); });

async function clip(id, status, ageDays, previewBytes = 1000) {
  const at = new Date(Date.now() - ageDays * DAY);
  const previewFile = await saveBuffer(Buffer.alloc(previewBytes, 1), `${id}.mp4`, "video/mp4");
  const thumbFile = await saveBuffer(Buffer.from("jpg"), `${id}.jpg`, "image/jpeg");
  // raw insert so createdAt/updatedAt can be in the past
  await Clip.collection.insertOne({ clipId: id, status, previewFile, thumbFile, createdAt: at, updatedAt: at, publications: [] });
}
const has = async (id) => !!(await Clip.findOne({ clipId: id }).lean()).previewFile;

describe("storage janitor", () => {
  it("drops previews of finished clips after a few days, keeps the review queue and thumbnails", async () => {
    await clip("old_published", "published", 5);
    await clip("old_rejected", "rejected", 4);
    await clip("new_published", "published", 1);
    await clip("waiting_review", "pending", 6);
    await clip("ancient_pending", "pending", 20);
    const r = await cleanupStorage();
    expect(r.removed).toBe(3);
    expect(await has("old_published")).toBe(false);
    expect(await has("old_rejected")).toBe(false);
    expect(await has("ancient_pending")).toBe(false);
    expect(await has("new_published")).toBe(true);
    expect(await has("waiting_review")).toBe(true);
    expect((await Clip.findOne({ clipId: "old_published" }).lean()).thumbFile).toBeTruthy();
  });

  it("enforces a size cap, oldest non-pending previews first", async () => {
    for (let i = 0; i < 6; i++) await clip(`c${i}`, i < 4 ? "ready" : "pending", 0, 400 * 1024);
    const r = await cleanupStorage(Date.now(), { KEEP_DONE_DAYS: 3, KEEP_ANY_DAYS: 14, SOFT_CAP_MB: 1, TARGET_MB: 1 });
    expect(r.mediaMB).toBeLessThanOrEqual(1);
    expect(await has("c0")).toBe(false);                // oldest ready clip went first
    expect(await has("c5")).toBe(true);                 // review queue kept while possible
  });
});
