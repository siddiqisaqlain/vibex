// Last pieces held by "I've paid": warning, automatic release, late confirm. Runs the real server
// with a short hold. `node tests/holds.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 4796;
const HOLD = 1600, WARN = 800;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-holds-"));
const env = { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_KEY: "k", ANTHROPIC_API_KEY: "", WA_TOKEN: "",
  ORDER_HOLD_MS: String(HOLD), ORDER_WARN_MS: String(WARN), ORDER_SWEEP_MS: "100" };
const base = `http://127.0.0.1:${PORT}`;
let srv, log = "";
async function start() {
  srv = spawn(process.execPath, ["server.js"], { cwd: path.resolve(import.meta.dirname, ".."), env, stdio: ["ignore", "pipe", "pipe"] });
  srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 50; i++) { try { await fetch(`${base}/api/products`); return; } catch { await wait(100); } }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { "Content-Type": "application/json", "x-owner-key": "k" };
const post = async (p, b) => { const r = await fetch(base + p, { method: "POST", headers: H, body: JSON.stringify(b) }); return { status: r.status, ...(await r.json()) }; };
const get = async (p) => (await fetch(base + p, { headers: H })).json();
const say = (text) => post("/api/message", { text });
const addItem = async (name, quantity) => {
  const { product } = await post("/api/billing/items", { name, price: 1000, quantity });
  const f = path.join(dir, "products.json");
  const all = JSON.parse(fs.readFileSync(f, "utf8"));
  const p = all.find((x) => x.id === product.id); p.image = "/uploads/x.jpg"; delete p.hidden;
  fs.writeFileSync(f, JSON.stringify(all));
  return product.id;
};
let phone = 9876500000;
async function order(productId) {
  phone++;
  const r = await post("/api/orders", { productId, name: "Aamir", phone: String(phone), delivery: "pickup", method: "upi", payment: "upi" });
  assert.ok(r.id, JSON.stringify(r));
  await post(`/api/orders/${r.id}/paid`, {});
  return r;
}
const statusOf = async (id) => (await get("/api/products")).find((p) => p.id === id)?.status;
const orderOf = async (code) => (await get("/api/billing/orders")).find((o) => o.code === code);
const inbox = () => JSON.parse(fs.readFileSync(path.join(dir, "inbox.json"), "utf8"));
const about = (code, re) => inbox().filter((m) => m.text.includes(code) && re.test(m.text));
let n = 0; const ok = (name) => console.log(`ok ${++n} - ${name}`);

try {
  await start();

  // Nobody acts: warned once, then released.
  const a = await addItem("Last Jacket", 1);
  const oa = await order(a);
  assert.equal(await statusOf(a), "hold");
  await wait(HOLD - WARN + 300);
  assert.equal(about(oa.code, /still needs checking/).length, 1);
  assert.equal((await orderOf(oa.code)).status, "paid"); assert.equal(await statusOf(a), "hold");
  ok("the owner is warned before the hold ends, and the piece stays held");
  await wait(WARN + 300);
  assert.equal((await orderOf(oa.code)).status, "lapsed"); assert.equal(await statusOf(a), "available");
  assert.equal(about(oa.code, /still needs checking/).length, 1, "only one warning");
  assert.equal(about(oa.code, /lapsed/).length, 1);
  ok("after the hold the order lapses and the piece is back on sale, with one warning and one notice");

  // Late confirm: piece unsold.
  let m = await say(`confirm ${oa.code}`);
  assert.match(m.reply, /confirmed/); assert.equal((await orderOf(oa.code)).status, "confirmed"); assert.equal(await statusOf(a), "sold");
  ok("a late confirm still works while the piece is unsold");

  // Late confirm: piece gone.
  const b = await addItem("Last Shirt", 1);
  const ob = await order(b);
  await wait(HOLD + 500);
  assert.equal((await orderOf(ob.code)).status, "lapsed");
  assert.equal((await post("/api/billing/invoices", { lines: [{ productId: b, qty: 1 }], payment: "cash" })).status, 200);
  m = await say(`confirm ${ob.code}`);
  assert.match(m.reply, /refund/); assert.match(m.reply, /has gone/); assert.equal((await orderOf(ob.code)).status, "lapsed");
  m = await say(`cancel ${ob.code}`);
  assert.doesNotMatch(m.reply, /back on sale/); assert.match(m.reply, /refund/);
  assert.equal((await orderOf(ob.code)).status, "cancelled"); assert.equal(await statusOf(b), "sold");
  ok("if it sold meanwhile, confirm asks for a refund and cancel doesn't claim it's back on sale");

  // The owner acts in time: no warning, no lapse.
  const c = await addItem("Last Coat", 1);
  const oc = await order(c);
  await say(`confirm ${oc.code}`);
  const d = await addItem("Last Hat", 1);
  const od = await order(d);
  await say(`cancel ${od.code}`);
  await wait(HOLD + 400);
  assert.equal((await orderOf(oc.code)).status, "confirmed"); assert.equal((await orderOf(od.code)).status, "cancelled");
  assert.equal(about(oc.code, /still needs checking|lapsed/).length, 0); assert.equal(about(od.code, /still needs checking|lapsed/).length, 0);
  ok("confirming or cancelling in time stops the warning and the lapse");

  // More in stock: nothing is held, so nothing lapses.
  const e = await addItem("Plenty Socks", 5);
  const oe = await order(e);
  await wait(HOLD + 400);
  assert.equal((await orderOf(oe.code)).status, "paid"); assert.equal(about(oe.code, /still needs checking|lapsed/).length, 0);
  ok("an item with more in stock isn't held, so its order keeps waiting for the owner");

  // A restart in the middle keeps the clock, and overdue holds still get a full warning.
  srv.kill(); await wait(200); await start(); // past the flood guard (5 orders in 10 minutes)
  const f = await addItem("Last Scarf", 1);
  const of = await order(f);
  srv.kill(); await wait(HOLD + 300);
  await start();
  await wait(300);
  assert.equal(about(of.code, /still needs checking/).length, 1, "warned after restart");
  assert.equal((await orderOf(of.code)).status, "paid", "not released without the full warning");
  await wait(WARN + 300);
  assert.equal((await orderOf(of.code)).status, "lapsed"); assert.equal(await statusOf(f), "available");
  ok("after a restart the hold still ends, and a full warning always comes first");

  console.log(`\nall ${n} checks passed`);
} catch (e) { console.error("\nFAILED:", e); console.error(log.slice(-1200)); process.exitCode = 1; }
finally { srv?.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
