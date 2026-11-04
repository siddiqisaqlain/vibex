// Returns, credit and debit notes, quotations, proforma, challans, purchase orders.
// Runs the real server. `node tests/documents.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 4795;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-docs-"));
const now = new Date().toISOString();
fs.writeFileSync(path.join(dir, "products.json"), JSON.stringify([
  { id: "a1", code: "1001", name: "Polo Jacket", category: "Clothing", price: 1500, mrp: 6700, cost: 800, quantity: 5, status: "available", createdAt: now },
  { id: "b2", code: "1002", name: "Lower", category: "Clothing", price: 700, cost: 300, quantity: 1, status: "available", createdAt: now },
]));
const srv = spawn(process.execPath, ["server.js"], { cwd: path.resolve(import.meta.dirname, ".."), env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_KEY: "k", WA_TOKEN: "", ANTHROPIC_API_KEY: "", PUBLIC_URL: "" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/products"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
const H = { "Content-Type": "application/json", "x-owner-key": "k" }, A = "/api/billing";
const get = (p) => fetch(base + A + p, { headers: H }).then((r) => r.json());
const post = async (p, b = {}) => { const r = await fetch(base + A + p, { method: "POST", headers: H, body: JSON.stringify(b) }); return { status: r.status, ...(await r.json()) }; };
const stock = async (id) => (await get("/products")).find((p) => p.id === id).quantity;
let pass = 0; const ok = (n) => { pass++; console.log("  ✓", n); };

try {
  // Sale on credit, then a partial return to the ledger
  let r = await post("/invoices", { lines: [{ productId: "a1", qty: 3, price: 1500, disc: 300 }], payment: "credit", customer: { name: "Bilal", phone: "9876543210" } });
  const bill = r.invoice; assert.equal(bill.total, 4200); assert.equal(await stock("a1"), 2);
  const party = (await get("/parties")).find((p) => p.phone === "9876543210");
  r = await post("/returns", { kind: "sale_return", invoiceId: bill.number, lines: [{ productId: "a1", qty: 1 }], reason: "Size" });
  assert.equal(r.status, 200); assert.equal(r.return.number, "SR-0001"); assert.equal(r.return.total, 1400); assert.equal(await stock("a1"), 3);
  assert.equal((await get(`/parties/${party.id}/ledger`)).balance, 2800); ok("sale return: stock back, discount shared fairly, ledger down");

  assert.equal((await post("/returns", { kind: "sale_return", invoiceId: bill.number, lines: [{ productId: "a1", qty: 3 }] })).status, 409); ok("can't return more than is left on the bill");

  r = await post("/returns", { kind: "sale_return", invoiceId: bill.id, lines: [{ productId: "a1", qty: 1 }], refund: 1400, mode: "cash" });
  assert.equal((await get(`/parties/${party.id}/ledger`)).balance, 2800);
  let c = await get("/cash"); assert.equal(c.cash, -1400); ok("refund goes through the cash book, not the ledger");

  assert.equal((await post(`/invoices/${bill.id}/cancel`)).status, 409); ok("a bill with a return can't be cancelled");
  r = await post(`/returns/${r.return.id}/cancel`); assert.equal(r.status, 200);
  assert.equal(await stock("a1"), 3); assert.equal((await get("/cash")).cash, 0); ok("cancelling a return undoes stock and refund");

  // Profit nets returns off
  let pl = await get("/profit"); assert.equal(pl.sales, 2800); assert.equal(pl.returns, 1400); assert.equal(pl.cogs, 1600); assert.equal(pl.net, 1200); ok("profit nets off returned sales and their cost");

  // Walk-in must be refunded in full
  r = await post("/invoices", { lines: [{ productId: "b2", qty: 1 }], payment: "cash" });
  const walk = r.invoice;
  assert.equal((await post("/returns", { kind: "sale_return", invoiceId: walk.id, lines: [{ productId: "b2", qty: 1 }] })).status, 409);
  r = await post("/returns", { kind: "sale_return", invoiceId: walk.id, lines: [{ productId: "b2", qty: 1 }], refund: 700, mode: "cash" });
  assert.equal(r.status, 200); assert.equal((await get("/products")).find((p) => p.id === "b2").status, "available"); ok("walk-in return needs a full refund; sold-out item comes back on sale");

  // Credit and debit notes
  assert.equal((await post("/returns", { kind: "credit_note", partyId: party.id, amount: 300 })).status, 409);
  r = await post("/returns", { kind: "credit_note", partyId: party.id, amount: 300, reason: "Price correction" });
  assert.equal(r.return.number, "CN-0001"); assert.equal((await get(`/parties/${party.id}/ledger`)).balance, 2500); ok("credit note lowers the balance and needs a reason");
  const sup = (await post("/parties", { type: "supplier", name: "Delhi Traders", phone: "9811111111" })).party;
  r = await post("/returns", { kind: "debit_note", partyId: sup.id, amount: 200, reason: "Short supply" });
  assert.equal((await get(`/parties/${sup.id}/ledger`)).balance, 200); ok("debit note raises what the supplier owes");

  // Purchase order -> purchase -> purchase return
  r = await post("/docs", { kind: "purchase_order", partyId: sup.id, lines: [{ productId: "b2", qty: 4, price: 300 }] });
  const po = r.doc; assert.equal(po.number, "PO-0001"); assert.equal(await stock("b2"), 1); ok("a purchase order moves no stock");
  r = await post(`/docs/${po.id}/convert`, {}); assert.equal(r.status, 200); assert.equal(await stock("b2"), 5);
  assert.equal((await post(`/docs/${po.id}/convert`, {})).status, 409); ok("converting adds the stock, once only");
  r = await post("/returns", { kind: "purchase_return", purchaseId: r.purchase.id, lines: [{ productId: "b2", qty: 1 }], refund: 300, mode: "upi" });
  assert.equal(r.status, 200); assert.equal(await stock("b2"), 4); assert.equal((await get("/cash")).bank, 300);
  assert.equal((await get(`/parties/${sup.id}/ledger`)).balance, -1000); ok("purchase return sends stock back and books the refund"); // +200 note, −1200 bought, +300 returned, −300 refunded

  // Quotation -> bill; proforma; challan
  r = await post("/docs", { kind: "quotation", lines: [{ productId: "a1", qty: 2, price: 1400 }], customer: { name: "Sana", phone: "9000000001" }, validUntil: "2099-01-01" });
  const q = r.doc; assert.equal(q.number, "QT-0001"); assert.equal(await stock("a1"), 3);
  const page = await (await fetch(`${base}/doc/${q.id}`)).text(); assert.ok(page.includes("QUOTATION")); assert.ok(page.includes("Valid until")); assert.ok(!page.includes("Received Amount")); ok("a quotation prints and moves no stock");
  r = await post(`/docs/${q.id}/convert`, { payment: "upi" });
  assert.equal(r.status, 200); assert.equal(r.invoice.total, 2800); assert.equal(await stock("a1"), 1); assert.equal(r.invoice.note, "From Quotation QT-0001"); ok("quotation converts to a real bill and takes stock");
  r = await post("/docs", { kind: "proforma", lines: [{ productId: "a1", qty: 1 }] });
  assert.equal(r.doc.number, "PF-0001"); assert.equal((await post(`/docs/${r.doc.id}/cancel`)).status, 200); assert.equal((await post(`/docs/${r.doc.id}/convert`)).status, 409);
  r = await post("/docs", { kind: "challan", lines: [{ productId: "a1", qty: 1 }], customer: { name: "Asif" } });
  assert.equal(r.doc.number, "DC-0001"); ok("proforma and challan work; a cancelled one can't convert");

  // Printed return
  const rt = (await get("/returns")).find((x) => x.kind === "credit_note");
  const rp = await (await fetch(`${base}/doc/${rt.id}`)).text(); assert.ok(rp.includes("CREDIT NOTE")); assert.ok(rp.includes("Price correction"));
  assert.equal((await fetch(`${base}/doc/0000000000000000`)).status, 404); ok("notes print; unknown links 404");
  // Dispatch note: a shipping slip, no government number, no stock or money moved
  r = await post("/invoices", { lines: [{ productId: "a1", qty: 1, price: 1000 }], payment: "upi", customer: { name: "Delhi", address: "1 Road, Delhi 110001" } });
  const shipped = r.invoice, before = await stock("a1");
  assert.equal((await post("/dispatch", { invoiceId: shipped.number })).status, 409);
  assert.equal((await post("/dispatch", { invoiceId: "0", courier: "DTDC" })).status, 409);
  r = await post("/dispatch", { invoiceId: shipped.number, courier: "DTDC", tracking: "D123", packages: 2, weight: "2 kg" });
  assert.equal(r.status, 200); assert.equal(r.doc.number, "DP-0001"); assert.equal(await stock("a1"), before);
  const dp = await (await fetch(`${base}/doc/${r.doc.id}`)).text();
  for (const t of ["DISPATCH NOTE", "DTDC", "D123", `Against bill ${shipped.number}`, "not a government e-way bill", "Delhi 110001"]) assert.ok(dp.includes(t), t);
  assert.ok(!/\bIRN\b|EWB|Ack No/i.test(dp)); ok("dispatch note prints, moves nothing and carries no government number");
  const billPage = await (await fetch(`${base}/bill/${shipped.id}`)).text();
  assert.ok(billPage.includes('class="qr"')); assert.ok(billPage.includes("Scan to check this bill")); assert.ok(!/\bIRN\b|e-invoice/i.test(billPage)); ok("every bill has a check QR, with no e-invoice wording");

  assert.equal((await fetch(`${base}${A}/returns`)).status, 401); assert.equal((await fetch(`${base}${A}/docs`)).status, 401); ok("everything needs the owner key");

  console.log(`\nAll ${pass} document checks passed.`);
} catch (e) { console.error("\nFAILED:", e); console.error(log.slice(-1200)); process.exitCode = 1; }
finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
