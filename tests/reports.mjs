// Reports, Excel download, GST numbers, ageing, low stock. `node tests/reports.mjs`
// The GST half runs a second server with a test copy of shop.json that has a GSTIN.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const now = new Date().toISOString();
const PRODUCTS = [
  { id: "a1", code: "1001", name: "Tee", category: "Clothing", price: 2000, mrp: 3000, cost: 800, quantity: 5, status: "available", hsn: "6109", createdAt: now },
  { id: "b2", code: "1002", name: "Jacket", category: "Clothing", price: 5000, cost: 2500, quantity: 2, status: "available", hsn: "6201", createdAt: now },
  { id: "c3", code: "1003", name: "=Perfume", category: "Fragrances", price: 2800, cost: 1000, quantity: 1, status: "available", reorderAt: 3, hsn: "3303", createdAt: now },
];
async function boot(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-rep-"));
  fs.writeFileSync(path.join(dir, "products.json"), JSON.stringify(PRODUCTS));
  const srv = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dir, OWNER_KEY: "k", WA_TOKEN: "", ANTHROPIC_API_KEY: "", PUBLIC_URL: "" }, stdio: ["ignore", "pipe", "pipe"] });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/products"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const H = { "Content-Type": "application/json", "x-owner-key": "k" }, A = "/api/billing";
  return { srv, dir, base,
    get: (p) => fetch(base + A + p, { headers: H }).then((r) => r.json()),
    post: async (p, b = {}) => { const r = await fetch(base + A + p, { method: "POST", headers: H, body: JSON.stringify(b) }); return { status: r.status, ...(await r.json()) }; },
    wa: async (text) => (await (await fetch(base + "/api/message", { method: "POST", headers: H, body: JSON.stringify({ text }) })).json()).reply };
}
let pass = 0; const ok = (n) => { pass++; console.log("  ✓", n); };
const shopFile = path.join(root, "shop.json"); const original = fs.readFileSync(shopFile, "utf8");
const a = await boot(4796); let b;
try {
  await a.post("/invoices", { lines: [{ productId: "a1", qty: 2, price: 2000, disc: 100 }], payment: "cash", customer: { name: "Asif" } });
  await a.post("/invoices", { lines: [{ productId: "b2", qty: 1, price: 5000 }], payment: "credit", customer: { name: "Bilal", phone: "9876543210" } });
  const list = await a.get("/reports"); assert.equal(list.flatMap((g) => g[1]).length, 17);
  for (const [, reps] of list) for (const [name] of reps) { const r = await a.get(`/reports/${name}`); assert.ok(r.title && Array.isArray(r.rows), name); } ok("all 17 reports run");
  let d = await a.get("/reports/daily"); assert.equal(d.rows[0].cash, 3900); assert.equal(d.rows[0].credit, 5000); assert.equal(d.totals.net, 8900); ok("daily sales split by payment");
  let s = await a.get("/reports/stock"); assert.equal(s.totals.qty, 5); assert.equal(s.totals.atCost, 800 * 3 + 2500 + 1000); ok("stock summary values add up");
  let l = await a.get("/reports/low"); assert.deepEqual(l.rows.map((r) => r.code).sort(), ["1002", "1003"]); assert.match(await a.wa("low"), /Running low: 2/); ok("low stock uses each item's own level; WhatsApp 'low' works");
  let p = await a.get("/reports/pnl"); assert.equal(p.rows.at(-1).amount, 8900 - 1600 - 2500);
  let bs = await a.get("/reports/balance"); const v = (x) => bs.rows.find((r) => r.line === x).amount; assert.equal(v("Total assets"), 3900 + 5000 + s.totals.atCost); assert.equal(v("Liabilities and capital"), v("Total assets")); ok("profit and balance sheet tie out");
  // ageing: back-date the credit bill 45 days
  const f = path.join(a.dir, "invoices.json"); const inv = JSON.parse(fs.readFileSync(f)); inv[1].at = new Date(Date.now() - 45 * 864e5).toISOString(); fs.writeFileSync(f, JSON.stringify(inv));
  const party = (await a.get("/parties"))[0]; await a.post("/payments", { direction: "in", partyId: party.id, amount: 1000, mode: "cash" });
  let ag = await a.get("/reports/ageing"); assert.equal(ag.rows[0].d60, 4000); assert.equal(ag.rows[0].total, 4000); ok("ageing buckets by date; payments clear the oldest first");
  const r = await fetch(`${a.base}/api/billing/reports/stock.csv`, { headers: { "x-owner-key": "k" } }); const raw = Buffer.from(await r.arrayBuffer()), text = raw.toString("utf8");
  assert.match(r.headers.get("content-disposition"), /vibex-stock\.csv/); assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]); assert.ok(text.includes("'=Perfume")); assert.ok(!/,=Perfume/.test(text)); ok("Excel download works and can't run a cell as a formula");
  assert.equal((await fetch(`${a.base}/api/billing/reports/stock.csv`)).status, 401); ok("reports need the owner key");
  assert.ok((await a.get("/reports/gstr3b")).note.includes("No GSTIN")); ok("GST reports say so when there's no GSTIN");

  // Registered shop
  a.srv.kill();
  const j = JSON.parse(original); j.business.gstin = "01ABCDE1234F1Z5"; fs.writeFileSync(shopFile, JSON.stringify(j));
  b = await boot(4797);
  fs.writeFileSync(shopFile, original);
  await b.post("/invoices", { lines: [{ productId: "a1", qty: 1, price: 2000 }], payment: "cash", customer: { name: "Local" } }); // 5%
  await b.post("/invoices", { lines: [{ productId: "b2", qty: 1, price: 5000 }], payment: "upi", customer: { name: "Delhi", address: "1 Road, Delhi 110001" } }); // 18%, IGST
  await b.post("/invoices", { lines: [{ productId: "c3", qty: 1, price: 2800 }], payment: "cash", customer: { name: "Trader", gstin: "01ABCDE9999F1Z5", address: "Srinagar 190001" } });
  const c = await b.get("/reports/gstr1b2c");
  const local = c.rows.find((x) => x.place === "Within state"), out = c.rows.find((x) => x.place === "Other states");
  assert.equal(local.rate, 5); assert.equal(local.taxable, 1904.76); assert.equal(local.cgst, 47.62); assert.equal(local.igst, 0);
  assert.equal(out.rate, 18); assert.equal(out.taxable, 4237.29); assert.equal(out.igst, 762.71); assert.equal(out.cgst, 0); ok("B2C splits CGST+SGST within J&K and IGST outside");
  const g = await b.get("/reports/gstr1b2b"); assert.equal(g.rows.length, 1); assert.equal(g.rows[0].gstin, "01ABCDE9999F1Z5"); assert.equal(g.rows[0].rate, 18); ok("B2B lists registered buyers bill by bill");
  const h = await b.get("/reports/hsn"); assert.deepEqual(h.rows.map((x) => x.hsn).sort(), ["3303", "6109", "6201"]);
  const g3 = await b.get("/reports/gstr3b"); assert.equal(g3.rows[0].taxable, round(1904.76 + 4237.29 + 2372.88)); ok("HSN and 3B add up");
  const bills = (await b.get("/invoices")).invoices; const delhi = bills.find((x) => x.customer.name === "Delhi");
  assert.ok((await (await fetch(`${b.base}/bill/${delhi.id}`)).text()).includes("IGST ₹")); ok("an out-of-state tax invoice prints IGST");
  console.log(`\nAll ${pass} report checks passed.`);
} catch (e) { console.error("\nFAILED:", e); process.exitCode = 1; }
finally { fs.writeFileSync(shopFile, original); a.srv.kill(); b?.srv.kill(); fs.rmSync(a.dir, { recursive: true, force: true }); if (b) fs.rmSync(b.dir, { recursive: true, force: true }); }
function round(n) { return Math.round(n * 100) / 100; }
