export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Server messages are short and technical-ish; make them read like a sentence a person would write. */
export function friendlyError(status, message) {
  if (status === 0) return "Can't reach SpeedClipper. Check your internet connection and try again.";
  if (status >= 500 && (!message || /server error|internal/i.test(message))) return "Something went wrong on our side. Please try again in a minute.";
  if (status === 429) return message || "Too many tries. Please wait a little and try again.";
  if (status === 404 && /^not found$/i.test(message || "")) return "That item doesn't exist any more.";
  const m = String(message || "Something went wrong.").trim();
  const sentence = m.charAt(0).toUpperCase() + m.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

export async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, friendlyError(0));
  }
  const data = (res.headers.get("content-type") || "").includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && path !== "/auth/me" && !path.startsWith("/auth/")) window.dispatchEvent(new Event("sc:logout"));
    throw new ApiError(res.status, friendlyError(res.status, data?.error || res.statusText));
  }
  return data;
}

export const timeAgo = (d) => {
  if (!d) return "never";
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} hours ago`;
  const days = Math.round(s / 86400);
  return days === 1 ? "yesterday" : `${days} days ago`;
};

export const minutes = (sec) => (sec == null ? "–" : `${sec >= 3600 ? `${Math.floor(sec / 3600)}h ` : ""}${Math.round((sec % 3600) / 60)}m`);
