// Accounts: anyone can sign up (config.signupOpen); the first account is the admin.
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

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "only the site admin can do this" });
  next();
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
  const setupNeeded = (await User.countDocuments()) === 0;
  res.json({ setupNeeded, signupOpen: setupNeeded || config.signupOpen });
});

const me = (u) => ({ email: u.email, role: u.role || "user" });

const signupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  skip: () => !!process.env.VITEST,
  message: { error: "too many sign-ups from this network; try again later" } });

async function signup(req, res) {
  const first = (await User.countDocuments()) === 0;
  if (!first && !config.signupOpen) return res.status(403).json({ error: "sign-up is closed on this site; ask the admin for an account" });
  const r = creds.safeParse(req.body);
  if (!r.success) return res.status(400).json({ error: r.error.issues[0].message });
  if (await User.exists({ email: r.data.email.toLowerCase() })) return res.status(409).json({ error: "an account with this email already exists; log in instead" });
  const user = await User.create({ email: r.data.email, passwordHash: await bcrypt.hash(r.data.password, 12), role: first ? "admin" : "user" });
  setSession(res, user);
  res.json(me(user));
}
authRouter.post("/signup", signupLimiter, signup);
authRouter.post("/setup", signupLimiter, signup);   // older clients

authRouter.post("/login", loginLimiter, async (req, res) => {
  const r = creds.safeParse(req.body);
  const user = r.success ? await User.findOne({ email: r.data.email.toLowerCase() }) : null;
  const ok = user && (await bcrypt.compare(r.data.password, user.passwordHash));
  if (!ok) return res.status(401).json({ error: "wrong email or password" });
  setSession(res, user);
  res.json(me(user));
});

authRouter.post("/logout", (req, res) => {
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireUser, (req, res) => res.json(me(req.user)));

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
