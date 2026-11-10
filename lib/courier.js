// What delivery costs, from shop.json -> policy.courier. The server is the only place this is worked out: the order
// total comes from here, and the checkout only shows it. The courier charge is kept apart from the selling price.
//
// Each piece's packed weight is pulled automatically: a weight the owner set on the item wins, then the first
// word in the weights table that appears in the item's subcategory or name ("Puffer", "Jacket", "Perfume"...),
// then its category, then the default. The parcel's weights add up, and the courier is charged per started kg:
// 0.9 kg pays for 1 kg, 1.8 kg for 2 kg, 2.1 kg for 3 kg.

function kgOf(c, product) {
  const own = Number(product.weightKg);
  if (own > 0) return own;
  const table = c?.kg || {};
  const text = `${product.subcategory || ""} ${product.name || ""}`.toLowerCase();
  // Longer words first, so "Puffer jacket" matches Puffer before Jacket.
  const word = Object.keys(table).filter((k) => k !== "default" && !k.startsWith("_")).sort((a, b) => b.length - a.length)
    .find((k) => new RegExp(`\\b${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`).test(text));
  return word ? table[word] : table[product.category] ?? table.default ?? 1;
}

const isInside = (c, pin) => (c?.kashmirPins || []).some((x) => String(pin).startsWith(x));

// Whole kg charged for a parcel weight (2 decimal places first, so 0.3 x 3 is 0.9 and not 0.90000001).
const slabs = (kg) => Math.max(1, Math.ceil(Math.round(kg * 100) / 100));

// The rate per kg for a PIN, or null if inside Kashmir is confirmed on WhatsApp instead.
function rateFor(c, inside) {
  if (!inside) return c.perKg;
  return c.insideKashmirPerKg ?? null;
}

function feeFor(c, kg, pin) {
  if (!c?.perKg) return { fee: null, inside: false, kg };
  const inside = isInside(c, pin), rate = rateFor(c, inside);
  return { fee: rate == null || !kg ? (rate == null ? null : 0) : slabs(kg) * rate, inside, kg, chargedKg: kg ? slabs(kg) : 0, rate };
}

// One piece to a PIN (the product page's "what will delivery cost me").
function courierFor(c, product, pin) {
  if (!c?.perKg) return { fee: null, inside: false, kg: 0 };
  return feeFor(c, kgOf(c, product), pin);
}

module.exports = { courierFor, feeFor, kgOf };
