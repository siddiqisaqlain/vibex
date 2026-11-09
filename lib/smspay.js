// Automatic payment check from the owner's bank SMS (free, no payment gateway). Decided 2026-11-09.
//
// The owner's Android phone runs an SMS forwarder app that posts every bank SMS to
// /api/pay/sms?t=<PAY_SMS_TOKEN>. Each website order asks for a unique amount a few paise
// below its price (₹6,599.63 for a ₹6,600 jacket), so an SMS saying "credited ₹6,599.63"
// belongs to exactly one open order, which then confirms itself.
// Anything that doesn't match exactly is left alone: the owner can still send "confirm VX-1234".
//
// The token is the only lock: anyone holding it could confirm an order without paying. Keep it
// long and random, only in the forwarder app and on Render, and change it if the phone is lost.

const crypto = require("crypto");

// The message, from whatever shape the forwarder app sends: JSON, a form, or plain text.
function smsText(raw, contentType = "") {
  const s = String(raw || "");
  let obj = null;
  if (/json/i.test(contentType) || /^\s*\{/.test(s)) { try { obj = JSON.parse(s); } catch { /* plain text after all */ } }
  else if (/x-www-form-urlencoded/i.test(contentType)) obj = Object.fromEntries(new URLSearchParams(s));
  if (!obj) return { text: s.slice(0, 2000), from: "" };
  const pick = (...keys) => { for (const k of keys) for (const [kk, v] of Object.entries(obj)) if (kk.toLowerCase() === k && v != null && v !== "") return String(v); return ""; };
  return { text: pick("text", "message", "msg", "body", "content", "sms").slice(0, 2000), from: pick("from", "sender", "address", "phone", "number").slice(0, 60) };
}

// "credited with INR 6,599.63" -> 659963 (paise). Null when the SMS isn't money coming in.
const AMOUNT = /(?:rs\.?|inr|₹)\s*:?\s*([\d,]+(?:\.\d{1,2})?)/gi;
function creditPaise(text) {
  const t = String(text || "");
  const credit = t.search(/\b(credited|received|deposited)\b|\bcr\b/i);
  if (credit < 0) return null;
  // "Rs 500 debited from your a/c ... credited to xyz@upi" is money going OUT: whichever comes first decides.
  const debit = t.search(/\b(debited|sent|paid|withdrawn|dr)\b/i);
  if (debit >= 0 && debit < credit) return null;
  // Not money that has arrived: a collect request, an OTP, a reminder.
  if (/\b(otp|collect request|requested|will be|is due|reminder)\b/i.test(t)) return null;
  AMOUNT.lastIndex = 0;
  const m = AMOUNT.exec(t);
  if (!m) return null;
  const n = Math.round(Number(m[1].replace(/,/g, "")) * 100);
  return n > 0 ? n : null;
}

// A paise amount below `amountRupees` that no other open order is using: 1..99 paise off.
function uniquePaise(amountRupees, openOrders) {
  const used = new Set(openOrders.map((o) => Math.round((o.payExact ?? o.amount) * 100)));
  const base = Math.round(amountRupees * 100);
  const free = [];
  for (let p = 1; p <= 99; p++) if (!used.has(base - p)) free.push(p);
  return free.length ? free[crypto.randomInt(free.length)] : 0;
}

const sameToken = (given, want) => {
  if (!want) return false;
  const a = Buffer.from(String(given || "")), b = Buffer.from(String(want));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

module.exports = { smsText, creditPaise, uniquePaise, sameToken };
