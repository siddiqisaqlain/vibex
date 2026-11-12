// The race for a last piece. When a second real visitor lands on a piece that has one left, both are told the
// other is there and both see the same clock. The first to press gets a real hold (lib/holds.js); the clock itself
// takes nothing away, and when it ends the piece is still there for whoever presses first. Kept in memory on purpose.
const RACE_MS = 15e3, LEAD_MS = 4e3, REST_MS = 30 * 60e3, SHOWN_AFTER_MS = 8e3;
module.exports = function createRaces({ now = Date.now, ms = RACE_MS, lead = LEAD_MS, rest = REST_MS } = {}) {
  const races = new Map(); // product id -> { from, until, ran: Map(visitor -> when) }
  // `here` is everyone really on the piece now, `me` the visitor asking. A race starts when two or more are here and
  // one of them hasn't raced for this piece yet, so the same two people aren't raced again and again.
  function see(id, here, me) {
    const t = now();
    let r = races.get(id);
    if (r) { for (const [who, at] of r.ran) if (t - at > rest) r.ran.delete(who); if (!r.ran.size && t > r.until + SHOWN_AFTER_MS) { races.delete(id); r = null; } }
    const running = r && t < r.until;
    if (!running && here.length >= 2 && here.includes(me) && here.some((who) => !r?.ran.has(who))) {
      if (!r) races.set(id, (r = { from: 0, until: 0, ran: new Map() }));
      r.from = t + lead; r.until = r.from + ms; // the lead lets both pages hear of it before the clock starts
      for (const who of here) r.ran.set(who, t);
    } else if (running && here.includes(me)) r.ran.set(me, t); // walked in mid-race: this one counts as theirs too
    return r && t < r.until + SHOWN_AFTER_MS ? { from: r.from, until: r.until } : null;
  }
  const end = (id) => { const r = races.get(id); if (r && now() < r.until) r.until = now(); }; // someone pressed
  return { see, end };
};
module.exports.RACE_MS = RACE_MS;
