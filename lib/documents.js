// Everything that isn't a sale or a purchase itself.
//  Returns (returns.json): sale return, credit note, purchase return, debit note. These change
//   the ledger, and the two "return" kinds also move stock.
//  Documents (docs.json): quotation, proforma, delivery challan, purchase order. These change
//   nothing until they're converted into a bill or a purchase.
const fs = require("fs");
const path = require("path");
const { moveSizeStock } = require("./sizes");
const crypto = require("crypto");
const { readJson, writeJson } = require("./jsonstore");

const round2 = (n) => Math.round(n * 100) / 100;
const newId = () => crypto.randomBytes(8).toString("hex");
const istDay = (d = new Date()) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const MODES = ["cash", "upi", "card", "bank"];
const RETURN_KIND = { sale_return: ["SR", "Sales Return"], credit_note: ["CN", "Credit Note"], purchase_return: ["PR", "Purchase Return"], debit_note: ["DN", "Debit Note"] };
const DOC_KIND = { quotation: ["QT", "Quotation"], proforma: ["PF", "Proforma Invoice"], challan: ["DC", "Delivery Challan"], purchase_order: ["PO", "Purchase Order"] };

module.exports = function createDocuments({ STORE, billing, books, load, save, logActivity, newCode }) {
  const file = (n) => path.join(STORE, `${n}.json`);
  const WEB_FIELDS = ["barcode", "cost", "mrp", "hsn", "gstRate", "reorderAt", "quantity"];
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  const lineStores = () => ({
    bills: { all: billing.loadInvoices, put: billing.saveInvoices },
    buys: { all: books.purchases.all, put: books.purchases.put },
    docs: { all: docs.all, put: docs.put },
    returns: { all: returns.all, put: returns.put },
  });
  const returns = { all: () => readJson(file("returns"), []), put: (l) => writeJson(file("returns"), l) };
  const docs = { all: () => readJson(file("docs"), []), put: (l) => writeJson(file("docs"), l) };
  const nextNo = (list, prefix) => {
    const n = list.filter((x) => x.number.startsWith(`${prefix}-`)).reduce((m, x) => Math.max(m, Number(x.number.split("-")[1]) || 0), 0);
    return `${prefix}-${String(n + 1).padStart(4, "0")}`;
  };
  const goodDay = (v) => { const d = v ? String(v) : istDay(); return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && d <= istDay() ? d : null; };
  const addStock = (p, n, size) => { p.quantity = billing.stockOf(p) + n; moveSizeStock(p, size, n); if (p.quantity > 0 && p.status === "sold") p.status = "available"; };
  const takeStock = (p, n, size) => { p.quantity = Math.max(0, billing.stockOf(p) - n); moveSizeStock(p, size, -n); if (p.quantity === 0) { p.status = "sold"; delete p.holdFor; } };
  const live = (x) => x.status !== "cancelled";
  const refundOf = (b, total) => {
    const refund = round2(Number(b.refund) || 0);
    if (refund < 0 || refund > total) return { error: "The refund can't be more than the return." };
    if (refund && !MODES.includes(b.mode)) return { error: "Pick how the money was paid back." };
    return { refund, mode: refund ? b.mode : null };
  };
  const already = (kind, key, id, productId) => returns.all().filter((r) => r.kind === kind && r[key] === id && live(r)).reduce((n, r) => n + r.lines.filter((l) => l.productId === productId).reduce((m, l) => m + l.qty, 0), 0);
  function record(row) {
    const list = returns.all();
    const full = { id: newId(), number: nextNo(list, RETURN_KIND[row.kind][0]), at: new Date().toISOString(), status: "done", ...row };
    list.push(full);
    returns.put(list);
    return full;
  }

  // Customer brings goods back: stock returns, and the money goes back or sits on their ledger.
  function saleReturn(b) {
    const inv = billing.loadInvoices().find((x) => x.id === b.invoiceId || x.number === String(b.invoiceId));
    if (!inv) return { error: "Bill not found." };
    if (inv.status === "cancelled") return { error: `Bill ${inv.number} is cancelled.` };
    const day = goodDay(b.day);
    if (!day) return { error: "Check the date. It can't be in the future." };
    if (!Array.isArray(b.lines) || !b.lines.some((l) => Number(l.qty) > 0)) return { error: "Enter how many pieces came back." };
    const lines = [];
    for (const l of b.lines) {
      const qty = Math.floor(Number(l.qty) || 0);
      if (!qty) continue;
      const line = inv.lines.find((x) => x.productId === l.productId);
      if (!line) return { error: "That item isn't on this bill." };
      const left = line.qty - already("sale_return", "invoiceId", inv.id, line.productId);
      if (qty < 0 || qty > left) return { error: `Only ${left} × “${line.name}” can still be returned on this bill.` };
      const each = line.amount / line.qty;
      lines.push({ productId: line.productId, code: line.code, name: line.name, qty, mrp: line.mrp, unit: round2(each), disc: 0, amount: round2(each * qty), taxable: round2((line.taxable / line.qty) * qty), tax: round2((line.tax / line.qty) * qty), gstRate: line.gstRate, cost: line.cost ?? null });
    }
    const total = round2(lines.reduce((n, l) => n + l.amount, 0));
    const r = refundOf(b, total);
    if (r.error) return r;
    if (!inv.partyId && r.refund < total) return { error: "This bill has no customer saved, so the full amount must be refunded." };
    const items = load();
    for (const l of lines) { const p = items.find((x) => x.id === l.productId); if (p) addStock(p, l.qty, l.sizes); }
    const row = record({ kind: "sale_return", invoiceId: inv.id, invoiceNumber: inv.number, partyId: inv.partyId || null, customer: inv.customer, day, lines, total, refund: r.refund, mode: r.mode, reason: String(b.reason || "").slice(0, 200) });
    save(items);
    for (const l of lines) logActivity({ type: "return", id: l.productId, qty: l.qty, amount: -l.amount, ref: row.number });
    return { return: row };
  }

  // Goods go back to the supplier: stock leaves, and they owe the shop or pay it back.
  function purchaseReturn(b) {
    const pu = books.purchases.all().find((x) => x.id === b.purchaseId || x.number === String(b.purchaseId));
    if (!pu) return { error: "Purchase not found." };
    if (pu.status === "cancelled") return { error: `${pu.number} is cancelled.` };
    const day = goodDay(b.day);
    if (!day) return { error: "Check the date. It can't be in the future." };
    const items = load();
    const lines = [];
    for (const l of b.lines || []) {
      const qty = Math.floor(Number(l.qty) || 0);
      if (!qty) continue;
      const line = pu.lines.find((x) => x.productId === l.productId);
      if (!line) return { error: "That item isn't on this purchase." };
      const left = line.qty - already("purchase_return", "purchaseId", pu.id, line.productId);
      const p = items.find((x) => x.id === line.productId);
      if (qty < 0 || qty > left) return { error: `Only ${left} × “${line.name}” can still be returned on this purchase.` };
      if (p && billing.stockOf(p) < qty) return { error: `Only ${billing.stockOf(p)} × “${line.name}” in stock to send back.` };
      const each = line.amount / line.qty;
      lines.push({ productId: line.productId, code: line.code, name: line.name, qty, unit: round2(each), disc: 0, amount: round2(each * qty) });
    }
    if (!lines.length) return { error: "Enter how many pieces went back." };
    const total = round2(lines.reduce((n, l) => n + l.amount, 0));
    const r = refundOf(b, total);
    if (r.error) return r;
    for (const l of lines) { const p = items.find((x) => x.id === l.productId); if (p) takeStock(p, l.qty, l.sizes); }
    const row = record({ kind: "purchase_return", purchaseId: pu.id, purchaseNumber: pu.number, partyId: pu.partyId, day, lines, total, refund: r.refund, mode: r.mode, reason: String(b.reason || "").slice(0, 200) });
    save(items);
    return { return: row };
  }

  // Money only, no goods: a price correction or goodwill.
  function note(kind, b) {
    const party = books.partyList().find((x) => x.id === b.partyId);
    if (!party) return { error: "Pick a party." };
    const amount = round2(Number(b.amount));
    if (!(amount > 0) || amount > 100_000_000) return { error: "Enter the amount." };
    const day = goodDay(b.day);
    if (!day) return { error: "Check the date. It can't be in the future." };
    const reason = String(b.reason || "").trim().slice(0, 200);
    if (!reason) return { error: "Add the reason. It prints on the note." };
    return { return: record({ kind, partyId: party.id, customer: { name: party.name, phone: party.phone, address: party.address, gstin: party.gstin }, day, lines: [], total: amount, refund: 0, mode: null, reason }) };
  }

  function cancelReturn(id) {
    const list = returns.all();
    const row = list.find((x) => x.id === id);
    if (!row) return { error: "Not found." };
    if (row.status === "cancelled") return { error: `${row.number} is already cancelled.` };
    const items = load();
    if (row.kind === "sale_return") {
      for (const l of row.lines) { const p = items.find((x) => x.id === l.productId); if (p && billing.stockOf(p) < l.qty) return { error: `Only ${billing.stockOf(p)} × “${l.name}” left, so this return can't be undone.` }; }
      for (const l of row.lines) { const p = items.find((x) => x.id === l.productId); if (p) takeStock(p, l.qty, l.sizes); }
    } else if (row.kind === "purchase_return") {
      for (const l of row.lines) { const p = items.find((x) => x.id === l.productId); if (p) addStock(p, l.qty, l.sizes); }
    }
    row.status = "cancelled"; row.cancelledAt = new Date().toISOString();
    returns.put(list);
    if (row.lines.length) save(items);
    return { return: row };
  }

  // A bill or purchase with a live return can't be cancelled: the two would double up.
  const hasReturn = (key, id) => returns.all().some((r) => r[key] === id && live(r));

  // ---- Quotations, proforma, challans, purchase orders ----
  function saveDoc(b) {
    if (!DOC_KIND[b.kind]) return { error: "Pick a document type." };
    const buying = b.kind === "purchase_order";
    if (buying && !b.partyId) return { error: "Pick a supplier." };
    if (!Array.isArray(b.lines) || !b.lines.length) return { error: "Add at least one item." };
    const day = goodDay(b.day);
    if (!day) return { error: "Check the date. It can't be in the future." };
    const items = load();
    const lines = [];
    for (const l of b.lines) {
      const p = items.find((x) => x.id === l.productId);
      if (!p) return { error: "One of the items isn't in your stock list." };
      const qty = Math.floor(Number(l.qty) || 0), unit = Number(l.price ?? (buying ? p.cost : p.price)) || 0, disc = Number(l.disc) || 0;
      if (qty < 1 || qty > 9999) return { error: `Check the quantity for “${p.name}”.` };
      if (unit < 0 || disc < 0 || disc > unit * qty) return { error: `Check the price for “${p.name}”.` };
      lines.push({ productId: p.id, code: p.code, name: p.name, sizes: p.sizes || "", qty, mrp: p.mrp || null, unit, disc, amount: round2(unit * qty - disc) });
    }
    const party = b.partyId ? books.partyList().find((x) => x.id === b.partyId) : null;
    if (b.partyId && !party) return { error: "Pick a party." };
    const c = party || b.customer || {};
    const list = docs.all();
    const row = {
      id: newId(), number: nextNo(list, DOC_KIND[b.kind][0]), kind: b.kind, day, at: new Date().toISOString(), status: "open", partyId: party?.id || null,
      customer: { name: String(c.name || "").slice(0, 80), phone: String(c.phone || "").replace(/\D/g, "").slice(-10), address: String(c.address || "").slice(0, 300), gstin: String(c.gstin || "") },
      lines, total: round2(lines.reduce((n, l) => n + l.amount, 0)), note: String(b.note || "").slice(0, 200), validUntil: /^\d{4}-\d{2}-\d{2}$/.test(b.validUntil) ? b.validUntil : "",
    };
    list.push(row);
    docs.put(list);
    return { doc: row };
  }
  function cancelDoc(id) {
    const list = docs.all();
    const d = list.find((x) => x.id === id);
    if (!d) return { error: "Not found." };
    if (d.status !== "open") return { error: `${d.number} is already ${d.status}.` };
    d.status = "cancelled";
    docs.put(list);
    return { doc: d };
  }
  // Turning it into the real thing: only now does stock or money move.
  function convertDoc(id, b = {}) {
    const list = docs.all();
    const d = list.find((x) => x.id === id);
    if (!d) return { error: "Not found." };
    if (d.status !== "open") return { error: `${d.number} is already ${d.status}.` };
    let result, to;
    if (d.kind === "purchase_order") {
      result = books.addPurchase({ partyId: d.partyId, supplierBill: d.number, lines: d.lines.map((l) => ({ productId: l.productId, qty: l.qty, cost: l.qty ? l.amount / l.qty : l.unit })), paid: b.paid, mode: b.mode });
      if (result.error) return result;
      to = result.purchase.number;
    } else {
      if (b.payment === "credit" && !d.partyId && !d.customer.phone) return { error: "A credit bill needs a customer with a mobile number." };
      result = billing.sell(d.lines.map((l) => ({ productId: l.productId, qty: l.qty, price: l.unit, disc: l.disc })), { source: "counter", customer: d.customer, payment: b.payment || "cash", partyId: d.partyId, allowShort: true, note: `From ${DOC_KIND[d.kind][1]} ${d.number}` });
      if (result.error) return result;
      to = result.invoice.number;
    }
    const fresh = docs.all();
    const row = fresh.find((x) => x.id === id);
    row.status = "converted"; row.convertedTo = to; row.convertedAt = new Date().toISOString();
    docs.put(fresh);
    return { doc: row, invoice: result.invoice, purchase: result.purchase };
  }

  // A shipping slip made from a bill. It records the shipment and moves no stock or money.
  // It carries no government number and says so: it doesn't replace an e-way bill.
  function dispatchNote(b) {
    const inv = billing.loadInvoices().find((x) => x.id === b.invoiceId || x.number === String(b.invoiceId));
    if (!inv) return { error: "Bill not found." };
    if (inv.status === "cancelled") return { error: `Bill ${inv.number} is cancelled.` };
    const text = (k, max = 60) => String(b[k] || "").replace(/\s+/g, " ").trim().slice(0, max);
    const courier = text("courier");
    if (!courier) return { error: "Add the courier or transporter." };
    if (!inv.customer?.address && !text("shipTo", 300)) return { error: "This bill has no address. Add where it's going." };
    const packages = Math.floor(Number(b.packages) || 1);
    if (packages < 1 || packages > 999) return { error: "Check the number of packages." };
    const list = docs.all();
    const row = { id: newId(), number: nextNo(list, "DP"), kind: "dispatch", day: goodDay(b.day) || istDay(), at: new Date().toISOString(), status: "dispatched", partyId: inv.partyId || null, invoiceId: inv.id, invoiceNumber: inv.number,
      customer: { ...inv.customer, address: text("shipTo", 300) || inv.customer.address }, lines: inv.lines.map(({ productId, code, name, sizes, qty, mrp, unit, disc, amount }) => ({ productId, code, name, sizes, qty, mrp, unit, disc, amount })), total: inv.total,
      transport: { courier, tracking: text("tracking"), vehicle: text("vehicle", 20), packages, weight: text("weight", 20) }, note: text("note", 200) };
    list.push(row);
    docs.put(list);
    return { doc: row };
  }

  // Joins a website item to its imported stock record, leaving one item. The website item keeps
  // its id, photo and link; the stock record's barcode, cost and real count move onto it.
  // Anything already recorded against the stock record is repointed, so no bill is orphaned.
  function linkItem({ websiteId, stockId }) {
    const items = load();
    const web = items.find((x) => x.id === websiteId), stock = items.find((x) => x.id === stockId);
    if (!web || web.hidden) return { error: "Pick an item that's on the website." };
    if (web.importKey) return { error: `“${web.name}” is already linked.` };
    if (!stock || !stock.hidden) return { error: "Pick an imported item that isn't on the website yet." };
    if (web.status === "hold") return { error: `“${web.name}” is held for order ${web.holdFor}. Confirm or cancel that order first.` };
    writeJson(file(`products-before-link-${Date.now()}`), items);

    // Everything an unlink needs to split them again: the record about to go, what the website
    // item held before, and which lines moved across.
    const undo = { at: new Date().toISOString(), stock: { ...stock }, web: pick(web, WEB_FIELDS), lines: {} };
    const repoint = (rows, kind) => { const moved = []; for (const r of rows) (r.lines || []).forEach((l, i) => { if (l.productId === stockId) { l.productId = websiteId; moved.push([r.id, i]); } }); if (moved.length) undo.lines[kind] = moved; return moved.length; };
    const stores = lineStores();
    for (const [kind, { all, put }] of Object.entries(stores)) { const rows = all(); if (repoint(rows, kind)) put(rows); }

    Object.assign(web, { importKey: stock.importKey || `linked:${stock.id}`, barcode: stock.barcode || web.barcode || "", cost: stock.cost ?? web.cost ?? null, mrp: web.mrp || stock.mrp || null, hsn: stock.hsn || web.hsn || "", gstRate: stock.gstRate ?? web.gstRate ?? null, reorderAt: stock.reorderAt ?? web.reorderAt ?? null, quantity: billing.stockOf(stock) });
    web.status = web.quantity > 0 ? "available" : "sold";
    if (stock.needsCount) web.needsCount = true;
    web.linkUndo = undo;
    save(items.filter((x) => x.id !== stockId));
    return { product: web };
  }

  // Links made before linkUndo existed: the copy kept just before linking has both records.
  function oldLink(web) {
    let names = [];
    try { names = fs.readdirSync(STORE).filter((f) => f.startsWith("products-before-link-")).sort().reverse(); } catch { return null; }
    for (const name of names) {
      const items = readJson(path.join(STORE, name), []);
      const before = items.find((x) => x.id === web.id), stock = items.find((x) => x.id !== web.id && x.hidden && (x.importKey ? x.importKey === web.importKey : `linked:${x.id}` === web.importKey));
      if (before && !before.importKey && stock) return { stock, web: pick(before, WEB_FIELDS), lines: {} };
    }
    return null;
  }

  // Splits a linked item back into its two records. The stock record leaves with today's count,
  // because linking made that the real one. The website item gets its old count back, which can't
  // know what sold since, so it's marked to be counted.
  function unlinkItem({ id }) {
    const items = load();
    const web = items.find((x) => x.id === id);
    if (!web || !web.importKey) return { error: "That item isn't linked." };
    if (web.status === "hold") return { error: `“${web.name}” is held for order ${web.holdFor}. Confirm or cancel that order first.` };
    const undo = web.linkUndo || oldLink(web);
    if (!undo) return { error: `“${web.name}” was matched during the stock import, so there's no second item to split it into.` };
    if (items.some((x) => x.id === undo.stock.id)) return { error: "The stock item is already back in your list." };
    writeJson(file(`products-before-unlink-${Date.now()}`), items);

    const stores = lineStores();
    for (const [kind, moved] of Object.entries(undo.lines)) {
      const rows = stores[kind].all();
      for (const [rid, i] of moved) { const l = rows.find((r) => r.id === rid)?.lines?.[i]; if (l?.productId === id) l.productId = undo.stock.id; }
      stores[kind].put(rows);
    }
    const left = billing.stockOf(web);
    const stock = { ...undo.stock, hidden: true, quantity: left, status: left > 0 ? "available" : "sold" };
    if (items.some((x) => x.code === stock.code)) stock.code = newCode(items);
    delete web.importKey; delete web.linkUndo;
    for (const k of WEB_FIELDS) if (undo.web[k] === undefined) delete web[k]; else web[k] = undo.web[k];
    web.status = web.quantity > 0 ? "available" : "sold";
    web.needsCount = true;
    items.push(stock);
    save(items);
    return { product: web, stock };
  }

  // Same printed page as a bill.
  function printable(id) {
    const r = returns.all().find((x) => x.id === id);
    if (r) {
      const lines = r.lines.length ? r.lines : [{ name: r.reason, qty: 1, unit: r.total, disc: 0, amount: r.total }];
      const party = r.partyId ? books.partyList().find((x) => x.id === r.partyId) : null;
      return { title: RETURN_KIND[r.kind][1].toUpperCase(), doc: { ...r, lines, customer: r.customer || party || {}, charges: [], kind: "doc", paid: r.refund, source: r.kind, note: [r.invoiceNumber && `Against bill ${r.invoiceNumber}`, r.purchaseNumber && `Against ${r.purchaseNumber}`, r.reason].filter(Boolean).join(". ") }, labels: { paid: "Refunded", balance: "To ledger" } };
    }
    const d = docs.all().find((x) => x.id === id);
    if (!d) return null;
    if (d.kind === "dispatch") {
      const t = d.transport;
      const note = [`Against bill ${d.invoiceNumber}`, `Courier: ${t.courier}`, t.tracking && `Tracking: ${t.tracking}`, t.vehicle && `Vehicle: ${t.vehicle}`, `Packages: ${t.packages}`, t.weight && `Weight: ${t.weight}`, d.note, "This is a shop dispatch note, not a government e-way bill."].filter(Boolean).join(". ");
      return { title: "DISPATCH NOTE", doc: { ...d, charges: [], paid: 0, source: "dispatch", kind: "doc", note }, labels: { hideMoney: true } };
    }
    return { title: DOC_KIND[d.kind][1].toUpperCase(), doc: { ...d, charges: [], paid: 0, source: d.kind, kind: "doc", note: [d.validUntil && `Valid until ${d.validUntil}`, d.note].filter(Boolean).join(". ") }, labels: { hideMoney: true } };
  }

  return { returns, docs, saleReturn, purchaseReturn, note, cancelReturn, hasReturn, saveDoc, cancelDoc, convertDoc, dispatchNote, linkItem, unlinkItem, printable, RETURN_KIND, DOC_KIND };
};
