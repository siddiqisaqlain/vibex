// Home, Parties, Purchases, Expenses and Cash & Bank tabs of the billing portal.
// Everything shown comes from the server, which works balances out from the records.
(() => {
  const { api, esc, inr, toast } = window.VX;
  const $ = (id) => document.getElementById(id);
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const dayText = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const modePick = (name, chosen = "cash") => `<div class="pay">${[["cash", "Cash"], ["upi", "UPI"], ["card", "Card"], ["bank", "Bank"]].map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}" ${v === chosen ? "checked" : ""}><span>${l}</span></label>`).join("")}</div>`;
  const modeOf = (name) => document.querySelector(`input[name=${name}]:checked`).value;
  const bal = (n) => (n > 0 ? `<b class="owed-in">${inr(n)}</b> <span class="sub">to collect</span>` : n < 0 ? `<b class="owed-out">${inr(-n)}</b> <span class="sub">to pay</span>` : `<span class="sub">Settled</span>`);
  const { twoTap, busy } = window.VX;

  // ---- Home: what happened today, what needs doing, then the same numbers as before ----
  const SINCE = { cash: "Cash", upi: "UPI", card: "Card", credit: "Credit" };
  let chartDays = 7;
  function waitText(t) {
    const left = t - Date.now(), h = Math.floor(left / 36e5), m = Math.max(0, Math.floor((left % 36e5) / 6e4));
    return left <= 0 ? "about to go back on sale" : h ? `goes back on sale in ${h}h ${m}m` : `goes back on sale in ${m} min`;
  }
  function todos(d) {
    const a = d.attention, out = [];
    // After the myBillBook import the cash book starts empty: old receipts are history, not cash in the drawer.
    if (d.setOpening) out.push(["high", "Set today's cash in hand and bank balance", "Your myBillBook history is in. Cash & Bank counts from today", "Set", () => window.VX.go("cash")]);
    if (a.ordersToCheck) out.push(["high", `${a.ordersToCheck} website order${a.ordersToCheck === 1 ? "" : "s"} to check`, a.nextLapse ? `A held piece ${waitText(a.nextLapse)}` : "Match the payment, then confirm", "Check", () => window.VX.go("orders")]);
    if (d.topDues.length) out.push(["", `${inr(d.toCollect)} to collect`, `${d.topDues.length === 10 ? "10 or more" : d.topDues.length} customer${d.topDues.length === 1 ? "" : "s"} owe you`, "See who", () => window.VX.go("parties")]);
    if (a.itemsToCount) out.push(["", `${a.itemsToCount} item${a.itemsToCount === 1 ? "" : "s"} to recount`, "Sold with no stock showing", "Count", () => window.VX.setStockFilter("check")]);
    if (a.lowStock) out.push(["", `${a.lowStock} item${a.lowStock === 1 ? "" : "s"} running low`, "At or below the alert level", "View", () => window.VX.setStockFilter("low")]);
    const failed = window.VX.data().alertFailures?.length || 0;
    if (failed) out.push(["high", `WhatsApp alerts failed to send ${failed} time${failed === 1 ? "" : "s"}`, "Last 7 days. Check Online Orders so none is missed", "Check", () => window.VX.go("orders")]);
    if (a.noPrice) out.push(["", `${a.noPrice} item${a.noPrice === 1 ? "" : "s"} missing a name or price`, "These can't be billed yet", "Fix", () => window.VX.setStockFilter("check")]);
    return out;
  }
  async function home() {
    const d = await api("/api/billing/dashboard");
    const m = d.month, t = d.today, yest = d.week[5]?.total || 0, list = todos(d);
    const compare = `Yesterday: ${inr(yest)}`; // a plain figure: "less than yesterday" would be wrong every morning
    const tile = (label, val, cls, go) => `<button class="tile" data-go="${go}">${label}<b class="${cls}">${val}</b></button>`;
    $("tab-home").innerHTML = `
      <div class="todayRow">
        <button class="hero" id="heroToday"><span>Today's Sales</span><b>${inr(t.total)}</b>
          <small>${t.bills} bill${t.bills === 1 ? "" : "s"} · ${t.pieces} piece${t.pieces === 1 ? "" : "s"}</small><small>${compare}</small>
          ${Object.keys(t.byPayment).length ? `<small class="modes">${Object.entries(t.byPayment).map(([k, v]) => `${SINCE[k] || k} ${inr(v)}`).join(" · ")}</small>` : ""}</button>
        <div class="todo"><b>Needs your attention</b>
          ${list.length ? list.map((x, i) => `<button class="todoRow ${x[0]}" data-todo="${i}"><span><b>${x[1]}</b><small>${x[2]}</small></span><em>${x[3]} →</em></button>`).join("") : `<div class="empty">All clear. Nothing needs you right now.</div>`}
        </div>
      </div>
      <h3>Your shop</h3>
      <div class="tiles">
        ${tile("To collect", inr(d.toCollect), "owed-in", "parties")}${tile("To pay", inr(d.toPay), "owed-out", "parties")}${tile("Cash", inr(d.cash), "", "cash")}${tile("Bank", inr(d.bank), "", "cash")}${tile("Stock at cost", inr(d.stockAtCost), "", "stock")}
      </div>
      <div class="dash">
        <div><div class="dashHead"><b>Latest Transactions</b><button class="x" id="allBills">See all</button></div>
          <div class="scroll"><table><thead><tr><th>Date</th><th>Type</th><th>Txn No</th><th>Party Name</th><th class="n">Amount</th></tr></thead><tbody>
          ${d.latest.length ? d.latest.map((x) => `<tr class="${x.id ? "click" : ""}" ${x.id ? `data-bill="${x.id}"` : ""}><td>${dayText(x.day)}</td><td>${esc(x.type)}</td><td>${esc(x.ref)}</td><td>${esc(x.party)}</td><td class="n">${inr(x.amount)}</td></tr>`).join("") : `<tr><td colspan="5" class="empty">Nothing yet. <button class="x" id="firstBill">Make your first bill</button></td></tr>`}
          </tbody></table></div></div>
        <div><div class="dashHead"><b>Sales Report</b><span class="seg"><button data-days="7" class="${chartDays === 7 ? "on" : ""}">7 days</button><button data-days="30" class="${chartDays === 30 ? "on" : ""}">30 days</button></span></div>
          ${salesChart(chartDays === 7 ? d.week : d.month30)}</div>
      </div>
      <div class="dash even">
        <div><b>This month</b>
          <div class="tiles flat"><div>Sales${d.gst ? " (before GST)" : ""}<b>${inr(m.sales)}</b></div><div>Cost of goods<b>${inr(m.cogs)}</b></div><div>Expenses<b>${inr(m.expenses)}</b></div><div>Profit<b>${inr(m.net)}</b></div></div>
          ${m.piecesWithoutCost ? `<p class="sub">⚠ ${m.piecesWithoutCost} piece${m.piecesWithoutCost === 1 ? "" : "s"} sold had no purchase price, so profit looks higher than it is.</p>` : ""}
          ${d.gst ? "" : turnoverBox(d.turnover)}
        </div>
        <div><b>Who owes the most</b>
          ${d.topDues.length ? `<table class="dues"><tbody>${d.topDues.slice(0, 6).map((x) => `<tr><td class="click" data-party="${x.id}"><b>${esc(x.name)}</b><div class="sub">${esc(x.phone || "")}</div></td><td class="n"><b>${inr(x.balance)}</b></td><td class="n">${x.phone ? `<a class="tbtn" href="${window.VX.reminder(x, x.balance)}" target="_blank" rel="noopener">Remind</a> ` : ""}<button class="tbtn" data-get="${x.id}">Collect</button></td></tr>`).join("")}</tbody></table>` : `<div class="empty">Nobody owes anything.</div>`}
        </div>
      </div>`;
    const P = $("tab-home");
    $("heroToday").onclick = () => $("todayBox").click();
    P.querySelectorAll("[data-todo]").forEach((b) => (b.onclick = () => list[+b.dataset.todo][4]()));
    P.querySelectorAll(".tile[data-go]").forEach((b) => (b.onclick = () => window.VX.go(b.dataset.go)));
    P.querySelectorAll("[data-bill]").forEach((r) => (r.onclick = async () => { await window.VX.go("bills"); window.VX.billPanel(r.dataset.bill); }));
    P.querySelectorAll("[data-party]").forEach((r) => (r.onclick = () => window.VX.go("parties", r.dataset.party)));
    P.querySelectorAll("[data-get]").forEach((b) => (b.onclick = () => window.VX.collect(b.dataset.get)));
    P.querySelectorAll("[data-days]").forEach((b) => (b.onclick = () => { chartDays = +b.dataset.days; home(); }));
    $("allBills").onclick = () => window.VX.go("bills");
    if ($("firstBill")) $("firstBill").onclick = () => window.VX.go("new");
  }

  // One series, so one colour. Each column is a hover and tap target. The totals sit beside it as text.
  function salesChart(days) {
    const W = 340, H = 150, top = 10, base = H - 22, n = days.length, max = Math.max(...days.map((x) => x.total), 1);
    const slot = (W - 8) / n, bar = Math.min(30, Math.max(3, slot - 2)), x0 = (i) => 4 + slot * i + (slot - bar) / 2;
    const short = (x) => (n === 7 ? new Date(x.day).toLocaleDateString("en-IN", { weekday: "short" }) : new Date(x.day).toLocaleDateString("en-IN", { day: "numeric", month: "short" }));
    const full = (x) => new Date(x.day).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
    window.VX.barTip = (i, on) => {
      const t = $("wkTip");
      document.querySelectorAll(".bar").forEach((b, k) => b.classList.toggle("lit", on && k === i));
      if (!on) return t.classList.add("hide");
      const x = days[i];
      t.textContent = `${full(x)}: ${inr(x.total)}, ${x.bills} bill${x.bills === 1 ? "" : "s"}`;
      t.style.left = `${Math.min(82, Math.max(18, ((x0(i) + bar / 2) / W) * 100))}%`; t.style.top = "0";
      t.classList.remove("hide");
    };
    const every = n === 7 ? 1 : 7;
    const bars = days.map((x, i) => {
      const h = x.total ? Math.max(3, (x.total / max) * (base - top)) : 0, r = Math.min(4, bar / 2, h), y = base - h;
      const d = h ? `M${x0(i)} ${base}V${y + r}Q${x0(i)} ${y} ${x0(i) + r} ${y}H${x0(i) + bar - r}Q${x0(i) + bar} ${y} ${x0(i) + bar} ${y + r}V${base}Z` : "";
      const lastOne = i === n - 1 && n > 7;
      const label = (n - 1 - i) % every === 0 ? `<text x="${lastOne ? x0(i) + bar : x0(i) + bar / 2}" y="${H - 6}" text-anchor="${lastOne ? "end" : "middle"}" font-size="10.5" fill="#667085">${short(x)}</text>` : "";
      return `${d ? `<path class="bar" d="${d}"/>` : `<g class="bar"></g>`}${label}<rect x="${4 + slot * i}" y="0" width="${slot}" height="${H}" fill="transparent" onpointerenter="VX.barTip(${i},true)" onpointerleave="VX.barTip(${i},false)" onclick="VX.barTip(${i},true)"/>`;
    }).join("");
    const sum = days.reduce((a, x) => a + x.total, 0), count = days.reduce((a, x) => a + x.bills, 0);
    return `<div class="week"><div style="position:relative"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales for the last ${n} days, total ${inr(sum)}">
        <line x1="4" x2="${W - 4}" y1="${base}" y2="${base}" stroke="var(--line)"/>${bars}</svg><div id="wkTip" class="hide"></div></div>
      <div class="weekStat"><span>Total sales<b>${inr(sum)}</b></span><span>Invoices Made<b>${count}</b></span><span>Average a day<b>${inr(Math.round(sum / n))}</b></span></div></div>`;
  }

  // No GSTIN yet: how close the shop is to needing one.
  function turnoverBox(x) {
    const pct = Math.min(100, Math.round((x.total / x.limit) * 100));
    return `<div class="gstBox"><div class="dashHead"><b>GST check, this financial year</b><span class="sub">${inr(x.total)} of ${inr(x.limit)}</span></div>
      <div class="meter" role="img" aria-label="${pct}% of the limit used"><i class="${pct >= 80 ? "hot" : ""}" style="width:${Math.max(pct, 1)}%"></i></div>
      <div class="sub">${pct}% used · Shipped outside J&amp;K: ${x.outsideBills} bill${x.outsideBills === 1 ? "" : "s"}</div>
      ${pct >= 80 ? `<p class="sub">⚠ Close to the limit. Talk to a CA about GST registration.</p>` : ""}
      ${x.outsideBills ? `<p class="sub">⚠ Selling goods to other states can need GST registration at any turnover. Check with a CA.</p>` : ""}</div>`;
  }

  // ---- Parties ----
  let partyType = "customer", partySearch = "", partyView = "", partyCache = [];
  async function parties(id) {
    if (id) return ledger(id);
    partyCache = await api("/api/billing/parties");
    const list = partyCache;
    const of = list.filter((x) => x.type === partyType);
    const owes = of.filter((x) => (partyType === "customer" ? x.balance > 0 : x.balance < 0));
    const sum = owes.reduce((n, x) => n + Math.abs(x.balance), 0);
    $("tab-parties").innerHTML = `
      <div class="partyTop"><div class="pay" style="max-width:320px;margin:0">
        <label><input type="radio" name="ptype" value="customer" ${partyType === "customer" ? "checked" : ""}><span>Customers</span></label>
        <label><input type="radio" name="ptype" value="supplier" ${partyType === "supplier" ? "checked" : ""}><span>Suppliers</span></label>
      </div>
      <details class="form"><summary>Create Party</summary>
        <div class="row2"><input id="pName" placeholder="Name"><input id="pPhone" type="tel" placeholder="Mobile"></div>
        <div class="row2"><input id="pGst" placeholder="GSTIN (optional)"><input id="pOpen" type="number" inputmode="decimal" placeholder="${partyType === "customer" ? "Already owes you ₹" : "You already owe ₹"}"></div>
        <div class="row2"><input id="pAddr" placeholder="Address"><input id="pLimit" type="number" inputmode="decimal" placeholder="Credit limit ₹ (optional)"></div>
        <button class="big" id="pSave">Save</button><div class="err" id="pErr"></div>
      </details></div>
      <div class="chips"><button class="chip ${partyView ? "" : "on"}" data-pv="">All ${of.length}</button><button class="chip ${partyView ? "on" : ""}" data-pv="owes">${partyType === "customer" ? "Owe you" : "You owe"} ${owes.length} · ${inr(sum)}</button></div>
      <input type="search" id="psearch" placeholder="Search name or mobile…" value="${esc(partySearch)}" autocomplete="off">
      <div class="scroll" style="margin-top:10px"><table><thead><tr><th>Party Name</th><th class="hideSm">Mobile Number</th><th>Party type</th><th class="n">Balance</th><th></th></tr></thead><tbody id="partyRows"></tbody></table></div>`;
    paintParties();
    document.querySelectorAll("input[name=ptype]").forEach((i) => (i.onchange = () => { partyType = i.value; partyView = ""; parties(); }));
    document.querySelectorAll("[data-pv]").forEach((b) => (b.onclick = () => { partyView = b.dataset.pv; parties(); }));
    $("psearch").oninput = (e) => { partySearch = e.target.value.toLowerCase(); paintParties(); };
    $("pSave").onclick = busy($("pSave"), async (requestId) => {
      // "Already owes" is entered as a positive number; a supplier's opening is what the shop owes.
      const o = Number($("pOpen").value) || 0;
      await api("/api/billing/parties", { method: "POST", requestId, body: JSON.stringify({ type: partyType, name: $("pName").value, phone: $("pPhone").value, gstin: $("pGst").value, address: $("pAddr").value, opening: partyType === "customer" ? o : -o, creditLimit: Number($("pLimit").value) || 0 }) });
      toast("Saved."); parties().catch((e) => toast(e.message, { bad: true }));
    }, "pErr");
  }
  function paintParties() {
    const shown = partyCache.filter((x) => x.type === partyType && (!partyView || (partyType === "customer" ? x.balance > 0 : x.balance < 0)) && (!partySearch || `${x.name} ${x.phone}`.toLowerCase().includes(partySearch))).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance) || a.name.localeCompare(b.name));
    $("partyRows").innerHTML = shown.length ? shown.map((x) => `<tr class="click" data-open="${x.id}"><td><b>${esc(x.name)}</b></td><td class="hideSm">${esc(x.phone)}</td><td>${x.type === "supplier" ? "Supplier" : "Customer"}</td><td class="n">${bal(x.balance)}</td>
      <td class="n">${x.balance > 0 && x.phone ? `<a class="tbtn" href="${window.VX.reminder(x, x.balance)}" target="_blank" rel="noopener">Remind</a> ` : ""}${x.balance ? `<button class="tbtn" data-get="${x.id}">${x.balance > 0 ? "Collect" : "Pay"}</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="5" class="empty">No ${partyType}s here yet.</td></tr>`;
    document.querySelectorAll("[data-open]").forEach((r) => (r.onclick = (e) => { if (e.target.closest("a,button")) return; window.VX.go("parties", r.dataset.open); }));
    document.querySelectorAll("#partyRows [data-get]").forEach((b) => (b.onclick = () => window.VX.collect(b.dataset.get)));
  }
  async function ledger(id) {
    const { party: p, rows, balance } = await api(`/api/billing/parties/${id}/ledger`);
    const direction = p.type === "customer" ? "in" : "out";
    const remind = balance > 0 && p.phone ? window.VX.reminder(p, balance) : "";
    $("pageTitle").textContent = p.name;
    $("tab-parties").innerHTML = `
      <button class="tbtn" id="back">← All parties</button>
      <div class="ledgerHead"><div><h2>${esc(p.name)}</h2>
        <p class="sub">${esc([p.phone, p.gstin, p.address].filter(Boolean).join(" · ")) || "No contact details yet"}${p.creditLimit ? ` · Limit ${inr(p.creditLimit)}` : ""}</p></div>
        <div class="ledgerBal"><span class="sub">Balance</span><div>${bal(balance)}</div></div></div>
      <div class="actions">
        <button class="primary" id="payNow">${direction === "in" ? "Payment In" : "Payment Out"}</button>
        ${remind ? `<a class="tbtn wa" href="${remind}" target="_blank" rel="noopener">Send WhatsApp reminder</a>` : ""}
        <button class="tbtn" id="shareLedger">${p.shareToken ? "Stop sharing ledger" : "Share ledger link"}</button>
        <button class="tbtn" id="editParty">Edit party</button>
      </div>
      ${p.shareToken ? `<p class="sub">Anyone with this link can see this ledger: <a href="/l/${p.shareToken}" target="_blank" rel="noopener">${esc(location.origin)}/l/${p.shareToken}</a></p>` : ""}
      <div class="scroll"><table><thead><tr><th>Date</th><th>Entry</th><th class="n">Amount</th><th class="n">Balance</th><th></th></tr></thead><tbody>
      ${rows.length ? rows.slice().reverse().map((r) => `<tr><td>${dayText(r.day)}</td><td>${esc(r.kind)}<div class="sub">${esc(r.ref)}</div></td><td class="n">${r.amount > 0 ? "+" : "−"}${inr(Math.abs(r.amount))}</td><td class="n">${inr(r.balance)}</td>
        <td class="n">${/^Payment/.test(r.kind) ? `<button class="tbtn danger" data-paycancel="${r.id}">Cancel</button>` : r.kind === "Sale" ? `<a class="tbtn" href="/bill/${r.id}?o" target="_blank" rel="noopener">View</a>` : ""}</td></tr>`).join("") : `<tr><td colspan="5" class="empty">No entries yet.</td></tr>`}
      </tbody></table></div>`;
    $("back").onclick = () => window.VX.go("parties");
    $("shareLedger").onclick = busy($("shareLedger"), async () => { await api(`/api/billing/parties/${id}/share`, { method: "POST", body: JSON.stringify({ on: !p.shareToken }) }); await ledger(id); });
    $("payNow").onclick = () => window.VX.collect(id);
    $("editParty").onclick = () => {
      window.VX.drawer("Edit party", `<label class="sub">Name<input id="epName" value="${esc(p.name)}"></label>
        <div class="row2"><label class="sub">Mobile<input id="epPhone" type="tel" value="${esc(p.phone)}"></label><label class="sub">GSTIN<input id="epGst" value="${esc(p.gstin)}"></label></div>
        <label class="sub">Address<input id="epAddr" value="${esc(p.address)}"></label>
        <label class="sub">Credit limit ₹<input id="epLimit" type="number" inputmode="decimal" value="${esc(p.creditLimit || "")}"></label>
        <button class="big" id="epSave">Save</button><div class="err" id="epErr"></div>`);
      $("epSave").onclick = busy($("epSave"), async () => {
        await api(`/api/billing/parties/${id}`, { method: "POST", body: JSON.stringify({ ...p, name: $("epName").value, phone: $("epPhone").value, gstin: $("epGst").value, address: $("epAddr").value, creditLimit: Number($("epLimit").value) || 0 }) });
        window.VX.closeDrawer(); toast("Saved."); await window.VX.reload(); ledger(id);
      }, "epErr");
    };
    document.querySelectorAll("[data-paycancel]").forEach((b) => twoTap(b, "Tap again to cancel", async () => { await api(`/api/billing/payments/${b.dataset.paycancel}/cancel`, { method: "POST", body: "{}" }); toast("Payment cancelled."); await window.VX.reload(); ledger(id); }));
  }

  // ---- Purchases ----
  const buy = [];
  let stockList = [];
  async function purchases() {
    const [list, ps, items] = await Promise.all([api("/api/billing/purchases"), api("/api/billing/parties"), api("/api/billing/products")]);
    stockList = items;
    const sup = ps.filter((x) => x.type === "supplier");
    const name = new Map(ps.map((x) => [x.id, x.name]));
    $("tab-purchases").innerHTML = `
      ${sup.length ? "" : `<p class="sub">Add a supplier first: <button class="x" onclick="VX.go('parties')">go to Parties</button>.</p>`}
      <details class="form"><summary>Create Purchase Invoice</summary>
        <div class="row2"><select id="buySup"><option value="">Supplier…</option>${sup.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select><input id="buyBill" placeholder="Supplier's bill no."></div>
        <input id="buyDay" type="date" value="${today()}" max="${today()}" style="margin-top:8px">
        <label class="sub" style="display:block;margin-top:8px">Scan the supplier's bill (photo)<input type="file" id="buyScan" accept="image/jpeg,image/png,image/webp"></label><div class="sub" id="buyScanMsg"></div>
        <input type="search" id="buyQ" placeholder="Type code or name to add an item…" style="margin-top:8px" autocomplete="off">
        <div class="results" id="buyHits" style="max-height:200px"></div>
        <div id="buyLines"></div>
        <div class="tot"><span>Total</span><span id="buyTotal">₹0</span></div>
        <div class="row2"><input id="buyPaid" type="number" inputmode="decimal" min="0" placeholder="Paid now ₹ (blank = on credit)"><div></div></div>
        ${modePick("buyMode")}
        <button class="big" id="buySave">Save purchase and add stock</button><div class="err" id="buyErr"></div>
      </details>
      <div class="scroll"><table><thead><tr><th>Bill</th><th>Supplier</th><th class="hideSm">Items</th><th class="n">Total</th><th></th></tr></thead><tbody>
      ${list.length ? list.map((x) => `<tr class="${x.status}"><td><b>${esc(x.number.split("/").pop())}</b><div class="sub">${dayText(x.day)}</div></td><td>${esc(name.get(x.partyId) || "")}${x.supplierBill ? `<div class="sub">${esc(x.supplierBill)}</div>` : ""}</td><td class="hideSm">${x.lines.map((l) => `${l.qty} × ${esc(l.name)}`).join("<br>")}</td><td class="n"><b>${inr(x.total)}</b>${x.paid ? `<div class="sub">paid ${inr(x.paid)}</div>` : ""}</td>
        <td class="n">${x.status === "cancelled" ? `<span class="sub">Cancelled</span>` : `<button class="tbtn danger" data-pucancel="${x.id}">Cancel</button>`}</td></tr>`).join("") : `<tr><td colspan="5" class="empty">No purchases yet.</td></tr>`}
      </tbody></table></div>`;
    paintBuy();
    $("buyScan").onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      $("buyScanMsg").textContent = "Reading the bill…";
      try {
        const b = await window.VX.scanBill(file);
        if (b.billNumber) $("buyBill").value = b.billNumber;
        const missed = [];
        for (const l of b.lines) { if (l.productId && !buy.some((x) => x.productId === l.productId)) buy.push({ productId: l.productId, name: l.matched, qty: l.qty, cost: l.cost, gstRate: l.gstRate }); else if (!l.productId) missed.push(l.name); }
        paintBuy();
        $("buyScanMsg").textContent = `Check every line before saving.${missed.length ? ` Not in your stock list: ${missed.join(", ")}.` : ""}`;
      } catch (err) { $("buyScanMsg").textContent = err.message; }
    };
    $("buyQ").oninput = () => {
      const q = $("buyQ").value.trim().toLowerCase();
      const hits = q ? stockList.filter((p) => `${p.code} ${p.name}`.toLowerCase().includes(q)).slice(0, 6) : [];
      $("buyHits").innerHTML = hits.map((p) => `<button class="item" data-add="${esc(p.id)}"><div class="grow"><div class="name">${esc(p.name)}</div><div class="sub">#${esc(p.code)}</div></div></button>`).join("");
      document.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => {
        const p = stockList.find((x) => x.id === b.dataset.add);
        if (!buy.some((l) => l.productId === p.id)) buy.push({ productId: p.id, name: p.name, qty: 1, cost: p.cost || "", gstRate: 0 });
        $("buyQ").value = ""; $("buyHits").innerHTML = ""; paintBuy();
      }));
    };
    $("buySave").onclick = busy($("buySave"), async (requestId) => {
      await api("/api/billing/purchases", { method: "POST", requestId, body: JSON.stringify({ partyId: $("buySup").value, supplierBill: $("buyBill").value, day: $("buyDay").value, lines: buy, paid: $("buyPaid").value, mode: modeOf("buyMode") }) });
      buy.length = 0; toast("Saved. Stock added on the website too."); purchases().catch((e) => toast(e.message, { bad: true }));
    }, "buyErr");
    document.querySelectorAll("[data-pucancel]").forEach((b) => twoTap(b, "Tap again: remove stock and its payment", async () => { await api(`/api/billing/purchases/${b.dataset.pucancel}/cancel`, { method: "POST", body: "{}" }); toast("Purchase cancelled."); purchases(); }));
  }
  function paintBuy() {
    const amtOf = (l) => (Number(l.qty) || 0) * (Number(l.cost) || 0) * (1 + (Number(l.gstRate) || 0) / 100);
    // Typing only updates the sums: redrawing the row would lose the box being moved to.
    const sums = () => {
      buy.forEach((l, i) => { const el = document.querySelector(`[data-amt="${i}"]`); if (el) el.textContent = inr(amtOf(l)); });
      $("buyTotal").textContent = inr(buy.reduce((n, l) => n + amtOf(l), 0));
    };
    $("buyLines").innerHTML = buy.map((l, i) => {
      return `<div class="line"><div class="grow"><div class="name">${esc(l.name)}</div><button class="x" data-brm="${i}">remove</button></div><div class="price" data-amt="${i}"></div>
        <div class="row3"><label class="sub">Qty<input type="number" inputmode="numeric" min="1" value="${esc(l.qty)}" data-b="qty" data-i="${i}"></label><label class="sub">Cost ₹<input type="number" inputmode="decimal" min="0" value="${esc(l.cost)}" data-b="cost" data-i="${i}"></label><label class="sub">GST on bill %<input type="number" inputmode="decimal" min="0" value="${esc(l.gstRate)}" data-b="gstRate" data-i="${i}"></label></div></div>`;
    }).join("");
    sums();
    document.querySelectorAll("[data-brm]").forEach((b) => (b.onclick = () => { buy.splice(+b.dataset.brm, 1); paintBuy(); }));
    document.querySelectorAll("[data-b]").forEach((i) => (i.oninput = () => { buy[+i.dataset.i][i.dataset.b] = i.value; sums(); }));
  }

  // ---- Expenses ----
  async function expenses() {
    const { list, types } = await api("/api/billing/expenses");
    $("tab-expenses").innerHTML = `
      <details class="form"><summary>Create Expense</summary>
        <div class="row2"><select id="exType" aria-label="Type">${types.map((t) => `<option>${esc(t)}</option>`).join("")}</select><input id="exAmt" type="number" inputmode="decimal" min="1" placeholder="Amount ₹"></div>
        <div class="row2"><input id="exDay" type="date" value="${today()}" max="${today()}"><input id="exNote" placeholder="Note (optional)"></div>
        ${modePick("exMode")}
        <button class="big" id="exSave">Save expense</button><div class="err" id="exErr"></div>
      </details>
      <div class="scroll"><table><thead><tr><th>Date</th><th>Type</th><th class="n">Amount</th><th></th></tr></thead><tbody>
      ${list.length ? list.map((x) => `<tr class="${x.status}"><td>${dayText(x.day)}</td><td>${esc(x.type)}<div class="sub">${esc(x.note)}</div></td><td class="n"><b>${inr(x.amount)}</b></td><td class="n">${x.status === "cancelled" ? `<span class="sub">Cancelled</span>` : `<button class="tbtn danger" data-excancel="${x.id}">Cancel</button>`}</td></tr>`).join("") : `<tr><td colspan="4" class="empty">No expenses yet.</td></tr>`}
      </tbody></table></div>`;
    $("exSave").onclick = busy($("exSave"), async (requestId) => {
      await api("/api/billing/expenses", { method: "POST", requestId, body: JSON.stringify({ type: $("exType").value, amount: $("exAmt").value, day: $("exDay").value, note: $("exNote").value, mode: modeOf("exMode") }) });
      toast("Saved."); expenses().catch((e) => toast(e.message, { bad: true }));
    }, "exErr");
    document.querySelectorAll("[data-excancel]").forEach((b) => twoTap(b, "Tap again to cancel", async () => { await api(`/api/billing/expenses/${b.dataset.excancel}/cancel`, { method: "POST", body: "{}" }); toast("Expense cancelled."); expenses(); }));
  }

  // ---- Cash and bank ----
  async function cash() {
    const c = await api("/api/billing/cash");
    $("tab-cash").innerHTML = `
      <div class="summary"><div>Cash in hand<b>${inr(c.cash)}</b></div><div>Bank and UPI<b>${inr(c.bank)}</b></div></div>
      <details class="form"><summary>Starting balances</summary>
        <p class="sub">What was in the till and the bank on the day you started using this.</p>
        <div class="row2"><input id="opCash" type="number" inputmode="decimal" value="${c.openingCash}" aria-label="Opening cash"><input id="opBank" type="number" inputmode="decimal" value="${c.openingBank}" aria-label="Opening bank"></div>
        <button class="big" id="opSave">Save</button><div class="err" id="opErr"></div>
      </details>
      <div class="scroll"><table><thead><tr><th>Date</th><th>Entry</th><th>Account</th><th class="n">Amount</th></tr></thead><tbody>
      ${c.rows.length ? c.rows.map((r) => `<tr><td>${dayText(r.day)}</td><td>${esc(r.kind)}<div class="sub">${esc(r.ref)}</div></td><td>${r.account === "cash" ? "Cash" : "Bank"}</td><td class="n"><b class="${r.amount > 0 ? "owed-in" : "owed-out"}">${r.amount > 0 ? "+" : "−"}${inr(Math.abs(r.amount))}</b></td></tr>`).join("") : `<tr><td colspan="4" class="empty">Nothing yet.</td></tr>`}
      </tbody></table></div>`;
    $("opSave").onclick = busy($("opSave"), async () => {
      await api("/api/billing/cash/opening", { method: "POST", body: JSON.stringify({ openingCash: $("opCash").value, openingBank: $("opBank").value }) });
      toast("Saved."); cash().catch((e) => toast(e.message, { bad: true }));
    }, "opErr");
  }

  Object.assign(window.VX.tabs, { home, parties, purchases, expenses, cash });
})();
