// Keyword rules that turn a caption ("North Face puffer, ₹4,999, size M L") into a product,
// or into a command ("sold north face"). This is the backup when the AI reader in
// classify.js isn't configured or fails, and it fills in price/sizes the AI leaves empty.

const CLOTHING_BRANDS = [
  "The North Face", "North Face", "Arc'teryx", "Arcteryx", "Patagonia", "Columbia", "Carhartt", "Nike", "Adidas",
  "Puma", "New Balance", "Levi's", "Levis", "Zara", "H&M", "Uniqlo", "Tommy Hilfiger", "Ralph Lauren",
  "Polo", "Lacoste", "Calvin Klein", "Superdry", "Timberland", "Dr. Martens", "Clarks", "Gap",
  "Burberry", "Stone Island", "Moncler", "Canada Goose", "Barbour", "Champion", "Fila", "Vans", "Converse",
  "US Polo", "U.S. Polo", "Tommy", "Jack & Jones", "Allen Solly", "Peter England", "Wrangler", "Lee", "Pepe Jeans",
  "Under Armour", "Reebok", "Asics", "Skechers", "Woodland", "Red Tape", "Mango", "Gant", "Hollister", "Abercrombie",
];
// Houses whose products in a surplus store are almost always fragrance.
const FRAGRANCE_BRANDS = [
  "Diptyque", "Chanel", "Dior", "Creed", "Tom Ford", "YSL", "Yves Saint Laurent", "Jo Malone", "Le Labo",
  "Byredo", "Maison Margiela", "Replica", "Parfums de Marly", "Initio", "Amouage", "Xerjoff", "Kilian",
  "Mancera", "Montale", "Lattafa", "Afnan", "Rasasi", "Ajmal", "Armaf", "Al Haramain", "Swiss Arabian",
  "Montblanc", "Davidoff", "Paco Rabanne", "Rabanne", "Jean Paul Gaultier", "Versace", "Armani", "Prada",
  "Givenchy", "Gucci", "Hermes", "Hermès", "Boss", "Hugo Boss", "Dolce & Gabbana", "D&G", "Guerlain", "Carolina Herrera", "Valentino", "Bvlgari", "Azzaro", "Viktor & Rolf",
];
// Labels that sell both clothes and perfume, so the brand alone doesn't say which it is.
const MIXED_BRANDS = new Set([
  "Gucci", "Versace", "Armani", "Prada", "Boss", "Hugo Boss", "Dolce & Gabbana", "D&G", "Burberry", "Ralph Lauren",
  "Polo", "US Polo", "U.S. Polo", "Tommy Hilfiger", "Calvin Klein", "Lacoste", "Givenchy", "Valentino", "Hermes",
  "Dior", "Chanel", "YSL", "Zara", "Montblanc", "Nike", "Adidas", "Puma", "Fila", "Superdry", "Mango", "Abercrombie", "Hollister",
]);
// Well-known scent names that give the category away even without a brand.
const FRAGRANCE_LINES = /\b(sauvage|bleu de|aventus|khamrah|eros|acqua di gio|oud wood|baccarat|9 ?pm|club de nuit|la nuit|invictus|1 million|one million|le male|ultra male|stronger with you|wanted|layton|hawas|asad|tam dao|philosykos|santal 33|lost cherry|black orchid|tobacco vanille|y edp|bdc|libre|j'adore|good girl|light blue|explorer|terre d'hermes|gentleman|gentlemen only|guilty|bloom|flora|pour homme|l'homme|homme|femme|intense|eau de|luna rossa|bottled|cool water|the one|polo blue|allure|egoiste|fahrenheit|spicebomb|ombre leather|oud ispahan|god of fire|erba pura|naxos|you|you intense|because it's you|flora|bloom|guilty|gentle ?man|man in black|bvlgari man|aqva|only the brave|boss the scent|the scent|l'interdit|black opium|mon paris|la vie est belle|scandal|le beau|phantom|toy boy|silver mountain|green irish|wood sage|baccarat rouge|the most wanted|ombre nomade|hacivat|kirke|delina|layton|sedley|herod|pegasus|bentley|cr7|club de nuit|khamrah|asad|yara|ameer al oudh|bade'e al oud|9 ?am|odyssey)\b/i;

// Scent names that are also everyday words, so on their own they don't prove it's a perfume.
const GENERIC_LINES = /^(you|you intense|guilty|bloom|flora|wanted|explorer|gentleman|gentle ?man|gentlemen only|intense|homme|femme|pour homme|l'homme|eau de|the one|bottled|phantom|libre|scandal|allure|odyssey|the scent|polo blue|luna rossa|le beau|le male|man in black|toy boy|cool water|9 ?pm|9 ?am|y edp|bdc|kirke|wood sage)$/i;
const FRAGRANCE_WORDS = /\b(perfume|perfumes|scent|edp|edt|parfum|extrait|attar|ittar|fragrance|cologne|oud|body mist|mist|tester|\d+\s?ml)\b/i;
const FOOTWEAR_WORDS = /\b(footwear|shoes?|sneakers?|boots?|loafers?|wingtips?|brogues?|sandals?|trainers?|slides?|kicks|air max|air force|af1|jordan|dunk|yeezy|samba|gazelle|campus|superstar|chuck taylor|old skool|550|990|chelsea)\b/i;
const ACCESSORY_WORDS = /\b(accessory|accessories|cap|caps|beanie|hat|bag|backpack|wallet|belt|gloves?|scarf|muffler|sunglasses|watch)\b/i;
const CLOTHING_WORDS = /\b(clothes|clothing|cloth|kapde|kapda|garment|jacket|puffer|parka|coat|shell|fleece|hoodie|sweater|sweatshirt|vest|gilet|shirt|tee|t-shirt|jeans?|pants|trousers|chinos?|cargos?|joggers?|shorts|blazer|kurta|pheran|cardigan|overshirt|windbreaker|track ?suit)\b/i;

const SUBCATS = [
  [/\b(puffer|parka|down|nuptse)\b/i, "Puffer", "Clothing"], [/\b(jacket|shell|windbreaker|coat|blazer)\b/i, "Jacket", "Clothing"],
  [/\b(fleece)\b/i, "Fleece", "Clothing"], [/\b(hoodie)\b/i, "Hoodie", "Clothing"], [/\b(sweater|sweatshirt|cardigan|pullover)\b/i, "Sweater", "Clothing"],
  [/\b(vest|gilet)\b/i, "Vest", "Clothing"], [/\b(jeans?)\b/i, "Jeans", "Clothing"], [/\b(pants|trousers|chinos?|cargos?|joggers?)\b/i, "Pants", "Clothing"],
  [/\b(shorts)\b/i, "Shorts", "Clothing"], [/\b(tee|t-shirt|polo)\b/i, "T-shirt", "Clothing"], [/\b(shirt|overshirt)\b/i, "Shirt", "Clothing"],
  [/\b(sneakers?|trainers?|kicks|air max|air force|af1|jordan|dunk|yeezy|samba|gazelle|campus|superstar|chuck taylor|old skool)\b/i, "Sneakers", "Footwear"], [/\b(boots?)\b/i, "Boots", "Footwear"], [/\b(brogues?|wingtips?|loafers?)\b/i, "Formal shoes", "Footwear"],
  [/\b(attar|ittar)\b/i, "Attar", "Fragrances"], [/\b(body mist|mist)\b/i, "Body mist", "Fragrances"],
  [/\b(cap|caps|beanie|hat)\b/i, "Cap", "Accessories"], [/\b(bag|backpack)\b/i, "Bag", "Accessories"],
];

// Common misspellings in captions -> the real brand, so "Chinnel 2459" lists as Chanel.
const MISSPELLINGS = [
  [/\b(chinnel|chanell|channel|chanal|shanel)\b/gi, "Chanel"],
  [/\b(gucchi|guchi|gucci)\b/gi, "Gucci"],
  [/\b(versachi|versache|versace)\b/gi, "Versace"],
  [/\b(diorr|dior)\b/gi, "Dior"],
  [/\b(armaani|armani)\b/gi, "Armani"],
  [/\b(homus|hommes|homm)\b/gi, "Homme"],
];
const fixSpelling = (t) => MISSPELLINGS.reduce((acc, [re, to]) => acc.replace(re, to), t);

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
    .replace(/\b\d{1,3}\s*(?:pcs|pc|pieces|piece|units|unit|left|nos|no's|qty|in stock)\b/gi, " ")
    .replace(/\b(?:qty|quantity|stock)\s*[:=\-]?\s*\d{1,3}\b/gi, " ")
    .replace(/(?:^|\s)[x×]\s*\d{1,3}\b/gi, " ");
  const bare = [...cleaned.matchAll(/(?:^|[\s,:|\-])(\d{1,2},\d{3}|\d{3,6})(?=$|[\s,.|!])/g)].map((m) => toNumber(m[1]));
  const plausible = bare.filter((n) => n >= 100 && n <= 500000 && !(n >= 1900 && n <= 2100 && bare.length > 1));
  return plausible.length ? plausible[plausible.length - 1] : null;
}

function findMrp(text) {
  const m = text.match(/(?:mrp|retail|original price)\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*([\d,]{2,})/i);
  return m ? toNumber(m[1]) : null;
}

function findSizes(text) {
  text = text
    .replace(/\b\d{1,3}\s*(?:pcs|pc|pieces|piece|units|unit|left|nos|no's|qty|in stock)\b/gi, " ")
    .replace(/\b(?:qty|quantity|stock)\s*[:=\-]?\s*\d{1,3}\b/gi, " ")
    .replace(/(?:^|\s)[x×]\s*\d{1,3}\b/gi, " ");
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
// "3 pcs", "2 pieces", "qty 4", "x3", "stock 5", "5 left", "3 nos" -> how many the shop has.
const QTY_WORDS = "pcs|pc|pieces|piece|units|unit|left|nos|no's|qty|in stock";
function findQuantity(text) {
  const m =
    text.match(new RegExp(`\\b(\\d{1,3})\\s*(?:${QTY_WORDS})\\b`, "i")) ||
    text.match(/\b(?:qty|quantity|stock)\s*[:=\-]?\s*(\d{1,3})\b/i) ||
    text.match(/(?:^|\s)[x×]\s*(\d{1,3})\b/i);
  const n = m ? Number(m[1]) : null;
  return n && n > 0 ? n : null;
}

function findBrand(text) {
  const lower = text.toLowerCase();
  const hit = [...CLOTHING_BRANDS, ...FRAGRANCE_BRANDS]
    .filter((b) => new RegExp(`(^|[^a-z])${b.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(lower))
    .sort((a, b) => b.length - a.length)[0];
  if (!hit) return null;
  return { "North Face": "The North Face", Tommy: "Tommy Hilfiger", Arcteryx: "Arc'teryx", Levis: "Levi's", "Yves Saint Laurent": "YSL", Rabanne: "Paco Rabanne", Hermès: "Hermes" }[hit] || hit;
}

function findName(text) {
  const first = text.split(/\n|,(?!\d{3})|\||•/)[0] || text;
  const cleaned = first
    .replace(/\bsizes?\b.*$/i, "")
    .replace(/\b\d{1,3}\s*(?:pcs|pc|pieces|piece|units|unit|left|nos|no's|qty|in stock)\b/gi, "")
    .replace(/\b(?:qty|quantity|stock)\s*[:=\-]?\s*\d{1,3}\b/gi, "")
    .replace(/(?:^|\s)[x×]\s*\d{1,3}\b/gi, " ")
    .replace(/\b\d+\s?ml\b/gi, "")
    .replace(/(?:₹|rs\.?|inr)\s*[\d,]+/gi, "")
    .replace(/[\d,]+\s*(?:\/-|rs\b|₹)/gi, "")
    .replace(/\b(new arrival|just in|new|available|in stock)\b[:!\-]*/gi, "")
    .replace(/[\p{Extended_Pictographic}️]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[\-–:]+|[\-–:]+$/g, "")
    .trim();
  const named = cleaned
    .replace(/(?:\s+|^)(?:\d{1,2},\d{3}|\d{3,6})(?:\s+(?:xs|s|m|l|xl|xxl|xxxl))*$/i, "") // drop a trailing bare price (and sizes after it)
    .trim();
  if (!named || /^\d+$/.test(named)) return "New arrival";
  // Title-case all-lowercase captions so "diptyque" shows as "Diptyque".
  return named === named.toLowerCase() ? named.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase()) : named;
}

// Returns { category, sure }. "sure" is false when it's a guess (only a brand that makes both
// clothes and perfume, or nothing at all to go on), so the bot asks the owner before listing.
function findCategory(text, brand) {
  // Clear perfume words (EDP, 100ml, attar) first, then clothing/shoe words, then scent names,
  // so "You 1928" is a perfume but "Hoodie for you" stays clothing.
  if (FRAGRANCE_WORDS.test(text)) return { category: "Fragrances", sure: true };
  if (FOOTWEAR_WORDS.test(text)) return { category: "Footwear", sure: true };
  if (ACCESSORY_WORDS.test(text) && !CLOTHING_WORDS.test(text)) return { category: "Accessories", sure: true };
  if (CLOTHING_WORDS.test(text)) return { category: "Clothing", sure: true };
  const mixed = brand && MIXED_BRANDS.has(brand);
  // A scent name is a strong hint, but short ones ("You", "Guilty", "Wanted") need a perfume house behind them.
  if (FRAGRANCE_LINES.test(text)) {
    const names = [...text.matchAll(new RegExp(FRAGRANCE_LINES.source, "gi"))].map((m) => m[1].toLowerCase());
    const distinctive = names.some((n) => !GENERIC_LINES.test(n)); // "Eros", "Khamrah", "Aventus"
    return { category: "Fragrances", sure: distinctive || (!mixed && !(brand && CLOTHING_BRANDS.includes(brand))) };
  }
  // A brand that makes both (Armani, Gucci) falls through to the size check for its guess.
  if (brand && !mixed && FRAGRANCE_BRANDS.includes(brand)) return { category: "Fragrances", sure: true };
  if (brand && !mixed && CLOTHING_BRANDS.includes(brand)) return { category: "Clothing", sure: true };
  // Nothing says what it is: clothes captions almost always carry a size, so a caption
  // with no size is most likely a perfume ("Man in black 1899"). Still a guess: ask.
  if (/\bsizes?\b|\b(xs|s|m|l|xl|xxl|xxxl)\b/i.test(text)) return { category: "Clothing", sure: false };
  return { category: "Fragrances", sure: false };
}

function findSubcategory(text, category) {
  const hit = SUBCATS.find(([re, , cat]) => cat === category && re.test(text));
  if (hit) return hit[1];
  return { Fragrances: "Perfume", Footwear: "Shoes", Accessories: "Accessory", Clothing: null }[category];
}

// The owner naming a category: "1".."4", "clothes", "perfume", "shoes", "accessory"... -> category or null.
const CATEGORY_ANSWERS = [
  [/^(1|clothing|clothes|cloth|kapde|kapda|garments?)$/i, "Clothing"],
  [/^(2|fragrances?|perfumes?|scent|attar|ittar|edp|edt|cologne)$/i, "Fragrances"],
  [/^(3|footwear|shoes?|sneakers?|boots?|chappal)$/i, "Footwear"],
  [/^(4|accessory|accessories|acc|cap|bag|belt|watch|wallet)$/i, "Accessories"],
];
function categoryAnswer(text) {
  const t = String(text).trim().replace(/[.!]+$/, "");
  const hit = CATEGORY_ANSWERS.find(([re]) => re.test(t));
  return hit ? hit[1] : null;
}

// Returns { type: "product", product } or { type: "command", action, query }
// Stock commands that use the product's 4-digit code (the LOT number on the website):
//   "sold 4795", "sold 4795 2", "sold #4795 x2", "4795 sold 2"  -> take that many off
//   "add 4795 3", "restock 4795 3"                              -> put that many back
//   "stock 4795 5", "stock 4795 = 5"                            -> set the stock
//   "help"                                                       -> list commands
const CODE = String.raw`(?:lot|code|#)?\s*#?(\d{4})`;
const QTY = String.raw`(?:\s*(?:x|×|qty|pcs|pc|nos)?\s*(\d{1,3}))?`;
function parseStockCommand(t) {
  let m;
  if (/^(help|commands|\?)$/i.test(t)) return { type: "help" };
  if ((m = new RegExp(String.raw`^(?:sold|sale|sell)\s+${CODE}\b${QTY}\s*(?:pcs|pc|nos)?$`, "i").exec(t)) ||
      (m = new RegExp(String.raw`^${CODE}\s+sold${QTY}\s*(?:pcs|pc|nos)?$`, "i").exec(t))) {
    return { type: "stock", action: "sold", code: m[1], qty: m[2] ? Number(m[2]) : 1 };
  }
  if ((m = new RegExp(String.raw`^(?:add|restock|back in stock|plus|\+)\s*${CODE}\b${QTY}\s*(?:pcs|pc|nos)?$`, "i").exec(t))) {
    return { type: "stock", action: "add", code: m[1], qty: m[2] ? Number(m[2]) : 1 };
  }
  if ((m = new RegExp(String.raw`^(?:move|change|fix|put)\s+${CODE}\s+(?:to\s+|in\s+|into\s+)?(\w+)$`, "i").exec(t)) ||
      (m = new RegExp(String.raw`^${CODE}\s+(?:is\s+(?:a\s+)?)?(\w+)$`, "i").exec(t))) {
    const category = categoryAnswer(m[2]);
    if (category && !/^\d$/.test(m[2])) return { type: "stock", action: "move", code: m[1], category };
  }
  if ((m = new RegExp(String.raw`^stock\s+${CODE}\s*(?:=|to|:)?\s*(\d{1,3})$`, "i").exec(t))) {
    return { type: "stock", action: "set", code: m[1], qty: Number(m[2]) };
  }
  return null;
}

function parseMessage(text = "") {
  const t = text.trim();
  const stock = parseStockCommand(t);
  if (stock) return stock;
  const cmd = t.match(/^(sold|sold out|remove|delete|back in stock|restock)\b[:\s]*(.*)$/i);
  if (cmd) {
    const word = cmd[1].toLowerCase();
    const action = word.startsWith("back") || word === "restock" ? "restock" : word.startsWith("sold") ? "sold" : "remove";
    return { type: "command", action, query: cmd[2].trim() };
  }
  const fixed = fixSpelling(t);
  const brand = findBrand(fixed);
  const { category, sure } = findCategory(fixed, brand);
  return {
    sure,
    type: "product",
    product: {
      name: findName(fixed),
      brand,
      category,
      subcategory: findSubcategory(fixed, category),
      price: findPrice(t),
      mrp: findMrp(t),
      sizes: findSizes(t),
      quantity: findQuantity(t),
      caption: t,
    },
  };
}

module.exports = { parseMessage, categoryAnswer, findSubcategory };
