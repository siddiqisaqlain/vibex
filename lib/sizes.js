// Size options. A product keeps one `sizes` text ("50 ml · 100 ml", "M · L") so bills, the stock
// list and the bot all read it as before. `sizePrices` is optional: { "50 ml": 2999, "100 ml": 4999 }
// for bottles priced per size. `sizeStock` is optional too: { "50 ml": 2, "100 ml": 1 }. `quantity`
// is always the total, so bills, reports and the portal read it as before. Without sizeStock,
// every size shares the one count.
const SIZE_PRICE = /(\d{1,4}(?:\.\d)?)\s?mls?\b\s*[-:=@]?\s*(?:₹|rs\.?)?\s*(\d[\d,]{1,8})(?![\d,]|\s?ml)/gi;

// "50ml 2999, 100 ml ₹4,999" -> [{ size: "50 ml", price: 2999 }, ...]
function sizePairs(text) {
  return [...String(text || "").matchAll(SIZE_PRICE)]
    .map((m) => ({ size: `${m[1]} ml`, price: Number(m[2].replace(/,/g, "")) }))
    .filter((x) => x.price >= 10);
}
const withoutSizePairs = (text) => String(text || "").replace(SIZE_PRICE, " ");

const WORD_SIZE = /^(?:xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl|\d{2})$/i;
function splitSizes(sizes) {
  const parts = String(sizes || "").split(/\s*[·,/|]\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 1) {
    const words = parts[0].split(/\s+/);
    if (words.length > 1 && words.every((w) => WORD_SIZE.test(w))) return words;
  }
  return [...new Set(parts)];
}

// What a customer can pick from.
function optionsOf(p) {
  return splitSizes(p.sizes).map((size) => ({ size, price: p.sizePrices?.[size] ?? p.price ?? null, ...(p.sizeStock ? { left: p.sizeStock[size] ?? 0 } : {}) }));
}

// Puts priced sizes on a listing; the cheapest becomes the product's price.
function applySizePairs(l, pairs) {
  l.sizes = pairs.map((x) => x.size).join(" · ");
  l.sizePrices = Object.fromEntries(pairs.map((x) => [x.size, x.price]));
  l.price = Math.min(...pairs.map((x) => x.price));
  return l;
}

// "m l xl", "50ml, 100 ml", "50 ml · 100 ml" -> "M · L · XL", "50 ml · 100 ml"
function formatSizes(v) {
  v = String(v || "").replace(/·/g, " ").trim();
  if (/^(free|free ?size|one ?size|os)$/i.test(v)) return "Free size";
  return v.replace(/(\d)\s*mls?\b/gi, "$1ml").split(/[\s,\/&]+/).filter(Boolean)
    .map((x) => (/^[\d.]+ml$/i.test(x) ? x.replace(/ml$/i, " ml") : x.toUpperCase())).join(" · ").replace(/^(UK|US|EU) · /, "$1 ");
}

// Sets the count for each size. Returns the new total, or { error }. {} goes back to one shared count.
function setSizeStock(p, input) {
  const names = splitSizes(p.sizes);
  if (names.length < 2 || !Object.keys(input || {}).length) { delete p.sizeStock; return {}; }
  const counts = {};
  for (const size of names) {
    const n = Number(input[size] || 0);
    if (!Number.isInteger(n) || n < 0 || n > 9999) return { error: `Check the stock for ${size}.` };
    counts[size] = n;
  }
  p.sizeStock = counts;
  return { total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

// Pieces of one known size came in or went out. The caller changes the total.
function moveSizeStock(p, size, n) {
  if (p.sizeStock && size in p.sizeStock) p.sizeStock[size] = Math.max(0, p.sizeStock[size] + n);
}

// Runs on every save. Something that doesn't know the size (a purchase, a stock count, "sold 4795")
// can change the total, so the sizes are made to add up again and the item is flagged for a count.
function fitSizeStock(p) {
  if (!p.sizeStock) return;
  const names = splitSizes(p.sizes);
  if (names.length < 2) { delete p.sizeStock; return; }
  const counts = Object.fromEntries(names.map((s) => [s, p.sizeStock[s] ?? 0]));
  if (!Object.keys(p.sizeStock).some((s) => names.includes(s))) { delete p.sizeStock; return; }
  p.sizeStock = counts;
  const total = p.quantity ?? (p.status === "sold" ? 0 : 1);
  let gap = total - names.reduce((n, s) => n + counts[s], 0);
  if (!gap) return;
  p.needsCount = true;
  if (gap > 0) counts[names[0]] += gap;
  for (; gap < 0; gap++) counts[names.reduce((a, b) => (counts[b] > counts[a] ? b : a))]--;
}

// A plain description built only from known facts, for items the owner hasn't described yet.
function autoDescription(p) {
  const kind = { Clothing: "piece", Fragrances: "fragrance", Footwear: "pair", Accessories: "accessory" }[p.category] || "piece";
  const what = p.brand && !p.name.toLowerCase().includes(p.brand.toLowerCase()) ? `${p.name} by ${p.brand}` : p.name;
  return `${what}, an original ${kind} from the Vibe X store in Khanyaar, Srinagar. Pick it up at the store or get it couriered anywhere in India.`;
}

module.exports = { sizePairs, withoutSizePairs, splitSizes, optionsOf, applySizePairs, autoDescription, formatSizes, setSizeStock, moveSizeStock, fitSizeStock };
