type RefreshListener = () => void;

const listeners = new Set<RefreshListener>();

export function refreshPosition(): void {
  for (const listener of listeners) listener();
}

export function onPositionRefresh(listener: RefreshListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
