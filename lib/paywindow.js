// When online payment is open, and how long a customer has. Both come from shop.json: pay.window.
// The hours are the shop's own clock (India time), so they don't depend on the server's.
const IST = 5.5 * 3600e3;
const hourOf = (now) => new Date(now + IST).getUTCHours();
const isOpen = (w, now = Date.now()) => { const h = hourOf(now); return h >= w.opensHour && h < w.closesHour; };
const label = (h) => `${h % 12 || 12} ${h % 24 < 12 ? "am" : "pm"}`;
const closedText = (w) => `Online payment is open from ${label(w.opensHour)} to ${label(w.closesHour)}. Message us on WhatsApp to order now.`;
// ORDER_HOURS="0-24" overrides the hours, for tests and previews that run at any time of day.
function read(base = {}, hours = "") {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(hours || "");
  return { minutes: base.minutes || 4, opensHour: m ? Number(m[1]) : base.opensHour ?? 11, closesHour: m ? Number(m[2]) : base.closesHour ?? 23 };
}
module.exports = { isOpen, closedText, read };
