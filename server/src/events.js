// Activity log + in-process event bus for Server-Sent Events.
import { EventEmitter } from "node:events";
import { Event } from "./models.js";

export const bus = new EventEmitter();
bus.setMaxListeners(200);

/** Record an activity event and push it to every open dashboard. Never throws. */
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

/** Tell dashboards something changed (no activity entry). */
export function notify(topic, data = {}) {
  bus.emit("event", { kind: "refresh", topic, ...data });
}
