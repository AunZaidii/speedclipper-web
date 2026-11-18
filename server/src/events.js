// Activity log + in-process event bus for Server-Sent Events.
// Events belong to a user (`owner`); events without an owner are platform/worker events, shown to the admin.
import { EventEmitter } from "node:events";
import { Event } from "./models.js";

export const bus = new EventEmitter();
bus.setMaxListeners(500);

/** Record an activity event and push it to that user's open dashboards. Never throws. */
export async function logEvent(type, message, extra = {}) {
  try {
    const e = await Event.create({ type, message, ...extra });
    bus.emit("event", { kind: "event", ...e.toObject() });
    return e;
  } catch (err) {
    console.error("logEvent failed", err.message);
    return null;
  }
}

/** Same event for several users (e.g. a channel they all follow went live). */
export async function logEventFor(owners, type, message, extra = {}) {
  const unique = [...new Set(owners.map(String))];
  await Promise.all(unique.map((owner) => logEvent(type, message, { ...extra, owner })));
}

/** Tell dashboards something changed (no activity entry). `owner` limits it to one user. */
export function notify(topic, data = {}) {
  bus.emit("event", { kind: "refresh", topic, ...data });
}

/** Should this SSE event reach this user? */
export function visibleTo(e, user) {
  if (e.owner) return String(e.owner) === String(user._id);
  return e.kind === "refresh" || user.role === "admin";
}
