// Small settings and the best score, kept in this browser only. Storage can be missing or throw (private windows,
// blocked site data), so every read and write is guarded and the game works without it.
const PREFIX = 'neonVoyage.';

export function read(key, fallback) {
  try {
    const value = localStorage.getItem(PREFIX + key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function write(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* not saved */ }
}

export const readBest = () => Math.max(0, Math.floor(Number(read('best', 0)) || 0));
