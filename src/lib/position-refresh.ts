export const POSITION_REFRESH_EVENT = "neutral-trade:position-refresh";

/** Notify the position panel that confirmed on-chain state should be fetched again. */
export function refreshPosition(): void {
  window.dispatchEvent(new Event(POSITION_REFRESH_EVENT));
}

