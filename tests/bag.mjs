// Bag + accounts with no sign-in: anyone can order, the first order quietly makes the phone's account,
// a bag of several pieces becomes one order, the owner confirms it into one bill, coins are earned,
// spent only when switched on, and come back on cancel.
// Runs the real server. `node tests/bag.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 4791;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-bag-"));
const base = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = spawn(process.execPath, ["server.js"], { cwd: path.resolve(import.meta.dirname, ".."), stdio: "ignore",
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_KEY: "k", ANTHROPIC_API_KEY: "", WA_TOKEN: "", ORDER_HOURS: "0-24", RENDER: "" } });
process.on("exit", () => srv.kill());
for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/products`); break; } catch { await wait(100); } }

let ip = 1, n = 0;
const ok = (name) => console.log(`ok ${++n} - ${name}`);
// A browser: keeps its own cookie.
function browser() {
  let cookie = "";
  const call = async (method, p, b) => {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", "x-forwarded-for": `10.1.0.${ip++}`, ...(cookie ? { cookie } : {}) }, body: b ? JSON.stringify(b) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0].endsWith("=") ? "" : sc.split(";")[0];
    return { ...(await r.json().catch(() => ({}))), status: r.status };
  };
  return { post: (p, b = {}) => call("POST", p, b), get: (p) => call("GET", p), cookie: () => cookie };
}
const owner = async (method, p, b) => (await fetch(base + p, { method, headers: { "Content-Type": "application/json", "x-owner-key": "k" }, body: b ? JSON.stringify(b) : undefined })).json();
const say = (text) => owner("POST", "/api/message", { text });
const item = async (name, price, quantity = 1) => {
  const { product } = await owner("POST", "/api/billing/items", { name, price, quantity });
  const f = path.join(dir, "products.json"), all = JSON.parse(fs.readFileSync(f, "utf8"));
  const p = all.find((x) => x.id === product.id); p.image = "/uploads/x.jpg"; delete p.hidden;
  fs.writeFileSync(f, JSON.stringify(all));
  return product.id;
};
const statusOf = async (id) => (await owner("GET", "/api/products")).find((p) => p.id === id)?.status;
const jacket = await item("Puma jacket", 7199);
const perfume = await item("Zara perfume", 1999, 5);
const scarf = await item("Wool scarf", 999);

// 1. No sign-in: a new phone is signed out, and its bag API simply says so.
const amir = browser();
assert.equal((await amir.get("/api/account/me")).signedIn, false);
assert.equal((await amir.post("/api/account/bag", { bag: [{ id: jacket }] })).signedIn, false);
ok("new phone: no account yet, nothing refused");

// 2. The quote is the server's price, not the browser's, and flags pieces that are gone.
const q = await amir.post("/api/account/quote", { lines: [{ id: jacket, price: 1 }, { id: perfume, qty: 2 }, { id: "fake-id" }] });
assert.equal(q.goods, 7199 + 2 * 1999); assert.equal(q.lines.length, 2); assert.equal(q.problems[0].why, "gone");
ok("quote uses server prices; gone pieces flagged");

// 5. One order for the whole bag: last piece held, owner gets every line.
// The first order makes this phone's account and sets its cookie.
let r = await amir.post("/api/orders", { lines: [{ id: jacket }, { id: perfume, qty: 2 }], name: "Aamir Khan", phone: "9876500002", delivery: "pickup" });
assert.equal(r.status, 200); assert.equal(r.amount, 11197); assert.equal(r.lines, 2);
assert.match(amir.cookie(), /^vxs=[a-f0-9]{64}$/);
const me = await amir.get("/api/account/me");
assert.equal(me.signedIn, true); assert.equal(me.name, "Aamir Khan"); assert.equal(me.address.phone, "9876500002"); assert.equal(me.orders.length, 1);
assert.equal(await statusOf(jacket), "hold");
const alert = JSON.parse(fs.readFileSync(path.join(dir, "inbox.json"), "utf8")).at(-1).text;
assert.match(alert, /Puma jacket/); assert.match(alert, /Zara perfume × 2 · ₹3,998/); assert.match(alert, /Total ₹11,197/);
ok("first order: account made, cookie set, details saved; one code, held last piece, alert lists every line");

// Its bag and wishlist now live in the account.
await amir.post("/api/account/bag", { bag: [{ id: scarf }] });
assert.equal((await amir.get("/api/account/me")).bag.length, 1);
ok("after the first order the bag is kept in the account");

// 6. Someone else can't buy the held jacket.
const sana = browser();
r = await sana.post("/api/orders", { lines: [{ id: jacket }], name: "Sana", phone: "9876500003", delivery: "pickup" });
assert.equal(r.status, 409); assert.ok(r.problems?.length);
ok("held piece refused to a second customer");

// Typing someone else's number never opens their account.
r = await sana.post("/api/orders", { lines: [{ id: perfume }], name: "Sana", phone: "9876500002", delivery: "pickup" });
assert.equal(r.status, 200);
const sanaMe = await sana.get("/api/account/me");
assert.equal(sanaMe.orders.length, 1); assert.equal(sanaMe.name, "Sana");
assert.equal((await amir.get("/api/account/me")).orders.length, 1);
ok("same number on another phone: a separate account, nobody else's orders shown");

// 7. Owner confirms: one bill with both lines, stock off, coins earned (1 per ₹100).
let reply = (await say(`confirm ${(await amir.get("/api/account/me")).orders[0].code}`)).reply;
assert.match(reply, /2 pieces marked sold/);
assert.equal(await statusOf(jacket), "sold");
const inv = JSON.parse(fs.readFileSync(path.join(dir, "invoices.json"), "utf8")).at(-1);
assert.equal(inv.lines.length, 2); assert.equal(inv.total, 11197);
let acct = await amir.get("/api/account/me");
assert.equal(acct.coins.balance, 111); assert.equal(acct.orders[0].status, "confirmed");
ok("confirm: one bill, both lines, 111 coins earned");

// 8. Spending is off until the owner switches it on, then capped at 10% of the bag.
let q2 = await amir.post("/api/account/quote", { lines: [{ id: scarf }] });
assert.equal(q2.coinsUsable, 0);
assert.match((await say("coins on")).reply, /ON/);
q2 = await amir.post("/api/account/quote", { lines: [{ id: scarf }] });
assert.equal(q2.coinsUsable, 99); // 10% of 999
r = await amir.post("/api/orders", { lines: [{ id: scarf }], useCoins: true, name: "Aamir Khan", phone: "9876500002", delivery: "pickup" });
assert.equal(r.amount, 900); assert.equal(r.coinsUsed, 99);
assert.equal((await amir.get("/api/account/me")).coins.balance, 12);
ok("coins: locked until 'coins on', capped at 10%, taken at order");

// 9. Cancelled order gives the coins back and frees the piece.
reply = (await say(`cancel ${(await amir.get("/api/account/me")).orders[0].code}`)).reply;
assert.match(reply, /cancelled/);
assert.equal((await amir.get("/api/account/me")).coins.balance, 111);
assert.equal(await statusOf(scarf), "available");
ok("cancel: spent coins return, piece back on sale");

// 10. Cancelling the confirmed bill in the portal takes its earned coins back.
const first = (await amir.get("/api/account/me")).orders.find((o) => o.status === "confirmed");
const bill = JSON.parse(fs.readFileSync(path.join(dir, "invoices.json"), "utf8")).find((x) => x.order === first.code);
await owner("POST", `/api/billing/invoices/${bill.id}/cancel`, { reason: "test" });
acct = await amir.get("/api/account/me");
assert.equal(acct.coins.balance, 0); assert.equal(acct.orders.find((o) => o.code === first.code).status, "cancelled");
ok("bill cancelled: earned coins taken back");

// 12. Pages exist.
for (const p of ["/account", "/bag"]) { const h = await (await fetch(base + p)).text(); assert.match(h, /id="acct"/); assert.match(h, /bag\.js/); }
assert.match(await (await fetch(base + "/")).text(), /bag\.js/);
ok("/account, /bag and home load the bag script");

console.log(`\n${n} passed`);
process.exit(0);
