// Unified ID generator.
// Avoids using crypto.randomUUID() directly because some HTTP/IP deployments
// may run in environments where it's missing (secure-context restrictions, polyfills, etc.).

function base36Time() {
  return Date.now().toString(36);
}

function randomBase36(len = 12) {
  // Best-effort randomness without assuming crypto.randomUUID exists.
  // Use crypto.getRandomValues when available, else Math.random.
  try {
    const g = globalThis.crypto;
    if (g && typeof g.getRandomValues === 'function') {
      const bytes = new Uint8Array(Math.ceil(len / 2));
      g.getRandomValues(bytes);
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, len);
    }
  } catch {
    // ignore and fallback
  }
  let s = '';
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}

export function generateId(prefix = 'id') {
  // Format: <prefix>-<time>-<rand>
  // Determinism not required; uniqueness is the goal for client-side and DB primary keys.
  return `${prefix}-${base36Time()}-${randomBase36(12)}`;
}

// Backward-friendly alias
export const createId = generateId;
