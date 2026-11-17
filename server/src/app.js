import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { createAuthRouter } from "./auth.js";
import { config } from "./config.js";
import { streamFile } from "./media.js";
import { Clip } from "./models.js";
import { accounts } from "./routes/accounts.js";
import { api } from "./routes/api.js";
import { insights } from "./routes/insights.js";
import { worker } from "./routes/worker.js";

const CLIENT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);            // behind Render's proxy: correct client IPs for rate limits
  app.disable("x-powered-by");
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      "default-src": ["'self'"], "img-src": ["'self'", "data:", "blob:"], "media-src": ["'self'", "blob:"],
      "style-src": ["'self'", "'unsafe-inline'"], "script-src": ["'self'"], "connect-src": ["'self'"],
      "form-action": ["'self'", "https://accounts.google.com", "https://www.facebook.com"],
    } },
    crossOriginResourcePolicy: { policy: "same-site" },
  }));
  app.use(compression({ filter: (req, res) => req.path !== "/api/stream" && compression.filter(req, res) }));
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));

  // Browser requests that change data must come from this site (CSRF defence on top of SameSite cookies).
  const allowed = new Set([new URL(config.publicUrl).origin, "http://localhost:5173", "http://127.0.0.1:5173"]);
  app.use("/api", (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method) || req.path.startsWith("/worker")) return next();
    const origin = req.get("origin");
    if (origin && !allowed.has(origin)) return res.status(403).json({ error: "cross-site request blocked" });
    next();
  });

  app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  // One-time public video URL for Instagram's fetcher (random 48-hex token, deleted after publishing).
  app.get("/api/public/ig/:file", async (req, res) => {
    const token = String(req.params.file).replace(/\.mp4$/, "");
    if (!/^[0-9a-f]{48}$/.test(token)) return res.status(404).end();
    const clip = await Clip.findOne({ publishToken: token }).select("publishFile").lean();
    if (!clip?.publishFile) return res.status(404).end();
    await streamFile(clip.publishFile, req, res);
  });

  app.use("/api/auth", createAuthRouter());
  app.use("/api/accounts", accounts);
  app.use("/api/worker", worker);
  app.use("/api", insights);
  app.use("/api", api);

  app.use("/api", (req, res) => res.status(404).json({ error: "not found" }));

  if (fs.existsSync(CLIENT_DIST)) {
    // hashed assets are immutable; index.html / sw.js must always be revalidated
    app.use("/assets", express.static(path.join(CLIENT_DIST, "assets"), { maxAge: "365d", immutable: true }));
    app.use(express.static(CLIENT_DIST, { index: false, maxAge: 0, setHeaders: (res, p) => {
      if (p.endsWith("sw.js")) res.setHeader("Service-Worker-Allowed", "/");
      if (p.endsWith(".webmanifest")) res.setHeader("Content-Type", "application/manifest+json");
    } }));
    app.get("/{*splat}", (req, res) => res.sendFile(path.join(CLIENT_DIST, "index.html")));
  }

  // Express 5 forwards async errors here.
  app.use((err, req, res, next) => {   // eslint-disable-line no-unused-vars
    const status = err.status || (err.name === "ValidationError" ? 400 : err.code === "LIMIT_FILE_SIZE" ? 413 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 && config.isProd ? "server error" : err.message });
  });
  return app;
}
