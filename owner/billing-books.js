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
  // Two taps instead of a pop-up. The label says what the second tap will do.
  function twoTap(b, label, run) {
    const first = b.textContent;
    b.onclick = async () => {
      if (!b.classList.contains("sure")) { b.classList.add("sure"); b.textContent = label; setTimeout(() => { b.classList.remove("sure"); b.textContent = first; }, 4000); return; }
      b.disabled = true;
      try { await run(); } catch (e) { toast(e.message); b.disabled = false; }
    };
  }

  // ---- Home ----
  async function home() {
    const d = await api("/api/billing/dashboard");
    const m = d.month;
    $("tab-home").innerHTML = `
      <div class="summary">
        <div>To collect<b class="owed-in">${inr(d.toCollect)}</b></div><div>To pay<b class="owed-out">${inr(d.toPay)}</b></div>
        <div>Cash<b>${inr(d.cash)}</b></div><div>Bank<b>${inr(d.bank)}</b></div><div>Stock at cost<b>${inr(d.stockAtCost)}</b></div>
      </div>
      <h3>This month</h3>
      <div class="summary">
        <div>Sales${d.gst ? " (before GST)" : ""}<b>${inr(m.sales)}</b></div><div>Cost of goods<b>${inr(m.cogs)}</b></div><div>Expenses<b>${inr(m.expenses)}</b></div><div>Profit<b>${inr(m.net)}</b></div>
      </div>
      ${m.piecesWithoutCost ? `<p class="sub">⚠ ${m.piecesWithoutCost} piece(s) sold have no purchase price, so profit looks higher than it is. Enter a purchase to set their cost.</p>` : ""}
      ${d.gst ? "" : turnoverBox(d.turnover)}
      <h3>Who owes the most</h3>
      ${d.topDues.length ? `<div class="scroll"><table><tbody>${d.topDues.map((x) => `<tr><td>${esc(x.name)}</td><td class="n"><b>${inr(x.balance)}</b></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">Nobody owes anything.</div>`}`;
  }

  // No GSTIN yet: how close the shop is to needing one.
  function turnoverBox(t) {
    const pct = Math.min(100, Math.round((t.total / t.limit) * 100));
    return `<h3>GST check, this financial year</h3>
      <div class="summary"><div>Sales so far<b>${inr(t.total)}</b></div><div>Limit<b>${inr(t.limit)}</b></div><div>Used<b class="${pct >= 80 ? "owed-out" : ""}">${pct}%</b></div><div>Shipped outside J&amp;K<b class="${t.outsideBills ? "owed-out" : ""}">${t.outsideBills} bill${t.outsideBills === 1 ? "" : "s"}</b></div></div>
      ${pct >= 80 ? `<p class="sub">⚠ Close to the limit. Talk to a CA about GST registration.</p>` : ""}
      ${t.outsideBills ? `<p class="sub">⚠ Selling goods to other states can need GST registration at any turnover. Check with a CA.</p>` : ""}`;
  }

  // ---- Parties ----
  let partyType = "customer", open = null, partySearch = "";
  async function parties() {
    if (open) return ledger(open);
    const list = await api("/api/billing/parties");
    const shown = list.filter((x) => x.type === partyType && (!partySearch || `${x.name} ${x.phone}`.toLowerCase().includes(partySearch)));
    $("tab-parties").innerHTML = `
      <div class="pay" style="max-width:320px">
        <label><input type="radio" name="ptype" value="customer" ${partyType === "customer" ? "checked" : ""}><span>Customers</span></label>
        <label><input type="radio" name="ptype" value="supplier" ${partyType === "supplier" ? "checked" : ""}><span>Suppliers</span></label>
      </div>
      <input type="search" id="psearch" placeholder="Search name or mobile…" value="${esc(partySearch)}" style="margin-top:10px" autocomplete="off">
      <details class="form"><summary>Add ${partyType}</summary>
        <div class="row2"><input id="pName" placeholder="Name"><input id="pPhone" type="tel" placeholder="Mobile"></div>
        <div class="row2"><input id="pGst" placeholder="GSTIN (optional)"><input id="pOpen" type="number" placeholder="${partyType === "customer" ? "Already owes you ₹" : "You already owe ₹"}"></div>
        <div class="row2"><input id="pAddr" placeholder="Address"><input id="pLimit" type="number" placeholder="Credit limit ₹ (optional)"></div>
        <button class="big" id="pSave">Save</button><div class="err" id="pErr"></div>
      </details>
      <div class="scroll"><table><thead><tr><th>Name</th><th class="hideSm">Mobile</th><th class="n">Balance</th></tr></thead><tbody>
      ${shown.length ? shown.map((x) => `<tr class="click" data-open="${x.id}"><td><b>${esc(x.name)}</b></td><td class="hideSm">${esc(x.phone)}</td><td class="n">${bal(x.balance)}</td></tr>`).join("") : `<tr><td colspan="3" class="empty">No ${partyType}s yet.</td></tr>`}
      </tbody></table></div>`;
    document.querySelectorAll("input[name=ptype]").forEach((i) => (i.onchange = () => { partyType = i.value; parties(); }));
    $("psearch").oninput = (e) => { partySearch = e.target.value.toLowerCase(); const at = e.target.selectionStart; parties().then(() => { $("psearch").focus(); $("psearch").setSelectionRange(at, at); }); };
    document.querySelectorAll("[data-open]").forEach((r) => (r.onclick = () => { open = r.dataset.open; parties(); }));
    $("pSave").onclick = async () => {
      // "Already owes" is entered as a positive number; a supplier's opening is what the shop owes.
      const o = Number($("pOpen").value) || 0;
      try {
        await api("/api/billing/parties", { method: "POST", body: JSON.stringify({ type: partyType, name: $("pName").value, phone: $("pPhone").value, gstin: $("pGst").value, address: $("pAddr").value, opening: partyType === "customer" ? o : -o, creditLimit: Number($("pLimit").value) || 0 }) });
        toast("Saved."); parties();
      } catch (e) { $("pErr").textContent = e.message; }
    };
  }
  async function ledger(id) {
    const { party: p, rows, balance } = await api(`/api/billing/parties/${id}/ledger`);
    const direction = p.type === "customer" ? "in" : "out";
    const remind = balance > 0 && p.phone ? `https://wa.me/91${p.phone}?text=${encodeURIComponent(`Hi ${p.name}, this is Vibe X. Your balance with us is ${inr(balance)}. You can pay on UPI 7006656599@ibl. Thank you!`)}` : "";
    $("tab-parties").innerHTML = `
      <button class="tbtn" id="back">← All parties</button>
      <h2 style="margin:12px 0 2px">${esc(p.name)}</h2>
      <p class="sub">${esc([p.phone, p.gstin, p.address].filter(Boolean).join(" · "))}${p.creditLimit ? ` · Limit ${inr(p.creditLimit)}` : ""}</p>
      <div class="summary"><div>Balance<span style="display:block;font-size:17px">${bal(balance)}</span></div></div>
      ${remind ? `<a class="tbtn" href="${remind}" target="_blank" rel="noopener">Send WhatsApp reminder</a>` : ""}
      <details class="form" open><summary>${direction === "in" ? "Record payment received" : "Record payment made"}</summary>
        <div class="row2"><input id="payAmt" type="number" min="1" placeholder="Amount ₹"><input id="payDay" type="date" value="${today()}" max="${today()}"></div>
        ${modePick("payMode")}
        <input id="payNote" placeholder="Note (optional)" style="margin-top:8px">
        <button class="big" id="paySave">Save payment</button><div class="err" id="payErr"></div>
      </details>
      <div class="scroll"><table><thead><tr><th>Date</th><th>Entry</th><th class="n">Amount</th><th class="n">Balance</th><th></th></tr></thead><tbody>
      ${rows.length ? rows.slice().reverse().map((r) => `<tr><td>${dayText(r.day)}</td><td>${esc(r.kind)}<div class="sub">${esc(r.ref)}</div></td><td class="n">${r.amount > 0 ? "+" : "−"}${inr(Math.abs(r.amount))}</td><td class="n">${inr(r.balance)}</td>
        <td class="n">${/^Payment/.test(r.kind) ? `<button class="tbtn danger" data-paycancel="${r.id}">Cancel</button>` : r.kind === "Sale" ? `<a class="tbtn" href="/bill/${r.id}?o" target="_blank" rel="noopener">View</a>` : ""}</td></tr>`).join("") : `<tr><td colspan="5" class="empty">No entries yet.</td></tr>`}
      </tbody></table></div>`;
    $("back").onclick = () => { open = null; parties(); };
    $("paySave").onclick = async () => {
      try {
        await api("/api/billing/payments", { method: "POST", body: JSON.stringify({ direction, partyId: id, amount: $("payAmt").value, day: $("payDay").value, mode: modeOf("payMode"), note: $("payNote").value }) });
        toast("Payment saved."); ledger(id);
      } catch (e) { $("payErr").textContent = e.message; }
    };
    document.querySelectorAll("[data-paycancel]").forEach((b) => twoTap(b, "Tap again to cancel", async () => { await api(`/api/billing/payments/${b.dataset.paycancel}/cancel`, { method: "POST", body: "{}" }); toast("Payment cancelled."); ledger(id); }));
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
      ${sup.length ? "" : `<p class="sub">Add a supplier under Parties first.</p>`}
      <details class="form" open><summary>New purchase</summary>
        <div class="row2"><select id="buySup"><option value="">Supplier…</option>${sup.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select><input id="buyBill" placeholder="Supplier's bill no."></div>
        <input id="buyDay" type="date" value="${today()}" max="${today()}" style="margin-top:8px">
        <input type="search" id="buyQ" placeholder="Type code or name to add an item…" style="margin-top:8px" autocomplete="off">
        <div class="results" id="buyHits" style="max-height:200px"></div>
        <div id="buyLines"></div>
        <div class="tot"><span>Total</span><span id="buyTotal">₹0</span></div>
        <div class="row2"><input id="buyPaid" type="number" min="0" placeholder="Paid now ₹ (blank = on credit)"><div></div></div>
        ${modePick("buyMode")}
        <button class="big" id="buySave">Save purchase and add stock</button><div class="err" id="buyErr"></div>
      </details>
      <div class="scroll"><table><thead><tr><th>Bill</th><th>Supplier</th><th class="hideSm">Items</th><th class="n">Total</th><th></th></tr></thead><tbody>
      ${list.length ? list.map((x) => `<tr class="${x.status}"><td><b>${esc(x.number.split("/").pop())}</b><div class="sub">${dayText(x.day)}</div></td><td>${esc(name.get(x.partyId) || "")}${x.supplierBill ? `<div class="sub">${esc(x.supplierBill)}</div>` : ""}</td><td class="hideSm">${x.lines.map((l) => `${l.qty} × ${esc(l.name)}`).join("<br>")}</td><td class="n"><b>${inr(x.total)}</b>${x.paid ? `<div class="sub">paid ${inr(x.paid)}</div>` : ""}</td>
        <td class="n">${x.status === "cancelled" ? `<span class="sub">Cancelled</span>` : `<button class="tbtn danger" data-pucancel="${x.id}">Cancel</button>`}</td></tr>`).join("") : `<tr><td colspan="5" class="empty">No purchases yet.</td></tr>`}
      </tbody></table></div>`;
    paintBuy();
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
    $("buySave").onclick = async () => {
      try {
        await api("/api/billing/purchases", { method: "POST", body: JSON.stringify({ partyId: $("buySup").value, supplierBill: $("buyBill").value, day: $("buyDay").value, lines: buy, paid: $("buyPaid").value, mode: modeOf("buyMode") }) });
        buy.length = 0; toast("Saved. Stock added on the website too."); purchases();
      } catch (e) { $("buyErr").textContent = e.message; }
    };
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
        <div class="row3"><label class="sub">Qty<input type="number" min="1" value="${esc(l.qty)}" data-b="qty" data-i="${i}"></label><label class="sub">Cost ₹<input type="number" min="0" value="${esc(l.cost)}" data-b="cost" data-i="${i}"></label><label class="sub">GST on bill %<input type="number" min="0" value="${esc(l.gstRate)}" data-b="gstRate" data-i="${i}"></label></div></div>`;
    }).join("");
    sums();
    document.querySelectorAll("[data-brm]").forEach((b) => (b.onclick = () => { buy.splice(+b.dataset.brm, 1); paintBuy(); }));
    document.querySelectorAll("[data-b]").forEach((i) => (i.oninput = () => { buy[+i.dataset.i][i.dataset.b] = i.value; sums(); }));
  }

  // ---- Expenses ----
  async function expenses() {
    const { list, types } = await api("/api/billing/expenses");
    $("tab-expenses").innerHTML = `
      <details class="form" open><summary>Add expense</summary>
        <div class="row2"><select id="exType">${types.map((t) => `<option>${esc(t)}</option>`).join("")}</select><input id="exAmt" type="number" min="1" placeholder="Amount ₹"></div>
        <div class="row2"><input id="exDay" type="date" value="${today()}" max="${today()}"><input id="exNote" placeholder="Note (optional)"></div>
        ${modePick("exMode")}
        <button class="big" id="exSave">Save expense</button><div class="err" id="exErr"></div>
      </details>
      <div class="scroll"><table><thead><tr><th>Date</th><th>Type</th><th class="n">Amount</th><th></th></tr></thead><tbody>
      ${list.length ? list.map((x) => `<tr class="${x.status}"><td>${dayText(x.day)}</td><td>${esc(x.type)}<div class="sub">${esc(x.note)}</div></td><td class="n"><b>${inr(x.amount)}</b></td><td class="n">${x.status === "cancelled" ? `<span class="sub">Cancelled</span>` : `<button class="tbtn danger" data-excancel="${x.id}">Cancel</button>`}</td></tr>`).join("") : `<tr><td colspan="4" class="empty">No expenses yet.</td></tr>`}
      </tbody></table></div>`;
    $("exSave").onclick = async () => {
      try {
        await api("/api/billing/expenses", { method: "POST", body: JSON.stringify({ type: $("exType").value, amount: $("exAmt").value, day: $("exDay").value, note: $("exNote").value, mode: modeOf("exMode") }) });
        toast("Saved."); expenses();
      } catch (e) { $("exErr").textContent = e.message; }
    };
    document.querySelectorAll("[data-excancel]").forEach((b) => twoTap(b, "Tap again to cancel", async () => { await api(`/api/billing/expenses/${b.dataset.excancel}/cancel`, { method: "POST", body: "{}" }); toast("Expense cancelled."); expenses(); }));
  }

  // ---- Cash and bank ----
  async function cash() {
    const c = await api("/api/billing/cash");
    $("tab-cash").innerHTML = `
      <div class="summary"><div>Cash in hand<b>${inr(c.cash)}</b></div><div>Bank and UPI<b>${inr(c.bank)}</b></div></div>
      <details class="form"><summary>Starting balances</summary>
        <p class="sub">What was in the till and the bank on the day you started using this.</p>
        <div class="row2"><input id="opCash" type="number" value="${c.openingCash}" aria-label="Opening cash"><input id="opBank" type="number" value="${c.openingBank}" aria-label="Opening bank"></div>
        <button class="big" id="opSave">Save</button><div class="err" id="opErr"></div>
      </details>
      <div class="scroll"><table><thead><tr><th>Date</th><th>Entry</th><th>Account</th><th class="n">Amount</th></tr></thead><tbody>
      ${c.rows.length ? c.rows.map((r) => `<tr><td>${dayText(r.day)}</td><td>${esc(r.kind)}<div class="sub">${esc(r.ref)}</div></td><td>${r.account === "cash" ? "Cash" : "Bank"}</td><td class="n"><b class="${r.amount > 0 ? "owed-in" : "owed-out"}">${r.amount > 0 ? "+" : "−"}${inr(Math.abs(r.amount))}</b></td></tr>`).join("") : `<tr><td colspan="4" class="empty">Nothing yet.</td></tr>`}
      </tbody></table></div>`;
    $("opSave").onclick = async () => {
      try { await api("/api/billing/cash/opening", { method: "POST", body: JSON.stringify({ openingCash: $("opCash").value, openingBank: $("opBank").value }) }); toast("Saved."); cash(); }
      catch (e) { $("opErr").textContent = e.message; }
    };
  }

  window.VX.tabs = { home, parties, purchases, expenses, cash };
})();
