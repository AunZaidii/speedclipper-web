// Every word people see about clips lives here, in plain language (no "queue", "VOD", "z-score", "heuristic"...).

/** A clip's state, as people think about it. */
export const CLIP_STATUS = {
  pending: "Needs review",
  ready: "Scheduled",
  rejected: "Skipped",
  published: "Posted",
  failed: "Didn't post",
};

export const CLIP_STATUS_HELP = {
  pending: "Waiting for you to approve or skip it.",
  ready: "Approved. It will be posted automatically when its turn comes.",
  rejected: "Not posted. You can still approve it if you like it.",
  published: "Live on your channel.",
  failed: "Something stopped it from posting. You can try again.",
};

/** One platform post (YouTube or Instagram) of a clip. */
export const POST_STATUS = { queued: "Scheduled", uploading: "Posting now", published: "Posted", failed: "Didn't post" };

export const PLATFORM = { youtube: "YouTube", instagram: "Instagram", twitch: "Twitch" };

/** Rating 1-10 in words. */
export function ratingWord(score) {
  if (score == null) return "Not rated";
  if (score >= 9) return "Excellent";
  if (score >= 7.5) return "Great";
  if (score >= 6) return "Good";
  if (score >= 4) return "Weak";
  return "Poor";
}

/** Why this moment was picked (new clips already carry a plain sentence; older ones get one from their numbers). */
export function whyPicked(clip) {
  const r = String(clip?.scoreReason || "");
  if (r && !/heuristic|z |density|combined/i.test(r)) return r;
  const z = clip?.zChat ?? clip?.combined ?? 0;
  const loud = (clip?.zAudio ?? 0) >= 2;
  const chat = z >= 6 ? "Chat exploded" : z >= 4 ? "Chat got very busy" : z >= 2.5 ? "Chat picked up" : "Something happened";
  return `${chat} at this moment${loud ? " and the streamer got loud" : ""}.`;
}

/** Why it wasn't posted, in plain words (also turns older technical reasons into sentences). */
export function whySkipped(reason) {
  const r = String(reason || "");
  let m = /score ([\d.]+) < (?:min_score_to_publish )?([\d.]+)/i.exec(r);
  if (m) return `Rated ${Number(m[1])}/10, below the minimum of ${Number(m[2])}.`;
  if (/music|lyrics/i.test(r)) return "Mostly music or singing (music can get the video blocked).";
  if (/rejected in dashboard|you skipped/i.test(r)) return "You skipped this clip.";
  m = /^Rated .*$/.exec(r);
  if (m) return r.endsWith(".") ? r : `${r}.`;
  return r ? (r.endsWith(".") ? r : `${r}.`) : "Not posted.";
}

/** A posting error, explained with what happens next. */
export function postProblem(error) {
  const e = String(error || "");
  if (!e) return "";
  if (/quota|allowance|daily limit/i.test(e)) return "The daily posting limit was reached. It will try again tomorrow.";
  if (/not connected/i.test(e)) return "Your account isn't connected. Connect it on the Accounts page.";
  if (/expired|invalid_grant|reconnect|unauthori[sz]ed|401/i.test(e)) return "Your login expired. Reconnect it on the Accounts page.";
  if (/file (?:missing|not found)|not found on the/i.test(e)) return "The video file was lost before it could be posted.";
  if (/PRIVATE although|made .* private/i.test(e)) return "YouTube set the video to private. Check it in YouTube Studio.";
  if (/\b5\d\d\b|timed? ?out|network|ECONN|reach/i.test(e)) return "The platform had a hiccup. It will try again by itself.";
  if (/too long to process|processing failed/i.test(e)) return "Instagram couldn't process the video. Try again.";
  return `Couldn't post: ${e.replace(/^Facebook: /, "").split(/(?<=\.)\s/)[0].slice(0, 140)}`;
}

/** "in 25 min", "tomorrow 9:30", ... for a scheduled time. */
export function whenLabel(date) {
  if (!date) return "soon";
  const d = new Date(date);
  const mins = Math.round((d - Date.now()) / 60000);
  if (mins <= 1) return "any minute now";
  if (mins < 60) return `in ${mins} min`;
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  if (d.toDateString() === today.toDateString()) return `today at ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow at ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} at ${time}`;
}
