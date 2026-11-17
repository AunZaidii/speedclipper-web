export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (res.headers.get("content-type") || "").includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && path !== "/auth/me" && !path.startsWith("/auth/")) window.dispatchEvent(new Event("sc:logout"));
    throw new ApiError(res.status, data?.error || res.statusText);
  }
  return data;
}

export const timeAgo = (d) => {
  if (!d) return "never";
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};

export const minutes = (sec) => (sec == null ? "–" : `${sec >= 3600 ? `${Math.floor(sec / 3600)}h ` : ""}${Math.round((sec % 3600) / 60)}m`);
