// One-time upgrade from the single-owner version to accounts for everyone. Safe to run on every start:
// each step only touches data that hasn't been upgraded yet.
import mongoose from "mongoose";
import {
  Account, Clip, Command, Creator, DEFAULT_PLATFORM_SETTINGS, DEFAULT_USER_SETTINGS, Event, LiveSession, Quota, Setting, User, WorkerStatus,
  channelId,
} from "./models.js";

const ALL = [User, Creator, Clip, Account, Setting, WorkerStatus, Quota, Event, LiveSession, Command];

/** Build every index the models declare (the server runs with autoIndex off so this happens after the migration). */
export async function ensureIndexes(log = console.log) {
  await Promise.all(ALL.map((M) => M.createIndexes().catch((e) => log(`index ${M.modelName}: ${e.message}`))));
}

const pick = (obj, keys) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => k in keys));

export async function migrate(log = console.log) {
  const db = mongoose.connection.db;
  const users = await User.find().sort({ createdAt: 1, _id: 1 });
  if (!users.length) { await ensureIndexes(log); return { migrated: false }; }   // fresh install: the first sign-up becomes the admin
  let admin = users.find((u) => u.role === "admin");
  if (!admin) {
    admin = users[0];
    await User.updateOne({ _id: admin._id }, { $set: { role: "admin" } });
    log(`migrate: ${admin.email} is the admin`);
  }

  // old single-owner unique indexes would block a second user following the same channel
  for (const [col, name] of [["creators", "platform_1_handle_1"], ["clips", "clipId_1"], ["accounts", "platform_1"]]) {
    try {
      const idx = (await db.collection(col).indexes()).find((i) => i.name === name && i.unique);
      if (idx) { await db.collection(col).dropIndex(name); log(`migrate: dropped old unique index ${col}.${name}`); }
    } catch { /* collection doesn't exist yet */ }
  }

  const stats = {};
  for (const [name, M] of [["creators", Creator], ["clips", Clip], ["accounts", Account], ["commands", Command]]) {
    const r = await M.collection.updateMany({ owner: { $exists: false } }, { $set: { owner: admin._id } });
    if (r.modifiedCount) stats[name] = r.modifiedCount;
  }
  const ev = await Event.collection.updateMany({ owner: { $exists: false }, type: { $ne: "worker" } }, { $set: { owner: admin._id } });
  if (ev.modifiedCount) stats.events = ev.modifiedCount;

  // single "global" settings -> platform settings + the admin's own publishing settings
  const g = await Setting.collection.findOne({ _id: "global" });
  if (g) {
    await Setting.collection.updateOne({ _id: "platform" },
      { $setOnInsert: { values: pick(g.values, DEFAULT_PLATFORM_SETTINGS), ...(g.secrets ? { secrets: g.secrets } : {}) } }, { upsert: true });
    await Setting.collection.updateOne({ _id: String(admin._id) },
      { $setOnInsert: { values: pick(g.values, DEFAULT_USER_SETTINGS) } }, { upsert: true });
    await Setting.collection.deleteOne({ _id: "global" });
    stats.settings = "split into platform + admin";
  }

  // every creator knows which shared channel it is
  for (const c of await Creator.collection.find({ channel: { $exists: false } }).toArray()) {
    await Creator.collection.updateOne({ _id: c._id }, { $set: { channel: channelId(c.platform, c.handle) } });
    stats.channels = (stats.channels || 0) + 1;
  }

  // live sessions are shared per channel now
  for (const s of await LiveSession.collection.find({ channel: { $exists: false } }).toArray()) {
    const c = s.creator ? await Creator.collection.findOne({ _id: s.creator }) : null;
    await LiveSession.collection.updateOne({ _id: s._id }, { $set: { channel: c ? channelId(c.platform, c.handle) : null } });
    stats.sessions = (stats.sessions || 0) + 1;
  }

  await ensureIndexes(log);
  if (Object.keys(stats).length) log(`migrate: upgraded to multi-user ${JSON.stringify(stats)}`);
  return { migrated: true, admin: admin.email, stats };
}
