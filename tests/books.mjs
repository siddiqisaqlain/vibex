// The books: parties, credit, payments, purchases, expenses, cash, profit, and the two failures
// that would hurt most (a damaged file wiping records; cost prices reaching customers).
// Runs the real server. `node tests/books.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 4793;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-books-"));
fs.writeFileSync(path.join(dir, "products.json"), JSON.stringify([
  { id: "a1", code: "4795", name: "North Face Puffer", category: "Clothing", price: 6000, quantity: 2, status: "available", createdAt: new Date().toISOString() },
  { id: "b2", code: "5100", name: "Lattafa Khamrah", category: "Fragrances", price: 2800, quantity: 1, status: "available", createdAt: new Date().toISOString() },
  { id: "h3", code: "6200", name: "Imported No Photo", category: "Clothing", price: 999, quantity: 5, status: "available", hidden: true, createdAt: new Date().toISOString() },
]));
const srv = spawn(process.execPath, ["server.js"], {
  cwd: path.resolve(import.meta.dirname, ".."),
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ORDER_HOURS: "0-24", OWNER_KEY: "k", WA_TOKEN: "", ANTHROPIC_API_KEY: "", PUBLIC_URL: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/products"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
const H = { "Content-Type": "application/json", "x-owner-key": "k" };
const B = "/api/billing";
const get = (p) => fetch(base + B + p, { headers: H }).then((r) => r.json());
const post = async (p, b = {}) => { const r = await fetch(base + B + p, { method: "POST", headers: H, body: JSON.stringify(b) }); return { status: r.status, ...(await r.json()) }; };
const wa = async (text) => (await (await fetch(base + "/api/message", { method: "POST", headers: H, body: JSON.stringify({ text }) })).json()).reply;
let pass = 0; const ok = (n) => { pass++; console.log("  ✓", n); };

try {
  // Suppliers and customers
  let r = await post("/parties", { type: "supplier", name: "Delhi Surplus Traders", phone: "9811111111", gstin: "07ABCDE1234F1Z5" });
  const sup = r.party; assert.ok(sup);
  assert.equal((await post("/parties", { name: "Bad", phone: "123" })).status, 409);
  assert.equal((await post("/parties", { name: "Bad", gstin: "XYZ" })).status, 409);
  assert.equal((await post("/parties", { type: "supplier", name: "Dup", phone: "9811111111" })).status, 409); ok("parties validate mobile, GSTIN and duplicates");

  // Purchase: stock up, cost saved, supplier owed
  r = await post("/purchases", { partyId: sup.id, supplierBill: "DS-77", lines: [{ productId: "a1", qty: 3, cost: 2000, gstRate: 5 }], paid: 1000, mode: "cash" });
  assert.equal(r.status, 200); assert.equal(r.purchase.total, 6300);
  let items = await get("/products"); assert.equal(items.find((p) => p.id === "a1").quantity, 5); assert.equal(items.find((p) => p.id === "a1").cost, 2100);
  let led = await get(`/parties/${sup.id}/ledger`); assert.equal(led.balance, -5300); ok("purchase adds stock, GST goes into cost (no GSTIN), supplier owed the rest");

  // Customers never see cost, and never see hidden items
  const pub = await (await fetch(base + "/api/products")).json();
  assert.ok(pub.every((p) => p.cost === undefined && p.supplierId === undefined)); assert.ok(!pub.some((p) => p.id === "h3"));
  assert.equal((await fetch(`${base}/p/h3`)).status, 404);
  r = await fetch(base + "/api/orders", { method: "POST", headers: H, body: JSON.stringify({ productId: "h3", name: "X", phone: "9000000000", delivery: "pickup" }) });
  assert.equal(r.status, 404); ok("cost prices and hidden items never reach customers");

  // Credit sale with mobile creates the customer; limit is enforced
  assert.equal((await post("/invoices", { lines: [{ productId: "a1", qty: 1, price: 6000 }], payment: "credit" })).status, 409);
  r = await post("/invoices", { lines: [{ productId: "a1", qty: 1, price: 6000 }], payment: "credit", customer: { name: "Aamir", phone: "9876543210" } });
  assert.equal(r.status, 200); assert.equal(r.invoice.paid, 0);
  const cust = (await get("/parties")).find((p) => p.phone === "9876543210");
  assert.equal(cust.balance, 6000); ok("credit bill creates the customer and goes in their ledger");
  await post(`/parties/${cust.id}`, { creditLimit: 7000 });
  r = await post("/invoices", { partyId: cust.id, lines: [{ productId: "a1", qty: 1, price: 6000 }], payment: "credit", customer: { name: "Aamir" } });
  assert.equal(r.status, 409); assert.equal(r.overLimit, true);
  assert.equal((await get("/products")).find((p) => p.id === "a1").quantity, 4);
  r = await post("/invoices", { partyId: cust.id, lines: [{ productId: "a1", qty: 1, price: 6000 }], payment: "credit", customer: { name: "Aamir" }, overLimit: true });
  assert.equal(r.status, 200); ok("credit limit stops the bill until overridden, no stock taken");
  const overBill = r.invoice;

  // Paid bill to the same mobile doesn't change the balance
  r = await post("/invoices", { lines: [{ productId: "b2", qty: 1, price: 2800 }], payment: "upi", customer: { name: "Aamir", phone: "9876543210" } });
  assert.equal((await get(`/parties/${cust.id}/ledger`)).balance, 12000); ok("a paid bill leaves the balance alone");

  // Payment in, partial; cancel bill; cancel payment
  r = await post("/payments", { direction: "in", partyId: cust.id, amount: 5000, mode: "upi" });
  assert.equal(r.balance, 7000); assert.match(r.payment.number, /^RCPT\/26-27\/0001$/);
  assert.equal((await post(`/invoices/${overBill.id}/cancel`)).status, 200);
  assert.equal((await get(`/parties/${cust.id}/ledger`)).balance, 1000);
  r = await post(`/payments/${(await get("/payments"))[0].id}/cancel`);
  assert.equal((await get(`/parties/${cust.id}/ledger`)).balance, 6000); ok("payments and cancelled bills move the balance correctly");
  assert.equal((await post("/payments", { direction: "in", partyId: cust.id, amount: -5, mode: "cash" })).status, 409);
  assert.equal((await post("/payments", { direction: "in", partyId: cust.id, amount: 5, mode: "cash", day: "2099-01-01" })).status, 409); ok("bad amounts and future dates refused");

  // WhatsApp sale is in the same books
  await wa("sold 4795");
  // Expense, cash and bank
  await post("/expenses", { type: "Rent", amount: 3000, mode: "cash" });
  const ex = await post("/expenses", { type: "Other", amount: 500, mode: "upi" });
  await post(`/expenses/${ex.expense.id}/cancel`);
  await post("/cash/opening", { openingCash: 10000, openingBank: 20000 });
  const cb = await get("/cash");
  // cash: 10000 − 1000 purchase + 6000 WhatsApp sale − 3000 rent; bank: 20000 + 2800 UPI sale
  assert.equal(cb.cash, 12000); assert.equal(cb.bank, 22800); ok("cash and bank add up across sales, purchases, expenses");

  // A cancel erases the whole purchase, payment included: the ₹1,000 paid counts as returned.
  // Money kept against a return is a debit note, not a cancel.
  const pu = (await get("/purchases"))[0];
  r = await post(`/purchases/${pu.id}/cancel`);
  assert.equal(r.status, 200);
  assert.equal((await get(`/parties/${sup.id}/ledger`)).balance, 0);
  assert.equal((await get("/cash")).cash, 13000); ok("cancelling a purchase takes off the stock, the debt and its payment");

  // Profit uses the cost at the time of sale
  const pl = await get("/profit");
  assert.equal(pl.sales, 14800); assert.equal(pl.cogs, 4200); assert.equal(pl.expenses, 3000); assert.equal(pl.net, 7600); assert.equal(pl.piecesWithoutCost, 1); ok("profit uses cost at sale and says what's missing");
  const d = await get("/dashboard"); assert.equal(d.toCollect, 6000); assert.equal(d.topDues[0].name, "Aamir"); ok("home numbers match the ledgers");

  // Pieces already sold can't be un-bought
  r = await post("/purchases", { partyId: sup.id, lines: [{ productId: "b2", qty: 2, cost: 1000 }] });
  await wa("sold 5100");
  const before = (await get("/products")).find((p) => p.id === "b2").quantity;
  const c = await post(`/purchases/${r.purchase.id}/cancel`);
  assert.equal(c.status, 409); assert.match(c.error, /can't be cancelled/);
  assert.equal((await get("/products")).find((p) => p.id === "b2").quantity, before); ok("a purchase whose pieces have sold can't be cancelled");

  // Shipping out of J&K shows on the GST check; a Srinagar delivery doesn't
  const ship = async (pin, phone) => {
    const o = await (await fetch(base + "/api/orders", { method: "POST", headers: H, body: JSON.stringify({ productId: "b2", name: "Zed", phone, delivery: "ship", address: "1 Road", city: "Town", pin }) })).json();
    return wa(`confirm ${o.code}`);
  };
  await post("/stock", { productId: "b2", quantity: 2 });
  assert.match(await ship("190003", "9000000002"), /confirmed/);
  let t = (await get("/dashboard")).turnover; assert.equal(t.outsideBills, 0);
  assert.match(await ship("110001", "9000000003"), /confirmed/);
  t = (await get("/dashboard")).turnover; assert.equal(t.outsideBills, 1); assert.equal(t.limit, 4000000); assert.ok(t.total > 0); ok("GST check counts yearly sales and bills shipped outside J&K");

  // A damaged file must stop, not wipe
  await post("/stock", { productId: "b2", quantity: 1 });
  const f = path.join(dir, "invoices.json"); const good = fs.readFileSync(f, "utf8");
  fs.writeFileSync(f, good.slice(0, 200));
  const bad = await fetch(base + B + "/invoices", { headers: H }); assert.equal(bad.status, 500);
  assert.match((await bad.json()).error, /damaged/);
  r = await post("/invoices", { lines: [{ productId: "b2", qty: 1 }] }); assert.equal(r.status, 500);
  assert.equal(fs.readFileSync(f, "utf8"), good.slice(0, 200)); ok("a damaged file stops the server and is not overwritten");
  fs.writeFileSync(f, good);

  console.log(`\nAll ${pass} books checks passed.`);
} catch (e) {
  console.error("\nFAILED:", e); console.error(log.slice(-1500)); process.exitCode = 1;
} finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
