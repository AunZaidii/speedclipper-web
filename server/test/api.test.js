import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { decrypt, encrypt } from "../src/crypto.js";
import { instagramCaption } from "../src/instagram.js";
import { resetMedia } from "../src/media.js";
import { Account, Clip, Creator, Quota } from "../src/models.js";
import { pacificDay, parseChannel } from "../src/util.js";

let mem, app;
const W = { "x-worker-key": config.workerKey };

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri("test"));
  app = createApp();
});
afterAll(async () => { await mongoose.disconnect(); await mem.stop(); });
beforeEach(async () => { await mongoose.connection.db.dropDatabase(); resetMedia(); });

async function owner() {
  const agent = request.agent(app);
  await agent.post("/api/auth/setup").send({ email: "me@example.com", password: "correct horse battery" }).expect(200);
  return agent;
}

function workerClip(creatorId, extra = {}) {
  return request(app).post("/api/worker/clips").set(W)
    .field("meta", JSON.stringify({ clipId: "vid_100", creatorId, videoId: "vid", source: "live", title: "Crazy moment #shorts",
      description: "Speed did a thing", tags: ["a"], score: 8.5, hookText: "NO WAY", duration: 31, ...extra }))
    .attach("thumb", Buffer.from("fakejpg"), { filename: "t.jpg", contentType: "image/jpeg" })
    .attach("preview", Buffer.alloc(5000, 7), { filename: "p.mp4", contentType: "video/mp4" });
}

describe("auth", () => {
  it("first visit creates the owner; nobody else can sign up", async () => {
    expect((await request(app).get("/api/auth/status")).body.setupNeeded).toBe(true);
    await request(app).post("/api/auth/setup").send({ email: "me@example.com", password: "short" }).expect(400);
    const a = await owner();
    expect((await a.get("/api/auth/me")).body.email).toBe("me@example.com");
    await request(app).post("/api/auth/setup").send({ email: "x@y.com", password: "another long pw" }).expect(409);
    await request(app).get("/api/creators").expect(401);
    await request(app).post("/api/auth/login").send({ email: "me@example.com", password: "wrong password!" }).expect(401);
    const b = request.agent(app);
    await b.post("/api/auth/login").send({ email: "ME@example.com", password: "correct horse battery" }).expect(200);
    await b.get("/api/creators").expect(200);
    // changing the password logs out every other session
    await a.post("/api/auth/password").send({ current: "correct horse battery", next: "new long password!" }).expect(200);
    await b.get("/api/creators").expect(401);
    await a.get("/api/creators").expect(200);
  });

  it("blocks cross-site writes", async () => {
    const a = await owner();
    await a.post("/api/creators").set("Origin", "https://evil.example").send({ link: "@Someone" }).expect(403);
  });
});

describe("creators", () => {
  it("add / edit / delete with validation", async () => {
    const a = await owner();
    const c = (await a.post("/api/creators").send({ link: "twitch.tv/KaiCenat", hashtags: "#kai" }).expect(201)).body;
    expect(c).toMatchObject({ platform: "twitch", handle: "kaicenat", liveUrl: "https://www.twitch.tv/kaicenat", autoUpload: true });
    expect(c.creditLine).toContain("Credit: kaicenat");
    await a.post("/api/creators").send({ link: "https://www.twitch.tv/KAICENAT" }).expect(400);
    await a.post("/api/creators").send({ link: "nonsense" }).expect(400);
    const e = (await a.patch(`/api/creators/${c._id}`).send({ enabled: false, tags: "kai, cenat", targets: { instagram: true } }).expect(200)).body;
    expect(e.enabled).toBe(false);
    expect(e.tags).toEqual(["kai", "cenat"]);
    expect(e.targets).toEqual({ youtube: true, instagram: true });
    await a.patch(`/api/creators/${c._id}`).send({ creditLine: "  " }).expect(400);
    await a.patch(`/api/creators/${c._id}`).send({ handle: "x" }).expect(400);
    await a.delete(`/api/creators/${c._id}`).expect(200);
    expect((await a.get("/api/creators")).body).toEqual([]);
  });

  it("parses channel links like the Python engine", () => {
    expect(parseChannel("@IShowSpeed")).toEqual({ platform: "youtube", handle: "@IShowSpeed" });
    expect(parseChannel("https://www.youtube.com/@IShowSpeed/live")).toEqual({ platform: "youtube", handle: "@IShowSpeed" });
    expect(parseChannel("twitch:xQc")).toEqual({ platform: "twitch", handle: "xqc" });
  });
});

describe("worker", () => {
  it("needs the worker key", async () => {
    await request(app).get("/api/worker/config").expect(401);
    await request(app).get("/api/worker/config").set({ "x-worker-key": "nope" }).expect(401);
  });

  it("gets enabled creators + settings, and reports status", async () => {
    const a = await owner();
    const c = (await a.post("/api/creators").send({ link: "@IShowSpeed", name: "IShowSpeed" })).body;
    await a.post("/api/creators").send({ link: "@paused" }).then((r) => a.patch(`/api/creators/${r.body._id}`).send({ enabled: false }));
    const cfg = (await request(app).get("/api/worker/config").set(W).expect(200)).body;
    expect(cfg.creators.map((x) => x.name)).toEqual(["IShowSpeed"]);
    expect(cfg.settings.privacy).toBe("private");
    await request(app).post("/api/worker/heartbeat").set(W).send({ state: "recording", sessions: [{ creatorId: c._id, title: "LIVE NOW" }], freeGb: 120 }).expect(200);
    const ov = (await a.get("/api/overview").expect(200)).body;
    expect(ov.worker.online).toBe(true);
    expect(ov.worker.sessions[0].title).toBe("LIVE NOW");
    expect((await a.get("/api/creators")).body[0].live.title).toBe("LIVE NOW");
  });

  it("live clip from an auto-upload creator is queued for its platforms; credit is enforced", async () => {
    const a = await owner();
    const c = (await a.post("/api/creators").send({ link: "@IShowSpeed", name: "IShowSpeed" })).body;
    await a.patch(`/api/creators/${c._id}`).send({ targets: { instagram: true } });
    const r = await workerClip(c._id).expect(201);
    expect(r.body.status).toBe("ready");
    const clip = await Clip.findOne({ clipId: "vid_100" }).lean();
    expect(clip.description).toContain(c.creditLine);
    expect(clip.publications.map((p) => [p.platform, p.status])).toEqual([["youtube", "queued"], ["instagram", "queued"]]);
    // media is served to the owner, with Range support
    const thumb = await a.get(`/api/clips/${clip._id}/thumb`).expect(200);
    expect(thumb.headers["content-type"]).toBe("image/jpeg");
    const part = await a.get(`/api/clips/${clip._id}/preview`).set("Range", "bytes=0-99").expect(206);
    expect(part.headers["content-range"]).toBe("bytes 0-99/5000");
    await request(app).get(`/api/clips/${clip._id}/preview`).expect(401);
  });

  it("VOD clips, low scores and approval mode are not auto-published", async () => {
    const a = await owner();
    const c = (await a.post("/api/creators").send({ link: "@IShowSpeed" })).body;
    expect((await workerClip(c._id, { source: "vod" })).body.status).toBe("pending");
    expect((await workerClip(c._id, { clipId: "vid_200", score: 5 })).body.status).toBe("rejected");
    expect((await workerClip(c._id, { clipId: "vid_300", rejectReason: "music-like" })).body.status).toBe("rejected");
    await a.patch("/api/settings").send({ requireApproval: true }).expect(200);
    expect((await workerClip(c._id, { clipId: "vid_400" })).body.status).toBe("pending");
  });

  it("no jobs for platforms that aren't connected", async () => {
    const a = await owner();
    const c = (await a.post("/api/creators").send({ link: "@IShowSpeed" })).body;
    await a.patch(`/api/creators/${c._id}`).send({ targets: { instagram: true } });
    await workerClip(c._id);
    expect((await request(app).get("/api/worker/jobs/next").set(W)).body).toMatchObject({ job: null, reason: "YouTube is not connected" });
    expect((await request(app).get("/api/worker/instagram/next").set(W)).body).toMatchObject({ clipId: null, reason: "Instagram is not connected" });
    await Account.create({ platform: "instagram", tokens: "x" });
    expect((await request(app).get("/api/worker/instagram/next").set(W)).body.clipId).toBe("vid_100");
  });

  it("YouTube job flow: best first, limits, result, approve/reject/edit locks", async () => {
    const a = await owner();
    await Account.create({ platform: "youtube", tokens: "x" });
    const c = (await a.post("/api/creators").send({ link: "@IShowSpeed" })).body;
    await workerClip(c._id, { clipId: "low_1", score: 7.5 });
    await workerClip(c._id, { clipId: "high_1", score: 9.5 });
    const j = (await request(app).get("/api/worker/jobs/next").set(W).expect(200)).body.job;
    expect(j.clipId).toBe("high_1");
    expect(j.privacy).toBe("private");
    expect(j.description).toContain("Credit:");
    expect(j.tags).toContain("shorts");
    await request(app).post("/api/worker/jobs/high_1/result").set(W).send({ ok: true, externalId: "YT1", url: "https://youtube.com/shorts/YT1", privacy: "private" }).expect(200);
    const done = await Clip.findOne({ clipId: "high_1" }).lean();
    expect(done.status).toBe("published");
    expect((await Quota.findById(`youtube:${pacificDay()}`).lean()).uploads).toBe(1);
    // 30-minute spacing blocks the next one
    const next = (await request(app).get("/api/worker/jobs/next").set(W)).body;
    expect(next.job).toBe(null);
    expect(next.reason).toMatch(/between uploads/);
    // published clips are locked
    await a.patch(`/api/clips/${done._id}`).send({ title: "x" }).expect(409);
    await a.delete(`/api/clips/${done._id}`).expect(409);
    // a failed upload that is retryable goes back to the queue
    await Quota.deleteMany({});
    const j2 = (await request(app).get("/api/worker/jobs/next").set(W)).body.job;
    expect(j2.clipId).toBe("low_1");
    await request(app).post("/api/worker/jobs/low_1/result").set(W).send({ ok: false, error: "503", retry: true }).expect(200);
    expect((await Clip.findOne({ clipId: "low_1" }).lean()).publications[0].status).toBe("queued");
  });

  it("clips published before linking are recorded as published and never queued", async () => {
    const a = await owner();
    const c = (await a.post("/api/creators").send({ link: "@IShowSpeed" })).body;
    const r = await workerClip(c._id, { clipId: "old_1", alreadyPublished: [{ platform: "youtube", externalId: "YT9", url: "https://youtube.com/shorts/YT9", privacy: "private" }] });
    expect(r.body.status).toBe("published");
    expect((await request(app).get("/api/worker/jobs/next").set(W)).body.job).toBe(null);
    const clip = await Clip.findOne({ clipId: "old_1" }).lean();
    expect(clip.publications[0]).toMatchObject({ platform: "youtube", status: "published", externalId: "YT9" });
    // pushing it again doesn't change it
    expect((await workerClip(c._id, { clipId: "old_1" })).body.unchanged).toBe(true);
  });

  it("owner can edit, approve, reject, delete a pending clip", async () => {
    const a = await owner();
    const c = (await a.post("/api/creators").send({ link: "@IShowSpeed" })).body;
    await workerClip(c._id, { source: "vod" });
    const clip = await Clip.findOne({ clipId: "vid_100" }).lean();
    const ed = (await a.patch(`/api/clips/${clip._id}`).send({ title: "New #shorts", description: "removed credit", tags: "x, y" }).expect(200)).body;
    expect(ed.description).toContain(c.creditLine);
    expect(ed.tags).toEqual(["x", "y"]);
    await a.patch(`/api/clips/${clip._id}`).send({ title: "" }).expect(400);
    const ap = (await a.post(`/api/clips/${clip._id}/approve`).expect(200)).body;
    expect(ap.status).toBe("ready");
    expect(ap.publications[0]).toMatchObject({ platform: "youtube", status: "queued" });
    const rj = (await a.post(`/api/clips/${clip._id}/reject`).expect(200)).body;
    expect(rj.status).toBe("rejected");
    expect(rj.publications).toEqual([]);
    await a.delete(`/api/clips/${clip._id}`).expect(200);
    expect(await Clip.countDocuments()).toBe(0);
    await a.get("/api/clips/not-an-id").expect(404);
  });
});

describe("settings, crypto, instagram", () => {
  it("validates settings", async () => {
    const a = await owner();
    expect((await a.patch("/api/settings").send({ privacy: "public", maxUploadsPerDay: "4" }).expect(200)).body)
      .toMatchObject({ privacy: "public", maxUploadsPerDay: 4 });
    await a.patch("/api/settings").send({ privacy: "secret" }).expect(400);
    await a.patch("/api/settings").send({ unknownKey: 1 }).expect(400);
  });

  it("encrypts tokens round-trip and detects tampering", () => {
    const s = encrypt({ refresh_token: "abc" });
    expect(s).not.toContain("abc");
    expect(decrypt(s)).toEqual({ refresh_token: "abc" });
    const parts = s.split(".");
    parts[2] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join("."))).toThrow();
  });

  it("instagram caption keeps credit, caps hashtags and length", () => {
    const tags = Array.from({ length: 40 }, (_, i) => `#t${i}`).join(" ");
    const cap = instagramCaption({ title: "Wow #shorts", description: `desc\n\n🎥 Credit: Speed\n\n${tags}` }, { instagramCaptionHashtags: "#reels" });
    expect(cap).toContain("Credit: Speed");
    expect(cap.match(/#\w+/g).length).toBeLessThanOrEqual(30);
    expect(cap.length).toBeLessThanOrEqual(2200);
  });

  it("instagram public file URL needs the exact one-time token", async () => {
    await request(app).get("/api/public/ig/abc.mp4").expect(404);
    await request(app).get(`/api/public/ig/${"a".repeat(48)}.mp4`).expect(404);
  });

  it("accounts endpoint reports what is configured", async () => {
    const a = await owner();
    const r = (await a.get("/api/accounts").expect(200)).body;
    expect(r.youtube).toBe(null);
    expect(r.redirects.youtube).toMatch(/\/api\/accounts\/youtube\/callback$/);
    await a.get("/api/accounts/youtube/start").expect(500);   // no Google client configured in tests
  });
});
