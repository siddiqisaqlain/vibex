// The shop's books: parties (customers and suppliers), payments in and out, purchases,
// expenses, cash and bank. Bills stay in lib/billing.js; stock stays in products.json.
// Balances are never stored. They're worked out from the records every time, so a ledger
// can't drift out of step with the bills behind it.
//
// Sign rule: a party's balance > 0 means they owe the shop; < 0 means the shop owes them.
const path = require("path");
const crypto = require("crypto");
const { readJson, writeJson } = require("./jsonstore");

const round2 = (n) => Math.round(n * 100) / 100;
const newId = () => crypto.randomBytes(8).toString("hex");
const istDay = (d = new Date()) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const MODES = ["cash", "upi", "card", "bank"];
const inBank = (mode) => mode !== "cash"; // UPI, card and transfers all land in the bank
const EXPENSE_TYPES = ["Rent", "Salary", "Electricity", "Courier", "Packing", "Travel", "Marketing", "Repairs", "Tea & food", "Other"];

function fyOf(day) {
  const [y, m] = day.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}
function goodDay(v) {
  const day = v ? String(v) : istDay();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) return null;
  return day > istDay() ? null : day;
}
const money = (v) => { const n = round2(Number(v)); return n > 0 && n <= 100_000_000 ? n : null; };

module.exports = function createBooks({ STORE, SHOP, billing, load, save, logActivity }) {
  const file = (n) => path.join(STORE, `${n}.json`);
  const table = (n) => ({ all: () => readJson(file(n), []), put: (list) => writeJson(file(n), list) });
  const parties = table("parties"), payments = table("payments"), purchases = table("purchases"), expenses = table("expenses");
  const returnsAll = () => readJson(file("returns"), []).filter((x) => x.status !== "cancelled");
  const settingsFile = file("books");
  const settings = () => readJson(settingsFile, { openingCash: 0, openingBank: 0 });

  const nextNumber = (list, prefix, day) => {
    const head = `${prefix}/${fyOf(day)}/`;
    const max = list.filter((x) => x.number.startsWith(head)).reduce((m, x) => Math.max(m, Number(x.number.slice(head.length)) || 0), 0);
    return head + String(max + 1).padStart(4, "0");
  };
  const liveInvoices = () => billing.loadInvoices().filter((x) => x.status !== "cancelled");
  const paidOn = (inv) => (inv.paid != null ? inv.paid : inv.payment === "credit" ? 0 : inv.total); // older bills have no paid field

  // ---- Parties ----
  const cleanPhone = (v) => String(v || "").replace(/\D/g, "").slice(-10);
  function saveParty(b, id) {
    const list = parties.all();
    const old = id ? list.find((x) => x.id === id) : null;
    if (id && !old) return { error: "Party not found." };
    const name = String(b.name ?? old?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!name) return { error: "Add the party's name." };
    const phone = b.phone !== undefined ? cleanPhone(b.phone) : old?.phone || "";
    if (phone && phone.length !== 10) return { error: "Mobile number should be 10 digits." };
    const gstin = String(b.gstin ?? old?.gstin ?? "").trim().toUpperCase();
    if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(gstin)) return { error: "That GSTIN doesn't look right (15 characters)." };
    const type = (b.type ?? old?.type) === "supplier" ? "supplier" : "customer";
    if (phone && list.some((x) => x.phone === phone && x.type === type && x.id !== id && !x.deleted)) return { error: `A ${type} with this mobile already exists.` };
    const opening = Number(b.opening ?? old?.opening ?? 0);
    const creditLimit = Number(b.creditLimit ?? old?.creditLimit ?? 0);
    if (!Number.isFinite(opening) || !(creditLimit >= 0)) return { error: "Check the opening balance and credit limit." };
    const row = {
      id: old?.id || newId(), type, name, phone, gstin,
      address: String(b.address ?? old?.address ?? "").trim().slice(0, 300),
      opening: round2(opening), creditLimit: round2(creditLimit),
      notes: String(b.notes ?? old?.notes ?? "").trim().slice(0, 500),
      birthday: /^\d{2}-\d{2}$/.test(b.birthday) ? b.birthday : old?.birthday || "",
      createdAt: old?.createdAt || new Date().toISOString(),
    };
    if (old) Object.assign(old, row); else list.push(row);
    parties.put(list);
    return { party: row };
  }
  // A bill with a mobile number files itself under that customer, new or not.
  function customerFor({ name, phone }) {
    const p = cleanPhone(phone);
    if (p.length !== 10) return null;
    const found = parties.all().find((x) => x.phone === p && x.type === "customer" && !x.deleted);
    if (found) return found.id;
    const r = saveParty({ type: "customer", name: name || `Customer ${p.slice(-4)}`, phone: p });
    return r.party ? r.party.id : null;
  }

  // ---- Ledger: every entry for one party, oldest first, with a running balance ----
  function ledger(partyId) {
    const party = parties.all().find((x) => x.id === partyId);
    if (!party) return { error: "Party not found." };
    const rows = [];
    if (party.opening) rows.push({ day: istDay(party.createdAt), at: party.createdAt, kind: "Opening balance", ref: "", amount: party.opening });
    for (const inv of billing.loadInvoices()) {
      if (inv.partyId !== partyId || inv.status === "cancelled") continue;
      rows.push({ day: istDay(inv.at), at: inv.at, kind: "Sale", ref: inv.number, id: inv.id, amount: inv.total });
      const paid = paidOn(inv);
      if (paid) rows.push({ day: istDay(inv.at), at: inv.at, kind: "Paid at sale", ref: inv.number, amount: -paid });
    }
    for (const pu of purchases.all()) {
      if (pu.partyId !== partyId || pu.status === "cancelled") continue;
      rows.push({ day: pu.day, at: pu.at, kind: "Purchase", ref: pu.number, amount: -pu.total });
      if (pu.paid) rows.push({ day: pu.day, at: pu.at, kind: "Paid at purchase", ref: pu.number, amount: pu.paid });
    }
    for (const pay of payments.all()) {
      if (pay.partyId !== partyId || pay.status === "cancelled") continue;
      rows.push({ day: pay.day, at: pay.at, kind: pay.direction === "in" ? "Payment in" : "Payment out", ref: pay.number, id: pay.id, amount: pay.direction === "in" ? -pay.amount : pay.amount });
    }
    // Returns and notes. What the shop gives back takes the balance down; what it's owed puts it up.
    const NAME = { sale_return: "Sales return", credit_note: "Credit note", purchase_return: "Purchase return", debit_note: "Debit note" };
    for (const r of returnsAll()) {
      if (r.partyId !== partyId) continue;
      const sign = r.kind === "sale_return" || r.kind === "credit_note" ? -1 : 1;
      rows.push({ day: r.day, at: r.at, kind: NAME[r.kind], ref: r.number, id: r.id, amount: sign * r.total });
      if (r.refund) rows.push({ day: r.day, at: r.at, kind: "Refund", ref: r.number, amount: -sign * r.refund });
    }
    rows.sort((a, b) => a.day.localeCompare(b.day) || String(a.at).localeCompare(String(b.at)));
    let run = 0;
    for (const r of rows) r.balance = run = round2(run + r.amount);
    return { party, rows, balance: run };
  }
  const balanceOf = (id) => ledger(id).balance || 0;
  function partyList() {
    return parties.all().filter((x) => !x.deleted).map((x) => ({ ...x, balance: balanceOf(x.id) }));
  }
  // Selling on credit past the limit needs a deliberate second tap.
  function creditCheck(partyId, amount) {
    const p = parties.all().find((x) => x.id === partyId);
    if (!p || !p.creditLimit) return null;
    const after = round2(balanceOf(partyId) + amount);
    return after > p.creditLimit ? `${p.name} would owe ₹${after.toLocaleString("en-IN")}, over the ₹${p.creditLimit.toLocaleString("en-IN")} credit limit.` : null;
  }

  // A read-only ledger link the party can open, like a shared statement. Revoking kills the link.
  function shareLedger(id, on) {
    const list = parties.all();
    const p = list.find((x) => x.id === id);
    if (!p) return { error: "Party not found." };
    p.shareToken = on ? p.shareToken || crypto.randomBytes(16).toString("hex") : "";
    parties.put(list);
    return { token: p.shareToken };
  }
  function sharedLedger(token) {
    const p = token && parties.all().find((x) => x.shareToken === token && !x.deleted);
    return p ? ledger(p.id) : null;
  }

  // ---- Payments in and out ----
  function addPayment(b) {
    const direction = b.direction === "out" ? "out" : "in";
    const amount = money(b.amount), day = goodDay(b.day);
    if (!amount) return { error: "Enter the amount." };
    if (!day) return { error: "Check the date. It can't be in the future." };
    if (!MODES.includes(b.mode)) return { error: "Pick cash, UPI, card or bank." };
    if (!parties.all().some((x) => x.id === b.partyId && !x.deleted)) return { error: "Pick a party." };
    const list = payments.all();
    const pay = { id: newId(), number: nextNumber(list, direction === "in" ? "RCPT" : "PAY", day), direction, partyId: b.partyId, amount, mode: b.mode, day, note: String(b.note || "").slice(0, 200), at: new Date().toISOString(), status: "done" };
    list.push(pay);
    payments.put(list);
    return { payment: pay, balance: balanceOf(b.partyId) };
  }
  function cancelPayment(id) {
    const list = payments.all();
    const pay = list.find((x) => x.id === id);
    if (!pay) return { error: "Payment not found." };
    if (pay.status === "cancelled") return { error: `${pay.number} is already cancelled.` };
    pay.status = "cancelled"; pay.cancelledAt = new Date().toISOString();
    payments.put(list);
    return { payment: pay };
  }

  // ---- Purchases: stock comes in, cost price is remembered, the supplier is owed ----
  function addPurchase(b) {
    const party = parties.all().find((x) => x.id === b.partyId && x.type === "supplier" && !x.deleted);
    if (!party) return { error: "Pick a supplier." };
    const day = goodDay(b.day);
    if (!day) return { error: "Check the date. It can't be in the future." };
    if (!Array.isArray(b.lines) || !b.lines.length) return { error: "Add at least one item." };
    const items = load();
    const lines = [];
    for (const l of b.lines) {
      const p = items.find((x) => x.id === l.productId);
      if (!p) return { error: "One of the items isn't in your stock list." };
      const qty = Math.floor(Number(l.qty) || 0), cost = Number(l.cost), gstRate = Number(l.gstRate) || 0;
      if (qty < 1 || qty > 9999) return { error: `Check the quantity for “${p.name}”.` };
      if (!(cost >= 0) || cost > 10_000_000) return { error: `Check the purchase price for “${p.name}”.` };
      const taxable = round2(qty * cost), tax = round2(taxable * gstRate / 100);
      lines.push({ p, qty, cost, gstRate, taxable, tax, amount: round2(taxable + tax) });
    }
    const total = round2(lines.reduce((n, x) => n + x.amount, 0));
    const paid = Number(b.paid) || 0;
    if (paid < 0 || paid > total) return { error: "Paid can't be more than the bill." };
    if (paid && !MODES.includes(b.mode)) return { error: "Pick how it was paid." };
    const list = purchases.all();
    const pu = {
      id: newId(), number: nextNumber(list, "PB", day), supplierBill: String(b.supplierBill || "").trim().slice(0, 40), partyId: party.id, day,
      at: new Date().toISOString(), mode: paid ? b.mode : null, paid: round2(paid), total, status: "done",
      lines: lines.map(({ p, qty, cost, gstRate, taxable, tax, amount }) => ({ productId: p.id, code: p.code, name: p.name, qty, cost, gstRate, taxable, tax, amount })),
    };
    list.push(pu);
    purchases.put(list);
    for (const { p, qty, cost, gstRate } of lines) {
      p.quantity = billing.stockOf(p) + qty;
      if (p.status === "sold") p.status = "available";
      // Without a GSTIN the GST on a supplier's bill can't be claimed back: it's part of the cost.
      p.cost = billing.gstOn() ? cost : round2(cost * (1 + gstRate / 100));
      p.supplierId = party.id;
    }
    save(items);
    for (const { p, qty } of lines) logActivity({ type: "stock-in", id: p.id, qty, purchase: pu.number });
    return { purchase: pu, products: items };
  }
  function cancelPurchase(id) {
    const list = purchases.all();
    const pu = list.find((x) => x.id === id);
    if (!pu) return { error: "Purchase not found." };
    if (pu.status === "cancelled") return { error: `${pu.number} is already cancelled.` };
    const items = load();
    // Pieces already sold can't be un-bought. Check all before changing any.
    for (const l of pu.lines) {
      const p = items.find((x) => x.id === l.productId);
      if (p && billing.stockOf(p) < l.qty) return { error: `Only ${billing.stockOf(p)} × “${p.name}” left of the ${l.qty} bought, so this purchase can't be cancelled.` };
    }
    for (const l of pu.lines) {
      const p = items.find((x) => x.id === l.productId);
      if (!p) continue;
      p.quantity = billing.stockOf(p) - l.qty;
      if (p.quantity === 0) { p.status = "sold"; delete p.holdFor; }
    }
    pu.status = "cancelled"; pu.cancelledAt = new Date().toISOString();
    purchases.put(list);
    save(items);
    return { purchase: pu };
  }

  // ---- Expenses ----
  function addExpense(b) {
    const amount = money(b.amount), day = goodDay(b.day);
    if (!amount) return { error: "Enter the amount." };
    if (!day) return { error: "Check the date. It can't be in the future." };
    if (!MODES.includes(b.mode)) return { error: "Pick cash, UPI, card or bank." };
    const type = EXPENSE_TYPES.includes(b.type) ? b.type : "Other";
    const list = expenses.all();
    const ex = { id: newId(), number: nextNumber(list, "EXP", day), type, amount, mode: b.mode, day, note: String(b.note || "").slice(0, 200), at: new Date().toISOString(), status: "done" };
    list.push(ex);
    expenses.put(list);
    return { expense: ex };
  }
  function cancelExpense(id) {
    const list = expenses.all();
    const ex = list.find((x) => x.id === id);
    if (!ex) return { error: "Expense not found." };
    if (ex.status === "cancelled") return { error: `${ex.number} is already cancelled.` };
    ex.status = "cancelled";
    expenses.put(list);
    return { expense: ex };
  }

  // ---- Cash and bank: every rupee in and out, worked out from the records ----
  function cashbook(limit = 300) {
    const rows = [];
    const add = (mode, amount, day, at, kind, ref) => amount && rows.push({ mode, account: inBank(mode) ? "bank" : "cash", amount, day, at, kind, ref });
    for (const inv of liveInvoices()) add(inv.payment === "credit" ? inv.paidMode || "cash" : inv.payment, paidOn(inv), istDay(inv.at), inv.at, "Sale", inv.number);
    for (const p of payments.all()) if (p.status !== "cancelled") add(p.mode, p.direction === "in" ? p.amount : -p.amount, p.day, p.at, p.direction === "in" ? "Payment in" : "Payment out", p.number);
    for (const pu of purchases.all()) if (pu.status !== "cancelled" && pu.paid) add(pu.mode, -pu.paid, pu.day, pu.at, "Purchase", pu.number);
    for (const e of expenses.all()) if (e.status !== "cancelled") add(e.mode, -e.amount, e.day, e.at, `Expense: ${e.type}`, e.number);
    for (const r of returnsAll()) if (r.refund) add(r.mode, r.kind === "sale_return" ? -r.refund : r.refund, r.day, r.at, r.kind === "sale_return" ? "Refund to customer" : "Refund from supplier", r.number);
    rows.sort((a, b) => b.day.localeCompare(a.day) || String(b.at).localeCompare(String(a.at)));
    const s = settings();
    const sum = (acc) => round2(rows.filter((r) => r.account === acc).reduce((n, r) => n + r.amount, 0));
    return { cash: round2(s.openingCash + sum("cash")), bank: round2(s.openingBank + sum("bank")), openingCash: s.openingCash, openingBank: s.openingBank, rows: rows.slice(0, limit) };
  }
  function setOpening(b) {
    const openingCash = Number(b.openingCash ?? settings().openingCash), openingBank = Number(b.openingBank ?? settings().openingBank);
    if (!Number.isFinite(openingCash) || !Number.isFinite(openingBank)) return { error: "Check the amounts." };
    writeJson(settingsFile, { ...settings(), openingCash: round2(openingCash), openingBank: round2(openingBank) });
    return { ok: true };
  }

  // ---- Profit and loss, and the home screen numbers ----
  function profit(from, to) {
    const inRange = (d) => d >= from && d <= to;
    const bills = liveInvoices().filter((x) => inRange(istDay(x.at)));
    const sales = round2(bills.reduce((n, x) => n + x.taxable, 0));
    let cogs = 0, noCost = 0;
    for (const x of bills) for (const l of x.lines) { if (l.cost != null) cogs += l.cost * l.qty; else noCost += l.qty; }
    const spent = expenses.all().filter((e) => e.status !== "cancelled" && inRange(e.day)).reduce((n, e) => n + e.amount, 0);
    let back = 0, costBack = 0, otherIn = 0;
    for (const r of returnsAll()) {
      if (!inRange(r.day)) continue;
      if (r.kind === "sale_return") for (const l of r.lines) { back += l.taxable ?? l.amount; if (l.cost != null) costBack += l.cost * l.qty; }
      if (r.kind === "credit_note") back += r.total;
      if (r.kind === "debit_note") otherIn += r.total;
    }
    const net = round2(sales - back - (cogs - costBack) - spent + otherIn);
    return { from, to, sales: round2(sales - back), returns: round2(back), cogs: round2(cogs - costBack), gross: round2(sales - back - cogs + costBack), otherIncome: round2(otherIn), expenses: round2(spent), net, piecesWithoutCost: noCost };
  }
  // This financial year's sales, for the GST limit. Shipping out of J&K is counted separately
  // because the turnover limit doesn't cover inter-state sales of goods.
  function turnover() {
    const thisFy = fyOf(istDay());
    const bills = liveInvoices().filter((x) => fyOf(istDay(x.at)) === thisFy);
    const outside = bills.filter((x) => { const m = /(\d{6})\s*$/.exec(x.customer?.address || ""); return m && !/^(18|19)/.test(m[1]); });
    const back = returnsAll().filter((r) => (r.kind === "sale_return" || r.kind === "credit_note") && fyOf(r.day) === thisFy).reduce((n, r) => n + r.total, 0);
    return { total: round2(bills.reduce((n, x) => n + x.total, 0) - back), limit: SHOP.billing?.gstLimit || 4000000, outsideBills: outside.length, outsideTotal: round2(outside.reduce((n, x) => n + x.total, 0)) };
  }
  function latestRows() {
    const names = new Map(parties.all().map((p) => [p.id, p.name]));
    const rows = liveInvoices().slice(-8).map((x) => ({ at: x.at, day: istDay(x.at), type: "Sales Invoices", ref: x.number, id: x.id, party: x.customer?.name || "Walk-in", amount: x.total }));
    for (const p of payments.all().slice(-8)) if (p.status !== "cancelled") rows.push({ at: p.at, day: p.day, type: p.direction === "in" ? "Payment In" : "Payment Out", ref: p.number, party: names.get(p.partyId) || "", amount: p.amount });
    return rows.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 7);
  }
  function lastDays(count) {
    const bills = liveInvoices();
    return Array.from({ length: count }, (_, i) => {
      const day = istDay(Date.now() - (count - 1 - i) * 864e5), of = bills.filter((x) => istDay(x.at) === day);
      return { day, bills: of.length, total: round2(of.reduce((n, x) => n + x.total, 0)) };
    });
  }
  // What is still unpaid on each bill. A payment goes against the party, not one bill, so the
  // ledger balance is spread over their latest bills: payments have cleared the oldest first.
  function billDues() {
    const dues = new Map(), left = new Map();
    const bills = liveInvoices();
    for (let i = bills.length - 1; i >= 0; i--) {
      const inv = bills[i];
      if (!inv.partyId || paidOn(inv) >= inv.total) continue;
      if (!left.has(inv.partyId)) left.set(inv.partyId, Math.max(0, balanceOf(inv.partyId)));
      const open = Math.min(left.get(inv.partyId), Math.max(0, inv.total - paidOn(inv)));
      if (open > 0) dues.set(inv.id, round2(open));
      left.set(inv.partyId, round2(left.get(inv.partyId) - open));
    }
    return dues;
  }
  function dashboard() {
    const all = partyList();
    const today = istDay();
    const cb = cashbook();
    const items = load();
    return {
      toCollect: round2(all.filter((x) => x.balance > 0).reduce((n, x) => n + x.balance, 0)),
      toPay: round2(all.filter((x) => x.balance < 0).reduce((n, x) => n - x.balance, 0)),
      cash: cb.cash, bank: cb.bank,
      stockAtCost: round2(items.reduce((n, p) => n + (p.cost || 0) * Math.max(0, billing.stockOf(p)), 0)),
      month: profit(`${today.slice(0, 7)}-01`, today),
      gst: billing.gstOn(), turnover: turnover(),
      latest: latestRows(), week: lastDays(7), month30: lastDays(30),
      topDues: all.filter((x) => x.balance > 0).sort((a, b) => b.balance - a.balance).slice(0, 10).map((x) => ({ id: x.id, name: x.name, phone: x.phone, balance: x.balance })),
    };
  }

  const getSetting = (k) => settings()[k];
  const setSetting = (k, v) => writeJson(settingsFile, { ...settings(), [k]: v });
  return { billDues, shareLedger, sharedLedger, getSetting, setSetting, saveParty, customerFor, ledger, partyList, creditCheck, addPayment, cancelPayment, payments, addPurchase, cancelPurchase, purchases, addExpense, cancelExpense, expenses, cashbook, setOpening, profit, dashboard, EXPENSE_TYPES };
};
