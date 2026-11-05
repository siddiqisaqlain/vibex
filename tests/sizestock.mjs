// Stock per size: website, counter, WhatsApp, cancels and anything that doesn't know the size.
// `node tests/sizestock.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 4797;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-sizes-"));
const srv = spawn(process.execPath, ["server.js"], { cwd: path.resolve(import.meta.dirname, ".."),
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_KEY: "k", ANTHROPIC_API_KEY: "", WA_TOKEN: "" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50; i++) { try { await fetch(`${base}/api/products`); break; } catch { await wait(100); } }
const H = { "Content-Type": "application/json", "x-owner-key": "k" };
const post = async (p, b) => { const r = await fetch(base + p, { method: "POST", headers: H, body: JSON.stringify(b) }); return { status: r.status, ...(await r.json()) }; };
const get = async (p) => (await fetch(base + p, { headers: H })).json();
const item = async (id) => (await get("/api/billing/products")).find((p) => p.id === id);
const shop = async (id) => (await get("/api/products")).find((p) => p.id === id);
const say = (text) => post("/api/message", { text });
let n = 0; const ok = (name) => console.log(`ok ${++n} - ${name}`);
const SIZES = "50ml 2999 100ml 4999";
async function perfume(name, counts) {
  const { product } = await post("/api/billing/items", { name, price: 999, sizes: SIZES, sizeStock: counts });
  const f = path.join(dir, "products.json");
  const all = JSON.parse(fs.readFileSync(f, "utf8"));
  const p = all.find((x) => x.id === product.id); p.image = "/uploads/x.jpg"; delete p.hidden;
  fs.writeFileSync(f, JSON.stringify(all));
  return product;
}

try {
  const a = await perfume("Size Test A", { "50 ml": 2, "100 ml": 1 });
  assert.equal(a.quantity, 3); assert.deepEqual(a.sizeStock, { "50 ml": 2, "100 ml": 1 });
  let web = await shop(a.id);
  assert.equal(web.sizeStock, undefined);
  assert.deepEqual(web.options.map((o) => o.left), [2, 1]);
  ok("the total is the sum of the sizes, and customers see a count on each size");

  // Counter: the size that sold comes off; a sale of the last one leaves the other size on sale.
  let r = await post("/api/billing/invoices", { lines: [{ productId: a.id, qty: 1, price: 4999, size: "100 ml" }], payment: "cash" });
  assert.equal(r.status, 200);
  let p = await item(a.id);
  assert.deepEqual(p.sizeStock, { "50 ml": 2, "100 ml": 0 }); assert.equal(p.quantity, 2); assert.equal(p.status, "available");
  ok("a counter sale takes stock from that size");

  // Website: a sold-out size can't be ordered, the other one can.
  r = await post("/api/orders", { productId: a.id, name: "Aamir", phone: "9876500001", delivery: "pickup", size: "100 ml" });
  assert.equal(r.status, 409); assert.match(r.error, /100 ml has just sold out/);
  r = await post("/api/orders", { productId: a.id, name: "Aamir", phone: "9876500001", delivery: "pickup", size: "50 ml" });
  assert.equal(r.amount, 2999);
  ok("the website refuses a sold-out size and sells the other");

  // WhatsApp
  let m = await say(`sold ${a.code} 100ml`);
  assert.match(m.reply, /100 ml/); assert.match(m.reply, /sold out/i);
  m = await say(`add ${a.code} 100ml 2`);
  assert.match(m.reply, /100 ml: \*2\*/); assert.equal((await item(a.id)).quantity, 4);
  m = await say(`stock ${a.code} 50ml 5`);
  assert.match(m.reply, /50 ml: \*5\*/);
  p = await item(a.id); assert.deepEqual(p.sizeStock, { "50 ml": 5, "100 ml": 2 }); assert.equal(p.quantity, 7);
  m = await say(`sold ${a.code}`);
  assert.match(m.reply, /Which size/);
  m = await say(`sold ${a.code} 100ml`);
  assert.match(m.reply, /Sold 1/);
  assert.deepEqual((await item(a.id)).sizeStock, { "50 ml": 5, "100 ml": 1 });
  ok("WhatsApp sells, adds and sets stock per size, and asks which size");

  // Cancelling a bill puts the piece back in the same size.
  r = await post("/api/billing/invoices", { lines: [{ productId: a.id, qty: 2, price: 2999, size: "50 ml" }], payment: "cash" });
  assert.equal((await item(a.id)).sizeStock["50 ml"], 3);
  r = await post(`/api/billing/invoices/${r.invoice.id}/cancel`, {});
  assert.equal(r.status, 200);
  p = await item(a.id); assert.deepEqual(p.sizeStock, { "50 ml": 5, "100 ml": 1 }); assert.equal(p.quantity, 6);
  ok("cancelling a bill puts the piece back in its size");

  // The same size twice on one bill can't oversell it.
  const twice = [{ productId: a.id, qty: 1, price: 4999, size: "100 ml" }, { productId: a.id, qty: 1, price: 4999, size: "100 ml" }];
  r = await post("/api/billing/invoices", { lines: twice, payment: "cash" });
  assert.equal(r.status, 409); assert.match(r.error, /Only|sold out/);
  assert.equal((await item(a.id)).sizeStock["100 ml"], 1);
  ok("the same size twice on one bill can't sell more than that size has");
  // ...unless the counter says the piece is in hand: it's flagged for a count and stops at 0
  r = await post("/api/billing/invoices", { lines: twice, payment: "cash", allowShort: true });
  assert.equal(r.status, 200);
  p = await item(a.id); assert.equal(p.sizeStock["100 ml"], 0); assert.equal(p.needsCount, true); assert.equal(p.quantity, 5);
  ok("a counter sale past a size's count stops at 0 and asks for a recount");

  // A change that doesn't know the size still adds up, and asks for a count.
  r = await post(`/api/billing/items/${a.id}`, { sizeStock: { "50 ml": 2, "100 ml": 3 } });
  assert.equal(r.status, 200); assert.equal(r.product.quantity, 5); assert.equal(r.product.needsCount, undefined);
  const before = await item(a.id);
  r = await say(`add ${a.code} 3`);
  p = await item(a.id);
  assert.equal(p.quantity, before.quantity + 3); assert.equal(Object.values(p.sizeStock).reduce((x, y) => x + y, 0), p.quantity); assert.equal(p.needsCount, true);
  r = await say(`stock ${a.code} 1`);
  p = await item(a.id);
  assert.equal(p.quantity, 1); assert.equal(Object.values(p.sizeStock).reduce((x, y) => x + y, 0), 1);
  ok("a change without a size keeps the sizes adding up and flags a recount");

  // Clearing, renaming and shared items.
  r = await post(`/api/billing/items/${a.id}`, { sizeStock: {} });
  assert.equal(r.product.sizeStock, undefined); assert.equal(r.product.quantity, 1);
  const b = (await post("/api/billing/items", { name: "Shared", price: 100, quantity: 4, sizes: "50ml 2999 100ml 4999" })).product;
  assert.equal(b.sizeStock, undefined); assert.equal(b.quantity, 4);
  assert.equal((await post(`/api/billing/items/${b.id}`, { sizeStock: { "50 ml": -1, "100 ml": 2 } })).status, 409);
  r = await post(`/api/billing/items/${b.id}`, { sizeStock: { "50 ml": 1, "100 ml": 2 } });
  assert.equal(r.product.quantity, 3);
  r = await post(`/api/billing/items/${b.id}`, { sizes: "100ml 4999 200ml 7999" });
  assert.deepEqual(r.product.sizeStock, { "100 ml": 3, "200 ml": 0 }); assert.equal(r.product.needsCount, true); assert.equal(r.product.quantity, 3);
  ok("items can go back to one shared count, and a changed size list stays consistent");

  console.log(`\nall ${n} checks passed`);
} catch (e) { console.error("\nFAILED:", e); console.error(log.slice(-800)); process.exitCode = 1; }
finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
