// Keyword rules that turn a caption ("North Face puffer, ₹4,999, size M L") into a product,
// or into a command ("sold north face"). This is the backup when the AI reader in
// classify.js isn't configured or fails, and it fills in price/sizes the AI leaves empty.

const CLOTHING_BRANDS = [
  "The North Face", "North Face", "Arc'teryx", "Arcteryx", "Patagonia", "Columbia", "Carhartt", "Nike", "Adidas",
  "Puma", "New Balance", "Levi's", "Levis", "Zara", "H&M", "Uniqlo", "Tommy Hilfiger", "Ralph Lauren",
  "Polo", "Lacoste", "Calvin Klein", "Superdry", "Timberland", "Dr. Martens", "Clarks", "Gap",
  "Burberry", "Stone Island", "Moncler", "Canada Goose", "Barbour", "Champion", "Fila", "Vans", "Converse",
];
// Houses whose products in a surplus store are almost always fragrance.
const FRAGRANCE_BRANDS = [
  "Diptyque", "Chanel", "Dior", "Creed", "Tom Ford", "YSL", "Yves Saint Laurent", "Jo Malone", "Le Labo",
  "Byredo", "Maison Margiela", "Replica", "Parfums de Marly", "Initio", "Amouage", "Xerjoff", "Kilian",
  "Mancera", "Montale", "Lattafa", "Afnan", "Rasasi", "Ajmal", "Armaf", "Al Haramain", "Swiss Arabian",
  "Montblanc", "Davidoff", "Paco Rabanne", "Rabanne", "Jean Paul Gaultier", "Versace", "Armani", "Prada",
  "Givenchy", "Gucci", "Hermes", "Hermès", "Boss", "Hugo Boss", "Dolce & Gabbana", "D&G", "Guerlain", "Carolina Herrera", "Valentino", "Bvlgari", "Azzaro", "Viktor & Rolf",
];
// Well-known scent names that give the category away even without a brand.
const FRAGRANCE_LINES = /\b(sauvage|bleu de|aventus|khamrah|eros|acqua di gio|oud wood|baccarat|9 ?pm|club de nuit|la nuit|invictus|1 million|one million|le male|ultra male|stronger with you|wanted|layton|hawas|asad|tam dao|philosykos|santal 33|lost cherry|black orchid|tobacco vanille|y edp|bdc|libre|j'adore|good girl|light blue|explorer|terre d'hermes|gentleman|gentlemen only|guilty|bloom|flora|pour homme|l'homme|homme|femme|intense|eau de|luna rossa|bottled|cool water|the one|polo blue|allure|egoiste|fahrenheit|spicebomb|ombre leather|oud ispahan|god of fire|erba pura|naxos)\b/i;

const FRAGRANCE_WORDS = /\b(perfume|perfumes|edp|edt|parfum|extrait|attar|ittar|fragrance|cologne|oud|body mist|mist|tester|\d+\s?ml)\b/i;
const FOOTWEAR_WORDS = /\b(shoes?|sneakers?|boots?|loafers?|wingtips?|brogues?|sandals?|trainers?|slides?|kicks|air max|air force|af1|jordan|dunk|yeezy|samba|gazelle|campus|superstar|chuck taylor|old skool|550|990|chelsea)\b/i;
const ACCESSORY_WORDS = /\b(cap|caps|beanie|hat|bag|backpack|wallet|belt|gloves?|scarf|muffler|sunglasses|watch)\b/i;
const CLOTHING_WORDS = /\b(jacket|puffer|parka|coat|shell|fleece|hoodie|sweater|sweatshirt|vest|gilet|shirt|tee|t-shirt|polo|jeans?|pants|trousers|chinos?|cargos?|joggers?|shorts|blazer|kurta|pheran|cardigan|overshirt|windbreaker|track ?suit)\b/i;

const SUBCATS = [
  [/\b(puffer|parka|down|nuptse)\b/i, "Puffer"], [/\b(jacket|shell|windbreaker|coat|blazer)\b/i, "Jacket"],
  [/\b(fleece)\b/i, "Fleece"], [/\b(hoodie)\b/i, "Hoodie"], [/\b(sweater|sweatshirt|cardigan|pullover)\b/i, "Sweater"],
  [/\b(vest|gilet)\b/i, "Vest"], [/\b(jeans?)\b/i, "Jeans"], [/\b(pants|trousers|chinos?|cargos?|joggers?)\b/i, "Pants"],
  [/\b(shorts)\b/i, "Shorts"], [/\b(shirt|overshirt)\b/i, "Shirt"], [/\b(tee|t-shirt|polo)\b/i, "T-shirt"],
  [/\b(sneakers?|trainers?|kicks|air max|air force|af1|jordan|dunk|yeezy|samba|gazelle|campus|superstar|chuck taylor|old skool)\b/i, "Sneakers"], [/\b(boots?)\b/i, "Boots"], [/\b(brogues?|wingtips?|loafers?)\b/i, "Formal shoes"],
  [/\b(attar|ittar)\b/i, "Attar"], [/\b(body mist|mist)\b/i, "Body mist"],
  [/\b(cap|caps|beanie|hat)\b/i, "Cap"], [/\b(bag|backpack)\b/i, "Bag"],
];

const toNumber = (s) => Number(String(s).replace(/[^\d]/g, "")) || null;

function findPrice(text) {
  const tagged =
    text.match(/(?:₹|rs\.?|inr)\s*([\d,]{2,})/i) || text.match(/([\d,]{2,})\s*(?:\/-|rs\b|₹|inr\b|only\b)/i);
  if (tagged) return toNumber(tagged[1]);
  // A bare number like "diptyque, 2000": take the last 3–6 digit number that isn't
  // an MRP, a volume (100ml), a size (UK 8) or a model number glued to a word.
  const cleaned = text
    .replace(/(?:mrp|retail|original price)\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*[\d,]+/gi, " ")
    .replace(/\d+\s?ml\b/gi, " ")
    .replace(/\bsizes?\b.*$/i, " ")
    .replace(/\b\d{1,3}\s*(?:pcs|pc|pieces|piece|units|left|nos)\b/gi, " ")
    .replace(/\bqty\s*[:\-]?\s*\d{1,3}\b/gi, " ");
  const bare = [...cleaned.matchAll(/(?:^|[\s,:|\-])(\d{1,2},\d{3}|\d{3,6})(?=$|[\s,.|!])/g)].map((m) => toNumber(m[1]));
  const plausible = bare.filter((n) => n >= 100 && n <= 500000 && !(n >= 1900 && n <= 2100 && bare.length > 1));
  return plausible.length ? plausible[plausible.length - 1] : null;
}

function findMrp(text) {
  const m = text.match(/(?:mrp|retail|original price)\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*([\d,]{2,})/i);
  return m ? toNumber(m[1]) : null;
}

function findSizes(text) {
  const ml = text.match(/(\d+)\s?ml\b/i);
  if (ml) return `${ml[1]} ml`;
  const m = text.match(/\bsizes?\s*[:\-]?\s*([a-z0-9 ,\/\-&]+?)(?=\s*(?:[.|\n]|₹|rs\b|mrp|$))/i);
  if (!m) return null;
  return m[1]
    .split(/[\s,\/&]+|\band\b/i)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s && s !== "-")
    .join(" · ")
    .replace(/^(UK|US|EU) · /, "$1 ");
}

// "3 pcs", "2 pieces", "qty 4", "5 left" -> how many the shop has.
function findQuantity(text) {
  const m = text.match(/\b(\d{1,3})\s*(?:pcs|pc|pieces|piece|units|left|nos)\b/i) || text.match(/\bqty\s*[:\-]?\s*(\d{1,3})\b/i);
  const n = m ? Number(m[1]) : null;
  return n && n > 0 ? n : null;
}

function findBrand(text) {
  const lower = text.toLowerCase();
  const hit = [...CLOTHING_BRANDS, ...FRAGRANCE_BRANDS]
    .filter((b) => new RegExp(`(^|[^a-z])${b.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(lower))
    .sort((a, b) => b.length - a.length)[0];
  if (!hit) return null;
  return { "North Face": "The North Face", Arcteryx: "Arc'teryx", Levis: "Levi's", "Yves Saint Laurent": "YSL", Rabanne: "Paco Rabanne", Hermès: "Hermes" }[hit] || hit;
}

function findName(text) {
  const first = text.split(/\n|,(?!\d{3})|\||•/)[0] || text;
  const cleaned = first
    .replace(/\bsizes?\b.*$/i, "")
    .replace(/\b\d{1,3}\s*(?:pcs|pc|pieces|piece|units|left|nos)\b/gi, "")
    .replace(/\bqty\s*[:\-]?\s*\d{1,3}\b/gi, "")
    .replace(/\b\d+\s?ml\b/gi, "")
    .replace(/(?:₹|rs\.?|inr)\s*[\d,]+/gi, "")
    .replace(/[\d,]+\s*(?:\/-|rs\b|₹)/gi, "")
    .replace(/\b(new arrival|just in|new|available|in stock)\b[:!\-]*/gi, "")
    .replace(/[\p{Extended_Pictographic}️]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[\-–:]+|[\-–:]+$/g, "")
    .trim();
  const named = cleaned.replace(/(?:\s+|^)(?:\d{1,2},\d{3}|\d{3,6})$/, "").trim(); // drop a trailing bare price
  if (!named || /^\d+$/.test(named)) return "New arrival";
  // Title-case all-lowercase captions so "diptyque" shows as "Diptyque".
  return named === named.toLowerCase() ? named.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase()) : named;
}

function findCategory(text, brand) {
  if (FRAGRANCE_WORDS.test(text) || FRAGRANCE_LINES.test(text)) return "Fragrances";
  if (FOOTWEAR_WORDS.test(text)) return "Footwear";
  if (ACCESSORY_WORDS.test(text) && !CLOTHING_WORDS.test(text)) return "Accessories";
  if (CLOTHING_WORDS.test(text)) return "Clothing";
  if (brand && FRAGRANCE_BRANDS.includes(brand)) return "Fragrances";
  return "Clothing";
}

function findSubcategory(text, category) {
  const hit = SUBCATS.find(([re]) => re.test(text));
  if (hit) return hit[1];
  return { Fragrances: "Perfume", Footwear: "Shoes", Accessories: "Accessory", Clothing: null }[category];
}

// Returns { type: "product", product } or { type: "command", action, query }
function parseMessage(text = "") {
  const t = text.trim();
  const cmd = t.match(/^(sold|sold out|remove|delete|back in stock|restock)\b[:\s]*(.*)$/i);
  if (cmd) {
    const word = cmd[1].toLowerCase();
    const action = word.startsWith("back") || word === "restock" ? "restock" : word.startsWith("sold") ? "sold" : "remove";
    return { type: "command", action, query: cmd[2].trim() };
  }
  const brand = findBrand(t);
  const category = findCategory(t, brand);
  return {
    type: "product",
    product: {
      name: findName(t),
      brand,
      category,
      subcategory: findSubcategory(t, category),
      price: findPrice(t),
      mrp: findMrp(t),
      sizes: findSizes(t),
      quantity: findQuantity(t),
      caption: t,
    },
  };
}

module.exports = { parseMessage };
