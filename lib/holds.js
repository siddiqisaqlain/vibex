// Holds the last piece for whoever pressed Order now, for real: while it stands, the server refuses anyone else.
// That's what makes the countdown on the page true. Kept in memory on purpose, so a restart can only free pieces.
const HOLD_MS = 10 * 60e3, PER_ADDRESS = 3;
module.exports = function createHolds({ now = Date.now, ms = HOLD_MS } = {}) {
  const holds = new Map(); // "id|size" -> { token, ip, until }
  const key = (id, size) => `${id}|${size || ""}`;
  const live = (k) => { const h = holds.get(k); if (h && h.until <= now()) { holds.delete(k); return null; } return h || null; };
  const sweep = () => { for (const k of [...holds.keys()]) live(k); };
  function take(id, size, token, ip) {
    sweep();
    const k = key(id, size), h = live(k);
    if (h && h.token !== token) return { held: false, taken: true, until: h.until };
    for (const [other, x] of holds) if (x.token === token && other !== k) holds.delete(other); // one piece at a time
    if (!h && [...holds.values()].filter((x) => x.ip === ip).length >= PER_ADDRESS) return { held: false };
    const until = h ? h.until : now() + ms; // pressing again can't stretch it
    holds.set(k, { token, ip, until });
    return { held: true, until };
  }
  const release = (id, size, token) => { const k = key(id, size); if (live(k)?.token === token) holds.delete(k); };
  const blockedFor = (id, size, token) => { const h = live(key(id, size)); return h && h.token !== token ? h : null; };
  const anyOn = (id) => { sweep(); return [...holds.entries()].filter(([k]) => k.startsWith(`${id}|`)).map(([, h]) => h); };
  return { take, release, blockedFor, anyOn };
};
module.exports.HOLD_MS = HOLD_MS;
