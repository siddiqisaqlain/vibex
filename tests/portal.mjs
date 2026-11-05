// The billing portal, driven like a person: real mouse clicks, taps and keys in a real Chrome, on
// desktop and on a phone. A button that is covered or dead fails here. `node tests/portal.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = 4797, DEBUG = 9477;
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-portal-"));
const now = new Date().toISOString();
const item = (id, code, name, price, quantity, extra = {}) => ({ id, code, name, category: "Clothing", price, quantity, status: "available", createdAt: now, ...extra });
fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
fs.writeFileSync(path.join(dir, "uploads", "b2.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
fs.writeFileSync(path.join(dir, "products.json"), JSON.stringify([
  item("a1", "4795", "North Face Puffer", 6000, 5, { barcode: "934911410459", cost: 3000 }),
  item("b2", "5100", "Levis Jeans", 2000, 3, { cost: 900, image: "/uploads/b2.png" }),
  item("c3", "6200", "Zero Stock Tee", 700, 0),
  item("d4", "7300", "Last Piece Jacket", 3500, 1, { status: "hold", holdFor: "VX-2001" }),
]));
fs.writeFileSync(path.join(dir, "orders.json"), JSON.stringify([
  { id: "1234567890abcdef", code: "VX-2001", status: "paid", createdAt: now, paidAt: now, name: "Rayees", phone: "9622123456", productId: "d4", productName: "Last Piece Jacket", amount: 3500, qty: 1 },
]));
const srv = spawn(process.execPath, ["server.js"], { cwd: path.resolve(import.meta.dirname, ".."), env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_KEY: "k", WA_TOKEN: "", ANTHROPIC_API_KEY: "", PUBLIC_URL: "" }, stdio: "ignore" });
for (let i = 0; i < 80; i++) { try { await fetch(base + "/api/products"); break; } catch { await sleep(100); } }
const api = async (p, opt = {}, key = "k") => { const r = await fetch(`${base}/api/billing/${p}`, { ...opt, headers: { "x-owner-key": key, "Content-Type": "application/json", ...(opt.headers || {}) } }); return { status: r.status, body: await r.json().catch(() => null) }; };

let fails = 0, passes = 0;
const ok = (c, m) => { c ? passes++ : fails++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };

async function browser({ width, height, mobile }, port) {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-chrome-"));
  const proc = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let tgt; for (let i = 0; i < 100 && !tgt; i++) { try { tgt = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {} await sleep(100); }
  const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const wait = new Map(), errors = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id) { wait.get(d.id)?.(d.result ?? d); wait.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  if (mobile) await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const js = async (e) => (await cdp("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
  const until = async (e, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(e)) return true; await sleep(70); } return false; };
  const nav = async (u) => { await cdp("Page.navigate", { url: u }); await until(`document.readyState==='complete'&&!!window.VX&&!document.getElementById('app').classList.contains('hide')`); await sleep(400); };
  const tap = async (sel) => {
    const p = await js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.getClientRects().length);if(!e)return{miss:1};e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,t=document.elementFromPoint(x,y);return{x,y,ok:!!t&&(t===e||e.contains(t)||t.contains(e)),top:t&&t.tagName+'.'+t.className}})()`);
    if (p.miss) { ok(false, `nothing to tap: ${sel}`); return false; }
    if (!p.ok) { ok(false, `${sel} is covered by ${p.top}`); return false; }
    if (mobile) { await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y }] }); await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }
    else { await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }); await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 }); await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 }); }
    await sleep(180); return true;
  };
  const type = async (t) => { for (const c of t) await cdp("Input.dispatchKeyEvent", { type: "char", text: c }); await sleep(100); };
  const keyCodes = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, F2: 113, k: 75 };
  const key = async (k, mods = 0) => { const p = { key: k, code: k.length === 1 ? "Key" + k.toUpperCase() : k, windowsVirtualKeyCode: keyCodes[k], modifiers: mods }; await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", ...p }); if (k === "Enter" && !mods) await cdp("Input.dispatchKeyEvent", { type: "char", ...p, text: "\r" }); await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...p }); await sleep(180); };
  const fill = async (sel, t) => { await tap(sel); await js(`document.querySelector(${JSON.stringify(sel)}).select?.()`); await type(t); };
  const text = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.textContent||""`);
  const close = () => { ws.close(); proc.kill(); };
  return { js, until, nav, tap, type, key, fill, text, errors, close, sleep };
}

try {
  // ---- Server: the parts the screens rely on ----
  {
    const r = await api("invoices", { method: "POST", body: JSON.stringify({ lines: [{ productId: "b2", qty: 1, price: 2000 }], customer: { name: "Bilal", phone: "9419012345" }, payment: "credit", received: 500, paidMode: "upi" }) });
    ok(r.status === 200 && r.body.invoice.paid === 500, "credit bill keeps the part received");
    const cash = (await api("cash")).body;
    ok(cash.bank === 500 && cash.cash === 0, "part payment lands in the right account");
    let bill = (await api("invoices")).body.invoices[0];
    ok(bill.due === 1500, "bill shows what's still due");
    const over = await api("invoices", { method: "POST", body: JSON.stringify({ lines: [{ productId: "a1", qty: 1, price: 6000 }], customer: { name: "Bilal", phone: "9419012345" }, payment: "credit", received: 7000 }) });
    ok(over.status === 409, "can't receive more than the bill");
    const party = bill.partyId;
    await api("payments", { method: "POST", body: JSON.stringify({ direction: "in", partyId: party, amount: 1500, mode: "cash", day: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) }) });
    bill = (await api("invoices")).body.invoices[0];
    ok(bill.due === 0, "a later payment clears the bill's Unpaid status");
    const backup = (await api("backup")).body;
    ok(backup.products?.length === 4 && backup.invoices?.length === 1 && backup.parties?.length === 1 && backup.orders?.length === 1, "backup holds the shop's records");
    const dash = (await api("dashboard")).body;
    ok(dash.attention.ordersToCheck === 1 && dash.attention.nextLapse > Date.now(), "dashboard lists the order and its hold time");
    ok(dash.month30.length === 30 && dash.week.length === 7, "dashboard has 7 and 30 day sales");
    const me = (await api("me")).body;
    ok(/@jkb$/.test(me.upi), "portal gets the shop's current UPI ID");
    ok((await api("backup", {}, "wrong")).status === 401, "backup needs the owner key");
  }

  // ---- Desktop ----
  const d = await browser({ width: 1366, height: 820, mobile: false }, DEBUG);
  await d.nav(`${base}/billing?key=k`);
  ok(await d.js(`document.activeElement.id==='q'`), "opens ready to scan");
  ok(!(await d.js(`location.search.includes('key')`)), "the key is cleared from the address");

  await d.type("934911410459"); await d.key("Enter");
  ok((await d.text("#total")) === "₹6,000", "a barcode scan adds the item");
  await d.type("levis"); await d.key("ArrowDown"); await d.key("Enter");
  ok((await d.text("#total")) === "₹8,000", "arrow keys and Enter pick an item");

  await d.fill('[data-disc="1"]', "10%"); await d.key("Enter");
  await d.tap("#q");
  ok((await d.js(`document.querySelector('[data-disc="1"]').value`)) === "200", "a line discount can be typed as a percent");
  ok((await d.text("#total")) === "₹7,800", "the total follows the discount");

  await d.tap("#addDisc"); await d.type("300");
  ok((await d.text("#total")) === "₹7,500", "discount on the whole bill");

  // A sale elsewhere redraws the page: the box being typed in must keep its cursor.
  await d.fill('[data-rate="0"]', "5999");
  await api("stock", { method: "POST", body: JSON.stringify({ productId: "c3", price: 750 }) });
  await d.sleep(3400);
  ok(await d.js(`document.activeElement.dataset.rate==='0'`), "a live update doesn't throw the cursor out of a box");
  await d.fill('[data-rate="0"]', "6000");

  await d.nav(`${base}/billing`);
  ok((await d.text("#total")) === "₹7,500", "an unfinished bill survives a refresh");

  await d.tap("#holdBill");
  ok((await d.text("#total")) === "₹0" && (await d.js(`document.querySelectorAll('.held').length`)) === 1, "Hold bill clears the screen and keeps it");
  await d.tap("#q"); await d.type("5100"); await d.key("Enter");
  await d.tap("[data-unhold]");
  ok((await d.text("#total")) === "₹7,500" && (await d.js(`document.querySelectorAll('.held').length`)) === 1, "bringing back a held bill holds the current one");
  await d.tap("[data-hrm]");

  await d.tap("#gave"); await d.type("8000");
  ok(/₹500/.test(await d.text("#change")), "shows the change to give back");
  await d.key("Enter", 2);
  ok(await d.until(`!document.getElementById('done').classList.contains('hide')`), "Ctrl+Enter makes the bill");
  ok(/Give back ₹500/.test(await d.text("#done")), "success screen repeats the change");
  const sold = (await api("invoices")).body.invoices[0];
  ok(sold.total === 7500 && sold.lines.reduce((n, l) => n + l.amount, 0) === 7500, "line amounts add up to the discounted total");
  ok(await d.tap("#dPrint"), "Print is tappable");
  await d.sleep(300);
  await d.key("Enter");
  ok(await d.js(`!document.getElementById('billForm').classList.contains('hide')&&document.activeElement.id==='q'`), "Enter starts the next bill");
  ok(!(await d.js(`localStorage.getItem('vx-draft')`)), "a finished bill leaves no draft");

  // Credit bills need a person, and say so before anything is sent.
  await d.type("5100"); await d.key("Enter");
  await d.tap('label:has(input[value=credit]) span');
  await d.tap("#make");
  ok(/mobile/.test(await d.text("#err")), "credit asks for the mobile");
  await d.fill("#cPhone", "94190");
  ok(await d.until(`/Bilal/.test(document.getElementById('custHits').textContent)`), "a saved customer is suggested");
  await d.tap("#custHits button");
  ok((await d.js(`document.getElementById('cName').value`)) === "Bilal", "picking them fills the name");
  await d.tap("#partPaid"); await d.type("500");
  ok(/₹1,500 goes in the ledger/.test(await d.text("#partLeft")), "shows what goes in the ledger");
  await d.tap("#make");
  ok(await d.until(`!document.getElementById('done').classList.contains('hide')`), "credit bill saved");
  await d.tap("#dNext");

  // Bills: filters, panel, collect.
  await d.tap('#side .head[data-group=sales]');
  await d.tap('#side [data-tab=bills]');
  ok(await d.js(`location.hash==='#/bills'`), "the address follows the page");
  await d.tap('[data-st=unpaid]');
  ok((await d.js(`document.querySelectorAll('#billRows tr').length`)) === 1, "Unpaid filter");
  await d.tap("#billRows [data-collect]");
  ok(await d.until(`!!document.getElementById('cSave')`), "Collect opens a payment panel");
  ok((await d.js(`document.getElementById('cAmt').value`)) === "1500", "amount is filled in");
  await d.tap("#cSave");
  await d.until(`!document.querySelector('#billRows [data-collect]')`);
  ok(/No bills/.test(await d.text("#billRows")), "the paid bill leaves the Unpaid list");
  await d.tap('[data-st=""]');
  await d.tap("#billRows tr [data-view]");
  ok(await d.until(`!!document.getElementById('bpCancel')`), "View opens the bill panel");
  await d.tap("#bpCancel"); await d.tap("#bpCancel");
  ok(await d.until(`/Cancelled/.test(document.getElementById('billRows').textContent)`), "two taps cancel a bill");
  const back = (await api("products")).body.find((p) => p.id === "b2");
  ok(back.quantity === 1, "cancelled bill puts the piece back");

  // Every item in the Create menu lands on an open form.
  for (const [i, name] of ["party", "item", "payment", "return", "quotation", "purchase", "expense"].entries()) {
    await d.tap("#createMore");
    await d.tap(`#createMenu button:nth-child(${i + 1})`);
    ok(await d.until(`!!document.querySelector('details.form[open]')`), `Create menu opens the ${name} form`);
    await d.key("Escape");
    ok(await d.until(`!document.querySelector('details.form[open]')&&document.getElementById('veil').classList.contains('hide')`), `Esc closes the ${name} form`);
  }
  await d.tap("#createMore"); await d.tap("#createMenu button:nth-child(1)");
  ok(await d.js(`[...document.querySelectorAll('details.form[open] label')].some(l=>/Mobile/.test(l.textContent))`), "form boxes have visible labels");

  // Search everything, then Back.
  await d.key("Escape");
  await d.tap('#side [data-tab=home]');
  await d.until(`!!document.getElementById('heroToday')`);
  await d.key("k", 2);
  await d.type("bilal");
  ok(await d.until(`/Parties/.test(document.getElementById('findHits').textContent)`), "Ctrl+K searches customers");
  await d.key("Enter");
  ok(await d.until(`/bilal/i.test(document.body.textContent)&&!document.getElementById('findAll').value`), "Enter opens the first match");
  await d.key("Escape");
  await d.nav(`${base}/billing#/parties`);
  await d.until(`!!document.querySelector('#partyRows tr')`);
  ok(await d.tap("#partyRows [data-open] td:first-child"), "open a party");
  ok(await d.until(`location.hash.startsWith('#/parties/')&&!!document.getElementById('payNow')`), "the ledger has its own address");
  await d.js(`history.back()`);
  ok(await d.until(`!!document.getElementById('partyRows')`), "Back returns to the list");

  // Live: a new website order appears by itself.
  fs.writeFileSync(path.join(dir, "orders.json"), JSON.stringify([...JSON.parse(fs.readFileSync(path.join(dir, "orders.json"), "utf8")), { id: "fedcba0987654321", code: "VX-2002", status: "paid", createdAt: now, paidAt: now, name: "Zoya", phone: "8899123456", productId: "a1", productName: "North Face Puffer", amount: 6000, qty: 1 }]));
  ok(await d.until(`document.querySelector('#side [data-badge=orders]').textContent==='2'`, 6000), "new order shows on the menu by itself");
  ok(/New website order/.test(await d.text("#toasts")), "and says so");
  await d.tap('#side [data-tab=orders]');
  await d.until(`!!document.querySelector('[data-oa=confirm]')`);
  await d.tap('[data-oc="VX-2002"][data-oa=confirm]'); await d.tap('[data-oc="VX-2002"][data-oa=confirm]');
  ok(await d.until(`document.querySelector('#side [data-badge=orders]').textContent==='1'`, 6000), "confirming clears it from the count");

  // Items.
  await d.tap('#side [data-tab=stock]');
  ok(await d.until(`document.querySelector('[data-photo=b2] img')?.naturalWidth>0`), "Items shows the product photo");
  ok(await d.js(`(()=>{const t=document.querySelector('#stockRows .thumb.none:not(.itemPic)');return !!t&&!t.textContent.trim()&&/svg/.test(getComputedStyle(t).backgroundImage)})()`), "an item with no photo shows the default image");
  await d.tap("[data-photo=b2]");
  ok(await d.until(`document.getElementById('photoBig')?.naturalWidth>0`), "tapping the photo opens it large");
  await d.tap("#photoEdit");
  ok(await d.until(`!!document.getElementById('itSave')`), "the photo panel leads to Edit item");
  await d.key("Escape");
  await d.tap('[data-sc=out]');
  ok((await d.js(`document.querySelectorAll('#stockRows tr').length`)) >= 1 && /Sold out/.test(await d.text("#stockRows")), "Sold out filter");
  await d.tap('[data-sc=""]');
  const q0 = (await api("products")).body.find((p) => p.id === "b2").quantity;
  await d.tap('[data-step="1"][data-id=b2]');
  await d.until(`/Undo/.test(document.getElementById('toasts').textContent)`);
  ok((await api("products")).body.find((p) => p.id === "b2").quantity === q0 + 1, "plus adds stock");
  await d.tap("#toasts .toast:last-child button");
  await d.sleep(500);
  ok((await api("products")).body.find((p) => p.id === "b2").quantity === q0, "Undo puts it back");
  await d.tap("[data-edit]");
  ok(await d.until(`!!document.getElementById('itSave')`), "Edit opens the item panel");
  await d.key("Escape");
  await d.tap('[data-pick]');
  ok(await d.until(`!document.getElementById('pickBar').classList.contains('hide')`), "ticking shows what you can do");

  // Settings.
  await d.tap('#side [data-tab=settings]');
  ok(await d.until(`!!document.getElementById('backupGo')`), "Settings has Backup");
  await d.tap("#backupGo");
  ok(await d.tap('#who #logout'), "Lock is tappable");
  ok(await d.until(`!document.getElementById('lock').classList.contains('hide')`), "Lock asks for the key again");
  ok(d.errors.length === 0, `no page errors on desktop ${d.errors.join(" | ").slice(0, 300)}`);
  d.close();

  // ---- Staff see the counter only ----
  await api("staff", { method: "POST", body: JSON.stringify({ name: "Sana", pin: "1234" }) });
  const login = await (await fetch(`${base}/api/billing/login`, { method: "POST", body: JSON.stringify({ name: "Sana", pin: "1234" }) })).json();
  const st = (p) => fetch(`${base}/api/billing/${p}`, { headers: { "x-session": login.token } }).then((r) => r.status);
  ok((await st("pulse")) === 200, "staff can use the live check");
  ok((await st("backup")) === 403 && (await st("dashboard")) === 403, "staff can't reach backup or the dashboard");

  // ---- Phone ----
  for (const [width, label] of [[390, "phone"], [320, "small phone"]]) {
    const m = await browser({ width, height: 800, mobile: true }, DEBUG + width);
    await m.nav(`${base}/billing?key=k`);
    ok(!(await m.js(`document.activeElement.id==='q'`)), `${label}: the keyboard doesn't jump up on open`);
    await m.tap("#results .item");
    ok(await m.js(`!document.getElementById('cartBar').classList.contains('hide')`), `${label}: bar shows the bill total`);
    await m.tap("#cartBar"); await m.sleep(500);
    await m.tap("#make");
    ok(await m.until(`!document.getElementById('done').classList.contains('hide')`), `${label}: makes a bill with taps`);
    await m.tap("#dNext");
    await m.nav(`${base}/billing#/stock`);
    await m.tap("[data-photo=b2]");
    ok(await m.until(`document.getElementById('photoBig')?.naturalWidth>0`), `${label}: tapping a product photo opens it`);
    await m.nav(`${base}/billing#/home`);
    for (const hash of ["home", "new", "bills", "stock", "parties", "payments/in", "orders", "purchases", "expenses", "cash", "reports", "settings", "docs/quotation", "returns/sale_return"]) {
      await m.nav(`${base}/billing#/${hash}`);
      const over = await m.js(`document.documentElement.scrollWidth-innerWidth`);
      ok(over <= 0, `${label}: ${hash} fits the screen${over > 0 ? ` (${over}px too wide)` : ""}`);
    }
    await m.tap("#dockMore");
    ok(await m.js(`document.getElementById('side').classList.contains('show')`), `${label}: More opens the menu`);
    await m.tap("#side [data-tab=parties]");
    ok(await m.until(`location.hash==='#/parties'&&!document.getElementById('side').classList.contains('show')`), `${label}: menu closes after picking a page`);
    ok(m.errors.length === 0, `${label}: no page errors ${m.errors.join(" | ").slice(0, 300)}`);
    m.close();
  }
} finally {
  srv.kill();
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
