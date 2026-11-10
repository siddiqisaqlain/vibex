// Brings a full myBillBook export (items, parties, every bill, payments, notes, expenses) into
// the shop's own files, so /billing carries straight on from myBillBook.
//   plan(data, STORE)  -> what would change and a reconciliation report. Writes nothing.
//   apply(data, STORE) -> copies every file it touches to backups/before-mbb-<time>/, then writes.
// Everything is keyed by myBillBook's own ids (mbbId), so running it again with a newer export
// only adds what's new and updates what changed. Nothing is ever deleted.
// Old bills are history: importing them never moves stock. Stock comes from the item counts.
// CLI: node lib/import-mbb.js <export.json> <DATA_DIR> [--apply]
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { readJson, writeJson } = require("./jsonstore");
const { fitSizeStock } = require("./sizes");
const { guessCategory } = require("./import-mybillbook");

const FILES = ["products", "parties", "invoices", "payments", "returns", "expenses"];
const META = "mbb-import.json";
const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const phone10 = (v) => String(v || "").replace(/\D/g, "").slice(-10);
const pad4 = (n) => String(n).padStart(4, "0");
// Our ids are 16 hex characters. Made from myBillBook's id, so the same record always gets the same id.
const hid = (kind, id) => crypto.createHash("sha1").update(`mbb:${kind}:${id}`).digest("hex").slice(0, 16);
const hash = (o) => crypto.createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 16);
const IST = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
const istDay = (d) => IST.format(new Date(d));
const month = (day) => day.slice(0, 7);
// The bill's own date with the time it was made: a bill dated the 15th but typed on the 17th stays on the 15th.
function atOf(day, created) {
  const t = created && !Number.isNaN(Date.parse(created)) ? new Date(Date.parse(created) + 5.5 * 3600e3).toISOString().slice(11, 23) : "12:00:00.000";
  return new Date(`${day}T${t}+05:30`).toISOString();
}
function fyOf(day) {
  const [y, m] = day.split("-").map(Number);
  const s = m >= 4 ? y : y - 1;
  return `${String(s).slice(2)}-${String(s + 1).slice(2)}`;
}
const modeOf = (m) => (/upi/i.test(m) ? "upi" : /card/i.test(m) ? "card" : !m || /cash/i.test(m) ? "cash" : "bank");
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
const EXPENSE_TYPES = ["Rent", "Salary", "Electricity", "Courier", "Packing", "Travel", "Marketing", "Repairs", "Tea & food", "Other"];
const addressOf = (a) => (a ? [a.street_address, a.city, a.state, a.pincode].map(clean).filter(Boolean).join(", ") : "");
function newCode(items) {
  const used = new Set(items.map((p) => p.code));
  for (;;) { const c = String(crypto.randomInt(1000, 10000)); if (!used.has(c)) return c; }
}

function check(data) {
  if (!data || typeof data !== "object") return "That isn't a myBillBook export.";
  if (!Array.isArray(data.items) || !Array.isArray(data.contacts) || !data.vouchers || !Array.isArray(data.vouchers.sales_invoice) || !data.invoiceDetails)
    return "That isn't a full myBillBook export: it needs items, contacts, vouchers and invoiceDetails.";
  return null;
}
const readStore = (store) => Object.fromEntries(FILES.map((f) => [f, readJson(path.join(store, `${f}.json`), [])]));

function plan(data, store, opts = {}) {
  const bad = check(data);
  if (bad) return { error: bad };
  const before = readStore(store);
  const out = structuredClone(before);
  const meta = readJson(path.join(store, META), null);
  const V = data.vouchers;
  const R = {
    export: { started: data.started || null, done: data.done || null, errors: (data.errors || []).length, errorList: (data.errors || []).slice(0, 10) },
    items: { inExport: data.items.length, matchedById: 0, matchedByBarcode: 0, matchedByKey: 0, matchedByName: 0, created: 0, updated: 0, unchanged: 0, ourItemsNotInMbb: 0, websiteItemsNotInMbb: [], flags: { negativeStock: [], noPrice: [], badName: [], noBarcode: [], barcodeClash: [], service: [], hiddenRenamed: [], websitePriceDifferent: [] } },
    parties: { inExport: data.contacts.length, created: 0, merged: 0, updated: 0, unchanged: 0, mergedSamePhone: [], openingChanged: [] },
    bills: { inExport: V.sales_invoice.length, cancelled: 0, created: 0, updated: 0, unchanged: 0, skippedLocal: [], noDetail: [], duplicateNumbersInMbb: [], numberClashWithOurs: [] },
    payments: { inExport: 0, created: 0, updated: 0, unchanged: 0, skippedLocal: [], notLinkedToBills: 0 },
    creditNotes: { inExport: (V.credit_note || []).length, created: 0, updated: 0, unchanged: 0, refunds: 0 },
    expenses: { inExport: (V.expense || []).length, created: 0, updated: 0, unchanged: 0 },
    notImported: {}, inOursNotInExport: { bills: 0, payments: 0 }, warnings: [],
  };
  for (const [k, list] of Object.entries(V)) if (Array.isArray(list) && list.length && !["sales_invoice", "payment_in", "payment_out", "credit_note", "expense"].includes(k)) R.notImported[k] = list.length;
  if (R.export.errors) R.warnings.push(`The export logged ${R.export.errors} fetch error(s) from myBillBook. Check the counts below match his myBillBook screens.`);
  if (meta?.appliedAt) {
    const since = meta.appliedAt;
    const native = before.invoices.filter((x) => x.source !== "mybillbook" && x.at > since).length;
    if (native) R.warnings.push(`${native} bill(s) were made in this system since the last import (${since}). Item stock is set from myBillBook again, so count those items if they weren't billed in myBillBook too.`);
  }

  // ---- Items ----
  const P = out.products;
  const itemOf = new Map(); // myBillBook item id -> our product
  const claimed = new Set();
  const mbbNames = {};
  for (const it of data.items) { const k = norm(it.name); mbbNames[k] = (mbbNames[k] || 0) + 1; }
  const free = (p) => p && !claimed.has(p.id);
  const seenName = {};
  const pick = (f) => P.find((p) => free(p) && f(p));
  const nameOwners = (k) => P.filter((p) => free(p) && !p.mbbId && norm(p.name) === k);
  for (const it of data.items) {
    const sku = String(it.sku_code || "").trim(), k = norm(it.name), name = clean(it.name);
    const qty = Math.round(num(it.quantity)), price = round2(num(it.sales_info?.price_per_unit)), mrp = round2(num(it.mrp)) || null;
    const cost = round2(num(it.purchase_info?.price_per_unit)) || null; // 0 in myBillBook means it was never entered
    const label = `${name}${sku ? ` (${sku})` : ""}`;
    let p = pick((x) => x.mbbId === it.id), how = "id";
    if (!p) { p = pick((x) => !x.mbbId && x.importKey === `mbb:${it.id}`); how = "key"; }
    if (!p && sku) { p = pick((x) => !x.mbbId && x.barcode === sku); how = "barcode"; }
    if (!p && sku) { p = pick((x) => !x.mbbId && x.importKey === sku); how = "key"; }
    // The old CSV import keyed items without a barcode by name and count: name:<name>#1, #2, ...
    seenName[k] = (seenName[k] || 0) + 1;
    if (!p && !sku) { p = pick((x) => !x.mbbId && x.importKey === `name:${k}#${seenName[k]}`); how = "key"; }
    if (!p && mbbNames[k] === 1) { const o = nameOwners(k); if (o.length === 1) { p = o[0]; how = "name"; } }
    if (qty < 0) R.items.flags.negativeStock.push(`${label}: ${qty}`);
    if (!(price > 0)) R.items.flags.noPrice.push(label);
    const badName = /^\d+$/.test(name.replace(/\s/g, "")) || !name;
    if (badName) R.items.flags.badName.push(label);
    if (!sku) R.items.flags.noBarcode.push(name);
    if (it.item_type === "service") R.items.flags.service.push(label);
    const clash = sku && P.find((x) => x.barcode === sku && x !== p);
    if (clash) R.items.flags.barcodeClash.push(`${label}: our item #${clash.code} “${clash.name}” already has this barcode`);

    if (p) {
      R.items[{ id: "matchedById", key: "matchedByKey", barcode: "matchedByBarcode", name: "matchedByName" }[how]]++;
      claimed.add(p.id);
      const was = JSON.stringify(p);
      const website = !p.hidden || p.wasLive || Boolean(p.image);
      // Website names were written for customers: those stay. Stock records follow myBillBook,
      // unless the name was changed here since the last import.
      if (!website && (p.mbbName === undefined || p.name === p.mbbName)) {
        if (p.mbbName === undefined && norm(p.name) !== k) R.items.flags.hiddenRenamed.push(`“${p.name}” -> “${name}”`);
        if (name) p.name = name;
      }
      p.mbbId = it.id; p.mbbName = name;
      if (sku && !clash) p.barcode = sku;
      if (!p.importKey) p.importKey = sku || `mbb:${it.id}`;
      // myBillBook's count is the truth as of the export. A piece held for a website order keeps its hold.
      if (p.status === "hold" && p.holdFor) { p.quantity = Math.max(qty, 1); if (qty < 1) p.needsCount = true; }
      else if (qty < 0) { p.quantity = p.sizeStock ? 0 : qty; p.status = "sold"; p.needsCount = true; p.mbbNegative = true; }
      else {
        p.quantity = qty;
        p.status = qty > 0 ? (p.status === "sold" ? "available" : p.status || "available") : "sold";
        if (p.mbbNegative) { delete p.mbbNegative; delete p.needsCount; }
      }
      // A price on the website was set for customers: it stays. myBillBook's goes in mbbPrice.
      // Items off the website take myBillBook's price.
      if (price > 0) {
        p.mbbPrice = price;
        if (!p.hidden && p.price) { if (p.price !== price) R.items.flags.websitePriceDifferent.push(`#${p.code} “${p.name}”: website ₹${p.price}, myBillBook ₹${price}`); }
        else { p.price = price; delete p.needsPrice; }
      }
      if (cost !== null) p.cost = cost;
      if (mrp) p.mrp = mrp;
      p.mbbCategory = clean(it.item_category_name);
      p.unit = it.unit || "PCS";
      if (!p.description && clean(it.description)) p.description = clean(it.description);
      if (JSON.stringify(p) === was) R.items.unchanged++; else R.items.updated++;
    } else {
      p = {
        id: `mbb${hid("item", it.id).slice(0, 12)}`, code: newCode(P), importKey: sku || `mbb:${it.id}`, hidden: true,
        name: name || sku || "Item", brand: "", category: guessCategory(name), subcategory: null, sizes: "", image: null, caption: "",
        barcode: clash ? "" : sku, cost, price: price > 0 ? price : null, ...(price > 0 ? { mbbPrice: price } : {}), mrp, quantity: qty, status: qty > 0 ? "available" : "sold",
        createdAt: it.created_at && !Number.isNaN(Date.parse(it.created_at)) ? new Date(it.created_at.replace(" ", "T") + "+05:30").toISOString() : new Date().toISOString(),
        mbbId: it.id, mbbName: name, mbbCategory: clean(it.item_category_name), unit: it.unit || "PCS", description: clean(it.description),
        ...(qty < 0 ? { needsCount: true, mbbNegative: true } : {}), ...(badName ? { needsName: true } : {}), ...(price > 0 ? {} : { needsPrice: true }),
      };
      P.push(p); claimed.add(p.id);
      R.items.created++;
    }
    itemOf.set(it.id, p);
  }
  for (const p of P) if (!claimed.has(p.id)) { R.items.ourItemsNotInMbb++; if (!p.hidden) R.items.websiteItemsNotInMbb.push(`#${p.code} ${p.name}`); }
  P.forEach(fitSizeStock);
  const bySku = new Map(data.items.filter((i) => i.sku_code).map((i) => [String(i.sku_code), itemOf.get(i.id)]));

  // ---- Parties: one per mobile number and type; contacts without a mobile stay apart ----
  const PT = out.parties;
  const groups = new Map();
  for (const c of [...data.contacts].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    const type = c.company_contact_type === "supplier" ? "supplier" : "customer", ph = phone10(c.mobile_number);
    const key = ph.length === 10 ? `${type}|${ph}` : `id|${c.id}`;
    if (!groups.has(key)) groups.set(key, { type, phone: ph.length === 10 ? ph : "", list: [] });
    groups.get(key).list.push(c);
  }
  const partyOf = new Map(); // contact id -> our party
  const used = new Set();
  for (const g of groups.values()) {
    const ids = g.list.map((c) => c.id), first = g.list[0], last = g.list[g.list.length - 1];
    if (g.list.length > 1) R.parties.mergedSamePhone.push(`${g.phone}: ${g.list.map((c) => clean(c.name) || "?").join(", ")}`);
    let p = PT.find((x) => !used.has(x.id) && Array.isArray(x.mbbIds) && x.mbbIds.some((i) => ids.includes(i)));
    if (!p && g.phone) p = PT.find((x) => !used.has(x.id) && !x.deleted && x.phone === g.phone && x.type === g.type);
    const opening = round2(g.list.reduce((n, c) => n + num(c.opening_balance), 0));
    const name = clean(last.name) || clean(first.name) || (g.phone ? `Customer ${g.phone.slice(-4)}` : "Customer");
    const address = addressOf(g.list.map((c) => c.billing_address).find((a) => addressOf(a)));
    const shipping = addressOf(g.list.map((c) => c.shipping_address).find((a) => addressOf(a)));
    const gstin = (g.list.map((c) => String(c.gst_number || "").trim().toUpperCase()).find((x) => GSTIN.test(x))) || "";
    const email = g.list.map((c) => clean(c.email)).find(Boolean) || "";
    const creditLimit = Math.max(0, ...g.list.map((c) => num(c.credit_limit)));
    const creditPeriod = num(last.credit_period) || 0;
    const created = new Date(first.created_at).toISOString();
    if (p) {
      const was = JSON.stringify(p);
      if (!p.mbbIds) { R.parties.merged++; if (p.opening && round2(p.opening) !== opening) { R.parties.openingChanged.push(`${p.name} (${p.phone}): ₹${p.opening} -> ₹${opening}`); p.openingBeforeMbb = p.opening; } }
      if (p.source === "mybillbook" && p.name === p.mbbName) p.name = name;
      p.mbbIds = [...new Set([...(p.mbbIds || []), ...ids])]; p.mbbName = name;
      p.opening = opening;
      if (!p.phone && g.phone) p.phone = g.phone;
      if (!p.address && address) p.address = address;
      if (!p.gstin && gstin) p.gstin = gstin;
      if (!p.creditLimit && creditLimit) p.creditLimit = creditLimit;
      if (email && !p.email) p.email = email;
      if (shipping && !p.shippingAddress) p.shippingAddress = shipping;
      p.creditPeriod = creditPeriod;
      if (!p.createdAt || created < p.createdAt) p.createdAt = created; // the opening balance dates from myBillBook
      if (JSON.stringify(p) === was) R.parties.unchanged++; else R.parties.updated++;
    } else {
      p = { id: hid("party", first.id), type: g.type, name, phone: g.phone, gstin, address, opening, creditLimit, notes: "", birthday: "", createdAt: created,
        source: "mybillbook", mbbIds: ids, mbbName: name, creditPeriod, ...(email ? { email } : {}), ...(shipping ? { shippingAddress: shipping } : {}) };
      PT.push(p);
      R.parties.created++;
    }
    used.add(p.id);
    for (const c of g.list) partyOf.set(c.id, p);
  }
  const contactOf = new Map(data.contacts.map((c) => [c.id, c]));

  // ---- Sales invoices ----
  const INV = out.invoices;
  const invByMbb = new Map(INV.filter((x) => x.mbbId).map((x) => [x.mbbId, x]));
  const ours = new Map(INV.filter((x) => x.source !== "mybillbook").map((x) => [String(x.number), x]));
  const withReturn = new Set(out.returns.filter((r) => r.status !== "cancelled" && r.invoiceId).map((r) => r.invoiceId));
  const seenNo = new Map();
  const exportIds = new Set();
  for (const v of V.sales_invoice) {
    const x = data.invoiceDetails[v.id];
    if (!x) { R.bills.noDetail.push(v.invoice_number); continue; }
    exportIds.add(v.id);
    const cancelled = v.status == null || Boolean(x.cancelled_at || v.cancelled_at);
    if (cancelled) R.bills.cancelled++;
    const number = `${x.prefix || ""}${x.invoice_number}`;
    if (seenNo.has(number)) R.bills.duplicateNumbersInMbb.push(number); else seenNo.set(number, v.id);
    if (ours.has(number)) R.bills.numberClashWithOurs.push(number);
    const day = x.invoice_date || v.invoice_date;
    const party = partyOf.get(x.contact_id) || null, c = contactOf.get(x.contact_id) || {};
    const lines = (x.items || []).map((l) => {
      const p = itemOf.get(l.id) || (l.sku_code && bySku.get(String(l.sku_code))) || null;
      const qty = num(l.quantity), unit = round2(num(l.price_per_unit)), amount = round2(num(l.item_final_amount));
      return { productId: p ? p.id : null, code: p ? p.code : "", name: clean(l.name), sizes: "", hsn: "", qty, mrp: round2(num(l.mrp)) || null, listPrice: unit,
        cost: round2(num(l.purchase_info?.price_per_unit)) || null, unit, disc: round2(num(l.discount_amount)), amount, gstRate: 0, taxable: amount, tax: 0, mbbItemId: l.id };
    });
    const charges = (x.additional_charges || []).map((ch) => ({ label: clean(ch.name).slice(0, 40) || "Extra charge", amount: round2(num(ch.charge)) })).filter((ch) => ch.amount);
    // His bill discount and round off become lines under the items, so the total reads the same as his paper bill.
    const sub = lines.reduce((n, l) => n + l.amount, 0) + charges.reduce((n, ch) => n + ch.amount, 0);
    const billDisc = round2(x.discount_type === "percentage" ? (sub * num(x.discount)) / 100 : num(x.discount));
    if (billDisc) charges.push({ label: "Discount", amount: -billDisc });
    if (num(x.round_off)) charges.push({ label: "Round off", amount: round2(num(x.round_off)) });
    const total = round2(num(x.total_amount));
    const credit = x.payment_type === "credit";
    const received = credit ? Math.min(total, round2(num(x.initial_payment_amount))) : total;
    const mode = modeOf(x.payment_mode);
    const rec = {
      number, kind: "cash-memo", at: atOf(day, x.created_at || x.cancelled_at), source: "mybillbook", mbbId: v.id, order: null,
      partyId: party ? party.id : null,
      customer: { name: clean(c.name || x.contact_name || v.contact_name).slice(0, 60), phone: phone10(c.mobile_number).length === 10 ? phone10(c.mobile_number) : "", address: addressOf(x.billing_address) || addressOf(c.billing_address), gstin: party?.gstin || "" },
      payment: credit ? "credit" : mode === "bank" ? "upi" : mode,
      note: clean(x.customer_notes || x.customer_note || v.notes).slice(0, 200),
      terms: String(x.tnc || "").trim().slice(0, 1000), // his terms on the day, printed on a reprint
      lines, charges, paid: received, ...(credit && received > 0 ? { paidMode: mode === "bank" ? "upi" : mode } : {}),
      taxable: total, tax: 0, total, status: cancelled ? "cancelled" : "paid",
      ...(cancelled ? { cancelledAt: x.cancelled_at || v.cancelled_at || null, cancelReason: clean(x.cancellation_reason).slice(0, 200) || "Cancelled in myBillBook", mbbCancelled: true } : {}),
    };
    if (Math.abs(round2(sub - billDisc + num(x.round_off)) - total) > 0.01) R.warnings.push(`Bill ${number}: lines add up to ₹${round2(sub - billDisc + num(x.round_off))}, myBillBook says ₹${total}. Kept myBillBook's total.`);
    rec.mbbHash = hash(rec);
    const old = invByMbb.get(v.id);
    if (!old) { INV.push({ id: hid("inv", v.id), ...rec }); R.bills.created++; continue; }
    if (old.mbbHash === rec.mbbHash) { R.bills.unchanged++; continue; }
    // Changed here since the import (cancelled, or a return made against it): ours wins.
    if ((old.status === "cancelled" && !old.mbbCancelled) || withReturn.has(old.id)) { R.bills.skippedLocal.push(old.number); continue; }
    for (const k of Object.keys(old)) if (k !== "id") delete old[k];
    Object.assign(old, rec);
    R.bills.updated++;
  }
  R.inOursNotInExport.bills = INV.filter((x) => x.mbbId && !exportIds.has(x.mbbId)).length;
  // Sorted by time, like bills made here: the Bills list and "latest" read the end of the file.
  INV.sort((a, b) => String(a.at).localeCompare(String(b.at)));

  // ---- Payments in and out ----
  const PAY = out.payments;
  const payByMbb = new Map(PAY.filter((x) => x.mbbId).map((x) => [x.mbbId, x]));
  const payNos = new Set(PAY.filter((x) => !x.mbbId).map((x) => x.number));
  const payIds = new Set();
  const putPayment = (key, rec, bucket) => {
    rec.mbbHash = hash(rec);
    payIds.add(key);
    const old = payByMbb.get(key);
    if (!old) { PAY.push({ id: hid("pay", key), ...rec }); bucket.created++; return; }
    if (old.mbbHash === rec.mbbHash) { bucket.unchanged++; return; }
    if (old.status === "cancelled" && !old.mbbCancelled) { (bucket.skippedLocal || []).push(old.number); return; }
    for (const k of Object.keys(old)) if (k !== "id") delete old[k];
    Object.assign(old, rec); bucket.updated++;
  };
  for (const [kind, dir, prefix] of [["payment_in", "in", "RCPT"], ["payment_out", "out", "PAY"]]) {
    for (const v of V[kind] || []) {
      R.payments.inExport++;
      const day = v.invoice_date || v.date, party = partyOf.get(v.contact_id);
      if (!party) { R.warnings.push(`Payment ${v.invoice_number} has no party in the export: skipped.`); continue; }
      let number = `${prefix}/${fyOf(day)}/${pad4(v.serial_number || v.invoice_number)}`;
      if (payNos.has(number)) number += "-M";
      if (!(v.txn_ledgers || []).length) R.payments.notLinkedToBills++;
      putPayment(v.id, { number, direction: dir, partyId: party.id, amount: round2(num(v.amount ?? v.total_amount)), mode: modeOf(v.payment_mode), day, note: clean(v.notes).slice(0, 200), at: atOf(day, v.created_at), status: "done", source: "mybillbook", mbbId: v.id }, R.payments);
    }
  }

  // ---- Credit notes (his sales returns). The money he paid back is a payment out, so cash and the ledger both show it ----
  const RET = out.returns;
  const retByMbb = new Map(RET.filter((x) => x.mbbId).map((x) => [x.mbbId, x]));
  for (const v of V.credit_note || []) {
    const day = v.invoice_date || v.date, party = partyOf.get(v.contact_id), c = contactOf.get(v.contact_id) || {};
    const total = round2(num(v.amount ?? v.total_amount)), refund = round2(num(v.initial_payment_amount));
    const number = `CN-${pad4(v.serial_number || v.invoice_number)}`;
    const rec = { number, kind: "credit_note", partyId: party ? party.id : null, customer: { name: clean(c.name || v.contact_name), phone: party?.phone || "", address: party?.address || "", gstin: party?.gstin || "" },
      day, lines: [], total, refund: 0, mode: null, reason: clean(v.notes) || "Sales return (myBillBook)", at: atOf(day, v.created_at), status: v.status === "cancelled" ? "cancelled" : "done", source: "mybillbook", mbbId: v.id };
    rec.mbbHash = hash(rec);
    const old = retByMbb.get(v.id);
    if (!old) { RET.push({ id: hid("cn", v.id), ...rec }); R.creditNotes.created++; }
    else if (old.mbbHash === rec.mbbHash) R.creditNotes.unchanged++;
    else { for (const k of Object.keys(old)) if (k !== "id") delete old[k]; Object.assign(old, rec); R.creditNotes.updated++; }
    if (refund > 0 && party) {
      R.creditNotes.refunds++;
      putPayment(`refund:${v.id}`, { number: `${number}-R`, direction: "out", partyId: party.id, amount: refund, mode: modeOf(v.payment_mode), day, note: `Paid back on credit note ${number}`, at: atOf(day, v.created_at), status: "done", source: "mybillbook", mbbId: `refund:${v.id}` }, { created: 0, updated: 0, unchanged: 0 });
    }
  }
  R.inOursNotInExport.payments = PAY.filter((x) => x.mbbId && !payIds.has(x.mbbId)).length;
  PAY.sort((x, y) => String(x.at).localeCompare(String(y.at)));

  // ---- Expenses ----
  const EXP = out.expenses;
  const expByMbb = new Map(EXP.filter((x) => x.mbbId).map((x) => [x.mbbId, x]));
  for (const v of V.expense || []) {
    const day = v.invoice_date || v.date, cat = clean(v.ledger_category_name);
    const what = (v.txn_ledgers || []).map((l) => clean(l.name)).filter(Boolean).join(", ");
    const rec = { number: `EXP/${fyOf(day)}/${pad4(v.serial_number || v.invoice_number)}`, type: EXPENSE_TYPES.find((t) => norm(t) === norm(cat)) || "Other", amount: round2(num(v.amount ?? v.total_amount)),
      mode: modeOf(v.payment_mode), day, note: [cat, what, clean(v.notes)].filter(Boolean).join(": ").slice(0, 200), at: atOf(day, v.created_at), status: "done", source: "mybillbook", mbbId: v.id };
    rec.mbbHash = hash(rec);
    const old = expByMbb.get(v.id);
    if (!old) { EXP.push({ id: hid("exp", v.id), ...rec }); R.expenses.created++; }
    else if (old.mbbHash === rec.mbbHash) R.expenses.unchanged++;
    else { for (const k of Object.keys(old)) if (k !== "id") delete old[k]; Object.assign(old, rec); R.expenses.updated++; }
  }

  const changed = FILES.filter((f) => JSON.stringify(before[f]) !== JSON.stringify(out[f]));
  return { report: R, files: out, changed, groups: [...groups.values()], partyOf };
}

// Worked out with the shop's own code (lib/books.js, lib/billing.js) on the files as they'd be,
// so it shows what the dashboard and ledgers will really say.
function reconcile(data, dir, ctx, SHOP, mbbDashboard = 1861702) {
  const createBilling = require("./billing"), createBooks = require("./books");
  const load = () => readJson(path.join(dir, "products.json"), []);
  const billing = createBilling({ STORE: dir, SHOP, load, save: () => {}, logActivity: () => {} });
  const books = createBooks({ STORE: dir, SHOP, billing, load, save: () => {}, logActivity: () => {} });
  billing.hooks.partyFor = () => null;
  const bal = new Map(books.partyList().map((p) => [p.id, p.balance || 0]));
  let matched = 0;
  const worst = [];
  for (const g of ctx.groups) {
    const p = ctx.partyOf.get(g.list[0].id);
    const want = round2(g.list.reduce((n, c) => n + num(c.balance), 0)), got = round2(bal.get(p.id) || 0);
    if (Math.abs(want - got) < 0.01) matched += g.list.length;
    else worst.push({ party: p.name, phone: p.phone, contacts: g.list.length, mbb: want, ours: got, diff: round2(got - want) });
  }
  worst.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const months = {};
  const row = (m) => (months[m] ||= { month: m, mbbBills: 0, mbb: 0, oursBills: 0, ours: 0, oursAllSources: 0 });
  for (const v of data.vouchers.sales_invoice) {
    const x = data.invoiceDetails[v.id];
    if (!x || v.status == null || x.cancelled_at) continue;
    const r = row(month(x.invoice_date)); r.mbbBills++; r.mbb = round2(r.mbb + num(x.total_amount));
  }
  const invs = billing.loadInvoices().filter((x) => x.status !== "cancelled");
  for (const x of invs) { const r = row(month(istDay(x.at))); r.oursAllSources = round2(r.oursAllSources + x.total); if (x.source === "mybillbook") { r.oursBills++; r.ours = round2(r.ours + x.total); } }
  const live = data.vouchers.sales_invoice.filter((v) => v.status != null && data.invoiceDetails[v.id] && !data.invoiceDetails[v.id].cancelled_at);
  const mbbAtSale = round2(live.reduce((n, v) => n + num(data.invoiceDetails[v.id].initial_payment_amount), 0));
  const mbbPayIn = round2((data.vouchers.payment_in || []).reduce((n, v) => n + num(v.amount), 0));
  const paidOn = (inv) => (inv.paid != null ? inv.paid : inv.payment === "credit" ? 0 : inv.total);
  const oursAtSale = round2(invs.filter((x) => x.source === "mybillbook").reduce((n, x) => n + paidOn(x), 0));
  const oursPayIn = round2(books.payments.all().filter((x) => x.source === "mybillbook" && x.direction === "in" && x.status !== "cancelled").reduce((n, x) => n + x.amount, 0));
  const items = load(), mine = items.filter((p) => p.mbbId);
  const sum = (list, f) => round2(list.reduce((n, p) => n + f(p), 0));
  const dash = books.dashboard();
  return {
    partyBalances: { contacts: data.contacts.length, matched, mismatches: worst.length, worst: worst.slice(0, 15) },
    salesByMonth: Object.values(months).sort((a, b) => a.month.localeCompare(b.month)),
    salesTotal: { mbb: round2(Object.values(months).reduce((n, r) => n + r.mbb, 0)), ours: round2(Object.values(months).reduce((n, r) => n + r.ours, 0)) },
    received: { mbbAtSale, oursAtSale, mbbPaymentsIn: mbbPayIn, oursPaymentsIn: oursPayIn, mbbTotal: round2(mbbAtSale + mbbPayIn), oursTotal: round2(oursAtSale + oursPayIn) },
    stock: {
      mbbPieces: data.items.reduce((n, i) => n + Math.round(num(i.quantity)), 0),
      oursPiecesMbbItems: sum(mine, (p) => num(p.quantity)), oursPiecesAll: sum(items, (p) => num(p.quantity)),
      mbbValueAtSellingPrice: round2(data.items.reduce((n, i) => n + num(i.quantity) * num(i.sales_info?.price_per_unit), 0)),
      oursValueAtSellingPrice: sum(mine, (p) => num(p.quantity) * num(p.price)),
      oursValueAtSellingPriceNoNegatives: sum(mine, (p) => Math.max(0, num(p.quantity)) * num(p.price)),
      oursValueAllItems: sum(items, (p) => Math.max(0, num(p.quantity)) * num(p.price)),
      mbbDashboardSaid: mbbDashboard, // his myBillBook dashboard on 10 Nov 2026
    },
    dashboard: { toCollect: dash.toCollect, toPay: dash.toPay, cash: dash.cash, bank: dash.bank, stockAtCost: dash.stockAtCost },
    nextBillNumber: String(Math.max(SHOP.billing?.nextNumber || 1, billing.loadInvoices().reduce((m, x) => Math.max(m, Number(x.number) || 0), 0) + 1)),
  };
}

function writeAll(dir, files, which) {
  for (const f of which) {
    const list = files[f];
    if (f === "products") list.forEach(fitSizeStock);
    writeJson(path.join(dir, `${f}.json`), list);
  }
}

// Dry run: the files as they'd be go to a temp folder, the shop's code reads them there, the folder goes.
function preview(data, store, SHOP) {
  const r = plan(data, store);
  if (r.error) return r;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-mbb-"));
  try {
    writeAll(tmp, r.files, FILES);
    for (const f of ["books.json", "purchases.json"]) if (fs.existsSync(path.join(store, f))) fs.copyFileSync(path.join(store, f), path.join(tmp, f));
    return { preview: true, changed: r.changed, report: r.report, check: reconcile(data, tmp, r, SHOP) };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

function apply(data, store, SHOP) {
  const r = plan(data, store);
  if (r.error) return r;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(store, "backups", `before-mbb-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of [...FILES.map((x) => `${x}.json`), META]) if (fs.existsSync(path.join(store, f))) fs.copyFileSync(path.join(store, f), path.join(dir, f));
  writeAll(store, r.files, r.changed); // each file is written whole or not at all (lib/jsonstore.js)
  writeJson(path.join(store, META), { appliedAt: new Date().toISOString(), exportStarted: data.started || null, exportDone: data.done || null, backup: path.relative(store, dir) });
  return { preview: false, changed: r.changed, backup: dir, report: r.report, check: reconcile(data, store, r, SHOP) };
}

// A readable report for the CLI and the portal.
function text(res) {
  const R = res.report, C = res.check, L = [];
  const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
  const clash = R.bills.numberClashWithOurs;
  if (clash.length) L.push(`⚠ ${clash.length} of our bills share a number with myBillBook: ${clash.join(", ")}. Both are kept (issued bills are never renumbered); find them by date and party.`);
  L.push(res.preview ? "PREVIEW: nothing written." : `APPLIED. Copies of the files before: ${res.backup}`);
  L.push(`Files that change: ${res.changed.join(", ") || "none"}`);
  L.push(`Items: ${R.items.inExport} in myBillBook. Matched ${R.items.matchedById} by id, ${R.items.matchedByBarcode} by barcode, ${R.items.matchedByKey} by import key, ${R.items.matchedByName} by name. New ${R.items.created}, updated ${R.items.updated}, unchanged ${R.items.unchanged}. Ours not in myBillBook: ${R.items.ourItemsNotInMbb} (${R.items.websiteItemsNotInMbb.length} on the website, kept).`);
  for (const [k, v] of Object.entries(R.items.flags)) if (v.length) L.push(`  ${k}: ${v.length}${v.length ? ` e.g. ${v.slice(0, 4).join(" | ")}` : ""}`);
  L.push(`Parties: ${R.parties.inExport} contacts. New ${R.parties.created}, merged into ours ${R.parties.merged}, updated ${R.parties.updated}, unchanged ${R.parties.unchanged}. Same mobile, merged: ${R.parties.mergedSamePhone.length} groups. Opening changed on ours: ${R.parties.openingChanged.length}.`);
  L.push(`Bills: ${R.bills.inExport} (${R.bills.cancelled} cancelled). New ${R.bills.created}, updated ${R.bills.updated}, unchanged ${R.bills.unchanged}, kept ours ${R.bills.skippedLocal.length}. No detail: ${R.bills.noDetail.length}. Numbers used twice in myBillBook: ${R.bills.duplicateNumbersInMbb.join(", ") || "none"}. Same number as a bill made here: ${R.bills.numberClashWithOurs.join(", ") || "none"}.`);
  L.push(`Payments: ${R.payments.inExport}. New ${R.payments.created}, updated ${R.payments.updated}, unchanged ${R.payments.unchanged}. Not linked to a bill in the export: ${R.payments.notLinkedToBills}.`);
  L.push(`Credit notes: ${R.creditNotes.inExport} (new ${R.creditNotes.created}, refunds as payment out ${R.creditNotes.refunds}). Expenses: ${R.expenses.inExport} (new ${R.expenses.created}).`);
  if (Object.keys(R.notImported).length) L.push(`NOT imported (no importer yet): ${JSON.stringify(R.notImported)}`);
  if (R.inOursNotInExport.bills || R.inOursNotInExport.payments) L.push(`Imported before but missing from this export (left as they are): ${R.inOursNotInExport.bills} bills, ${R.inOursNotInExport.payments} payments.`);
  for (const w of R.warnings) L.push(`WARNING: ${w}`);
  L.push("");
  L.push(`Party balances matching myBillBook: ${C.partyBalances.matched}/${C.partyBalances.contacts}.`);
  for (const w of C.partyBalances.worst) L.push(`  ${w.party} ${w.phone}: myBillBook ${inr(w.mbb)}, ours ${inr(w.ours)} (${w.diff > 0 ? "+" : ""}${w.diff})`);
  L.push("Sales by month (cancelled left out):  month | myBillBook bills ₹ | ours (imported) bills ₹ | ours all sources ₹");
  for (const m of C.salesByMonth) L.push(`  ${m.month} | ${m.mbbBills} ${inr(m.mbb)} | ${m.oursBills} ${inr(m.ours)} | ${inr(m.oursAllSources)}${Math.abs(m.mbb - m.ours) > 0.01 ? "  <-- differs" : ""}`);
  L.push(`  Total: myBillBook ${inr(C.salesTotal.mbb)}, ours ${inr(C.salesTotal.ours)}`);
  L.push(`Received: at sale myBillBook ${inr(C.received.mbbAtSale)} / ours ${inr(C.received.oursAtSale)}; payments in ${inr(C.received.mbbPaymentsIn)} / ${inr(C.received.oursPaymentsIn)}; total ${inr(C.received.mbbTotal)} / ${inr(C.received.oursTotal)}`);
  const S = C.stock;
  L.push(`Stock pieces: myBillBook ${S.mbbPieces}, ours (his items) ${S.oursPiecesMbbItems}, ours all items ${S.oursPiecesAll}.`);
  L.push(`Stock value at selling price: from the export ${inr(S.mbbValueAtSellingPrice)}, ours ${inr(S.oursValueAtSellingPrice)} (${inr(S.oursValueAtSellingPriceNoNegatives)} without negative counts; all items incl. website-only ${inr(S.oursValueAllItems)}). His myBillBook dashboard said ${inr(S.mbbDashboardSaid)}.`);
  L.push(`Dashboard after import: to collect ${inr(C.dashboard.toCollect)}, to pay ${inr(C.dashboard.toPay)}, cash ${inr(C.dashboard.cash)}, bank ${inr(C.dashboard.bank)}, stock at cost ${inr(C.dashboard.stockAtCost)}.`);
  L.push(`Next bill number: ${C.nextBillNumber}`);
  return L.join("\n");
}

module.exports = { plan, preview, apply, text, check, FILES };

if (require.main === module) {
  const [file, store] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!file || !store) { console.error("Usage: node lib/import-mbb.js <export.json> <DATA_DIR> [--apply] [--json]"); process.exit(2); }
  const SHOP = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "shop.json"), "utf8"));
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const res = process.argv.includes("--apply") ? apply(data, path.resolve(store), SHOP) : preview(data, path.resolve(store), SHOP);
  if (res.error) { console.error(res.error); process.exit(1); }
  console.log(process.argv.includes("--json") ? JSON.stringify(res, null, 2) : text(res));
}
