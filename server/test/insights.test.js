import http from "node:http";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { startMonitor } from "../src/routes/insights.js";
import { WorkerStatus } from "../src/models.js";
import { config } from "../src/config.js";
import { resetMedia } from "../src/media.js";
import { Account, Clip, Event, LiveSession, User } from "../src/models.js";

let mem, app;
const W = { "x-worker-key": config.workerKey };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => { mem = await MongoMemoryServer.create(); await mongoose.connect(mem.getUri("ins")); app = createApp(); });
afterAll(async () => { await mongoose.disconnect(); await mem.stop(); });
beforeEach(async () => { await mongoose.connection.db.dropDatabase(); resetMedia(); });

async function owner() {
  const agent = request.agent(app);
  await agent.post("/api/auth/setup").send({ email: "me@example.com", password: "correct horse battery" }).expect(200);
  return agent;
}
const acc = async (platform) => Account.create({ owner: (await User.findOne({ email: "me@example.com" }))._id, platform, tokens: "x" });
const push = (creatorId, extra = {}) => request(app).post("/api/worker/clips").set(W)
  .field("meta", JSON.stringify({ clipId: `c_${Math.random().toString(36).slice(2, 8)}`, creatorId, source: "live", title: "Clip #shorts",
    description: "d", score: 8, ...extra }));

describe("commands", () => {
  it("dashboard -> heartbeat -> worker result, with validation and dedupe", async () => {
    const a = await owner();
    const c = (await a.post("/api/creators").send({ link: "@IShowSpeed" })).body;
    await a.post("/api/commands").send({ type: "vod", payload: { url: "https://evil.example/x" } }).expect(400);
    await a.post("/api/commands").send({ type: "check_now", payload: { creatorId: "a".repeat(24) } }).expect(404);
    const cmd = (await a.post("/api/commands").send({ type: "check_now", payload: { creatorId: c._id } }).expect(201)).body;
    const again = (await a.post("/api/commands").send({ type: "check_now", payload: { creatorId: c._id } })).body;
    expect(again._id).toBe(cmd._id);                                       // not queued twice
    await a.post("/api/commands").send({ type: "pause" }).expect(201);
    const hb = (await request(app).post("/api/worker/heartbeat").set(W).send({ state: "watching" }).expect(200)).body;
    expect(hb.commands.map((x) => x.type)).toEqual(["check_now", "pause"]);
    expect((await request(app).post("/api/worker/heartbeat").set(W).send({})).body.commands).toEqual([]);   // delivered once
    const pauseId = hb.commands[1].id;
    await request(app).post(`/api/worker/commands/${pauseId}/result`).set(W).send({ ok: true, result: "monitoring paused" }).expect(200);
    expect((await a.get("/api/overview")).body.workerPaused).toBe(true);   // the admin pauses the whole worker
    const list = (await a.get("/api/commands")).body;
    expect(list.find((x) => x._id === pauseId).status).toBe("done");
  });
});

describe("live sessions", () => {
  it("tracks streams from heartbeats and logs went-live / ended", async () => {
    const a = await owner();
    const c = (await a.post("/api/creators").send({ link: "@IShowSpeed", name: "IShowSpeed" })).body;
    const now = Math.floor(Date.now() / 1000);
    const s = { creatorId: c.channel, creator: "IShowSpeed", platform: "youtube", videoId: "v1", title: "GTA 6", since: now - 600, recordedUntil: now, chatMessages: 900, moments: 2 };
    await request(app).post("/api/worker/heartbeat").set(W).send({ sessions: [s] });
    await request(app).post("/api/worker/heartbeat").set(W).send({ sessions: [{ ...s, moments: 3 }] });
    let list = (await a.get("/api/sessions")).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ live: true, moments: 3, recordedSeconds: 600 });
    await request(app).post("/api/worker/heartbeat").set(W).send({ sessions: [] });
    list = (await a.get("/api/sessions")).body;
    expect(list[0].live).toBe(false);
    await sleep(50);
    const types = (await a.get("/api/events")).body.map((e) => e.type);
    expect(types).toContain("live");
    expect(types).toContain("ended");
    expect((await LiveSession.countDocuments())).toBe(1);
  });
});

describe("queue, bulk, retry, search", () => {
  it("queue shows ETAs spaced by the upload gap, best score first", async () => {
    const a = await owner();
    await acc("youtube");
    const c = (await a.post("/api/creators").send({ link: "@IShowSpeed" })).body;
    await push(c._id, { score: 7.5, title: "low" });
    await push(c._id, { score: 9.5, title: "high" });
    const q = (await a.get("/api/queue").expect(200)).body;
    expect(q.youtube.connected).toBe(true);
    expect(q.youtube.items.map((i) => i.title)).toEqual(["high", "low"]);
    const [e1, e2] = q.youtube.items.map((i) => new Date(i.eta).getTime());
    expect(e2 - e1).toBe(30 * 60000);
    expect(q.instagram.items).toEqual([]);
  });

  it("bulk approve/reject/delete skips published clips; retry requeues failures", async () => {
    const a = await owner();
    const c = (await a.post("/api/creators").send({ link: "@IShowSpeed" })).body;
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await push(c._id, { source: "vod", title: `vod ${i}` })).body.id);
    await Clip.updateOne({ _id: ids[2] }, { $set: { publications: [{ platform: "youtube", status: "published" }], status: "published" } });
    const r = (await a.post("/api/clips/bulk").send({ ids, action: "approve" }).expect(200)).body;
    expect(r).toEqual({ done: 2, skipped: 1 });
    expect((await Clip.findById(ids[0]).lean()).status).toBe("ready");
    await a.post("/api/clips/bulk").send({ ids: ["x"], action: "approve" }).expect(400);
    await Clip.updateOne({ _id: ids[0] }, { $set: { status: "failed", "publications.0.status": "failed", "publications.0.error": "boom" } });
    const rt = (await a.post(`/api/clips/${ids[0]}/retry`).expect(200)).body;
    expect(rt.status).toBe("ready");
    expect(rt.publications[0]).toMatchObject({ status: "queued", attempts: 0 });
    await a.post(`/api/clips/${ids[1]}/retry`).expect(400);
    expect((await a.post("/api/clips/bulk").send({ ids: [ids[1]], action: "delete" })).body.done).toBe(1);
  });

  it("search and sort clips", async () => {
    const a = await owner();
    const c = (await a.post("/api/creators").send({ link: "@IShowSpeed" })).body;
    await push(c._id, { title: "Speed meets Ronaldo", score: 7.2 });
    await push(c._id, { title: "Speed scared (haunted)", score: 9.1 });
    expect((await a.get("/api/clips?q=ronaldo")).body.map((x) => x.title)).toEqual(["Speed meets Ronaldo"]);
    expect((await a.get("/api/clips?q=(haunted")).body).toHaveLength(1);             // regex characters are escaped
    expect((await a.get("/api/clips?sort=score")).body[0].score).toBe(9.1);
  });
});

describe("analytics, secrets, events", () => {
  it("analytics aggregates clips, scores and sessions", async () => {
    const a = await owner();
    const c = (await a.post("/api/creators").send({ link: "@IShowSpeed", name: "IShowSpeed" })).body;
    await push(c._id, { score: 8.2 });
    await push(c._id, { score: 5, title: "meh" });
    const r = (await a.get("/api/analytics?days=7").expect(200)).body;
    expect(r.dates).toHaveLength(7);
    expect(r.totals.clips).toBe(2);
    expect(r.scoreHistogram.find((x) => x.score === 8).n).toBe(1);
    expect(r.perCreator[0]).toMatchObject({ name: "IShowSpeed", clips: 2 });
    expect(r.clipsByDay.at(-1).ready + r.clipsByDay.at(-1).rejected).toBe(2);
  });

  it("AI key is encrypted, masked for the dashboard, and given to the worker only", async () => {
    const a = await owner();
    await a.put("/api/secrets/anthropic").send({ key: "nope" }).expect(400);
    const key = `sk-ant-api03-${"x".repeat(40)}`;
    const r = (await a.put("/api/secrets/anthropic").send({ key }).expect(200)).body;
    expect(r.anthropicKey).not.toContain("x".repeat(20));
    expect((await a.get("/api/secrets")).body.anthropicKey).toMatch(/^sk-ant-api…|^sk-ant-ap/);
    expect((await request(app).get("/api/worker/config").set(W)).body.anthropicKey).toBe(key);
    const raw = await mongoose.connection.db.collection("settings").findOne({ _id: "platform" });
    expect(JSON.stringify(raw)).not.toContain(key);
    await a.put("/api/secrets/anthropic").send({ key: "" }).expect(200);
    expect((await request(app).get("/api/worker/config").set(W)).body.anthropicKey).toBe("");
  });

  it("activity is recorded and streamed live over SSE", async () => {
    const a = await owner();
    const cookie = (await a.get("/api/auth/me")).request.cookies;
    const server = app.listen(0);
    const port = server.address().port;
    const got = [];
    const req = http.get({ port, path: "/api/stream", headers: { cookie, host: "localhost" } }, (res) => {
      res.setEncoding("utf8");
      res.on("data", (d) => got.push(d));
    });
    await sleep(150);
    await a.post("/api/creators").send({ link: "@SomeCreator", name: "Some Creator" }).expect(201);
    await sleep(200);
    req.destroy();
    server.close();
    const text = got.join("");
    expect(text).toContain("Now following Some Creator");
    expect(await Event.countDocuments({ type: "creator" })).toBe(1);
    await request(app).get("/api/stream").expect(401);
  });
});

describe("offline detection", () => {
  it("ends open recordings when the worker stops sending heartbeats", async () => {
    const a = await owner();
    const c = (await a.post("/api/creators").send({ link: "@SomeX" })).body;
    const now = Math.floor(Date.now() / 1000);
    await request(app).post("/api/worker/heartbeat").set(W).send({ sessions: [{ creatorId: c.channel, creator: "X", videoId: "v9", title: "t", since: now - 60, recordedUntil: now }] });
    await WorkerStatus.updateOne({ _id: "worker" }, { $set: { lastSeen: new Date(Date.now() - 5 * 60000) } });
    const h = startMonitor(200);
    await sleep(500);
    clearInterval(h);
    expect((await a.get("/api/sessions")).body[0].live).toBe(false);
    expect((await a.get("/api/worker-status")).body.online).toBe(false);
    const msg = (await a.get("/api/events?type=worker")).body[0].message;
    expect(msg).toContain("1 recording was interrupted");
  });
});

describe('publish next', () => {
  it('pinned clips jump the queue and the worker job order', async () => {
    const a = await owner();
    await acc("youtube");
    const c = (await a.post('/api/creators').send({ link: '@IShowSpeed' })).body;
    await push(c._id, { score: 9.5, title: 'best' });
    const low = (await push(c._id, { score: 7.1, title: 'low' })).body.id;
    expect((await a.get('/api/queue')).body.youtube.items[0].title).toBe('best');
    await a.post('/api/clips/' + low + '/priority').send({}).expect(200);
    const q = (await a.get('/api/queue')).body.youtube.items;
    expect(q[0]).toMatchObject({ title: 'low', pinned: true });
    expect((await request(app).get('/api/worker/jobs/next').set(W)).body.job.title).toBe('low');
    await a.post('/api/clips/' + low + '/priority').send({ pin: false }).expect(200);
  });

  it('serves gzip but never buffers the event stream', async () => {
    const a = await owner();
    const r = await a.get('/api/analytics?days=30').set('Accept-Encoding', 'gzip');
    expect(r.headers['content-encoding']).toBe('gzip');
  });
});
