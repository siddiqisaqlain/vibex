// Billing: one invoice for every sale, wherever it happens.
//   - the billing portal (/billing, the shop counter)
//   - WhatsApp ("sold 4795 2", "sold puffer")
//   - a website order the owner confirms ("confirm VX-1234")
// All three call sell() below, which takes the stock off products.json and writes the
// invoice in the same step. products.json is the only stock there is: the website reads it
// every 2 s, the bot on every message, the portal every few seconds. So a sale anywhere
// shows everywhere, and an item can't be sold twice (Node runs one request at a time and
// sell() has no await between checking and saving).
const path = require("path");
const crypto = require("crypto");
const { readJson, writeJson } = require("./jsonstore");
const { sizePairs, applySizePairs, formatSizes, setSizeStock, moveSizeStock } = require("./sizes");

module.exports = function createBilling({ STORE, SHOP, load, save, logActivity }) {
  const FILE = path.join(STORE, "invoices.json");
  const loadInvoices = () => readJson(FILE, []);
  const saveInvoices = (list) => writeJson(FILE, list);
  const cfg = SHOP.billing || {};
  const hooks = {}; // partyFor(customer): lets lib/books.js file a bill under its customer

  // Indian financial year, April to March: 5 Nov 2026 -> "26-27".
  function fy(d = new Date()) {
    const ist = new Date(new Date(d).toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const y = ist.getMonth() >= 3 ? ist.getFullYear() : ist.getFullYear() - 1;
    return `${String(y).slice(2)}-${String(y + 1).slice(2)}`;
  }
  // Carries straight on from his myBillBook numbers (billing.nextNumber in shop.json).
  // Numbers are never reused: a cancelled bill keeps its number.
  function nextNumber(list) {
    const max = list.reduce((m, x) => Math.max(m, Number(x.number) || 0), 0);
    return String(Math.max(cfg.nextNumber || 1, max + 1));
  }

  // GST is only charged once the shop has a GSTIN. Until then the bill is a plain cash memo.
  const gstOn = () => Boolean(SHOP.business?.gstin);
  // Prices on the site already include GST; the tax is worked out of the price.
  // Rates come from shop.json billing.gst (check them with the shop's CA).
  function gstRate(p, unit) {
    if (p.gstRate != null) return Number(p.gstRate);
    const r = (cfg.gst || {})[p.category] ?? (cfg.gst || {}).default ?? 18;
    if (typeof r === "number") return r;
    return unit <= (r.upTo ?? 2500) ? r.low : r.high; // e.g. clothes: 5% up to ₹2,500, 18% above
  }
  const hsnOf = (p) => p.hsn || (cfg.hsn || {})[p.category] || "";
  const round2 = (n) => Math.round(n * 100) / 100;

  // How many the shop has. Old items without a number count as 1 (or 0 once sold).
  const stockOf = (p) => (p.quantity != null ? p.quantity : p.status === "sold" ? 0 : 1);
  function setStock(p, n) {
    p.quantity = Math.max(0, n);
    if (p.quantity === 0) { p.status = "sold"; delete p.holdFor; }
    else if (p.status === "sold") p.status = "available";
  }

  // lines: [{ productId | code, qty, price? (rate), disc? (₹ off the whole line) }]
  // opts: { source: "counter" | "whatsapp" | "website", customer, payment, order, holdFor, note, clamp, charges }
  //   charges: [{ label, amount }] extra lines on the bill that aren't stock, e.g. courier
  //   clamp: sell what's there instead of refusing (WhatsApp "sold 4795 5" when only 3 are left)
  //   allowShort: counter only. The piece is in the owner's hand, so the sale goes through even if
  //     the system shows too few. Stock stops at 0, never negative, and the item is flagged for a count.
  function sell(lines, opts = {}) {
    if (!Array.isArray(lines) || !lines.length) return { error: "Add at least one item." };
    const items = load();
    const want = new Map(); // product id -> total qty, so the same item twice can't oversell
    const rows = [];
    for (const l of lines) {
      const p = items.find((x) => (l.productId && x.id === l.productId) || (l.code && x.code === String(l.code)));
      if (!p) return { error: `Item ${l.code || l.productId} isn't in stock any more.` };
      let qty = Math.floor(Number(l.qty) || 0);
      if (qty < 1 || qty > 999) return { error: `Check the quantity for “${p.name}”.` };
      if (p.status === "hold" && p.holdFor !== opts.holdFor)
        return { error: `“${p.name}” (#${p.code}) is held for website order ${p.holdFor} while the payment is checked. Confirm or cancel that order first.` };
      const sized = Boolean(p.sizeStock && l.size in p.sizeStock); // this size has its own count
      const key = sized ? `${p.id}|${l.size}` : p.id;
      const have = (sized ? p.sizeStock[l.size] : stockOf(p)) - (want.get(key) || 0);
      const what = sized ? `“${p.name}” ${l.size}` : `“${p.name}”`;
      let short = 0;
      if (qty > have) {
        if (opts.allowShort) short = qty - Math.max(0, have);
        else if (opts.clamp && have > 0) qty = have;
        else return { error: have > 0 ? `Only ${have} × ${what} (#${p.code}) left.` : `${what} (#${p.code}) is sold out.`, soldOut: have <= 0 };
      }
      want.set(key, (want.get(key) || 0) + qty - short);
      const unit = l.price != null && l.price !== "" ? Number(l.price) : Number(p.price || 0);
      if (!(unit >= 0) || unit > 10_000_000) return { error: `Check the price for “${p.name}”.` };
      const disc = round2(Number(l.disc) || 0);
      if (disc < 0 || disc > unit * qty) return { error: `The discount on “${p.name}” is more than the price.` };
      rows.push({ p, qty, unit, disc, short, size: l.size });
    }
    const charges = [];
    for (const c of opts.charges || []) {
      const label = String(c.label || "").replace(/\s+/g, " ").trim().slice(0, 40), amount = round2(Number(c.amount));
      if (!label || !(amount > 0) || amount > 10_000_000) return { error: "Each extra charge needs a name and an amount." };
      charges.push({ label, amount });
    }

    // Everything checked: now take the stock and write the bill.
    const invoices = loadInvoices();
    const now = new Date();
    const out = rows.map(({ p, qty, unit, disc, short, size }) => {
      setStock(p, stockOf(p) - (qty - short));
      moveSizeStock(p, size, -(qty - short));
      if (short) p.needsCount = true;
      const amount = round2(unit * qty - disc);
      const rate = gstOn() ? gstRate(p, unit) : 0;
      const taxable = round2(amount / (1 + rate / 100));
      return {
        productId: p.id, code: p.code, name: p.name, sizes: size || p.sizes || "", hsn: hsnOf(p),
        qty, mrp: p.mrp || null, listPrice: p.price || 0, cost: p.cost ?? null, unit, disc, ...(short ? { short } : {}), amount, gstRate: rate, taxable, tax: round2(amount - taxable),
      };
    });
    const extra = round2(charges.reduce((n, x) => n + x.amount, 0));
    const total = round2(out.reduce((n, x) => n + x.amount, 0) + extra);
    const c = opts.customer || {};
    const inv = {
      id: crypto.randomBytes(8).toString("hex"),
      number: nextNumber(invoices),
      kind: gstOn() ? "tax-invoice" : "cash-memo",
      at: now.toISOString(),
      source: opts.source || "counter",
      ...(opts.by ? { by: String(opts.by).slice(0, 40) } : {}),
      order: opts.order || null,
      partyId: opts.partyId || (hooks.partyFor ? hooks.partyFor(c) : null),
      customer: { name: String(c.name || "").trim().slice(0, 60), phone: String(c.phone || "").replace(/\D/g, "").slice(-10), address: String(c.address || "").trim().slice(0, 300), gstin: String(c.gstin || "").trim().toUpperCase().slice(0, 15) },
      payment: ["cash", "upi", "card", "credit"].includes(opts.payment) ? opts.payment : opts.source === "website" ? "upi" : "cash",
      note: String(opts.note || "").slice(0, 200),
      lines: out,
      charges,
      paid: opts.payment === "credit" ? 0 : total,
      taxable: round2(out.reduce((n, x) => n + x.taxable, 0) + extra),
      tax: round2(out.reduce((n, x) => n + x.tax, 0)),
      total,
      status: "paid",
    };
    invoices.push(inv);
    saveInvoices(invoices); // the bill first: it's the legal record
    save(items);
    for (const x of out) logActivity({ type: "sold", id: x.productId, qty: x.qty, amount: x.amount, invoice: inv.number, source: inv.source, ...(inv.order ? { order: inv.order } : {}) });
    return { invoice: inv, products: items };
  }

  // Cancelling a bill puts the pieces back on sale (on the website too).
  function cancel(id, reason = "") {
    const invoices = loadInvoices();
    const inv = invoices.find((x) => x.id === id || x.number === id);
    if (!inv) return { error: "Bill not found." };
    if (inv.status === "cancelled") return { error: `${inv.number} is already cancelled.` };
    const blocked = hooks.canCancel && hooks.canCancel(inv);
    if (blocked) return { error: blocked };
    const items = load();
    const back = [];
    for (const l of inv.lines) {
      const p = items.find((x) => x.id === l.productId);
      if (!p) continue; // removed from the site since: nothing to put back
      // Pieces the system never had (a short sale) aren't added back.
      const n = l.qty - (l.short || 0);
      if (n > 0) { setStock(p, stockOf(p) + n); moveSizeStock(p, l.sizes, n); }
      back.push(`${l.qty} × ${p.name}`);
    }
    save(items);
    inv.status = "cancelled";
    inv.cancelledAt = new Date().toISOString();
    inv.cancelReason = String(reason).slice(0, 200);
    saveInvoices(invoices);
    for (const l of inv.lines) logActivity({ type: "return", id: l.productId, qty: l.qty, amount: -l.amount, invoice: inv.number });
    return { invoice: inv, back };
  }

  // Counter restock / stock count / price change from the portal.
  function adjust(productId, { quantity, price } = {}) {
    const items = load();
    const p = items.find((x) => x.id === productId);
    if (!p) return { error: "Item not found." };
    if (quantity != null) {
      const q = Math.floor(Number(quantity));
      if (!(q >= 0 && q <= 9999)) return { error: "Stock must be 0 to 9999." };
      if (p.status === "hold" && q === 0) return { error: `#${p.code} is held for order ${p.holdFor}. Confirm or cancel that order first.` };
      if (p.status === "hold") p.quantity = q; else setStock(p, q);
      delete p.needsCount; // a count has been entered
    }
    if (price != null) {
      const v = Math.round(Number(price));
      if (!(v > 0 && v < 10_000_000)) return { error: "Check the price." };
      p.price = v;
    }
    save(items);
    return { product: p };
  }

  // Items made or changed from the portal. New items wait off the website like imported ones.
  function saveItem(b, id, newCode) {
    const items = load();
    const old = id ? items.find((x) => x.id === id) : null;
    if (id && !old) return { error: "Item not found." };
    const name = String(b.name ?? old?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!name) return { error: "Add the item's name." };
    const n = (k) => { const v = b[k]; return v === undefined ? old?.[k] ?? null : v === "" || v === null ? null : Number(v); };
    const row = { price: n("price"), cost: n("cost"), mrp: n("mrp"), gstRate: n("gstRate"), reorderAt: n("reorderAt") };
    for (const [k, v] of Object.entries(row)) if (v !== null && !(v >= 0 && v < 10_000_000)) return { error: `Check the ${k === "gstRate" ? "GST rate" : k === "reorderAt" ? "low stock level" : k}.` };
    const barcode = String(b.barcode ?? old?.barcode ?? "").trim();
    if (barcode && !/^[0-9A-Za-z-]{4,24}$/.test(barcode)) return { error: "Barcodes are 4 to 24 letters or digits." };
    if (barcode && items.some((x) => x.barcode === barcode && x.id !== id)) return { error: "Another item already has that barcode." };
    const hsn = String(b.hsn ?? old?.hsn ?? "").trim();
    if (hsn && !/^\d{4,8}$/.test(hsn)) return { error: "HSN codes are 4 to 8 digits." };
    const text = (k, max) => String(b[k] ?? old?.[k] ?? "").trim().slice(0, max);
    const fields = { name, ...row, barcode, hsn, category: text("category", 30) || "Clothing", sizes: text("sizes", 100), brand: text("brand", 40) };
    // "50ml 2999 100ml 4999" sets a price per size, the same as the WhatsApp command.
    const pairs = b.sizes === undefined ? [] : sizePairs(b.sizes);
    if (pairs.length) applySizePairs(fields, pairs);
    else if (b.sizes !== undefined) fields.sizes = formatSizes(fields.sizes);
    if (old) {
      if (typeof b.onWebsite === "boolean") {
        if (b.onWebsite && !old.image) return { error: "This item needs a photo first. Send it on WhatsApp with the code." };
        if (b.onWebsite && !fields.price) return { error: "Add a selling price first." };
        if (b.onWebsite && old.needsName) return { error: "Give this item a proper name first." };
        if (b.onWebsite) delete old.hidden; else old.hidden = true;
      }
      if (fields.price !== old.price || (b.sizes !== undefined && !pairs.length)) delete old.sizePrices; // one price for every size
      Object.assign(old, fields);
      if (old.price) delete old.needsPrice;
      if (b.name !== undefined) delete old.needsName;
      if (b.sizeStock !== undefined) {
        const r = setSizeStock(old, b.sizeStock);
        if (r.error) return r;
        if (r.total !== undefined) { setStock(old, r.total); delete old.needsCount; }
      }
      save(items);
      return { product: old };
    }
    const q = Math.floor(Number(b.quantity) || 0);
    if (q < 0 || q > 9999) return { error: "Stock must be 0 to 9999." };
    const row2 = { id: `itm${crypto.randomBytes(6).toString("hex")}`, code: newCode(items), hidden: true, ...fields, subcategory: null, image: null, caption: "", quantity: q, status: q > 0 ? "available" : "sold", createdAt: new Date().toISOString() };
    if (b.sizeStock !== undefined) {
      const r = setSizeStock(row2, b.sizeStock);
      if (r.error) return r;
      if (r.total !== undefined) setStock(row2, r.total);
    }
    items.push(row2);
    save(items);
    return { product: row2 };
  }
  // 12 digits starting with 2, like his existing codes in length and never clashing with them.
  function giveBarcodes(ids) {
    const items = load();
    const used = new Set(items.map((x) => x.barcode).filter(Boolean));
    const done = [];
    for (const id of ids) {
      const p = items.find((x) => x.id === id);
      if (!p || p.barcode) continue;
      let c;
      do { c = "2" + String(crypto.randomInt(0, 1e11)).padStart(11, "0"); } while (used.has(c));
      used.add(c); p.barcode = c; done.push(id);
    }
    if (done.length) save(items);
    return { done };
  }

  function today() {
    const day = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const t = day(Date.now());
    const list = loadInvoices().filter((x) => x.status !== "cancelled" && day(x.at) === t);
    const by = {};
    for (const x of list) by[x.payment] = (by[x.payment] || 0) + x.total;
    return { bills: list.length, total: list.reduce((n, x) => n + x.total, 0), byPayment: by, pieces: list.reduce((n, x) => n + x.lines.reduce((m, l) => m + l.qty, 0), 0) };
  }

  return { loadInvoices, saveInvoices, sell, cancel, adjust, saveItem, giveBarcodes, today, gstOn, stockOf, hooks };
};

// ₹1,23,456 -> "One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees Only"
module.exports.inWords = function inWords(n) {
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x) => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? " " + a[x % 10] : ""}`);
  const three = (x) => [x >= 100 ? `${a[Math.floor(x / 100)]} Hundred` : "", two(x % 100)].filter(Boolean).join(" ");
  let r = Math.floor(n), paise = Math.round((n - r) * 100);
  if (r === 0 && !paise) return "Zero Rupees Only";
  const parts = [];
  const crore = Math.floor(r / 1e7); r %= 1e7;
  const lakh = Math.floor(r / 1e5); r %= 1e5;
  const th = Math.floor(r / 1e3); r %= 1e3;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (th) parts.push(`${two(th)} Thousand`);
  if (r) parts.push(three(r));
  return `${parts.join(" ")} Rupees${paise ? ` and ${two(paise)} Paise` : ""} Only`.replace(/^ Rupees/, "Zero Rupees");
};
