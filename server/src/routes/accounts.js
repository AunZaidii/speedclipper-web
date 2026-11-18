// Connect YouTube (Google OAuth, upload scope only) and Instagram (Facebook Login -> IG Business account).
// Tokens are stored encrypted in MongoDB; the worker only ever gets short-lived access tokens.
import crypto from "node:crypto";
import express from "express";
import { OAuth2Client } from "google-auth-library";
import { requireUser } from "../auth.js";
import { config } from "../config.js";
import { decrypt, encrypt, safeEqual } from "../crypto.js";
import { Account } from "../models.js";
import { HttpError } from "../util.js";

export const accounts = express.Router();
const YT_SCOPES = ["https://www.googleapis.com/auth/youtube.upload"];
const IG_SCOPES = ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement", "business_management"];
const STATE_COOKIE = "sc_oauth_state";

const ytRedirect = () => `${config.publicUrl}/api/accounts/youtube/callback`;
const igRedirect = () => `${config.publicUrl}/api/accounts/instagram/callback`;
const graph = (path) => `https://graph.facebook.com/${config.meta.graphVersion}${path}`;

function googleClient() {
  if (!config.google.clientId || !config.google.clientSecret) throw new HttpError(500, "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set on the server");
  return new OAuth2Client(config.google.clientId, config.google.clientSecret, ytRedirect());
}

function newState(res, platform) {
  const state = `${platform}.${crypto.randomBytes(24).toString("hex")}`;
  res.cookie(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure: config.isProd, maxAge: 10 * 60 * 1000, path: "/" });
  return state;
}
function checkState(req, res, platform) {
  const ok = safeEqual(req.query.state, req.cookies?.[STATE_COOKIE]) && String(req.query.state).startsWith(`${platform}.`);
  res.clearCookie(STATE_COOKIE, { path: "/" });
  if (!ok) throw new HttpError(400, "login link expired or was not started here; try Connect again");
}

async function fbGet(url) {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new HttpError(502, `Facebook: ${j.error?.message || r.statusText}`);
  return j;
}

// ---------------------------------------------------------------- status
accounts.get("/", requireUser, async (req, res) => {
  const list = await Account.find({ owner: req.user._id }).select("-tokens").lean();
  res.json({
    youtube: list.find((a) => a.platform === "youtube") || null,
    instagram: list.find((a) => a.platform === "instagram") || null,
    configured: { youtube: !!(config.google.clientId && config.google.clientSecret), instagram: !!(config.meta.appId && config.meta.appSecret) },
    redirects: { youtube: ytRedirect(), instagram: igRedirect() },
    isAdmin: req.user.role === "admin",
  });
});

accounts.post("/:platform/disconnect", requireUser, async (req, res) => {
  if (!["youtube", "instagram"].includes(req.params.platform)) throw new HttpError(404, "unknown platform");
  await Account.deleteOne({ owner: req.user._id, platform: req.params.platform });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- YouTube
accounts.get("/youtube/start", requireUser, (req, res) => {
  const url = googleClient().generateAuthUrl({ access_type: "offline", prompt: "consent", scope: YT_SCOPES,
    state: newState(res, "youtube"), include_granted_scopes: true });
  res.redirect(url);
});

accounts.get("/youtube/callback", requireUser, async (req, res) => {
  if (req.query.error) return res.redirect(`/accounts?error=${encodeURIComponent(String(req.query.error))}`);
  checkState(req, res, "youtube");
  const { tokens } = await googleClient().getToken(String(req.query.code || ""));
  if (!tokens.refresh_token) throw new HttpError(400, "Google returned no refresh token; remove SpeedClipper at myaccount.google.com/permissions and connect again");
  if (!String(tokens.scope || "").includes("youtube.upload")) throw new HttpError(400, "the YouTube upload permission was not granted; tick it on Google's screen");
  await Account.updateOne({ owner: req.user._id, platform: "youtube" }, { $set: {
    displayName: "YouTube channel", tokens: encrypt({ refresh_token: tokens.refresh_token }),
    connectedAt: new Date(), expiresAt: null } }, { upsert: true });
  res.redirect("/accounts?connected=youtube");
});

/** Fresh access token for the worker, for the user who owns the clip being uploaded. */
export async function youtubeAccessToken(owner) {
  const acc = await Account.findOne({ owner, platform: "youtube" });
  if (!acc) throw new HttpError(409, "YouTube is not connected");
  const client = googleClient();
  client.setCredentials({ refresh_token: decrypt(acc.tokens).refresh_token });
  try {
    const { token } = await client.getAccessToken();
    return { accessToken: token, expiresAt: client.credentials.expiry_date || null };
  } catch (e) {
    throw new HttpError(409, `YouTube login expired (${e.message}); reconnect it in Accounts`);
  }
}

// ---------------------------------------------------------------- Instagram (via Facebook Login)
accounts.get("/instagram/start", requireUser, (req, res) => {
  if (!config.meta.appId) throw new HttpError(500, "META_APP_ID / META_APP_SECRET are not set on the server");
  const u = new URL(`https://www.facebook.com/${config.meta.graphVersion}/dialog/oauth`);
  u.search = new URLSearchParams({ client_id: config.meta.appId, redirect_uri: igRedirect(), state: newState(res, "instagram"),
    scope: IG_SCOPES.join(","), response_type: "code" }).toString();
  res.redirect(u.toString());
});

accounts.get("/instagram/callback", requireUser, async (req, res) => {
  if (req.query.error) return res.redirect(`/accounts?error=${encodeURIComponent(String(req.query.error_description || req.query.error))}`);
  checkState(req, res, "instagram");
  const { appId, appSecret } = config.meta;
  const short = await fbGet(graph(`/oauth/access_token?${new URLSearchParams({ client_id: appId, client_secret: appSecret,
    redirect_uri: igRedirect(), code: String(req.query.code || "") })}`));
  const long = await fbGet(graph(`/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: appId,
    client_secret: appSecret, fb_exchange_token: short.access_token })}`));
  const pages = await fbGet(graph(`/me/accounts?${new URLSearchParams({ fields: "name,instagram_business_account{id,username}",
    access_token: long.access_token })}`));
  const page = (pages.data || []).find((p) => p.instagram_business_account);
  if (!page) throw new HttpError(400, "no Instagram Business/Creator account is linked to the Facebook Pages you allowed");
  const ig = page.instagram_business_account;
  await Account.updateOne({ owner: req.user._id, platform: "instagram" }, { $set: {
    displayName: `@${ig.username}`, externalId: ig.id, connectedAt: new Date(),
    tokens: encrypt({ userToken: long.access_token }),
    expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null } }, { upsert: true });
  res.redirect("/accounts?connected=instagram");
});

/** Long-lived Instagram token for this user, refreshed when it has < 10 days left. */
export async function instagramToken(owner) {
  const acc = await Account.findOne({ owner, platform: "instagram" });
  if (!acc) throw new HttpError(409, "Instagram is not connected");
  let { userToken } = decrypt(acc.tokens);
  if (acc.expiresAt && acc.expiresAt - Date.now() < 10 * 86400000) {
    const r = await fbGet(graph(`/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token",
      client_id: config.meta.appId, client_secret: config.meta.appSecret, fb_exchange_token: userToken })}`));
    userToken = r.access_token;
    acc.tokens = encrypt({ userToken });
    acc.expiresAt = r.expires_in ? new Date(Date.now() + r.expires_in * 1000) : acc.expiresAt;
    await acc.save();
  }
  return { token: userToken, igUserId: acc.externalId };
}
