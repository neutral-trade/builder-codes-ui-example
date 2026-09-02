"use client";

export const POSITION_REFRESH_EVENT = "neutral-position-refresh";

export function refreshPosition(): void {
  window.dispatchEvent(new Event(POSITION_REFRESH_EVENT));
}
