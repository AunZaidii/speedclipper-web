import "dotenv/config";
import crypto from "node:crypto";

const env = process.env;
const isProd = env.NODE_ENV === "production";

function required(name, devDefault) {
  const v = env[name];
  if (v) return v;
  if (!isProd && devDefault !== undefined) return devDefault;
  throw new Error(`Missing required environment variable ${name} (see server/.env.example)`);
}

export const config = {
  isProd,
  port: Number(env.PORT || 4000),
  mongoUri: env.MONGODB_URI || "",
  // public base URL of this server, e.g. https://speedclipper.onrender.com (used for OAuth redirects)
  publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 4000}`).replace(/\/$/, ""),
  jwtSecret: required("JWT_SECRET", "dev-only-jwt-secret-change-me"),
  // 32-byte key (base64 or hex) that encrypts OAuth tokens at rest
  encryptionKey: required("ENCRYPTION_KEY", crypto.createHash("sha256").update("dev-only").digest("base64")),
  // shared secret the laptop worker sends in X-Worker-Key
  workerKey: required("WORKER_KEY", "dev-worker-key"),
  google: { clientId: env.GOOGLE_CLIENT_ID || "", clientSecret: env.GOOGLE_CLIENT_SECRET || "" },
  meta: { appId: env.META_APP_ID || "", appSecret: env.META_APP_SECRET || "", graphVersion: env.META_GRAPH_VERSION || "v23.0" },
  maxPreviewBytes: 25 * 1024 * 1024,
  maxPublishFileBytes: 200 * 1024 * 1024,
};
