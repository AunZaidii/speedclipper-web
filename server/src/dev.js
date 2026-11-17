// Local development: uses MONGODB_URI if set, otherwise a local MongoDB whose data is saved in server/.data/db
// (so your account, creators and settings survive restarts). DEV_DATA_DIR=memory gives a throwaway database.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { start } from "./index.js";

let uri = config.mongoUri;
if (!uri) {
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  const want = process.env.DEV_DATA_DIR;
  if (want === "memory") {
    uri = (await MongoMemoryServer.create()).getUri("speedclipper");
    console.log("DEV_DATA_DIR=memory: using a throwaway in-memory MongoDB (data is lost when this stops).");
  } else {
    const dbPath = path.resolve(want || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".data", "db"));
    fs.mkdirSync(dbPath, { recursive: true });
    const mongo = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: "wiredTiger", port: 27027 } });
    uri = mongo.getUri("speedclipper");
    console.log(`No MONGODB_URI: using a local MongoDB saved in ${dbPath}`);
  }
}
await start(uri);
