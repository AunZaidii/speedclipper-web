import { Quota, getSettings } from "./models.js";

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** '@IShowSpeed', 'youtube.com/@x', 'twitch.tv/x', 'twitch:x' -> { platform, handle } (same rules as the Python engine). */
export function parseChannel(text) {
  const t = String(text || "").trim();
  if (!t) throw new HttpError(400, "enter a channel link or handle");
  let m = /^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/([A-Za-z0-9_]{3,25})\/?/.exec(t) || /^twitch:([A-Za-z0-9_]{3,25})$/i.exec(t);
  if (m) return { platform: "twitch", handle: m[1].toLowerCase() };
  m = /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/(@[\w.\-]{3,30})/.exec(t);
  if (m) return { platform: "youtube", handle: m[1] };
  m = /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/(channel\/UC[\w-]{22})/.exec(t);
  if (m) return { platform: "youtube", handle: m[1] };
  if (/^@[\w.\-]{3,30}$/.test(t)) return { platform: "youtube", handle: t };
  throw new HttpError(400, "use a YouTube channel (@handle or youtube.com/@handle) or a Twitch link (twitch.tv/name)");
}

export function buildCreator({ name, link, autoUpload = true, hashtags = "", targets }) {
  const { platform, handle } = parseChannel(link);
  const channelUrl = platform === "twitch" ? `https://www.twitch.tv/${handle}` : `https://www.youtube.com/${handle}`;
  const liveUrl = platform === "twitch" ? channelUrl : `${channelUrl}/live`;
  const display = String(name || "").trim() || handle.replace(/^@/, "");
  return {
    name: display, platform, handle, channelUrl, liveUrl, autoUpload: !!autoUpload, hashtags: String(hashtags || "").trim(),
    creditLine: `🎥 Credit: ${display} — ${channelUrl}`,
    tags: [display, `${display} clips`, `${display.replace(/\s+/g, "")} highlights`],
    targets: { youtube: targets?.youtube ?? true, instagram: targets?.instagram ?? false },
  };
}

/** YouTube's quota day is Pacific time; we use it for every platform so the counter is simple. */
export function pacificDay(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export async function canPublish(platform, now = new Date()) {
  const s = await getSettings();
  if (!s.uploadsEnabled) return { ok: false, reason: "uploads are switched off" };
  const q = await Quota.findById(`${platform}:${pacificDay(now)}`).lean();
  if ((q?.uploads || 0) >= s.maxUploadsPerDay) return { ok: false, reason: `daily limit (${s.maxUploadsPerDay}) reached` };
  const last = await Quota.find({ _id: new RegExp(`^${platform}:`) }).sort({ lastAt: -1 }).limit(1).lean();
  const gapMs = s.minMinutesBetweenUploads * 60000;
  if (last[0]?.lastAt && now - new Date(last[0].lastAt) < gapMs) {
    return { ok: false, reason: `waiting ${s.minMinutesBetweenUploads} min between uploads`,
             waitMs: gapMs - (now - new Date(last[0].lastAt)) };
  }
  return { ok: true };
}

export async function countPublish(platform, now = new Date()) {
  await Quota.updateOne({ _id: `${platform}:${pacificDay(now)}` }, { $inc: { uploads: 1 }, $set: { lastAt: now } }, { upsert: true });
}

export function ensureCredit(description, creditLine) {
  const d = String(description || "");
  return creditLine && !d.includes(creditLine) ? `${d.trimEnd()}\n\n${creditLine}`.trim() : d;
}
