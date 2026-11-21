let counter = 0;

/**
 * Stable, collision-resistant identifier. Uses `crypto.randomUUID` when the
 * host provides it and falls back to a random + monotonic string otherwise.
 */
export function createId(prefix = ''): string {
  const base =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 10)}`;
  return prefix ? `${prefix}_${base}` : base;
}
