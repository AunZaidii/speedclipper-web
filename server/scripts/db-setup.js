// One-time (and safe to re-run) database setup: creates every collection and index the app uses,
// plus the GridFS "media" store for thumbnails and previews, then prints a report.
//   cd server
//   set MONGODB_URI=mongodb+srv://...      (cmd)   then:   npm run db:setup
// The server also builds missing indexes when it starts; this script just does it up front and verifies.
import "dotenv/config";
import mongoose from "mongoose";
import * as models from "../src/models.js";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("Set MONGODB_URI first (the mongodb+srv:// link from Atlas).");
  process.exit(1);
}

await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
const db = mongoose.connection.db;
console.log(`Connected to database "${db.databaseName}"\n`);

const list = Object.values(models).filter((m) => m?.prototype instanceof mongoose.Model);
for (const Model of list) {
  await Model.createCollection().catch((e) => { if (e.codeName !== "NamespaceExists") throw e; });
  await Model.syncIndexes();
}

// GridFS bucket "media": the same indexes the MongoDB driver creates on first upload
for (const name of ["media.files", "media.chunks"]) {
  await db.createCollection(name).catch((e) => { if (e.codeName !== "NamespaceExists") throw e; });
}
await db.collection("media.files").createIndex({ filename: 1, uploadDate: 1 });
await db.collection("media.chunks").createIndex({ files_id: 1, n: 1 }, { unique: true });

const rows = [];
for (const c of (await db.listCollections().toArray()).sort((a, b) => a.name.localeCompare(b.name))) {
  const idx = await db.collection(c.name).indexes();
  const count = await db.collection(c.name).estimatedDocumentCount();
  rows.push({
    collection: c.name,
    documents: count,
    indexes: idx.map((i) => Object.keys(i.key).join("+") + (i.unique ? " (unique)" : "") + (i.expireAfterSeconds ? ` (expires ${i.expireAfterSeconds / 86400}d)` : "")).join(", "),
  });
}
console.table(rows);
await mongoose.disconnect();
console.log("\nDatabase setup complete.");
