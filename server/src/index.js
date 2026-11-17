import mongoose from "mongoose";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { startMonitor } from "./routes/insights.js";

export async function start(mongoUri = config.mongoUri) {
  if (!mongoUri) throw new Error("MONGODB_URI is not set (see server/.env.example)");
  await mongoose.connect(mongoUri);
  const app = createApp();
  startMonitor();
  const server = app.listen(config.port, () => console.log(`SpeedClipper server on ${config.publicUrl} (port ${config.port})`));
  const stop = async () => { server.close(); await mongoose.disconnect(); process.exit(0); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  return server;
}

