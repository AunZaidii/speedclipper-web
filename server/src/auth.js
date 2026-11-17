// Single-owner login: the first visit creates the owner account; nobody else can sign up.
import bcrypt from "bcryptjs";
import express from "express";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "./config.js";
import { User } from "./models.js";

const COOKIE = "sc_session";
const MAX_AGE = 30 * 24 * 3600 * 1000;

function setSession(res, user) {
  const token = jwt.sign({ sub: String(user._id), v: user.tokenVersion }, config.jwtSecret, { expiresIn: "30d" });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: config.isProd, maxAge: MAX_AGE, path: "/" });
}

export async function requireUser(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: "not signed in" });
  try {
    const p = jwt.verify(token, config.jwtSecret);
    const user = await User.findById(p.sub).lean();
    if (!user || user.tokenVersion !== p.v) return res.status(401).json({ error: "session expired" });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "session expired" });
  }
}

const creds = z.object({ email: z.email().max(200), password: z.string().min(10, "password must be at least 10 characters").max(200) });

export function createAuthRouter() {
const authRouter = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true, message: { error: "too many failed attempts; try again in 15 minutes" } });

authRouter.get("/status", async (req, res) => {
  res.json({ setupNeeded: (await User.countDocuments()) === 0 });
});

authRouter.post("/setup", loginLimiter, async (req, res) => {
  if (await User.countDocuments()) return res.status(409).json({ error: "the owner account already exists; sign in" });
  const r = creds.safeParse(req.body);
  if (!r.success) return res.status(400).json({ error: r.error.issues[0].message });
  const user = await User.create({ email: r.data.email, passwordHash: await bcrypt.hash(r.data.password, 12) });
  setSession(res, user);
  res.json({ email: user.email });
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const r = creds.safeParse(req.body);
  const user = r.success ? await User.findOne({ email: r.data.email.toLowerCase() }) : null;
  const ok = user && (await bcrypt.compare(r.data.password, user.passwordHash));
  if (!ok) return res.status(401).json({ error: "wrong email or password" });
  setSession(res, user);
  res.json({ email: user.email });
});

authRouter.post("/logout", (req, res) => {
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireUser, (req, res) => res.json({ email: req.user.email }));

authRouter.post("/password", requireUser, async (req, res) => {
  const { current, next } = req.body || {};
  const user = await User.findById(req.user._id);
  if (!(await bcrypt.compare(String(current || ""), user.passwordHash))) return res.status(400).json({ error: "current password is wrong" });
  if (String(next || "").length < 10) return res.status(400).json({ error: "new password must be at least 10 characters" });
  user.passwordHash = await bcrypt.hash(String(next), 12);
  user.tokenVersion += 1;               // signs out every other device
  await user.save();
  setSession(res, user);
  res.json({ ok: true });
});

return authRouter;
}
