// The full myBillBook import (lib/import-mbb.js): items, parties, bills, payments, notes, expenses,
// merged into a shop that already has website items, stock from the old CSV import and its own bills.
// Then the real server and a real Chrome: scanning one of his 12-digit codes at the counter (keys + Enter,
// as a scanner types them) and his codes on printed labels. `node tests/import-mbb.mjs`
// MBB_EXPORT=/path/to/export.json also runs the same checks on a real export (counts only).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..");
const mbb = require("../lib/import-mbb.js");
const SHOP = JSON.parse(fs.readFileSync(path.join(ROOT, "shop.json"), "utf8"));
const PORT = 4000 + Math.floor(Math.random() * 900), DEBUG = 9000 + Math.floor(Math.random() * 900);
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, passes = 0;
const ok = (c, m) => { c ? passes++ : fails++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, `${f}.json`), "utf8"));

// ---- A small export shaped exactly like his (field names copied from the real file) ----
const item = (id, name, sku, quantity, price, cost, mrp, extra = {}) => ({ id, name, sku_code: sku, quantity, unit: "PCS", mrp, item_type: "good", item_category_name: "", description: "", created_at: "2026-01-02 10:00:00.000", sales_info: { price_per_unit: price }, purchase_info: { price_per_unit: cost }, ...extra });
const contact = (id, name, mobile, balance, extra = {}) => ({ id, name, mobile_number: mobile, company_contact_type: "customer", opening_balance: "0.0", balance: String(balance), credit_period: 7, credit_limit: "0.0", billing_address: { street_address: null }, shipping_address: {}, gst_number: null, email: null, created_at: "2026-01-01T10:00:00.000+05:30", ...extra });
const line = (it, qty, price, disc = 0) => ({ id: it.id, sku_code: it.sku_code, name: it.name + " ", quantity: `${qty}.0`, price_per_unit: `${price}.0`, mrp: `${it.mrp}.0`, discount: `${disc}`, discount_type: "amount", discount_amount: `${disc}`, item_final_amount: `${qty * price - disc}`, unit: "PCS", purchase_info: { price_per_unit: `${it.purchase_info.price_per_unit}` } });
function bill(id, no, day, contactId, lines, { credit = false, received, mode = "in_cash", charges = [], discount = 0, roundOff = 0, cancelled = false, updated, note } = {}) {
  const total = lines.reduce((n, l) => n + Number(l.item_final_amount), 0) + charges.reduce((n, c) => n + c.charge, 0) - discount + roundOff;
  const detail = { id, invoice_number: no, prefix: "", invoice_date: day, contact_id: contactId, items: lines, additional_charges: charges.map((c) => ({ name: c.name, charge_type: "amount", charge: `${c.charge}.0` })),
    discount: `${discount}.0`, discount_type: "amount", round_off: `${roundOff}.0`, total_amount: `${total}.0`, payment_type: credit ? "credit" : "cash", payment_mode: mode,
    initial_payment_amount: `${credit ? received || 0 : total}.0`, remaining_amount: `${credit ? total - (received || 0) : 0}.0`, customer_notes: note || null, status: "final", tnc: "1. Goods once sold will not be taken back or exchanged",
    ...(cancelled ? { cancelled_at: `${day}T19:25:44.675+05:30`, cancellation_reason: "Order Cancelled" } : { created_at: `${day}T15:20:39.293+05:30`, updated_at: updated || `${day}T15:20:39.293+05:30` }) };
  const voucher = cancelled ? { id, invoice_number: no, invoice_date: day, contact_id: contactId, cancelled_at: detail.cancelled_at } : { id, invoice_number: no, invoice_date: day, contact_id: contactId, amount: `${total}.0`, status: "final" };
  return { voucher, detail };
}
function exportV1() {
  const I = {
    jacket: item("it-jacket", "-30 combodian house outwear jacket new", "934911410459", 12, 2700, 1770, 37000),
    zeus: item("it-zeus", "404 passion zeus", "134601096127", 37, 300, 150, 999),
    acqua: item("it-acqua", "Acqua di Giò - 100 ml", "", 2, 3000, 0, null),
    adidas: item("it-adidas", "ADIDAS T.SHIRTS", "212257438475", 4, 499, 220, 3700),
    celio: item("it-celio", "CELIO JEANS", "700507061119", 3, 899, 510, 8900, { item_category_name: "jeans" }),
    jeans: item("it-jeans", "157 jeans", "956785429164", -2, 850, 600, 4100),
    junk: item("it-junk", "296707058704", "", 1, 0, 0, null),
  };
  const C = {
    zaid: contact("c-zaid", "Zaid ", "7006306036", 0), // set below once the bills are known
    mun1: contact("c-mun1", "Muntaza ", "9419071993", -1599, { created_at: "2026-01-01T09:00:00.000+05:30" }),
    mun2: contact("c-mun2", "muntaza k", "9419071993", 0),
    sup: { ...contact("c-sup", "Saqlain", "9541985339", 0, { opening_balance: "3547.0" }), company_contact_type: "supplier" },
    nophone: contact("c-gym", "DOWNTOWN GYM", null, 700),
  };
  const B = [
    bill("b-1", "7735", "2026-10-30", "c-zaid", [line(I.jacket, 1, 2700, 400)], { mode: "upi" }),
    bill("b-2", "7736", "2026-11-01", "c-zaid", [line(I.zeus, 2, 300)], { cancelled: true }),
    bill("b-3", "7737", "2026-11-02", "c-zaid", [line(I.celio, 1, 899), line(I.adidas, 2, 499)], { credit: true, received: 200, charges: [{ name: "Uspa sweater ", charge: 799 }], discount: 97, note: "half paid" }),
    bill("b-4", "7738", "2026-11-03", "c-gym", [line(I.acqua, 1, 3000)], { credit: true, received: 0, roundOff: -2300 }),
    bill("b-5", "897", "2026-03-15", "c-mun1", [line(I.zeus, 1, 300)]),
    bill("b-6", "897", "2026-03-15", "c-mun2", [line(I.zeus, 1, 300)]), // he used 897 twice
  ];
  // Zaid: bill 3 owes 899+998+799-97-200 = 2399; minus a 300 payment = 2099.
  C.zaid.balance = "2099.0";
  return {
    started: "2026-11-10T12:27:06.122Z", done: "2026-11-10T12:40:13.743Z", errors: [],
    items: Object.values(I), contacts: Object.values(C),
    vouchers: {
      sales_invoice: B.map((b) => b.voucher),
      payment_in: [
        { id: "p-1", serial_number: "29", invoice_number: "29", invoice_date: "2026-11-07", amount: "300.0", payment_mode: "cash", contact_id: "c-zaid", notes: "", created_at: "2026-11-07T17:50:49.667+05:30", txn_ledgers: [] },
        { id: "p-2", serial_number: "28", invoice_number: "28", invoice_date: "2026-11-04", amount: "1599.0", payment_mode: "upi", contact_id: "c-mun1", notes: "advance", created_at: "2026-11-04T17:48:24.784+05:30", txn_ledgers: [] },
        { id: "p-3", serial_number: "14", invoice_number: "14", invoice_date: "2026-08-30", amount: "3547.0", payment_mode: "cash", contact_id: "c-sup", notes: "", created_at: "2026-08-30T12:50:04.000+05:30", txn_ledgers: [] },
      ],
      credit_note: [{ id: "cn-1", serial_number: "1", invoice_number: "1", invoice_date: "2026-03-15", amount: "300.0", initial_payment_amount: "300.0", payment_mode: "in_cash", contact_id: "c-mun1", notes: "", created_at: "2026-03-15T18:00:00.000+05:30", status: "final" }],
      expense: [{ id: "e-1", serial_number: "1", invoice_number: "1", invoice_date: "2026-09-07", amount: "850.0", payment_mode: "in_cash", ledger_category_name: "Personal expenses ", txn_ledgers: [{ name: "Shoes for personal " }], created_at: "2026-09-07T07:18:50.756+05:30" }],
      sales_return: [], payment_out: [], purchase_invoice: [],
    },
    invoiceDetails: Object.fromEntries(B.map((b) => [b.detail.id, b.detail])),
  };
}

// ---- The shop as it is now: website items, CSV-imported stock, a linked item, a held item, its own bill ----
function seed(dir) {
  fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
  fs.writeFileSync(path.join(dir, "uploads", "w1.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
  const now = "2026-11-06T10:00:00.000Z";
  const P = [
    { id: "web001", code: "4795", name: "Canada-style -30 Parka", category: "Clothing", subcategory: "Puffer", sizes: "M · L", sizeStock: { M: 2, L: 3 }, image: "/uploads/w1.png", images: ["/uploads/w1.png"], price: 2999, mrp: 37000, quantity: 5, status: "available", featured: true, wardrobe: true, importKey: "934911410459", barcode: "934911410459", cost: 1770, createdAt: now },
    { id: "web002", code: "5100", name: "Adidas Tee (white)", brand: "Adidas", category: "Clothing", image: "/uploads/w1.png", price: 549, quantity: 1, status: "available", createdAt: now },
    { id: "web003", code: "6200", name: "Website Only Sneaker", category: "Footwear", image: "/uploads/w1.png", price: 4999, quantity: 1, status: "available", createdAt: now },
    { id: "mbbaaaaaaaaaaaa", code: "7300", importKey: "134601096127", hidden: true, name: "404 passion zeus", category: "Clothing", image: null, barcode: "134601096127", cost: 200, price: 300, quantity: 40, status: "available", createdAt: now },
    { id: "mbbcccccccccccc", code: "7500", importKey: "name:acqua di gi 100 ml#1", hidden: true, name: "Acqua di Giò - 100 ml", category: "Fragrances", image: null, barcode: "", price: 3000, quantity: 0, status: "sold", createdAt: now },
    { id: "mbbdddddddddddd", code: "7700", importKey: "212257438475", hidden: true, name: "ADIDAS T.SHIRTS", category: "Clothing", image: null, barcode: "212257438475", price: 499, quantity: 9, status: "available", createdAt: now },
    { id: "web004", code: "7600", name: "157 Jeans", category: "Clothing", image: "/uploads/w1.png", price: 850, quantity: 1, status: "hold", holdFor: "VX-2001", importKey: "956785429164", barcode: "956785429164", createdAt: now },
  ];
  fs.writeFileSync(path.join(dir, "products.json"), JSON.stringify(P));
  fs.writeFileSync(path.join(dir, "parties.json"), JSON.stringify([{ id: "aaaabbbbccccdddd", type: "customer", name: "Zaid counter", phone: "7006306036", gstin: "", address: "", opening: 0, creditLimit: 0, notes: "", birthday: "", createdAt: now }]));
  fs.writeFileSync(path.join(dir, "invoices.json"), JSON.stringify([{ id: "1111222233334444", number: "7651", kind: "cash-memo", at: now, source: "website", order: "VX-1999", partyId: null, customer: { name: "Web buyer", phone: "", address: "", gstin: "" }, payment: "upi", note: "", lines: [{ productId: "web003", code: "6200", name: "Website Only Sneaker", sizes: "", qty: 1, mrp: null, listPrice: 4999, cost: null, unit: 4999, disc: 0, amount: 4999, gstRate: 0, taxable: 4999, tax: 0 }], charges: [], paid: 4999, taxable: 4999, tax: 0, total: 4999, status: "paid" }]));
  fs.writeFileSync(path.join(dir, "orders.json"), JSON.stringify([{ id: "1234567890abcdef", code: "VX-2001", status: "paid", createdAt: now, paidAt: new Date().toISOString(), name: "Rayees", phone: "9622123456", productId: "web004", productName: "157 Jeans", amount: 850, qty: 1 }]));
}

// ---- Reads a Code 128 SVG from owner/code128.js back into its text, like a scanner would ----
const P128 = /"([\d ]+)"\.split/.exec(fs.readFileSync(path.join(ROOT, "owner", "code128.js"), "utf8"))[1].split(" ");
function decode128(svg, unit = 1.4) {
  const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="0" width="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const w = [];
  rects.forEach(([x, wd], i) => { w.push(Math.round(wd / unit)); if (i < rects.length - 1) w.push(Math.round((rects[i + 1][0] - x - wd) / unit)); });
  const vals = [];
  for (let i = 0; i + 6 <= w.length; i += 6) {
    if (i + 7 === w.length) { if (w.slice(i).join("") !== "2331112") return null; break; }
    const v = P128.indexOf(w.slice(i, i + 6).join(""));
    if (v < 0) return null;
    vals.push(v);
  }
  const check = vals.pop();
  if (vals.reduce((s, v, i) => s + v * (i || 1), 0) % 103 !== check) return null;
  let set = vals[0] === 105 ? "C" : vals[0] === 104 ? "B" : null, out = "";
  for (const v of vals.slice(1)) {
    if (v === 99) set = "C"; else if (v === 100) set = "B";
    else out += set === "C" ? String(v).padStart(2, "0") : String.fromCharCode(v + 32);
  }
  return out;
}
const sandbox = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(ROOT, "owner", "code128.js"), "utf8"), sandbox);
const code128 = sandbox.window.code128;

const work = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-mbb-test-"));
const procs = [];
try {
  // ======== Library ========
  const dir = path.join(work, "store"); fs.mkdirSync(dir); seed(dir);
  const before = fs.readFileSync(path.join(dir, "products.json"), "utf8");
  const pv = mbb.preview(exportV1(), dir, SHOP);
  ok(pv.preview && fs.readFileSync(path.join(dir, "products.json"), "utf8") === before && !fs.existsSync(path.join(dir, "payments.json")), "preview writes nothing");
  ok(pv.check.partyBalances.matched === 5 && pv.check.partyBalances.contacts === 5, `preview: every party balance matches myBillBook (${pv.check.partyBalances.matched}/5)`);
  ok(mbb.check({ items: [] }) && mbb.preview({ foo: 1 }, dir, SHOP).error, "a file that isn't an export is refused");

  const res = mbb.apply(exportV1(), dir, SHOP);
  const P = read(dir, "products"), byId = (id) => P.find((p) => p.id === id);
  ok(fs.existsSync(path.join(res.backup, "products.json")) && fs.readFileSync(path.join(res.backup, "products.json"), "utf8") === before, "a copy of every file is kept before writing");
  const web1 = byId("web001");
  ok(web1.mbbId === "it-jacket" && web1.name === "Canada-style -30 Parka" && web1.quantity === 12 && web1.price === 2999 && web1.mbbPrice === 2700 && web1.cost === 1770, "linked website item: myBillBook stock and cost; website name and price kept, his price in mbbPrice");
  ok(res.report.items.flags.websitePriceDifferent.some((x) => /4795.*2999.*2700/.test(x)), "the website/myBillBook price difference is reported");
  ok(read(dir, "products").find((p) => p.id === "mbbdddddddddddd").price === 499 && read(dir, "products").find((p) => p.id === "mbbaaaaaaaaaaaa").price === 300, "items off the website take myBillBook's price");
  ok(web1.image && web1.featured && web1.wardrobe && web1.subcategory === "Puffer" && web1.sizeStock && web1.images.length === 1 && !web1.hidden, "linked website item keeps its photos, flags and sizes");
  ok(byId("mbbaaaaaaaaaaaa").mbbId === "it-zeus" && byId("mbbaaaaaaaaaaaa").quantity === 37 && byId("mbbaaaaaaaaaaaa").cost === 150, "CSV-imported item matched by barcode and updated");
  ok(byId("mbbcccccccccccc").mbbId === "it-acqua" && byId("mbbcccccccccccc").quantity === 2 && byId("mbbcccccccccccc").cost === undefined, "item without a barcode matched by the old import's name key; a ₹0 purchase price isn't taken as a cost");
  ok(byId("mbbdddddddddddd").mbbId === "it-adidas" && byId("web002").mbbId === undefined, "barcode match beats a look-alike website name");
  const celio = P.find((p) => p.mbbId === "it-celio");
  ok(celio && celio.hidden && celio.barcode === "700507061119" && celio.quantity === 3 && celio.mbbCategory === "jeans" && /^\d{4}$/.test(celio.code), "new item comes in hidden, with his barcode and a counter code");
  const held = byId("web004");
  ok(held.status === "hold" && held.holdFor === "VX-2001" && held.quantity === 1 && held.needsCount, "a held piece keeps its hold when myBillBook shows it below 1");
  const junk = P.find((p) => p.mbbId === "it-junk");
  ok(junk.needsName && junk.needsPrice && junk.hidden, "barcode-as-name item with no price comes in flagged");
  ok(byId("web003") && P.length === 9, "website-only item kept, nothing deleted, no duplicates");
  ok(res.report.items.flags.negativeStock.length === 1 && res.report.items.flags.noPrice.length === 1, "negative stock and missing price are reported");

  const parties = read(dir, "parties");
  const zaid = parties.find((p) => p.phone === "7006306036");
  ok(parties.filter((p) => p.phone === "7006306036").length === 1 && zaid.id === "aaaabbbbccccdddd" && zaid.name === "Zaid counter" && zaid.mbbIds[0] === "c-zaid", "a party already here merges by mobile number");
  ok(parties.filter((p) => p.phone === "9419071993").length === 1 && parties.find((p) => p.phone === "9419071993").mbbIds.length === 2, "two myBillBook contacts with one mobile become one party");
  ok(parties.find((p) => p.name === "Saqlain").type === "supplier" && parties.find((p) => p.name === "Saqlain").opening === 3547, "supplier with its opening balance");
  ok(parties.find((p) => p.name === "DOWNTOWN GYM") && parties.length === 4, "contact without a mobile stays its own party");

  const inv = read(dir, "invoices");
  const n = (no) => inv.filter((x) => x.number === no);
  ok(inv.length === 7 && inv.filter((x) => x.source === "mybillbook").length === 6, "all bills imported once, ours kept");
  ok(n("7736")[0].status === "cancelled" && n("7736")[0].mbbCancelled, "cancelled bill comes in cancelled");
  const b3 = n("7737")[0];
  ok(b3.total === 2399 + 200 && b3.paid === 200 && b3.payment === "credit" && b3.partyId === zaid.id && b3.note === "half paid", "credit bill: total, part paid, party, note");
  ok(b3.charges.some((c) => c.label === "Uspa sweater" && c.amount === 799) && b3.charges.some((c) => c.label === "Discount" && c.amount === -97), "extra charges and the bill discount are on the bill");
  ok(b3.lines[0].productId === celio.id && b3.lines[0].code === celio.code && b3.lines[1].productId === "mbbdddddddddddd" && b3.lines[1].qty === 2, "bill lines point at our items");
  ok(n("7735")[0].lines[0].disc === 400 && n("7735")[0].lines[0].amount === 2300 && n("7735")[0].payment === "upi" && n("7735")[0].lines[0].productId === "web001", "line discount and UPI payment kept");
  ok(new Date(n("7735")[0].at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }).includes("15:20"), "bill keeps the time it was made");
  ok(n("897").length === 2, "his duplicate number 897 is kept on both bills (reported)");
  ok(res.report.bills.duplicateNumbersInMbb.includes("897"), "duplicate number reported");
  ok(byId("mbbaaaaaaaaaaaa").quantity === 37 && web1.quantity === 12, "importing bills didn't move stock");
  const pays = read(dir, "payments");
  ok(pays.length === 4 && pays.find((p) => p.mbbId === "p-2").mode === "upi" && pays.find((p) => p.mbbId === "p-1").number === "RCPT/26-27/0029", "payments in, with mode and his number");
  ok(pays.find((p) => p.mbbId === "refund:cn-1")?.direction === "out" && read(dir, "returns")[0].kind === "credit_note", "credit note and its cash refund");
  ok(read(dir, "expenses")[0].amount === 850 && read(dir, "expenses")[0].note.includes("Shoes"), "expense");
  ok(res.check.partyBalances.matched === 5, `after apply, the shop's own ledger code agrees on every balance (${res.check.partyBalances.matched}/5)`);
  ok(res.check.salesTotal.mbb === res.check.salesTotal.ours, `sales total ours = myBillBook (${res.check.salesTotal.ours})`);
  ok(res.check.nextBillNumber === "7739", "next bill number is 7739");

  // Run again with the same file: nothing changes.
  const again = mbb.apply(exportV1(), dir, SHOP);
  ok(again.changed.length === 0 && read(dir, "invoices").length === 7 && read(dir, "parties").length === 4 && read(dir, "payments").length === 4, "running it twice changes nothing");

  // A newer export: one bill edited in myBillBook, one new bill, one new payment, a stock change.
  // A bill cancelled here meanwhile stays cancelled.
  const local = read(dir, "invoices"); local.find((x) => x.number === "7735").status = "cancelled"; fs.writeFileSync(path.join(dir, "invoices.json"), JSON.stringify(local));
  const v2 = exportV1();
  v2.items.find((i) => i.id === "it-celio").quantity = 1;
  const nb = bill("b-7", "7739", "2026-11-10", "c-gym", [line(v2.items.find((i) => i.id === "it-celio"), 2, 899)]);
  v2.vouchers.sales_invoice.push(nb.voucher); v2.invoiceDetails["b-7"] = nb.detail;
  v2.invoiceDetails["b-5"].customer_notes = "edited later"; v2.invoiceDetails["b-1"].customer_notes = "edited there";
  v2.vouchers.payment_in.push({ id: "p-4", serial_number: "30", invoice_number: "30", invoice_date: "2026-11-10", amount: "700.0", payment_mode: "cash", contact_id: "c-gym", notes: "", created_at: "2026-11-10T11:00:00.000+05:30", txn_ledgers: [] });
  v2.contacts.find((c) => c.id === "c-gym").balance = "0.0"; // the new bill was paid in cash, the 700 owed came in
  const r2 = mbb.apply(v2, dir, SHOP);
  const inv2 = read(dir, "invoices");
  ok(r2.report.bills.created === 1 && r2.report.bills.updated === 1 && inv2.length === 8 && inv2.find((x) => x.number === "897" && x.mbbId === "b-5").note === "edited later", "newer export: the new bill is added, the edited bill is updated");
  ok(inv2.find((x) => x.number === "7735").status === "cancelled" && r2.report.bills.skippedLocal.includes("7735"), "a bill cancelled here isn't brought back");
  ok(read(dir, "payments").length === 5 && read(dir, "products").find((p) => p.mbbId === "it-celio").quantity === 1, "new payment added, stock updated");
  ok(r2.check.nextBillNumber === "7740", "numbering follows his newest bill");

  // A bill made here with a number myBillBook also used: both kept, warned at the top, next number past both.
  const cdir = path.join(work, "clash"); fs.mkdirSync(cdir); seed(cdir);
  const cinv = read(cdir, "invoices"); cinv.push({ ...cinv[0], id: "5555666677778888", number: "7741", at: "2026-11-09T10:00:00.000Z" }, { ...cinv[0], id: "9999aaaabbbbcccc", number: "7737", at: "2026-11-09T11:00:00.000Z" });
  fs.writeFileSync(path.join(cdir, "invoices.json"), JSON.stringify(cinv));
  const cp = mbb.preview(exportV1(), cdir, SHOP), ctext = mbb.text(cp);
  ok(ctext.startsWith("⚠ 1 of our bills share a number with myBillBook: 7737"), "a number clash is the first line of the report");
  ok(cp.check.nextBillNumber === "7742", "next number is past every bill, ours included");
  fs.writeFileSync(path.join(work, "export-v1.json"), JSON.stringify(exportV1()));

  // ======== Server and portal ========
  const srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ORDER_HOURS: "0-24", OWNER_KEY: "k", WA_TOKEN: "", ANTHROPIC_API_KEY: "", PUBLIC_URL: "" }, stdio: "ignore" });
  procs.push(srv);
  for (let i = 0; i < 80; i++) { try { await fetch(base + "/api/products"); break; } catch { await sleep(100); } }
  const call = async (p, body, h = { "x-owner-key": "k" }) => { const r = await fetch(`${base}/api/billing/${p}`, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...h }, ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json().catch(() => null) }; };
  await call("staff", { name: "Asif", pin: "4321" });
  const S = { "x-session": (await call("login", { name: "Asif", pin: "4321" }, {})).body.token };
  ok((await call("import-mbb", exportV1(), S)).status === 403, "staff can't import");
  ok((await call("import-mbb", exportV1(), {})).status === 401, "no key, no import");
  ok((await call("import-mbb", "{not json", undefined)).status === 400, "a broken file is refused");
  const big = await call("import-mbb", JSON.stringify({ ...v2, pad: "x".repeat(14 * 1024 * 1024) }));
  ok(big.status === 200 && big.body.preview && big.body.changed.length === 0 && /Party balances matching myBillBook: 5\/5/.test(big.body.text), "owner preview of a 14 MB file over the route: nothing to change, balances match");
  const sold = await call("invoices", { lines: [{ productId: celio.id, qty: 1 }], payment: "cash" });
  ok(sold.status === 200 && sold.body.invoice.number === "7740", "a new bill made here continues his numbering");
  const page = await fetch(`${base}/bill/${inv2.find((x) => x.number === "7737").id}`).then((r) => r.text());
  ok(/7737/.test(page) && /Uspa sweater/.test(page) && /CELIO JEANS/.test(page), "an imported bill reprints");
  ok(/Discount<\/span><span>−₹97</.test(page), "the bill discount prints as −₹97");
  ok(/Goods once sold will not be taken back/.test(page) && !/vibexindia\.com\/returns/.test(page), "the reprint carries his myBillBook terms, not today's");
  const cashNow = (await call("cash")).body;
  ok(cashNow.cash === 899 && cashNow.bank === 4999 && cashNow.rows.length === 2 && cashNow.rows.every((r) => ["7740", "7651"].includes(r.ref)), `cash book starts at the import: only bills made here count (the website's ₹4,999 UPI and the new ₹899 cash) (cash ₹${cashNow.cash}, bank ₹${cashNow.bank}, ${cashNow.rows.length} row)`);
  const dashNow = (await call("dashboard")).body;
  ok(dashNow.setOpening === true, "dashboard asks for today's cash and bank");
  const cashRep = (await call("reports/cash?from=2025-01-01&to=2026-12-31")).body;
  ok(cashRep.rows.some((r) => r.ref === "7737") && cashRep.rows.some((r) => r.ref === "RCPT/26-27/0029"), "the all-payments report still lists the myBillBook history");
  const sales = (await call("reports/sales?from=2025-01-01&to=2026-12-31")).body;
  ok(sales.rows.filter((r) => r.from === "mybillbook").length === 5, "sales report includes the imported bills");
  ok((await call("cash/opening", { openingCash: 5000, openingBank: 1000 })).status === 200 && (await call("dashboard")).body.setOpening === false && (await call("cash")).body.cash === 5899, "once cash and bank are set, the prompt goes and the new bill adds to them");
  const led = (await call(`parties/${zaid.id}/ledger`)).body;
  ok(led.balance === 2099 && led.rows.some((r) => r.ref === "7737"), "Zaid's ledger shows the imported bill and his myBillBook balance");

  // Labels print his codes, and the bars read back as the same digits.
  for (const c of ["934911410459", "700507061119", "90111584820", "9062173753"]) ok(decode128(code128(c)) === c, `Code 128 label for ${c} scans as ${c}`);

  // The counter, driven like a person with a scanner: digits typed as keys, then Enter.
  async function browser({ width, height, mobile }, port) {
    const prof = fs.mkdtempSync(path.join(work, "chrome-"));
    const proc = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
    procs.push(proc);
    let tgt; for (let i = 0; i < 100 && !tgt; i++) { try { tgt = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {} await sleep(100); }
    const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
    let id = 0; const wait = new Map(), errors = [];
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id) { wait.get(d.id)?.(d.result ?? d); wait.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
    const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await cdp("Page.enable"); await cdp("Runtime.enable");
    await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    if (mobile) await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    const js = async (e) => (await cdp("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
    const until = async (e, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(e)) return true; await sleep(70); } return false; };
    const tap = async (sel) => {
      const p = await js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.getClientRects().length);if(!e)return{miss:1};e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,t=document.elementFromPoint(x,y);return{x,y,ok:!!t&&(t===e||e.contains(t)||t.contains(e)),top:t&&t.tagName+'.'+t.className}})()`);
      if (p.miss) { ok(false, `nothing to tap: ${sel}`); return false; }
      if (!p.ok) { ok(false, `${sel} is covered by ${p.top}`); return false; }
      if (mobile) { await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y }] }); await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }
      else { await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }); await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 }); await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 }); }
      await sleep(180); return true;
    };
    // A scanner: one key event per digit, fast, then Enter.
    const scan = async (digits) => {
      for (const c of digits) { const k = { key: c, code: `Digit${c}`, windowsVirtualKeyCode: 48 + Number(c) }; await cdp("Input.dispatchKeyEvent", { type: "keyDown", ...k, text: c }); await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...k }); }
      const e = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 };
      await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", ...e }); await cdp("Input.dispatchKeyEvent", { type: "char", ...e, text: "\r" }); await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...e });
      await sleep(250);
    };
    const nav = async (u) => { await cdp("Page.navigate", { url: u }); await until(`document.readyState==='complete'&&!!window.VX&&!document.getElementById('app').classList.contains('hide')`); await sleep(400); };
    const close = () => { ws.close(); proc.kill(); };
    return { js, until, tap, scan, nav, cdp, errors, close };
  }
  // Settings import box on the clash shop: preview, then three taps because of the clash.
  {
    const CP = PORT + 1;
    const s2 = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, PORT: String(CP), DATA_DIR: cdir, OWNER_KEY: "k", WA_TOKEN: "", ANTHROPIC_API_KEY: "", PUBLIC_URL: "" }, stdio: "ignore" });
    procs.push(s2);
    for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${CP}/api/products`); break; } catch { await sleep(100); } }
    const d = await browser({ width: 1280, height: 800, mobile: false }, DEBUG + 2);
    await d.nav(`http://127.0.0.1:${CP}/billing?key=k#/settings`);
    await d.until(`!!document.getElementById('mbbFile')`);
    const doc = await d.cdp("DOM.getDocument"), node = await d.cdp("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#mbbFile" });
    await d.cdp("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [path.join(work, "export-v1.json")] });
    ok(await d.until(`/^⚠ 1 of our bills share a number/.test(document.getElementById('mbbReport').textContent)`, 15000), "Settings: preview shows the clash warning first");
    await d.tap("#mbbApply"); await d.tap("#mbbApply");
    ok(/clash/.test(await d.js(`document.getElementById('mbbApply').textContent`)) && read(cdir, "invoices").length === 3, "Settings: two taps aren't enough when numbers clash; nothing written yet");
    await d.tap("#mbbApply");
    ok(await d.until(`/APPLIED/.test(document.getElementById('mbbReport').textContent)`, 15000) && read(cdir, "invoices").length === 9, "Settings: the third tap imports");
    ok(!d.errors.length, `Settings import: no page errors ${d.errors[0] || ""}`);
    d.close();
  }
  for (const dev of [{ width: 1280, height: 800, mobile: false, label: "desktop" }, { width: 390, height: 844, mobile: true, label: "phone" }]) {
    const d = await browser(dev, DEBUG + (dev.mobile ? 1 : 0));
    await d.nav(`${base}/billing?key=k#/new`);
    await d.tap("#q");
    ok(await d.js(`document.activeElement.id==='q'`), `${dev.label}: the search box has the cursor`);
    await d.scan("700507061119");
    ok(await d.until(`/CELIO JEANS/.test(document.getElementById('cart').textContent)`), `${dev.label}: scanning his 12-digit code adds the imported item to the bill`);
    ok(await d.js(`document.getElementById('q').value===''`), `${dev.label}: the box is clear for the next scan`);
    await d.scan("134601096127");
    ok(await d.until(`/404 passion zeus/.test(document.getElementById('cart').textContent)`), `${dev.label}: a second scan adds the CSV-matched item`);
    await d.scan("934911410459");
    ok(await d.until(`/Canada-style -30 Parka/.test(document.getElementById('cart').textContent)`), `${dev.label}: scanning the linked website item's code finds it`);
    // Labels for the imported item: the printed bars read back as his code.
    await d.cdp("Page.navigate", { url: `${base}/billing/labels?items=${celio.id}:1` });
    await d.until(`!!document.querySelector('#sheet svg')`);
    const svg = await d.js(`document.querySelector('#sheet svg').outerHTML`);
    ok(decode128(svg) === "700507061119" && /700507061119/.test(await d.js(`document.querySelector('#sheet .code').textContent`)), `${dev.label}: the label page prints his code and its bars scan back to it`);
    await d.nav(`${base}/billing#/bills`);
    await d.until(`document.querySelectorAll('#billRows tr[data-bill]').length>0`);
    ok(await d.js(`[...document.querySelectorAll('#billRows .src')].some(e=>e.textContent==='myBillBook')&&![...document.querySelectorAll('#billRows .src')].some(e=>e.textContent==='mybillbook')`), `${dev.label}: Bills list labels imported bills “myBillBook”`);
    ok(!d.errors.length, `${dev.label}: no page errors${d.errors.length ? `: ${d.errors[0]}` : ""}`);
    d.close();
  }

  // ======== Optional: the real export ========
  if (process.env.MBB_EXPORT) {
    const real = JSON.parse(fs.readFileSync(process.env.MBB_EXPORT, "utf8"));
    const rdir = path.join(work, "real"); fs.mkdirSync(rdir); seed(rdir);
    const t = Date.now(), rr = mbb.apply(real, rdir, SHOP);
    ok(rr.check.partyBalances.matched === real.contacts.length, `real export: ${rr.check.partyBalances.matched}/${real.contacts.length} party balances match (${Date.now() - t} ms)`);
    ok(rr.check.salesTotal.mbb === rr.check.salesTotal.ours, `real export: sales ₹${rr.check.salesTotal.ours} = myBillBook`);
    ok(mbb.apply(real, rdir, SHOP).changed.length === 0, "real export: a second run changes nothing");
  }
} catch (e) { fails++; console.log("FAIL", e.stack); }
finally {
  for (const p of procs) try { p.kill(); } catch {}
  await sleep(400);
  try { fs.rmSync(work, { recursive: true, force: true, maxRetries: 5 }); } catch {}
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
