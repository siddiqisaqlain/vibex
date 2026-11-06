// The payment window: nobody can claim to have paid, the shop confirms within the time or the order ends,
// and payment follows the shop's hours. Runs the real server with a short window. `node tests/paywindow.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isOpen, closedText, read } = require("../lib/paywindow.js");
const PORT = 4787, WINDOW = 1200;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-paywindow-"));
const base = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const boot = (extra) => spawn(process.execPath, ["server.js"], { cwd: path.resolve(import.meta.dirname, ".."), stdio: "ignore",
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_KEY: "k", ANTHROPIC_API_KEY: "", WA_TOKEN: "", ORDER_WINDOW_MS: String(WINDOW), ORDER_SWEEP_MS: "100", ...extra } });
const up = async () => { for (let i = 0; i < 50; i++) { try { await fetch(`${base}/api/products`); return; } catch { await wait(100); } } };
const H = { "Content-Type": "application/json", "x-owner-key": "k", "x-forwarded-for": "" };
let ip = 1;
const post = async (p, b = {}) => { const r = await fetch(base + p, { method: "POST", headers: { ...H, "x-forwarded-for": `10.0.0.${ip}` }, body: JSON.stringify(b) }); return { ...(await r.json().catch(() => ({}))), status: r.status }; };
const get = async (p) => (await fetch(base + p, { headers: H })).json();
const item = async (name, quantity = 1) => {
  const { product } = await post("/api/billing/items", { name, price: 1000, quantity });
  const f = path.join(dir, "products.json"), all = JSON.parse(fs.readFileSync(f, "utf8"));
  const p = all.find((x) => x.id === product.id); p.image = "/uploads/x.jpg"; delete p.hidden;
  fs.writeFileSync(f, JSON.stringify(all));
  return product.id;
};
let phone = 9876500000, n = 0;
const order = (productId) => { ip++; return post("/api/orders", { productId, name: "Aamir", phone: String(++phone), delivery: "pickup" }); };
const statusOf = async (id) => (await get("/api/products")).find((p) => p.id === id)?.status;
const orderOf = async (code) => (await get("/api/billing/orders")).find((o) => o.code === code);
const inbox = () => JSON.parse(fs.readFileSync(path.join(dir, "inbox.json"), "utf8"));
const pulse = () => get("/api/billing/pulse");
const ok = (name) => console.log(`ok ${++n} - ${name}`);

// The clock is India's: 5:29 UTC is 10:59 am there.
const w = read({ minutes: 4, opensHour: 11, closesHour: 23 });
const at = (h, m) => Date.UTC(2026, 10, 7, h, m) - 5.5 * 3600e3;
assert.equal(isOpen(w, at(10, 59)), false); assert.equal(isOpen(w, at(11, 0)), true);
assert.equal(isOpen(w, at(22, 59)), true); assert.equal(isOpen(w, at(23, 0)), false); assert.equal(isOpen(w, at(3, 0)), false);
assert.match(closedText(w), /11 am to 11 pm/);
assert.deepEqual(read({ minutes: 4, opensHour: 11, closesHour: 23 }, "0-24"), { minutes: 4, opensHour: 0, closesHour: 24 });
ok("payment opens at 11 am and closes at 11 pm, India time");

let srv = boot({ ORDER_HOURS: "0-24" });
try {
  await up();

  const a = await item("Last Jacket");
  const oa = await order(a);
  assert.equal(oa.status, 200); assert.equal(oa.left, WINDOW);
  assert.equal(await statusOf(a), "hold");
  assert.ok(inbox().some((m) => m.text.includes(oa.code) && /to confirm/.test(m.text)));
  assert.equal((await pulse()).pending[0].code, oa.code); assert.ok((await pulse()).pending[0].left > 0);
  ok("an order holds the last piece, tells the owner, and reaches the portal pop-up");

  assert.equal((await order(a)).status, 409);
  ok("nobody else can order that piece during the window");

  assert.equal((await post(`/api/orders/${oa.id}/paid`)).status, 409);
  assert.equal((await orderOf(oa.code)).status, "awaiting_payment");
  ok("pressing the old I've paid does nothing");

  await wait(WINDOW + 400);
  assert.equal((await orderOf(oa.code)).status, "lapsed"); assert.equal(await statusOf(a), "available");
  assert.equal((await get(`/api/orders/${oa.id}`)).status, "lapsed");
  assert.equal((await pulse()).pending.length, 0);
  assert.ok(inbox().some((m) => m.text.includes(oa.code) && /ran out of time/.test(m.text)));
  ok("nobody confirms in time: the order ends and the piece goes back on sale");

  let r = await post(`/api/billing/orders/${oa.code}/confirm`);
  assert.equal(r.status, 200); assert.equal(await statusOf(a), "sold");
  ok("a late confirm still works while the piece is unsold");

  const b = await item("Quick Jacket"), ob = await order(b);
  r = await post(`/api/billing/orders/${ob.code}/confirm`);
  assert.equal(r.status, 200); assert.equal((await get(`/api/orders/${ob.id}`)).status, "confirmed"); assert.equal(await statusOf(b), "sold");
  await wait(WINDOW + 400);
  assert.equal((await orderOf(ob.code)).status, "confirmed");
  ok("confirmed in time: sold, billed, and the timer can't undo it");

  const c = await item("Back Jacket"), oc = await order(c);
  assert.equal((await post(`/api/orders/${oc.id}/cancel`)).status, 200);
  assert.equal(await statusOf(c), "available"); assert.equal((await orderOf(oc.code)).status, "cancelled");
  assert.equal((await order(c)).status, 200);
  ok("going back to change details frees the piece for the same customer");

  const d = await item("Many Jackets", 5), od = await order(d);
  assert.equal(await statusOf(d), "available");
  await wait(WINDOW + 400);
  assert.equal((await orderOf(od.code)).status, "lapsed");
  ok("with more in stock nothing is held, and the order still ends");

  srv.kill(); await wait(300);
  srv = boot({ ORDER_HOURS: "0-0" });
  await up();
  r = await order(d);
  assert.equal(r.status, 409); assert.match(r.error, /WhatsApp/);
  ok("outside the hours the server refuses an order, not just the page");
  console.log(`all ${n} checks passed`);
} finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
