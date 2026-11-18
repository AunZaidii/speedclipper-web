// Accounts for everyone: isolation between users, one recording per channel, per-user publishing, migration.
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { encrypt } from "../src/crypto.js";
import { resetMedia } from "../src/media.js";
import { migrate } from "../src/migrate.js";
import { Account, Clip, Command, Creator, Event, LiveSession, Quota, Setting, User, channelId } from "../src/models.js";
import { pacificDay } from "../src/util.js";

let mem, app;
const W = { "x-worker-key": config.workerKey };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => { mem = await MongoMemoryServer.create(); await mongoose.connect(mem.getUri("multi")); app = createApp(); });
afterAll(async () => { await mongoose.disconnect(); await mem.stop(); });
beforeEach(async () => { await mongoose.connection.db.dropDatabase(); resetMedia(); await Promise.all([Creator, Clip, Account].map((M) => M.createIndexes())); });

async function signup(email) {
  const agent = request.agent(app);
  await agent.post("/api/auth/signup").send({ email, password: "correct horse battery" }).expect(200);
  agent.id = (await User.findOne({ email }))._id;
  return agent;
}
const pushClip = (channel, extra = {}) => request(app).post("/api/worker/clips").set(W)
  .field("meta", JSON.stringify({ clipId: "m_1", creatorId: channel, videoId: "live1", source: "live", title: "Big moment #shorts",
    description: "d", score: 8.5, ...extra }))
  .attach("thumb", Buffer.from("jpg"), { filename: "t.jpg", contentType: "image/jpeg" })
  .attach("preview", Buffer.alloc(3000, 1), { filename: "p.mp4", contentType: "video/mp4" });
const ytAccount = (owner) => Account.create({ owner, platform: "youtube", tokens: encrypt({ refresh_token: "r" }) });

describe("isolation", () => {
  it("users only ever see and change their own creators, clips, settings and activity", async () => {
    const a = await signup("admin@example.com");
    const b = await signup("bob@example.com");
    const ca = (await a.post("/api/creators").send({ link: "@IShowSpeed" }).expect(201)).body;
    await pushClip(ca.channel).expect(201);
    const clipA = await Clip.findOne({ owner: a.id }).lean();
    expect((await b.get("/api/creators")).body).toEqual([]);
    expect((await b.get("/api/clips")).body).toEqual([]);
    await b.get(`/api/clips/${clipA._id}`).expect(404);
    await b.get(`/api/clips/${clipA._id}/preview`).expect(404);
    await b.patch(`/api/clips/${clipA._id}`).send({ title: "hacked" }).expect(404);
    await b.delete(`/api/creators/${ca._id}`).expect(200);                  // no-op on someone else's creator
    expect(await Creator.countDocuments()).toBe(1);
    await b.patch("/api/settings").send({ privacy: "public" }).expect(200);
    expect((await a.get("/api/settings")).body.privacy).toBe("private");
    await sleep(50);
    expect((await b.get("/api/events")).body.some((e) => /IShowSpeed|Big moment/.test(e.message))).toBe(false);
    expect((await b.get("/api/analytics?days=7")).body.totals.clips).toBe(0);
    expect((await b.get("/api/overview")).body.worker.log).toBeUndefined();      // worker internals are admin-only
  });

  it("only the admin changes detection/video style and the AI key; sign-up can be closed", async () => {
    const a = await signup("admin@example.com");
    const b = await signup("bob@example.com");
    await b.patch("/api/settings").send({ layout: "blur_background" }).expect(403);
    await b.patch("/api/settings").send({ ...(await b.get("/api/settings")).body, privacy: "unlisted" }).expect(200);   // full form, own part changed
    await a.patch("/api/settings").send({ layout: "center_crop" }).expect(200);
    expect((await b.get("/api/settings")).body.layout).toBe("center_crop");
    await b.put("/api/secrets/anthropic").send({ key: `sk-ant-api03-${"x".repeat(40)}` }).expect(403);
    config.signupOpen = false;
    try {
      await request(app).post("/api/auth/signup").send({ email: "c@example.com", password: "correct horse battery" }).expect(403);
      expect((await request(app).get("/api/auth/status")).body.signupOpen).toBe(false);
    } finally { config.signupOpen = true; }
  });
});

describe("one recording per channel", () => {
  it("worker sees a followed channel once; each follower gets their own copy sharing the media", async () => {
    const a = await signup("admin@example.com");
    const b = await signup("bob@example.com");
    const ca = (await a.post("/api/creators").send({ link: "@IShowSpeed", name: "Speed" }).expect(201)).body;
    const cb = (await b.post("/api/creators").send({ link: "youtube.com/@ishowspeed", name: "IShowSpeed" }).expect(201)).body;
    expect(ca.channel).toBe(cb.channel);
    const cfg = (await request(app).get("/api/worker/config").set(W)).body;
    expect(cfg.creators).toHaveLength(1);
    expect(cfg.creators[0]).toMatchObject({ id: ca.channel, followers: 2 });

    const r = (await pushClip(ca.channel).expect(201)).body;
    expect(r.copies).toBe(2);
    const [x, y] = await Clip.find({ clipId: "m_1" }).sort({ owner: 1 }).lean();
    expect(String(x.previewFile)).toBe(String(y.previewFile));                 // stored once
    expect(new Set([String(x.owner), String(y.owner)])).toEqual(new Set([String(a.id), String(b.id)]));
    const mineB = await Clip.findOne({ owner: b.id }).lean();
    expect(mineB.description).toContain(cb.creditLine);                         // each user's own credit line

    // deleting one user's copy keeps the shared file for the other
    const mineA = await Clip.findOne({ owner: a.id }).lean();
    await a.delete(`/api/clips/${mineA._id}`).expect(200);
    await b.get(`/api/clips/${mineB._id}/preview`).expect(200);
    await b.delete(`/api/clips/${mineB._id}`).expect(200);
    expect(await mongoose.connection.db.collection("media.files").countDocuments()).toBe(0);

    // live status + "went live" for both followers
    await request(app).post("/api/worker/heartbeat").set(W).send({ sessions: [{ creatorId: ca.channel, creator: "Speed", videoId: "live1", title: "GTA" }] });
    await sleep(50);
    expect((await b.get("/api/creators")).body[0].live.title).toBe("GTA");
    expect((await b.get("/api/sessions")).body).toHaveLength(1);
    expect((await b.get("/api/events?type=live")).body).toHaveLength(1);
    expect((await a.get("/api/events?type=live")).body).toHaveLength(1);
  });

  it("paused users and 'stop recording for me' are respected; the worker only stops when nobody wants it", async () => {
    const a = await signup("admin@example.com");
    const b = await signup("bob@example.com");
    const ca = (await a.post("/api/creators").send({ link: "@IShowSpeed" })).body;
    const cb = (await b.post("/api/creators").send({ link: "@IShowSpeed" })).body;
    await request(app).post("/api/worker/heartbeat").set(W).send({ sessions: [{ creatorId: ca.channel, creator: "S", videoId: "live1" }] });
    await b.post("/api/commands").send({ type: "stop_session", payload: { creatorId: cb._id } }).expect(201);
    expect(await Command.countDocuments()).toBe(0);                             // a still wants it: worker keeps recording
    expect((await pushClip(ca.channel).expect(201)).body.copies).toBe(1);
    expect(await Clip.countDocuments({ owner: b.id })).toBe(0);
    await a.post("/api/commands").send({ type: "stop_session", payload: { creatorId: ca._id } }).expect(201);
    expect((await Command.findOne().lean()).payload.creatorId).toBe(ca.channel);    // now the worker is told

    await b.post("/api/commands").send({ type: "pause" }).expect(201);           // a normal user pauses only themselves
    expect((await User.findById(b.id)).paused).toBe(true);
    expect((await request(app).get("/api/worker/config").set(W)).body.creators[0].followers).toBe(1);
  });

  it("a past stream (VOD) only goes to the user who asked for it", async () => {
    const a = await signup("admin@example.com");
    const b = await signup("bob@example.com");
    await a.post("/api/creators").send({ link: "@IShowSpeed" });
    const cb = (await b.post("/api/creators").send({ link: "@IShowSpeed" })).body;
    await b.post("/api/commands").send({ type: "vod", payload: { url: "https://www.youtube.com/watch?v=abcdef123", creatorId: cb._id } }).expect(201);
    const r = (await pushClip(cb.channel, { source: "vod", videoId: "abcdef123", clipId: "v_1" }).expect(201)).body;
    expect(r).toMatchObject({ copies: 1, status: "pending" });
    expect((await Clip.findOne({ clipId: "v_1" })).owner).toEqual(b.id);
  });
});

describe("publishing per user", () => {
  it("jobs go to each owner's own YouTube, with their own limits and privacy", async () => {
    const a = await signup("admin@example.com");
    const b = await signup("bob@example.com");
    const ca = (await a.post("/api/creators").send({ link: "@IShowSpeed" })).body;
    await b.post("/api/creators").send({ link: "@IShowSpeed" });
    await b.patch("/api/settings").send({ privacy: "public" });
    await pushClip(ca.channel).expect(201);
    expect((await request(app).get("/api/worker/jobs/next").set(W)).body).toMatchObject({ job: null, reason: "YouTube is not connected" });
    await ytAccount(b.id);
    const j = (await request(app).get("/api/worker/jobs/next").set(W)).body.job;
    const clipB = await Clip.findOne({ owner: b.id }).lean();
    expect(j).toMatchObject({ jobId: String(clipB._id), clipId: "m_1", privacy: "public" });
    await request(app).post(`/api/worker/jobs/${j.jobId}/result`).set(W).send({ ok: true, externalId: "YTB", url: "u" }).expect(200);
    expect((await Clip.findById(clipB._id)).status).toBe("published");
    expect((await Clip.findOne({ owner: a.id })).status).toBe("ready");          // a's copy untouched
    expect((await Quota.findById(`${b.id}:youtube:${pacificDay()}`)).uploads).toBe(1);
    await ytAccount(a.id);
    const j2 = (await request(app).get("/api/worker/jobs/next").set(W)).body.job;
    expect(j2).toMatchObject({ clipId: "m_1", privacy: "private" });            // a's job is not blocked by b's upload gap
    expect(j2.jobId).toBe(String((await Clip.findOne({ owner: a.id }))._id));
  });

  it("the shared Google project's daily allowance stops YouTube jobs for everyone", async () => {
    const a = await signup("admin@example.com");
    const ca = (await a.post("/api/creators").send({ link: "@IShowSpeed" })).body;
    await ytAccount(a.id);
    await pushClip(ca.channel).expect(201);
    await Quota.create({ _id: `project:youtube:${pacificDay()}`, uploads: config.youtubeProjectDailyUploads });
    expect((await request(app).get("/api/worker/jobs/next").set(W)).body.reason).toMatch(/allowance for today is used up/);
  });
});

describe("migration from the single-owner version", () => {
  it("gives existing data to the first user, splits settings and fixes the old unique indexes", async () => {
    const db = mongoose.connection.db;
    await db.collection("creators").dropIndexes().catch(() => {});
    await db.collection("creators").createIndex({ platform: 1, handle: 1 }, { unique: true });
    const uid = new mongoose.Types.ObjectId();
    await db.collection("users").insertOne({ _id: uid, email: "old@example.com", passwordHash: "x", tokenVersion: 0, createdAt: new Date() });
    const cid = new mongoose.Types.ObjectId();
    await db.collection("creators").insertOne({ _id: cid, name: "MrJay", platform: "youtube", handle: "@MrJayPlays", channelUrl: "u", liveUrl: "u", creditLine: "c" });
    await db.collection("clips").insertOne({ clipId: "z_1", creator: cid, status: "published", publications: [] });
    await db.collection("accounts").insertOne({ platform: "youtube", tokens: "t" });
    await db.collection("events").insertMany([{ type: "clip", message: "m", at: new Date() }, { type: "worker", message: "w", at: new Date() }]);
    await db.collection("livesessions").insertOne({ videoId: "v1", creator: cid, startedAt: new Date() });
    await db.collection("settings").insertOne({ _id: "global", values: { privacy: "public", layout: "center_crop", spikeZThreshold: 3 }, secrets: "enc" });

    const r = await migrate(() => {});
    expect(r).toMatchObject({ migrated: true, admin: "old@example.com" });
    expect((await User.findById(uid)).role).toBe("admin");
    expect(String((await Creator.findById(cid)).owner)).toBe(String(uid));
    expect((await Creator.findById(cid)).channel).toBe(channelId("youtube", "@MrJayPlays"));
    expect(String((await Clip.findOne({ clipId: "z_1" })).owner)).toBe(String(uid));
    expect(String((await Account.findOne()).owner)).toBe(String(uid));
    expect((await Event.findOne({ type: "worker" })).owner).toBeFalsy();     // platform events stay admin-only
    expect((await LiveSession.findOne()).channel).toBe(channelId("youtube", "@MrJayPlays"));
    expect((await Setting.findById("platform").lean())).toMatchObject({ values: { layout: "center_crop", spikeZThreshold: 3 }, secrets: "enc" });
    expect((await Setting.findById(String(uid)).lean()).values).toEqual({ privacy: "public" });
    expect(await Setting.findById("global")).toBe(null);
    // a second user can now follow the same channel
    const b = await signup("bob@example.com");
    await b.post("/api/creators").send({ link: "@MrJayPlays" }).expect(201);
    // running it again changes nothing
    expect((await migrate(() => {})).stats).toEqual({});
  });
});
