// Read-only backup of the whole database to one JSON file (Extended JSON: ids and dates survive a restore).
//   set MONGODB_URI=mongodb+srv://...      then:   node scripts/db-backup.js <output folder>
// The file contains password hashes and encrypted tokens: keep it private, never commit it.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI;
if (!uri) { console.error("Set MONGODB_URI first."); process.exit(1); }
const outDir = path.resolve(process.argv[2] || "backups");
fs.mkdirSync(outDir, { recursive: true });

await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
const db = mongoose.connection.db;
const { EJSON } = mongoose.mongo.BSON;
const dump = {};
for (const { name } of await db.listCollections().toArray()) dump[name] = await db.collection(name).find().toArray();
const file = path.join(outDir, `${db.databaseName}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(file, EJSON.stringify(dump, { relaxed: false }));
console.log(`Backed up ${Object.keys(dump).length} collections (${Object.entries(dump).map(([k, v]) => `${k}:${v.length}`).join(", ")})`);
console.log(`-> ${file} (${(fs.statSync(file).size / 1048576).toFixed(1)} MB)`);
await mongoose.disconnect();
