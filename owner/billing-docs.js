// Documents, Returns and Reports tabs of the billing portal.
(() => {
  const { api, esc, inr, toast, download } = window.VX;
  const $ = (id) => document.getElementById(id);
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const dayText = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const pills = (name, list, on) => `<div class="pay">${list.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}" ${v === on ? "checked" : ""}><span>${l}</span></label>`).join("")}</div>`;
  const picked = (name) => document.querySelector(`input[name=${name}]:checked`)?.value;
  const MODES = [["cash", "Cash"], ["upi", "UPI"], ["card", "Card"], ["bank", "Bank"]];
  function twoTap(b, label, run) {
    const first = b.textContent;
    b.onclick = async () => {
      if (!b.classList.contains("sure")) { b.classList.add("sure"); b.textContent = label; setTimeout(() => { b.classList.remove("sure"); b.textContent = first; }, 4000); return; }
      b.disabled = true;
      try { await run(); } catch (e) { toast(e.message); b.disabled = false; }
    };
  }

  // ---- Quotations, proforma, challans, purchase orders ----
  const KINDS = [["quotation", "Quotation"], ["proforma", "Proforma"], ["challan", "Challan"], ["purchase_order", "Purchase Order"], ["dispatch", "Dispatch Note"]];
  let kind = "quotation";
  const lines = [];
  async function documents(sub) {
    if (typeof sub === "string") { kind = sub; lines.length = 0; }
    const [list, parties, items] = await Promise.all([api("/api/billing/docs"), api("/api/billing/parties"), api("/api/billing/products")]);
    const buying = kind === "purchase_order";
    const shown = list.filter((d) => d.kind === kind);
    const who = parties.filter((p) => p.type === (buying ? "supplier" : "customer"));
    $("tab-docs").innerHTML = `
      ${kind === "dispatch" ? `<details class="form" open><summary>New Dispatch Note</summary>
        <p class="sub">A shipping slip from a bill. It isn't a government e-way bill.</p>
        <div class="row2"><input id="dpBill" placeholder="Bill number, e.g. 7651"><input id="dpCourier" placeholder="Courier or transporter"></div>
        <div class="row2"><input id="dpTrack" placeholder="Tracking or LR number"><input id="dpVehicle" placeholder="Vehicle number (optional)"></div>
        <div class="row2"><input id="dpPack" type="number" min="1" value="1" aria-label="Packages"><input id="dpWeight" placeholder="Weight, e.g. 2 kg"></div>
        <input id="dpTo" placeholder="Ship to (blank = address on the bill)" style="margin-top:8px">
        <button class="big" id="dpSave">Save</button><div class="err" id="dpErr"></div>
      </details>` : `<details class="form" open><summary>New ${esc(KINDS.find((k) => k[0] === kind)[1])}</summary>
        <div class="row2"><select id="dParty"><option value="">${buying ? "Supplier…" : "Saved customer (optional)…"}</option>${who.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>${buying ? `<div></div>` : `<input id="dName" placeholder="Or type a name">`}</div>
        ${kind === "quotation" ? `<label class="sub" style="display:block;margin-top:8px">Valid until<input type="date" id="dValid" min="${today()}"></label>` : ""}
        <input type="search" id="dQ" placeholder="Scan or type an item…" style="margin-top:8px" autocomplete="off">
        <div class="results" id="dHits" style="max-height:200px"></div>
        <div id="dLines"></div>
        <div class="tot"><span>Total</span><span id="dTotal">₹0</span></div>
        <button class="big" id="dSave">Save</button><div class="err" id="dErr"></div>
      </details>`}
      <div class="scroll"><table><thead><tr><th>Number</th><th>Party</th><th class="n">Total</th><th>Status</th><th></th></tr></thead><tbody>
      ${shown.length ? shown.map((d) => `<tr class="${d.status === "cancelled" ? "cancelled" : ""}"><td><b>${esc(d.number)}</b><div class="sub">${dayText(d.day)}</div></td><td>${esc(d.customer?.name || "-")}</td><td class="n"><b>${inr(d.total)}</b></td><td>${d.status === "dispatched" ? `<span class="pill">${esc(d.transport.courier)}${d.transport.tracking ? " · " + esc(d.transport.tracking) : ""}</span>` : d.status === "converted" ? `<span class="pill">Became ${esc(d.convertedTo)}</span>` : d.status === "open" ? `<span class="pill low">Open</span>` : `<span class="sub">Cancelled</span>`}</td>
        <td class="n"><a class="tbtn" href="/doc/${d.id}?o" target="_blank" rel="noopener">View</a>${d.status === "open" ? ` <button class="tbtn" data-conv="${d.id}">${d.kind === "purchase_order" ? "Receive stock" : "Make bill"}</button> <button class="tbtn danger" data-dcancel="${d.id}">Cancel</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="5" class="empty">Nothing yet.</td></tr>`}
      </tbody></table></div>`;
    document.querySelectorAll("[data-conv]").forEach((b) => twoTap(b, "Tap again to confirm", async () => { const r = await api(`/api/billing/docs/${b.dataset.conv}/convert`, { method: "POST", body: JSON.stringify({ payment: "cash" }) }); toast(`Done: ${r.doc.convertedTo}. Stock updated.`); documents(); }));
    document.querySelectorAll("[data-dcancel]").forEach((b) => twoTap(b, "Tap again to cancel", async () => { await api(`/api/billing/docs/${b.dataset.dcancel}/cancel`, { method: "POST", body: "{}" }); toast("Cancelled."); documents(); }));
    if (kind === "dispatch") {
      $("dpSave").onclick = async () => {
        try {
          await api("/api/billing/dispatch", { method: "POST", body: JSON.stringify({ invoiceId: $("dpBill").value.trim(), courier: $("dpCourier").value, tracking: $("dpTrack").value, vehicle: $("dpVehicle").value, packages: $("dpPack").value, weight: $("dpWeight").value, shipTo: $("dpTo").value }) });
          toast("Dispatch note saved."); documents();
        } catch (e) { $("dpErr").textContent = e.message; }
      };
      return;
    }
    paint();
    $("dQ").oninput = () => hits(items, buying);
    $("dQ").onkeydown = (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const q = $("dQ").value.trim().toLowerCase();
      const p = items.find((x) => x.barcode === q || x.code === q);
      if (p) { add(p, buying); $("dQ").value = ""; $("dHits").innerHTML = ""; }
    };
    $("dSave").onclick = async () => {
      try {
        await api("/api/billing/docs", { method: "POST", body: JSON.stringify({ kind, partyId: $("dParty").value, customer: { name: $("dName")?.value || "" }, validUntil: $("dValid")?.value || "", lines }) });
        lines.length = 0; toast("Saved. Stock isn't touched until it's converted."); documents();
      } catch (e) { $("dErr").textContent = e.message; }
    };
  }
  function hits(items, buying) {
    const q = $("dQ").value.trim().toLowerCase();
    const found = q ? items.filter((p) => `${p.code} ${p.barcode || ""} ${p.name}`.toLowerCase().includes(q)).slice(0, 6) : [];
    $("dHits").innerHTML = found.map((p) => `<button class="item" data-add="${esc(p.id)}"><div class="grow"><div class="name">${esc(p.name)}</div><div class="sub">#${esc(p.code)} · ${inr(p.price)}</div></div></button>`).join("");
    document.querySelectorAll("#dHits [data-add]").forEach((b) => (b.onclick = () => { add(items.find((x) => x.id === b.dataset.add), buying); $("dQ").value = ""; $("dHits").innerHTML = ""; $("dQ").focus(); }));
  }
  function add(p, buying) {
    const l = lines.find((x) => x.productId === p.id);
    if (l) l.qty++; else lines.push({ productId: p.id, name: p.name, qty: 1, price: (buying ? p.cost : p.price) || 0, disc: 0 });
    paint();
  }
  function paint() {
    const amt = (l) => (Number(l.price) || 0) * (Number(l.qty) || 0) - (Number(l.disc) || 0);
    const sums = () => { lines.forEach((l, i) => { const el = document.querySelector(`[data-damt="${i}"]`); if (el) el.textContent = inr(amt(l)); }); $("dTotal").textContent = inr(lines.reduce((n, l) => n + amt(l), 0)); };
    $("dLines").innerHTML = lines.map((l, i) => `<div class="line"><div class="grow"><div class="name">${esc(l.name)}</div><button class="x" data-drm="${i}">remove</button></div><div class="price" data-damt="${i}"></div>
      <div class="row3"><label class="sub">Qty<input type="number" min="1" value="${esc(l.qty)}" data-d="qty" data-i="${i}"></label><label class="sub">Rate ₹<input type="number" min="0" value="${esc(l.price)}" data-d="price" data-i="${i}"></label><label class="sub">Disc ₹<input type="number" min="0" value="${l.disc ? esc(l.disc) : ""}" data-d="disc" data-i="${i}"></label></div></div>`).join("");
    sums();
    document.querySelectorAll("[data-drm]").forEach((b) => (b.onclick = () => { lines.splice(+b.dataset.drm, 1); paint(); }));
    document.querySelectorAll("[data-d]").forEach((i) => (i.oninput = () => { lines[+i.dataset.i][i.dataset.d] = i.value; sums(); }));
  }

  // ---- Returns and notes ----
  const RTYPES = [["sale_return", "Sales Return"], ["credit_note", "Credit Note"], ["purchase_return", "Purchase Return"], ["debit_note", "Debit Note"]];
  let rtype = "sale_return", src = null;
  async function returns(sub) {
    if (typeof sub === "string") { rtype = sub; src = null; }
    const [list, parties] = await Promise.all([api("/api/billing/returns"), api("/api/billing/parties")]);
    const goods = rtype === "sale_return" || rtype === "purchase_return";
    const shown = list.filter((r) => r.kind === rtype);
    const sale = rtype === "sale_return";
    $("tab-returns").innerHTML = `
      <details class="form" open><summary>New ${esc(RTYPES.find((r) => r[0] === rtype)[1])}</summary>
      ${goods ? `<div class="row2"><input id="rFind" placeholder="${sale ? "Bill number, e.g. 7651" : "Purchase number, e.g. PB/26-27/0001"}"><button class="tbtn" id="rLoad">Find</button></div><div id="rLines"></div>
        <div class="row2" style="margin-top:8px"><input id="rRefund" type="number" min="0" placeholder="${sale ? "Money paid back ₹" : "Money received back ₹"}"><div></div></div>${pills("rmode", MODES, "cash")}`
      : `<div class="row2"><select id="rParty"><option value="">Party…</option>${parties.filter((p) => p.type === (rtype === "credit_note" ? "customer" : "supplier")).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select><input id="rAmt" type="number" min="1" placeholder="Amount ₹"></div>`}
        <input id="rWhy" placeholder="Reason" style="margin-top:8px">
        <button class="big" id="rSave">Save</button><div class="err" id="rErr"></div>
      </details>
      <div class="scroll"><table><thead><tr><th>Number</th><th>Against</th><th class="n">Amount</th><th></th></tr></thead><tbody>
      ${shown.length ? shown.map((r) => `<tr class="${r.status === "cancelled" ? "cancelled" : ""}"><td><b>${esc(r.number)}</b><div class="sub">${dayText(r.day)}</div></td><td>${esc(r.invoiceNumber || r.purchaseNumber || r.customer?.name || "")}<div class="sub">${esc(r.reason || "")}</div></td><td class="n"><b>${inr(r.total)}</b>${r.refund ? `<div class="sub">refund ${inr(r.refund)}</div>` : ""}</td>
        <td class="n"><a class="tbtn" href="/doc/${r.id}?o" target="_blank" rel="noopener">View</a>${r.status === "cancelled" ? "" : ` <button class="tbtn danger" data-rcancel="${r.id}">Cancel</button>`}</td></tr>`).join("") : `<tr><td colspan="4" class="empty">Nothing yet.</td></tr>`}
      </tbody></table></div>`;
    if (goods) $("rLoad").onclick = () => find(sale);
    $("rSave").onclick = async () => {
      try {
        const base = { kind: rtype, reason: $("rWhy").value };
        const body = goods
          ? { ...base, [sale ? "invoiceId" : "purchaseId"]: src?.id, lines: [...document.querySelectorAll("[data-rq]")].map((i) => ({ productId: i.dataset.rq, qty: i.value })), refund: $("rRefund").value, mode: picked("rmode") }
          : { ...base, partyId: $("rParty").value, amount: $("rAmt").value };
        if (goods && !src) throw new Error(sale ? "Find the bill first." : "Find the purchase first.");
        await api("/api/billing/returns", { method: "POST", body: JSON.stringify(body) });
        src = null; toast("Saved. Stock and ledger updated."); returns();
      } catch (e) { $("rErr").textContent = e.message; }
    };
    document.querySelectorAll("[data-rcancel]").forEach((b) => twoTap(b, "Tap again to undo", async () => { await api(`/api/billing/returns/${b.dataset.rcancel}/cancel`, { method: "POST", body: "{}" }); toast("Undone."); returns(); }));
  }
  async function find(sale) {
    const q = $("rFind").value.trim();
    $("rErr").textContent = "";
    const pool = sale ? (await api("/api/billing/invoices")).invoices : await api("/api/billing/purchases");
    src = pool.find((x) => x.number === q) || null;
    if (!src) { $("rLines").innerHTML = ""; $("rErr").textContent = `Nothing found for ${q}.`; return; }
    $("rLines").innerHTML = `<p class="sub">${esc(src.customer?.name || "")} · ${inr(src.total)}</p>` + src.lines.map((l) => `<div class="line"><div class="grow"><div class="name">${esc(l.name)}</div><div class="sub">${l.qty} on ${sale ? "bill" : "purchase"} · ${inr(l.amount / l.qty)} each</div></div><label class="sub">Back<input class="rate" type="number" min="0" max="${l.qty}" value="0" data-rq="${esc(l.productId)}"></label></div>`).join("");
  }

  // ---- Reports ----
  let groups = null, current = null;
  const range = { from: "", to: "" };
  function setPreset(p) {
    const t = today(), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
    if (p === "today") { range.from = range.to = t; }
    if (p === "month") { range.from = `${t.slice(0, 7)}-01`; range.to = t; }
    if (p === "fy") { const s = m >= 4 ? y : y - 1; range.from = `${s}-04-01`; range.to = t; }
    if (p === "all") { range.from = ""; range.to = ""; }
  }
  async function reports() {
    groups ||= await api("/api/billing/reports");
    if (!current) { current = "daily"; setPreset("month"); }
    const q = new URLSearchParams(Object.entries(range).filter(([, v]) => v)).toString();
    const rep = await api(`/api/billing/reports/${current}?${q}`);
    const cell = (c, r) => (c.type === "money" && r[c.key] !== "" ? inr(r[c.key]) : esc(r[c.key] ?? ""));
    $("tab-reports").innerHTML = `
      <div class="repGrid"><aside>${groups.map(([g, list]) => `<h3>${esc(g)}</h3>${list.map(([k, l]) => `<button class="repBtn ${k === current ? "on" : ""}" data-rep="${k}">${esc(l)}</button>`).join("")}`).join("")}</aside>
      <div class="grow"><div class="repHead"><h2>${esc(rep.title)}</h2><button class="tbtn" id="repCsv">Download Excel</button></div>
        ${rep.noDates ? "" : `<div class="repDates"><button class="tbtn" data-pre="today">Today</button><button class="tbtn" data-pre="month">This month</button><button class="tbtn" data-pre="fy">This year</button><button class="tbtn" data-pre="all">All</button><input type="date" id="repFrom" value="${range.from}" aria-label="From"><input type="date" id="repTo" value="${range.to}" aria-label="To"></div>`}
        ${rep.note ? `<p class="sub">${esc(rep.note)}</p>` : ""}
        <div class="scroll"><table><thead><tr>${rep.columns.map((c) => `<th class="${c.type ? "n" : ""}">${esc(c.label)}</th>`).join("")}</tr></thead><tbody>
        ${rep.rows.length ? rep.rows.map((r) => `<tr>${rep.columns.map((c) => `<td class="${c.type ? "n" : ""}">${cell(c, r)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${rep.columns.length}" class="empty">Nothing for these dates.</td></tr>`}
        ${rep.totals && rep.rows.length ? `<tr>${rep.columns.map((c, i) => `<td class="${c.type ? "n" : ""}"><b>${c.key in rep.totals ? cell(c, rep.totals) : i === 0 ? "Total" : ""}</b></td>`).join("")}</tr>` : ""}
        </tbody></table></div></div></div>`;
    document.querySelectorAll("[data-rep]").forEach((b) => (b.onclick = () => { current = b.dataset.rep; reports(); }));
    document.querySelectorAll("[data-pre]").forEach((b) => (b.onclick = () => { setPreset(b.dataset.pre); reports(); }));
    if ($("repFrom")) { $("repFrom").onchange = (e) => { range.from = e.target.value; reports(); }; $("repTo").onchange = (e) => { range.to = e.target.value; reports(); }; }
    $("repCsv").onclick = () => download(`/api/billing/reports/${current}.csv?${q}`, `vibex-${current}.csv`).catch((e) => toast(e.message));
  }

  Object.assign(window.VX.tabs, { docs: documents, returns, reports });
})();
