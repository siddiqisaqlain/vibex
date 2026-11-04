// Every report the portal shows, as { title, columns, rows, totals, note }. The same data
// drives the table on screen and the Excel (CSV) download.
const round2 = (n) => Math.round(n * 100) / 100;
const istDay = (d = new Date()) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const col = (key, label, type) => ({ key, label, type }); // type: "money" | "num" | undefined
const sum = (rows, key) => round2(rows.reduce((n, r) => n + (Number(r[key]) || 0), 0));
const totalsOf = (rows, keys) => Object.fromEntries(keys.map((k) => [k, sum(rows, k)]));

// Sold outside J&K = inter-state, which means IGST instead of CGST + SGST.
const interState = (inv) => { const m = /(\d{6})\s*$/.exec(inv.customer?.address || ""); return Boolean(m && !/^(18|19)/.test(m[1])); };

module.exports = function createReports({ SHOP, billing, books, documents, load }) {
  const liveBills = (from, to) => billing.loadInvoices().filter((x) => x.status !== "cancelled" && istDay(x.at) >= from && istDay(x.at) <= to);
  const liveReturns = (from, to) => documents.returns.all().filter((r) => r.status !== "cancelled" && r.day >= from && r.day <= to);
  const threshold = (p) => p.reorderAt ?? SHOP.billing?.lowStockAt ?? 1;
  const partyName = () => new Map(books.partyList().map((p) => [p.id, p.name]));
  const notGst = () => (billing.gstOn() ? "" : "No GSTIN set, so there's nothing to file yet. This report fills itself once a GSTIN is added.");

  const R = {
    sales(from, to) {
      const rows = liveBills(from, to).map((x) => ({ day: istDay(x.at), number: x.number, party: x.customer?.name || "Walk-in", from: x.source, pay: x.payment, pieces: x.lines.reduce((n, l) => n + l.qty, 0), total: x.total, due: round2(x.total - (x.paid ?? x.total)) }));
      return { title: "Sales Summary", columns: [col("day", "Date"), col("number", "Bill"), col("party", "Party"), col("from", "From"), col("pay", "Payment"), col("pieces", "Pieces", "num"), col("total", "Total", "money"), col("due", "Unpaid", "money")], rows, totals: totalsOf(rows, ["pieces", "total", "due"]) };
    },
    daily(from, to) {
      const days = {};
      const row = (d) => (days[d] ||= { day: d, bills: 0, pieces: 0, cash: 0, upi: 0, card: 0, credit: 0, returns: 0, net: 0 });
      for (const x of liveBills(from, to)) { const r = row(istDay(x.at)); r.bills++; r.pieces += x.lines.reduce((n, l) => n + l.qty, 0); r[x.payment] = (r[x.payment] || 0) + x.total; r.net += x.total; }
      for (const b of liveReturns(from, to)) if (b.kind === "sale_return" || b.kind === "credit_note") { const r = row(b.day); r.returns += b.total; r.net -= b.total; }
      const rows = Object.values(days).sort((a, b) => b.day.localeCompare(a.day));
      return { title: "Daily Sales", columns: [col("day", "Date"), col("bills", "Bills", "num"), col("pieces", "Pieces", "num"), col("cash", "Cash", "money"), col("upi", "UPI", "money"), col("card", "Card", "money"), col("credit", "Credit", "money"), col("returns", "Returns", "money"), col("net", "Net", "money")], rows, totals: totalsOf(rows, ["bills", "pieces", "cash", "upi", "card", "credit", "returns", "net"]) };
    },
    items(from, to) {
      const m = {};
      const row = (id, name) => (m[id] ||= { name, sold: 0, sales: 0, returned: 0, bought: 0, purchases: 0 });
      for (const x of liveBills(from, to)) for (const l of x.lines) { const r = row(l.productId, l.name); r.sold += l.qty; r.sales += l.amount; }
      for (const b of liveReturns(from, to)) if (b.kind === "sale_return") for (const l of b.lines) { const r = row(l.productId, l.name); r.returned += l.qty; r.sales -= l.amount; }
      for (const p of books.purchases.all()) if (p.status !== "cancelled" && p.day >= from && p.day <= to) for (const l of p.lines) { const r = row(l.productId, l.name); r.bought += l.qty; r.purchases += l.amount; }
      const rows = Object.values(m).map((r) => ({ ...r, sales: round2(r.sales), purchases: round2(r.purchases) })).sort((a, b) => b.sales - a.sales);
      return { title: "Item Sales and Purchase Summary", columns: [col("name", "Item"), col("sold", "Sold", "num"), col("returned", "Returned", "num"), col("sales", "Sales", "money"), col("bought", "Bought", "num"), col("purchases", "Purchases", "money")], rows, totals: totalsOf(rows, ["sold", "returned", "sales", "bought", "purchases"]) };
    },
    category(from, to) {
      const byId = new Map(load().map((p) => [p.id, p])), m = {};
      for (const x of liveBills(from, to)) for (const l of x.lines) { const c = byId.get(l.productId)?.category || "Other"; const r = (m[c] ||= { category: c, pieces: 0, sales: 0 }); r.pieces += l.qty; r.sales = round2(r.sales + l.amount); }
      const rows = Object.values(m).sort((a, b) => b.sales - a.sales);
      return { title: "Sales by Category", columns: [col("category", "Category"), col("pieces", "Pieces", "num"), col("sales", "Sales", "money")], rows, totals: totalsOf(rows, ["pieces", "sales"]) };
    },
    stock() {
      const rows = load().map((p) => { const q = billing.stockOf(p); return { code: p.code, barcode: p.barcode || "", name: p.name, category: p.category || "", qty: q, cost: p.cost ?? "", price: p.price ?? "", mrp: p.mrp ?? "", atCost: round2(q * (p.cost || 0)), atSale: round2(q * (p.price || 0)) }; }).sort((a, b) => a.name.localeCompare(b.name));
      return { title: "Stock Summary", noDates: true, columns: [col("code", "Code"), col("barcode", "Barcode"), col("name", "Item"), col("category", "Category"), col("qty", "Stock", "num"), col("cost", "Cost", "money"), col("price", "Price", "money"), col("mrp", "MRP", "money"), col("atCost", "Value at cost", "money"), col("atSale", "Value at price", "money")], rows, totals: totalsOf(rows, ["qty", "atCost", "atSale"]) };
    },
    low() {
      const rows = load().filter((p) => { const q = billing.stockOf(p); return q > 0 && q <= threshold(p); }).map((p) => ({ code: p.code, name: p.name, qty: billing.stockOf(p), at: threshold(p) })).sort((a, b) => a.qty - b.qty || a.name.localeCompare(b.name));
      return { title: "Low Stock Summary", noDates: true, columns: [col("code", "Code"), col("name", "Item"), col("qty", "Stock", "num"), col("at", "Alert at", "num")], rows };
    },
    rate() {
      const rows = load().filter((p) => p.price).map((p) => ({ code: p.code, name: p.name, mrp: p.mrp ?? "", price: p.price })).sort((a, b) => a.name.localeCompare(b.name));
      return { title: "Rate List", noDates: true, columns: [col("code", "Code"), col("name", "Item"), col("mrp", "MRP", "money"), col("price", "Price", "money")], rows };
    },
    parties() {
      const rows = books.partyList().map((p) => ({ name: p.name, type: p.type, phone: p.phone, balance: p.balance })).filter((p) => p.balance).sort((a, b) => b.balance - a.balance);
      return { title: "Party Balances", noDates: true, note: "Positive: they owe the shop. Negative: the shop owes them.", columns: [col("name", "Party"), col("type", "Type"), col("phone", "Mobile"), col("balance", "Balance", "money")], rows, totals: totalsOf(rows, ["balance"]) };
    },
    // Oldest unpaid first: each payment clears the oldest amount still open.
    ageing() {
      const today = Date.parse(istDay());
      const rows = [];
      for (const p of books.partyList().filter((x) => x.balance > 0)) {
        const open = []; let credit = 0;
        for (const r of books.ledger(p.id).rows) { if (r.amount > 0) open.push({ day: r.day, left: r.amount }); else credit -= r.amount; }
        for (const o of open) { const used = Math.min(o.left, credit); o.left -= used; credit -= used; }
        const row = { name: p.name, phone: p.phone, d30: 0, d60: 0, d90: 0, older: 0, total: p.balance };
        for (const o of open) { if (!o.left) continue; const age = (today - Date.parse(o.day)) / 864e5; row[age <= 30 ? "d30" : age <= 60 ? "d60" : age <= 90 ? "d90" : "older"] += o.left; }
        for (const k of ["d30", "d60", "d90", "older"]) row[k] = round2(row[k]);
        rows.push(row);
      }
      rows.sort((a, b) => b.older - a.older || b.total - a.total);
      return { title: "Receivable Ageing", noDates: true, columns: [col("name", "Party"), col("phone", "Mobile"), col("d30", "0-30 days", "money"), col("d60", "31-60 days", "money"), col("d90", "61-90 days", "money"), col("older", "Over 90 days", "money"), col("total", "Total", "money")], rows, totals: totalsOf(rows, ["d30", "d60", "d90", "older", "total"]) };
    },
    pnl(from, to) {
      const p = books.profit(from, to);
      const rows = [{ line: "Sales after returns", amount: p.sales }, { line: "Cost of goods sold", amount: -p.cogs }, { line: "Gross profit", amount: p.gross }, ...(p.otherIncome ? [{ line: "Other income (debit notes)", amount: p.otherIncome }] : []), { line: "Expenses", amount: -p.expenses }, { line: "Net profit", amount: p.net }];
      return { title: "Profit and Loss", note: p.piecesWithoutCost ? `${p.piecesWithoutCost} piece(s) sold have no purchase price, so profit looks higher than it is.` : "", columns: [col("line", ""), col("amount", "Amount", "money")], rows };
    },
    balance() {
      const d = books.dashboard();
      const assets = round2(d.cash + d.bank + d.toCollect + d.stockAtCost);
      const rows = [{ side: "Assets", line: "Cash in hand", amount: d.cash }, { side: "Assets", line: "Bank and UPI", amount: d.bank }, { side: "Assets", line: "To collect from customers", amount: d.toCollect }, { side: "Assets", line: "Stock at cost", amount: d.stockAtCost }, { side: "Assets", line: "Total assets", amount: assets }, { side: "Liabilities", line: "To pay suppliers", amount: d.toPay }, { side: "Capital", line: "Owner's capital and profit", amount: round2(assets - d.toPay) }, { side: "Total", line: "Liabilities and capital", amount: assets }];
      return { title: "Balance Sheet", noDates: true, note: "Capital is what's left after what the shop owes. Have his CA check this before using it for tax or a loan.", columns: [col("side", ""), col("line", ""), col("amount", "Amount", "money")], rows };
    },
    cash(from, to) {
      const rows = books.cashbook(100000).rows.filter((r) => r.day >= from && r.day <= to).map((r) => ({ day: r.day, kind: r.kind, ref: r.ref, account: r.account, in: r.amount > 0 ? r.amount : 0, out: r.amount < 0 ? -r.amount : 0 }));
      return { title: "Cash and Bank (All Payments)", columns: [col("day", "Date"), col("kind", "Entry"), col("ref", "Number"), col("account", "Account"), col("in", "Received", "money"), col("out", "Paid", "money")], rows, totals: totalsOf(rows, ["in", "out"]) };
    },
    daybook(from, to) {
      const names = partyName(), rows = [];
      for (const x of liveBills(from, to)) rows.push({ day: istDay(x.at), type: "Sale", ref: x.number, party: x.customer?.name || "Walk-in", amount: x.total });
      for (const p of books.payments.all()) if (p.status !== "cancelled" && p.day >= from && p.day <= to) rows.push({ day: p.day, type: p.direction === "in" ? "Payment in" : "Payment out", ref: p.number, party: names.get(p.partyId) || "", amount: p.amount });
      for (const p of books.purchases.all()) if (p.status !== "cancelled" && p.day >= from && p.day <= to) rows.push({ day: p.day, type: "Purchase", ref: p.number, party: names.get(p.partyId) || "", amount: p.total });
      for (const e of books.expenses.all()) if (e.status !== "cancelled" && e.day >= from && e.day <= to) rows.push({ day: e.day, type: `Expense: ${e.type}`, ref: e.number, party: "", amount: e.amount });
      for (const r of liveReturns(from, to)) rows.push({ day: r.day, type: documents.RETURN_KIND[r.kind][1], ref: r.number, party: names.get(r.partyId) || r.customer?.name || "", amount: r.total });
      rows.sort((a, b) => b.day.localeCompare(a.day));
      return { title: "Day Book", columns: [col("day", "Date"), col("type", "Type"), col("ref", "Number"), col("party", "Party"), col("amount", "Amount", "money")], rows };
    },
    // GSTR-1: registered buyers bill by bill, everyone else summed by rate, then HSN.
    gstr1b2b(from, to) {
      const rows = [];
      for (const x of liveBills(from, to)) {
        if (x.kind !== "tax-invoice" || !x.customer?.gstin) continue;
        const rates = {};
        for (const l of x.lines) { const r = (rates[l.gstRate] ||= { taxable: 0, tax: 0 }); r.taxable += l.taxable; r.tax += l.tax; }
        for (const [rate, r] of Object.entries(rates)) rows.push({ gstin: x.customer.gstin, party: x.customer.name, number: x.number, day: istDay(x.at), value: x.total, rate: Number(rate), taxable: round2(r.taxable), igst: interState(x) ? round2(r.tax) : 0, cgst: interState(x) ? 0 : round2(r.tax / 2), sgst: interState(x) ? 0 : round2(r.tax / 2) });
      }
      return { title: "GSTR-1: B2B (registered buyers)", note: notGst(), columns: [col("gstin", "Buyer GSTIN"), col("party", "Buyer"), col("number", "Bill"), col("day", "Date"), col("value", "Bill value", "money"), col("rate", "Rate %", "num"), col("taxable", "Taxable", "money"), col("igst", "IGST", "money"), col("cgst", "CGST", "money"), col("sgst", "SGST", "money")], rows, totals: totalsOf(rows, ["taxable", "igst", "cgst", "sgst"]) };
    },
    gstr1b2c(from, to) {
      const m = {};
      const add = (place, rate, taxable, tax, out) => { const r = (m[`${place}|${rate}`] ||= { place, rate: Number(rate), taxable: 0, igst: 0, cgst: 0, sgst: 0 }); r.taxable += taxable; if (out) r.igst += tax; else { r.cgst += tax / 2; r.sgst += tax / 2; } };
      for (const x of liveBills(from, to)) { if (x.kind !== "tax-invoice" || x.customer?.gstin) continue; const out = interState(x); for (const l of x.lines) add(out ? "Other states" : "Within state", l.gstRate, l.taxable, l.tax, out); }
      const bills = new Map(billing.loadInvoices().map((x) => [x.id, x]));
      for (const b of liveReturns(from, to)) { if (b.kind !== "sale_return") continue; const x = bills.get(b.invoiceId); if (!x || x.kind !== "tax-invoice" || x.customer?.gstin) continue; const out = interState(x); for (const l of b.lines) add(out ? "Other states" : "Within state", l.gstRate, -(l.taxable || 0), -(l.tax || 0), out); }
      const rows = Object.values(m).map((r) => ({ ...r, taxable: round2(r.taxable), igst: round2(r.igst), cgst: round2(r.cgst), sgst: round2(r.sgst) }));
      return { title: "GSTR-1: B2C (everyone else, after returns)", note: notGst(), columns: [col("place", "Place of supply"), col("rate", "Rate %", "num"), col("taxable", "Taxable", "money"), col("igst", "IGST", "money"), col("cgst", "CGST", "money"), col("sgst", "SGST", "money")], rows, totals: totalsOf(rows, ["taxable", "igst", "cgst", "sgst"]) };
    },
    hsn(from, to) {
      const m = {};
      for (const x of liveBills(from, to)) { if (x.kind !== "tax-invoice") continue; const out = interState(x); for (const l of x.lines) { const r = (m[`${l.hsn}|${l.gstRate}`] ||= { hsn: l.hsn || "(missing)", rate: l.gstRate, qty: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 }); r.qty += l.qty; r.taxable += l.taxable; if (out) r.igst += l.tax; else { r.cgst += l.tax / 2; r.sgst += l.tax / 2; } } }
      const rows = Object.values(m).map((r) => ({ ...r, taxable: round2(r.taxable), igst: round2(r.igst), cgst: round2(r.cgst), sgst: round2(r.sgst) }));
      return { title: "GSTR-1: HSN Summary", note: notGst(), columns: [col("hsn", "HSN"), col("rate", "Rate %", "num"), col("qty", "Pieces", "num"), col("taxable", "Taxable", "money"), col("igst", "IGST", "money"), col("cgst", "CGST", "money"), col("sgst", "SGST", "money")], rows, totals: totalsOf(rows, ["qty", "taxable", "igst", "cgst", "sgst"]) };
    },
    gstr3b(from, to) {
      const b2b = R.gstr1b2b(from, to).totals, b2c = R.gstr1b2c(from, to).totals;
      const taxable = round2(b2b.taxable + b2c.taxable), igst = round2(b2b.igst + b2c.igst), cgst = round2(b2b.cgst + b2c.cgst), sgst = round2(b2b.sgst + b2c.sgst);
      let itc = 0;
      for (const p of books.purchases.all()) if (p.status !== "cancelled" && p.day >= from && p.day <= to && billing.gstOn()) for (const l of p.lines) itc += l.tax || 0;
      itc = round2(itc);
      const rows = [{ line: "3.1(a) Outward taxable supplies", taxable, igst, cgst, sgst }, { line: "4 Input tax credit on purchases (check against GSTR-2B)", taxable: 0, igst: 0, cgst: round2(itc / 2), sgst: round2(itc / 2) }, { line: "Tax to pay in cash (estimate)", taxable: 0, igst: Math.max(0, round2(igst)), cgst: Math.max(0, round2(cgst - itc / 2)), sgst: Math.max(0, round2(sgst - itc / 2)) }];
      return { title: "GSTR-3B Summary", note: notGst() || "A working summary for his CA, not a filed return.", columns: [col("line", ""), col("taxable", "Taxable", "money"), col("igst", "IGST", "money"), col("cgst", "CGST", "money"), col("sgst", "SGST", "money")], rows };
    },
  };

  const LIST = [["Sales", [["daily", "Daily Sales"], ["sales", "Sales Summary"], ["category", "Sales by Category"], ["daybook", "Day Book"]]], ["Items", [["items", "Item Sales and Purchase"], ["stock", "Stock Summary"], ["low", "Low Stock"], ["rate", "Rate List"]]], ["Parties", [["parties", "Party Balances"], ["ageing", "Receivable Ageing"]]], ["Accounts", [["pnl", "Profit and Loss"], ["balance", "Balance Sheet"], ["cash", "Cash and Bank"]]], ["GST", [["gstr1b2b", "GSTR-1 B2B"], ["gstr1b2c", "GSTR-1 B2C"], ["hsn", "HSN Summary"], ["gstr3b", "GSTR-3B Summary"]]]];

  function run(name, from = "0000-01-01", to = "9999-12-31") { return R[name] ? R[name](from, to) : null; }
  function csv(rep) {
    const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; // Excel must never run a cell as a formula
    const lines = [[rep.title], rep.columns.map((c) => c.label), ...rep.rows.map((r) => rep.columns.map((c) => r[c.key]))];
    if (rep.totals) lines.push(rep.columns.map((c, i) => (c.key in rep.totals ? rep.totals[c.key] : i === 0 ? "Total" : "")));
    return "﻿" + lines.map((l) => l.map(cell).join(",")).join("\r\n");
  }
  // WhatsApp: what needs reordering. onlyToday keeps the evening message to fresh news.
  function lowText({ onlyToday = false, soldToday = new Set() } = {}) {
    let rows = R.low().rows;
    if (onlyToday) rows = rows.filter((r) => soldToday.has(r.code));
    if (!rows.length) return onlyToday ? null : "✅ Nothing is running low.";
    return `📉 *Running low: ${rows.length}*\n${rows.slice(0, 20).map((r) => `${r.qty} left · ${r.name} (#${r.code})`).join("\n")}${rows.length > 20 ? `\n…and ${rows.length - 20} more` : ""}\n\nMore came in? Send *add ${rows[0].code} 5*`;
  }
  return { run, csv, LIST, lowText, interState };
};
module.exports.interState = interState;
