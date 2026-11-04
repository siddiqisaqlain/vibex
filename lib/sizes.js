// Size options. A product keeps one `sizes` text ("50 ml · 100 ml", "M · L") so bills, the stock
// list and the bot all read it as before. `sizePrices` is optional: { "50 ml": 2999, "100 ml": 4999 }
// for bottles priced per size. Stock stays one count per product.
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
  return splitSizes(p.sizes).map((size) => ({ size, price: p.sizePrices?.[size] ?? p.price ?? null }));
}

// Puts priced sizes on a listing; the cheapest becomes the product's price.
function applySizePairs(l, pairs) {
  l.sizes = pairs.map((x) => x.size).join(" · ");
  l.sizePrices = Object.fromEntries(pairs.map((x) => [x.size, x.price]));
  l.price = Math.min(...pairs.map((x) => x.price));
  return l;
}

// A plain description built only from known facts, for items the owner hasn't described yet.
function autoDescription(p) {
  const kind = { Clothing: "piece", Fragrances: "fragrance", Footwear: "pair", Accessories: "accessory" }[p.category] || "piece";
  const what = p.brand && !p.name.toLowerCase().includes(p.brand.toLowerCase()) ? `${p.name} by ${p.brand}` : p.name;
  return `${what}, an original ${kind} from the Vibe X store in Khanyaar, Srinagar. Pick it up at the store or get it couriered anywhere in India.`;
}

module.exports = { sizePairs, withoutSizePairs, splitSizes, optionsOf, applySizePairs, autoDescription };
