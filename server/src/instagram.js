// Publish a clip as an Instagram Reel: create container from a one-time public URL -> wait -> publish.
import { config } from "./config.js";
import { releaseFile } from "./media.js";
import { Clip } from "./models.js";
import { instagramToken } from "./routes/accounts.js";
import { countPublish } from "./util.js";
import { logEvent, notify } from "./events.js";
import { getSettings } from "./models.js";

const graph = (path) => `https://graph.facebook.com/${config.meta.graphVersion}${path}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, params) {
  const url = graph(path) + (method === "GET" ? `?${new URLSearchParams(params)}` : "");
  const r = await fetch(url, method === "GET" ? {} : { method, body: new URLSearchParams(params) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.error_user_msg || j.error?.message || r.statusText);
  return j;
}

export function instagramCaption(clip, settings) {
  const desc = String(clip.description || "");   // keeps the credit line (links aren't clickable on IG, the name still credits)
  const tags = (settings.instagramCaptionHashtags || "").trim();
  let caption = `${clip.title || ""}\n\n${desc}\n\n${tags}`.trim();
  const hashtags = caption.match(/#\w+/g) || [];
  if (hashtags.length > 30) for (const h of hashtags.slice(30)) caption = caption.replace(h, "");   // IG max 30 hashtags
  return caption.slice(0, 2200);
}

export async function publishToInstagram(clipObjectId, { pollMs = 10000, maxPolls = 60 } = {}) {
  const clip = await Clip.findById(clipObjectId);
  const pub = clip?.publications.find((p) => p.platform === "instagram");
  if (!clip || !pub || !clip.publishToken) return;
  pub.status = "uploading"; pub.attempts += 1; pub.updatedAt = new Date();
  await clip.save();
  try {
    const { token, igUserId } = await instagramToken(clip.owner);
    const settings = await getSettings(clip.owner);
    const container = await call("POST", `/${igUserId}/media`, {
      media_type: "REELS", video_url: `${config.publicUrl}/api/public/ig/${clip.publishToken}.mp4`,
      caption: instagramCaption(clip, settings), share_to_feed: "true", access_token: token,
    });
    let status = "IN_PROGRESS";
    for (let i = 0; i < maxPolls && status === "IN_PROGRESS"; i++) {
      await sleep(pollMs);
      const s = await call("GET", `/${container.id}`, { fields: "status_code,status", access_token: token });
      status = s.status_code;
      if (status === "ERROR" || status === "EXPIRED") throw new Error(`Instagram processing failed: ${s.status || status}`);
    }
    if (status !== "FINISHED") throw new Error("Instagram took too long to process the video");
    const media = await call("POST", `/${igUserId}/media_publish`, { creation_id: container.id, access_token: token });
    const info = await call("GET", `/${media.id}`, { fields: "permalink", access_token: token }).catch(() => ({}));
    Object.assign(pub, { status: "published", externalId: media.id, url: info.permalink, error: undefined, updatedAt: new Date() });
    await countPublish(clip.owner, "instagram");
    logEvent("published", `Posted to Instagram: ${clip.title}`, { level: "success", owner: clip.owner, clip: clip._id, platform: "instagram", url: info.permalink });
  } catch (e) {
    Object.assign(pub, { status: pub.attempts < 3 ? "queued" : "failed", error: String(e.message).slice(0, 500), updatedAt: new Date() });
    logEvent("failed", `${pub.status === "queued" ? "Instagram post didn't go through, trying again soon" : "Couldn't post to Instagram"}: ${clip.title}`,
      { level: pub.status === "queued" ? "warn" : "error", owner: clip.owner, clip: clip._id, platform: "instagram" });
  } finally {
    const file = clip.publishFile;
    clip.publishFile = undefined;
    clip.publishToken = undefined;
    if (clip.publications.every((p) => p.status === "published")) clip.status = "published";
    else if (clip.publications.some((p) => p.status === "failed") && !clip.publications.some((p) => ["queued", "uploading"].includes(p.status))) clip.status = "failed";
    await clip.save();
    await releaseFile(file);
    notify("clips", { owner: clip.owner });
  }
}
