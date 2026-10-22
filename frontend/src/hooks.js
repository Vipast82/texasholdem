import { useEffect, useState } from 'react';

/** The current time, re-read every `interval` ms while `active` (for countdowns). */
export function useNow(active, interval = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [active, interval]);
  return now;
}

/**
 * Milliseconds left on a server countdown. The server sends "ms remaining"
 * with each snapshot; `receivedAt` is when that snapshot arrived locally.
 */
export function remainingMs(ms, receivedAt, now) {
  if (ms == null) return null;
  return Math.max(0, ms - Math.max(0, now - receivedAt));
}
