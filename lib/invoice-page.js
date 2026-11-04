// The printable bill: /bill/<id>. The id is random, so the link can go to the customer on
// WhatsApp. Prints on A4, or on a 3-inch shop printer with ?size=80.
const { inWords } = require("./billing");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = (n) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const round1 = (n) => Math.round(n * 100) / 100;
const PAY = { cash: "Cash", upi: "UPI", card: "Card", credit: "Credit (to be paid)" };

module.exports = function invoicePage(inv, SHOP, { thermal = false, owner = false } = {}) {
  const b = SHOP.business || {};
  const gst = inv.kind === "tax-invoice";
  const date = new Date(inv.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const c = inv.customer || {};
  const bill = SHOP.billing || {};
  const sub = inv.lines.reduce((n, l) => n + l.amount, 0), discTotal = inv.lines.reduce((n, l) => n + (l.disc || 0), 0);
  const received = inv.paid != null ? inv.paid : inv.payment === "credit" ? 0 : inv.total;
  // His counter wording stays on counter bills. Website orders go by the website's returns policy.
  const terms = inv.source === "website" ? "Returns as per vibexindia.com/returns" : bill.terms || "";
  const anyDisc = inv.lines.some((l) => l.disc);
  const rows = inv.lines.map((l) => `<tr>
      <td><b>${esc(l.name)}</b>${l.sizes ? `<small>${esc(l.sizes)}</small>` : ""}${gst && l.hsn ? `<small>HSN ${esc(l.hsn)}</small>` : ""}</td>
      <td class="n">${l.qty} PCS</td>
      <td class="n">${l.mrp ? whole(l.mrp) : "-"}</td>
      <td class="n">${whole(l.unit)}</td>
      <td class="n">${l.disc ? `${whole(l.disc)}<small>(${round1((l.disc / (l.unit * l.qty)) * 100)}%)</small>` : "-"}</td>
      ${gst ? `<td class="n">${l.gstRate}%</td>` : ""}
      <td class="n">${whole(l.amount)}</td></tr>`).join("");
  // GST summary by rate. J&K shop, sold in J&K: CGST + SGST, half each.
  const byRate = {};
  for (const l of inv.lines) { const r = (byRate[l.gstRate] ||= { taxable: 0, tax: 0 }); r.taxable += l.taxable; r.tax += l.tax; }
  const taxRows = gst ? Object.entries(byRate).map(([rate, r]) => `<tr><td>${rate}%</td><td class="n">${money(r.taxable)}</td><td class="n">${money(r.tax / 2)}</td><td class="n">${money(r.tax / 2)}</td></tr>`).join("") : "";
  const cancelled = inv.status === "cancelled";
  const waText = encodeURIComponent(`Hi${c.name ? " " + c.name : ""}, thank you for shopping at ${SHOP.name}! Your bill ${inv.number} (₹${money(inv.total)}): `);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(inv.number)} · ${esc(SHOP.name)}</title>
<style>
  :root{--ink:#16130f;--mute:#6b665e;--line:#e3ded5;--red:#e92e30;--paper:#fff}
  *{box-sizing:border-box}body{margin:0;background:#f3f1ec;color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .sheet{max-width:${thermal ? "80mm" : "820px"};margin:24px auto;background:var(--paper);padding:${thermal ? "10px" : "36px 40px"};border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,.08);position:relative}
  h1{margin:0;font-size:${thermal ? "18px" : "26px"};letter-spacing:-.01em}.tag{color:var(--mute);margin:2px 0 0}
  .strip{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;font-weight:600;margin-bottom:12px}
  .strip b{font-size:13px}.strip span.box{border:1px solid var(--mute);padding:1px 6px;font-size:11px;letter-spacing:.03em}
  .logo{width:96px;height:96px;object-fit:contain;flex:none}
  .head{display:flex;gap:16px;align-items:center;border-bottom:4px solid var(--ink);padding-bottom:12px}
  .head .tag{font-size:13px}
  .band{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;background:#e7e7e7;padding:8px 12px}
  .kind{font-weight:700;text-transform:uppercase;letter-spacing:.08em;font-size:12px;color:var(--red)}
  .top>div:first-child{flex:1 1 320px;min-width:0}.meta{text-align:right;flex:none}.meta b{font-size:16px}
  .two{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:14px 0}.two div{min-width:0}
  .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--mute)}
  table{width:100%;border-collapse:collapse;margin-top:8px}th,td{padding:7px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--mute);font-weight:600}
  td small{display:block;color:var(--mute);font-size:12px}.n{text-align:right;white-space:nowrap}
  .tot{margin-left:auto;width:min(320px,100%);margin-top:10px}.tot div{display:flex;justify-content:space-between;padding:3px 0}
  .tot .grand{font-size:18px;font-weight:800;border-top:2px solid var(--ink);margin-top:6px;padding-top:8px}
  .words{color:var(--mute);font-size:12px;margin-top:6px;text-align:right}
  .foot{margin-top:22px;padding-top:12px;border-top:1px solid var(--line);color:var(--mute);font-size:12px}
  .stamp{position:absolute;top:40%;left:50%;transform:translate(-50%,-50%) rotate(-14deg);border:4px solid var(--red);color:var(--red);font-size:44px;font-weight:900;padding:4px 18px;opacity:.55;letter-spacing:.1em}
  .bar{max-width:820px;margin:16px auto 0;display:flex;gap:8px;flex-wrap:wrap;padding:0 16px}
  .bar a,.bar button{font:inherit;font-weight:600;padding:10px 14px;border-radius:8px;border:1px solid var(--ink);background:#fff;color:var(--ink);text-decoration:none;cursor:pointer}
  .bar .go{background:var(--ink);color:#fff}
  ${thermal ? ".two,.band{display:block}.head{display:block}body{font-size:12px}" : ""}
  @media (max-width:600px){.sheet{margin:12px;padding:18px}.meta{text-align:left}}
  @media print{body{background:#fff}.bar{display:none}.sheet{box-shadow:none;margin:0;max-width:none;padding:${thermal ? "0" : "0 6mm"}}@page{size:${thermal ? "80mm auto" : "A4"};margin:${thermal ? "2mm" : "12mm"}}}
</style></head><body>
<div class="bar">
  <button class="go" onclick="print()">Print / Save PDF</button>
  ${c.phone ? `<a href="https://wa.me/91${esc(c.phone)}?text=${waText}${encodeURIComponent("{{URL}}")}" target="_blank" rel="noopener" id="wa">Send on WhatsApp</a>` : ""}
  <a href="?size=${thermal ? "a4" : "80"}">${thermal ? "A4 size" : "3-inch printer size"}</a>
  ${owner ? `<a href="/billing">Back to billing</a>` : ""}
</div>
<div class="sheet">
  ${cancelled ? `<div class="stamp">CANCELLED</div>` : ""}
  <div class="strip"><b>${gst ? "TAX INVOICE" : "BILL OF SUPPLY"}</b><span class="box">ORIGINAL FOR RECIPIENT</span>${bill.headerLine ? `<span>${esc(bill.headerLine)}</span>` : ""}</div>
  <div class="head">
    ${bill.logo ? `<img class="logo" src="${esc(bill.logo)}" alt="">` : ""}
    <div>
      <h1>${esc(b.legalName || SHOP.name)}</h1>
      <p class="tag">${esc(b.address || SHOP.city || "")}</p>
      <p class="tag">Mobile: ${esc(b.phone || "")}${bill.email ? ` · Email: ${esc(bill.email)}` : ""}</p>
      ${SHOP.igHandle ? `<p class="tag">Instagram: @${esc(SHOP.igHandle)}${bill.youtube ? ` · YouTube: ${esc(bill.youtube)}` : ""} · WhatsApp: ${esc(b.phone || "")}</p>` : ""}
      ${b.gstin ? `<p class="tag"><b>GSTIN ${esc(b.gstin)}</b></p>` : ""}
    </div>
  </div>
  <div class="band"><span><b>Invoice No.:</b> ${esc(inv.number)}</span><span><b>Invoice Date:</b> ${esc(date)}</span></div>
  <div class="two">
    <div><div class="lbl">Bill to</div><b>${esc(c.name || "Walk-in customer")}</b>${c.phone ? `<br>Mobile: ${esc(c.phone)}` : ""}${c.address ? `<br>${esc(c.address)}` : ""}${c.gstin ? `<br>GSTIN ${esc(c.gstin)}` : ""}${inv.order ? `<br>Order ${esc(inv.order)}` : ""}</div>
    <div style="text-align:right"><div class="lbl">Payment</div>${esc(PAY[inv.payment] || inv.payment)}</div>
  </div>
  <table><thead><tr><th>Items</th><th class="n">Qty.</th><th class="n">MRP</th><th class="n">Rate</th><th class="n">Disc.</th>${gst ? `<th class="n">GST</th>` : ""}<th class="n">Amount</th></tr></thead><tbody>${rows}</tbody>
  <tfoot><tr><th colspan="4">Subtotal</th><th class="n">${discTotal ? `₹${whole(discTotal)}` : ""}</th>${gst ? "<th></th>" : ""}<th class="n">₹${whole(sub)}</th></tr></tfoot></table>
  ${gst ? `<table style="margin-top:14px;font-size:12px"><thead><tr><th>GST rate</th><th class="n">Taxable ₹</th><th class="n">CGST ₹</th><th class="n">SGST ₹</th></tr></thead><tbody>${taxRows}</tbody></table>` : ""}
  <div class="tot">
    ${gst ? `<div><span>Taxable value</span><span>₹${money(inv.taxable)}</span></div><div><span>GST (incl.)</span><span>₹${money(inv.tax)}</span></div>` : ""}
    ${(inv.charges || []).map((x) => `<div><span>${esc(x.label)}</span><span>₹${whole(x.amount)}</span></div>`).join("")}
    <div class="grand"><span>Total Amount</span><span>₹${whole(inv.total)}</span></div>
    <div><span>Received Amount</span><span>₹${whole(received)}</span></div>
    <div><b>Balance</b><b>₹${whole(round1(inv.total - received))}</b></div>
  </div>
  ${terms ? `<p style="margin:10px 0 0"><b>Terms and Conditions</b><br>${esc(terms)}</p>` : ""}
  <div class="words">${esc(inWords(inv.total))}</div>
  ${inv.note ? `<p class="foot">${esc(inv.note)}</p>` : ""}
  <div class="foot">${gst ? "Prices include GST." : "Seller not registered under GST. No GST charged."} Thank you for shopping at ${esc(SHOP.name)}.${SHOP.igHandle ? ` Instagram @${esc(SHOP.igHandle)}.` : ""}${cancelled ? ` Cancelled ${esc(new Date(inv.cancelledAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }))}${inv.cancelReason ? `: ${esc(inv.cancelReason)}` : ""}.` : ""}</div>
</div>
<script>var w=document.getElementById("wa");if(w)w.href=w.href.replace(encodeURIComponent("{{URL}}"),encodeURIComponent(location.origin+location.pathname));</script>
</body></html>`;
};
