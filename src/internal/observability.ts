import type { ManageBacEvent, ManageBacObserver } from "../types.js";

export type EmitEvent = (event: ManageBacEvent) => void;

export function createEmitter(observer: ManageBacObserver | undefined): EmitEvent {
  return (event) => {
    if (!observer) return;
    try {
      void Promise.resolve(observer(Object.freeze(event))).catch(() => undefined);
    } catch {
      // Instrumentation must never change scraper behavior.
    }
  };
}
