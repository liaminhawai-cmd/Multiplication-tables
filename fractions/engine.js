/* ============================================================
   FRACTIONS HUB — ENGINE
   ------------------------------------------------------------
   Owns: the matrix selector, the Teach cycle, the timed Drill,
   results, the Report tab, persistence and exports. Knows nothing
   about fraction content beyond calling FH.bank / FH.check /
   FH.explain (data/cells.js), the models (models.js) and the
   interactive builders (interactives.js).

   Screen flow:
     Teach: grid -> goals -> watch (2 worked examples, stepped)
                 -> build (2 examples the student constructs)
                 -> your turn (3 correct in a row) -> done
     Drill: grid -> timed questions -> results
   The Report tab reads saved records and history at any time.
   ============================================================ */
(function () {
  "use strict";
  const FH = window.FH, F = FH.F, M = FH.M;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Time is per cell: pick a pace, and the clock scales with how many
  // cells you selected. Colours bind to a pace (see the legend).
  const TIERS = [
    { id: "120", label: "2:00", seconds: 120, cls: "t120" },
    { id: "90", label: "1:30", seconds: 90, cls: "t90" },
    { id: "60", label: "1:00", seconds: 60, cls: "t60" },
  ];
  const PER_CELL = 5;          // questions per selected cell
  const REVIEW_PER_CELL = 1;   // of those, from an earlier cell in the same row
  const BEAT_MIN_RIGHT = 4;    // out of 5 to count a pace as beaten
  const YOUDO_TARGET = 3;      // correct in a row to finish the teach cycle
  const BUILD_ROUNDS = 2;      // examples the student constructs
  const BUILD = "2026-09-02.1";

  /* ---------------- persistence ---------------- */
  const STORE_KEY = "fractionsHub.v1";
  let store = load();
  function load() {
    try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && s.v === 1) return Object.assign({ name: "", records: {}, history: [], teach: {}, lastServed: {} }, s); } catch (e) { /* fresh */ }
    return { v: 1, name: "", records: {}, history: [], teach: {}, lastServed: {} };
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* private mode */ } }
  const today = () => new Date().toISOString().slice(0, 10);
  const rec = (cellId, tierId) => (store.records[cellId] || {})[tierId];
  const beaten = (cellId, tierId) => !!(rec(cellId, tierId) && rec(cellId, tierId).beaten);

  /* ---------------- state ---------------- */
  let mode = "teach";
  let teachTarget = null;
  let drillSel = new Set();
  let tier = TIERS[0];
  let drill = null;
  let teach = null;
  let timerHandle = null;
  let advanceTimeout = null;
  let pendingResume = null;

  /* ---------------- screens & tabs ---------------- */
  const SCREENS = ["grid", "teach", "drill", "results"];
  function show(name) {
    SCREENS.forEach((s) => $("screen-" + s).classList.toggle("active", s === name));
    document.body.classList.toggle("wide", name === "grid");
    window.scrollTo(0, 0);
  }
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.tab !== "practise" && drill) voidDrill();
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + btn.dataset.tab));
      if (btn.dataset.tab === "report") renderReport();
    });
  });

  /* ---------------- helpers ---------------- */
  function shuffle(arr) { const o = arr.slice(); for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; }
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function fmtTime(s) { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
  const cellName = (id) => `${FH.rowOf(id).name} · ${FH.CELLS[id].name}`;
  // Sample n items from a cell, preferring ones not served last time.
  function sample(cellId, n) {
    const bank = FH.bank(cellId);
    const prev = new Set(store.lastServed[cellId] || []);
    const fresh = shuffle(bank.filter((it) => !prev.has(it.uid)));
    const seen = shuffle(bank.filter((it) => prev.has(it.uid)));
    const out = fresh.concat(seen).slice(0, n);
    store.lastServed[cellId] = out.map((it) => it.uid);
    return out;
  }

  /* ---------------- fraction input (shared by drill, build, your turn) ---------------- */
  function fracInputHtml(form) {
    if (form === "number") return `<div class="frac-input single"><input class="fi fi-n" type="text" inputmode="numeric" autocomplete="off" aria-label="answer"></div>`;
    return `<div class="frac-input">
      <input class="fi fi-w" type="text" inputmode="numeric" autocomplete="off" aria-label="whole number (leave empty if none)">
      <div class="fi-stack"><input class="fi fi-n" type="text" inputmode="numeric" autocomplete="off" aria-label="numerator (top)"><div class="fi-line"></div><input class="fi fi-d" type="text" inputmode="numeric" autocomplete="off" aria-label="denominator (bottom)"></div>
    </div>`;
  }
  const val = (host, sel) => { const el = host.querySelector(sel); return el ? el.value : ""; };
  function readFrac(host) { return { w: val(host, ".fi-w"), n: val(host, ".fi-n"), d: val(host, ".fi-d") }; }
  function wireFrac(host, form, onSubmit) {
    const w = host.querySelector(".fi-w"), n = host.querySelector(".fi-n"), d = host.querySelector(".fi-d");
    const focus = (el) => { if (el) { el.focus(); el.select && el.select(); } };
    host.querySelectorAll(".fi").forEach((el) => {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault(); e.stopPropagation(); // the page-level Enter (advance) must not see this
          if (el === w) { if (n && (n.value || d.value)) focus(n); else if (w.value) onSubmit(); else focus(n); return; }
          if (el === n && d && n.value && !d.value && form !== "number") { focus(d); return; }
          onSubmit();
        } else if (e.key === "/" ) { e.preventDefault(); if (el === w) focus(n); else if (el === n) focus(d); }
        else if (e.key === " " && el === w) { e.preventDefault(); focus(n); }
        else if (e.key === "ArrowDown" && el === n) { e.preventDefault(); focus(d); }
        else if (e.key === "ArrowUp" && el === d) { e.preventDefault(); focus(n); }
      });
    });
    focus(form === "mixed" && w ? w : n);
  }
  function lockFrac(host) { host.querySelectorAll(".fi").forEach((el) => { el.disabled = true; }); }
  function givenText(r) {
    const w = (r.w || "").trim(), n = (r.n || "").trim(), d = (r.d || "").trim();
    if (!w && !n && !d) return "(blank)";
    if (!n && !d) return w;
    if (n && !d && !w) return n;
    return `${w ? w + " " : ""}${n}/${d}`;
  }

  /* ================= GRID (select screen) ================= */
  function buildModeToggle() {
    const wrap = $("modeToggle");
    wrap.innerHTML = `<button type="button" class="filter-btn${mode === "teach" ? " active" : ""}" data-m="teach">Teach</button>` +
      `<button type="button" class="filter-btn${mode === "drill" ? " active" : ""}" data-m="drill">Drill</button>`;
    wrap.querySelectorAll(".filter-btn").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.m; buildModeToggle(); buildMatrix(); updateToolbar(); }));
  }
  function buildTierChips() {
    const wrap = $("tierChips");
    wrap.innerHTML = TIERS.map((t) => `<button type="button" class="tier-chip ${t.cls}${tier.id === t.id ? " selected" : ""}" data-t="${t.id}"><i class="sw ${t.cls}"></i>${t.label} per cell</button>`).join("");
    wrap.querySelectorAll(".tier-chip").forEach((b) => b.addEventListener("click", () => { tier = TIERS.find((t) => t.id === b.dataset.t); buildTierChips(); updateToolbar(); }));
  }
  function buildMatrix() {
    const wrap = $("matrix");
    wrap.innerHTML = "";
    const head = document.createElement("div");
    head.className = "mrow mhead";
    head.innerHTML = `<div class="mcell rowlabel"></div>` + FH.LEVELS.map((l) => `<div class="mcell colhead">${l}</div>`).join("");
    wrap.appendChild(head);
    FH.ROWS.forEach((row) => {
      const r = document.createElement("div");
      r.className = "mrow";
      const lab = document.createElement("div");
      lab.className = "mcell rowlabel";
      lab.innerHTML = `<span>${row.name}</span><span class="rowsym">${row.sym}</span>`;
      r.appendChild(lab);
      const selLevelsInRow = [...drillSel].filter((id) => id.startsWith(row.id + "-")).map((id) => +id.split("-")[1]);
      FH.LEVELS.forEach((l) => {
        const id = `${row.id}-${l}`, c = FH.CELLS[id];
        const el = document.createElement("button");
        el.type = "button";
        el.className = "mcell cell";
        el.dataset.id = id;
        let tag = "";
        if (mode === "teach") {
          if (teachTarget === id) { el.classList.add("target"); tag = `<span class="drill-tag">teach ▸</span>`; }
        } else {
          if (drillSel.has(id)) { el.classList.add("target"); tag = `<span class="drill-tag">drill ▸</span>`; }
          else if (selLevelsInRow.some((s) => s > l)) { el.classList.add("below"); tag = `<span class="drill-tag muted">review</span>`; }
        }
        const dots = TIERS.map((t) => `<i class="dot${beaten(id, t.id) ? " " + t.cls : ""}" title="${beaten(id, t.id) ? "beaten at " + t.label + " per cell" : "not yet beaten at " + t.label + " per cell"}"></i>`).join("");
        const taught = store.teach[id] ? `<span class="ttick" title="teach cycle finished ${store.teach[id].date}">taught</span>` : "";
        el.innerHTML = `<span class="cell-name">${esc(c.name)}</span><span class="cell-eg">${esc(c.example)}</span><span class="cell-foot"><span class="dots">${dots}</span>${taught}${tag}</span>`;
        el.setAttribute("aria-pressed", el.classList.contains("target") ? "true" : "false");
        el.addEventListener("click", () => {
          if (mode === "teach") teachTarget = teachTarget === id ? null : id;
          else { if (drillSel.has(id)) drillSel.delete(id); else drillSel.add(id); }
          buildMatrix(); updateToolbar();
        });
        r.appendChild(el);
      });
      wrap.appendChild(r);
    });
    $("matrixLegend").innerHTML = `<span class="lg"><i class="dot t120"></i>beaten at 2:00 per cell</span><span class="lg"><i class="dot t90"></i>at 1:30</span><span class="lg"><i class="dot t60"></i>at 1:00</span><span class="lg"><span class="ttick">taught</span> teach cycle finished</span>`;
  }
  function updateToolbar() {
    const btn = $("startBtn");
    $("tierRow").classList.toggle("hidden", mode !== "drill");
    if (mode === "teach") {
      btn.disabled = !teachTarget;
      btn.textContent = teachTarget ? `Teach: ${cellName(teachTarget)}` : "Pick a cell to teach";
      $("helpText").innerHTML = `Pick <b>one</b> cell. You'll see the goal, watch two worked examples as cakes, bars and number lines, build two yourself by cutting and dragging, then answer three in a row. Then drill it. Columns get harder left to right; nothing is locked. Do <b>Convert 1 and 2</b> before the mixed-number columns.`;
    } else {
      const n = drillSel.size;
      btn.disabled = n === 0;
      btn.textContent = n ? `Start drill · ${n} cell${n === 1 ? "" : "s"} · ${fmtTime(n * tier.seconds)}` : "Pick cells to drill";
      $("helpText").innerHTML = `Pick <b>any</b> cells. Each gives ${PER_CELL} questions: ${PER_CELL - REVIEW_PER_CELL} from the cell and ${REVIEW_PER_CELL} from an earlier cell in the same row (marked <b>review</b>), never from a harder one. Questions are typed; wrong answers show the rule and the clock keeps running. Finish all of them with at least ${BEAT_MIN_RIGHT} of ${PER_CELL} right per cell and the cell is beaten at that pace — finish fast enough and slower paces are ticked too.`;
    }
  }
  $("startBtn").addEventListener("click", () => { if (mode === "teach") startTeach(teachTarget); else startDrill(); });

  // ?cell=add-3&mode=drill — other tools may link to a cell
  function applyDeepLink() {
    const p = new URLSearchParams(location.search);
    const id = p.get("cell");
    if (!id || !FH.CELLS[id]) return;
    mode = p.get("mode") === "drill" ? "drill" : "teach";
    if (mode === "drill") drillSel = new Set([id]); else teachTarget = id;
  }

  /* ================= TEACH ================= */
  function startTeach(cellId) {
    if (!cellId) return;
    const cell = FH.cellOf(cellId);
    teach = { cellId, cell, row: FH.rowOf(cellId), phase: "goals", examples: pickExamples(cellId), exIdx: 0, stage: 0, stages: [], builds: sample(cellId, BUILD_ROUNDS), buildIdx: 0, script: null, stepIdx: 0, streak: 0, youdoItem: null, youdoRight: 0, youdoTotal: 0, youdoWrongs: [] };
    show("teach");
    renderGoals();
  }
  // Two worked examples: one plain, one that shows the cell's hard feature
  // (carry / regroup / simplify / over 1) when the cell has one.
  function pickExamples(cellId) {
    const bank = FH.bank(cellId);
    const needsTidy = (it) => {
      if (it.op === "+" || it.op === "−") return it.ans.d !== F.lcm(it.A.d, it.B.d);
      if (it.op === "×") return it.ans.d !== it.A.d * it.B.d;
      if (it.op === "÷") return it.ans.d !== it.A.d * it.B.n;
      return false;
    };
    const feature = (it) => it.tags.includes("regroup") || it.tags.includes("answer-over-1") || it.tags.includes("simplifies") || it.tags.includes("cancels") || needsTidy(it);
    const plainOnes = bank.filter((it) => !feature(it) && !(it.tags.includes("from-whole")));
    const featured = bank.filter(feature);
    const a = pick(plainOnes.length ? plainOnes : bank);
    let b = featured.length ? pick(featured) : pick(bank.filter((it) => it !== a));
    if (!b || b === a) b = pick(bank.filter((it) => it !== a)) || a;
    return [a, b];
  }
  function teachHead(phaseText, pct, sub) {
    $("teachPhase").textContent = phaseText;
    $("teachBar").style.width = pct + "%";
    $("teachSub").textContent = sub || `${cellName(teach.cellId)}`;
  }
  function nextBtn(text, visible) { const b = $("teachNextBtn"); b.style.display = visible === false ? "none" : ""; b.textContent = text; b.disabled = false; }

  function renderGoals() {
    const c = teach.cell;
    teachHead("Learning goals", 6);
    $("teachContent").innerHTML = `
      <div class="li-box"><div class="eyebrow">Learning intention</div><div class="li-text">${esc(c.li)}</div></div>
      <div class="eyebrow">Success criteria</div>
      <div class="sc-list">
        <div class="sc-item"><span class="sc-step">1</span><div class="sc-body"><span class="sc-tag">Show it</span><span class="sc-goal">I can show the question with cakes, a bar or a number line, and read the answer off the picture.</span></div></div>
        <div class="sc-item"><span class="sc-step">2</span><div class="sc-body"><span class="sc-tag">Do it</span><span class="sc-goal">${esc(c.sc)}</span></div></div>
        <div class="sc-item"><span class="sc-step">3</span><div class="sc-body"><span class="sc-tag">Do it fast</span><span class="sc-goal">I can answer ${YOUDO_TARGET} in a row here, then beat this cell in a timed drill.</span></div></div>
      </div>
      <div class="against"><div class="eyebrow">The rule, against the usual mistake</div><div>${esc(c.against)}</div></div>
      <div class="eyebrow">How this cycle runs</div>
      <ol class="cycle"><li>Watch two examples, step by step, in three pictures.</li><li>Build two yourself: cut, shade and drag the cakes.</li><li>Your turn: ${YOUDO_TARGET} correct in a row, with the picture shown only after you answer.</li></ol>
      ${M.legend(["fa", "fb", "fr-fill", "fx"])}`;
    teach.phase = "goals";
    nextBtn("Watch an example");
  }

  /* ---- Watch: stepped worked examples in three representations ---- */
  const fills = (d, spec) => { // spec: [[count, cls], ...] -> fills array padded to whole cakes
    const arr = []; spec.forEach(([k, cls]) => { for (let i = 0; i < k; i++) arr.push(cls); });
    while (arr.length % d !== 0 || arr.length === 0) arr.push("");
    return arr;
  };
  const cakesFromFills = (d, arr, size) => { let s = `<div class="cake-row">`; for (let i = 0; i < arr.length; i += d) s += M.cake({ d, fills: arr.slice(i, i + d), size: size || 96 }); return s + `</div>`; };
  const labelled = (label, cls, html) => `<div class="model-block"><div class="model-label"><i class="sw ${cls}"></i>${label}</div>${html}</div>`;
  const symbolic = (html) => `<div class="symbolic">${html}</div>`;

  function watchStages(it) {
    const q = FH.questionHtml(it);
    const A = it.A, B = it.B;
    const st = [];
    const exp = FH.explain(it);
    if (it.op === "+" || it.op === "−") {
      const isAdd = it.op === "+";
      const L = F.lcm(A.d, B.d);
      const aL = A.n * (L / A.d), bL = B.n * (L / B.d);
      const resN = isAdd ? aL + bL : aL - bL;
      st.push({ text: `${isAdd ? "We are adding" : "We are taking away"}: ${q}. First, each amount as cake.`,
        html: labelled(`First amount ${FH.plain(A)}`, "fa", M.cakesFor(A, "fa")) + labelled(`Second amount ${FH.plain(B)}`, "fb", M.cakesFor(B, "fb")) + symbolic(q) });
      if (A.d !== B.d) {
        st.push({ text: `${FH.words(A.d)} and ${FH.words(B.d)} are different sizes, so we cannot count them together yet. Re-cut so every piece is a ${FH.words(L).replace(/s$/, "")}. The amounts do not change.`,
          html: labelled(`${FH.plain(A)} = ${aL}/${L}`, "fa", M.cakesFor(A, "fa", { sub: L / A.d })) + labelled(`${FH.plain(B)} = ${bL}/${L}`, "fb", M.cakesFor(B, "fb", { sub: L / B.d })) + symbolic(`${FH.fr(aL, L)} ${it.op} ${FH.fr(bL, L)}`) });
      }
      if (isAdd) {
        const combined = cakesFromFills(L, fills(L, [[aL, "fa"], [bL, "fb"]]));
        st.push({ text: `Now the pieces are the same size, put them together and count: ${aL} + ${bL} = ${resN} ${FH.words(L)}.`,
          html: labelled("Together", "fa", combined) + labelled("On a number line: start at the first amount, jump the second", "fb", M.line({ max: Math.max(1, Math.ceil(resN / L)), d: L, bar: { to: aL / L, cls: "fa" }, jumps: [{ from: aL / L, to: resN / L, cls: "fb", label: "+" + FH.plain(B) }], marks: [{ v: resN / L, cls: "fr-fill", label: FH.plain({ n: resN, d: L }) }] })) + symbolic(`${FH.fr(aL, L)} + ${FH.fr(bL, L)} = ${FH.fr(resN, L)}`) });
      } else {
        const eaten = cakesFromFills(L, fills(L, [[resN, "fa"], [bL, "fx"]]));
        st.push({ text: `Now take away ${bL} ${FH.words(L)} (the grey pieces): ${aL} − ${bL} = ${resN} left.${it.tags.includes("regroup") ? " There were not enough loose pieces, so a whole cake was cut up to take from." : ""}`,
          html: labelled("Taken away", "fx", eaten) + labelled("On a number line: start at the first amount, jump back the second", "fx", M.line({ max: Math.max(1, Math.ceil(aL / L)), d: L, bar: { to: aL / L, cls: "fa" }, jumps: [{ from: aL / L, to: resN / L, cls: "fx", label: "−" + FH.plain(B) }], marks: [{ v: resN / L, cls: "fr-fill", label: FH.plain({ n: resN, d: L }) }] })) + symbolic(`${FH.fr(aL, L)} − ${FH.fr(bL, L)} = ${FH.fr(resN, L)}`) });
      }
      st.push({ text: `Tidy the answer: ${exp.slice(-2).join(" ")}`, html: labelled("Answer", "fr-fill", M.cakesFor(it.ans, "fr-fill")) + symbolic(`${q} ${FH.showAns(it.ans)}`) });
    } else if (it.op === "×") {
      const uW = Math.ceil(A.n / A.d), uH = Math.ceil(B.n / B.d);
      const colOn = Array.from({ length: uW * A.d }, (_, i) => i < A.n), rowOn = Array.from({ length: uH * B.d }, (_, i) => i < B.n);
      if (A.mixed || B.mixed || A.d === 1 || B.d === 1) st.push({ text: `${q}. Mixed and whole numbers become improper fractions first — every whole is ${A.d === 1 ? B.d : A.d} ${FH.words(A.d === 1 ? B.d : A.d)}. ${exp[0]}`, html: labelled(`First amount ${FH.plain(A)} = ${A.n}/${A.d}`, "fa", M.cakesFor(A, "fa", { showCuts: true })) + labelled(`Second amount ${FH.plain(B)} = ${B.n}/${B.d}`, "fb", M.cakesFor(B, "fb", { showCuts: true })) + symbolic(`${FH.fr(A.n, A.d)} × ${FH.fr(B.n, B.d)}`) });
      st.push({ text: `${q}. Multiplying means "${FH.plain(A)} of ${FH.plain(B)}". Start with the first amount as columns of a square: cut every whole into ${A.d} columns and shade ${A.n}.`, html: labelled(`First amount ${FH.plain(A, "improper")} as columns`, "fa", M.grid({ cols: A.d, rows: 1, unitsW: uW, unitsH: uH, colOn, rowOn: [] })) + symbolic(`${FH.fr(A.n, A.d)} × ${FH.fr(B.n, B.d)}`) });
      st.push({ text: `Now the second amount as rows across the same square: cut every whole into ${B.d} rows and shade ${B.n}. Where the two shadings cross is ${FH.plain(A)} of ${FH.plain(B)}.`, html: labelled("Both amounts on one square", "ab", M.grid({ cols: A.d, rows: B.d, unitsW: uW, unitsH: uH, colOn, rowOn })) + symbolic(`${FH.fr(A.n, A.d)} × ${FH.fr(B.n, B.d)}`) });
      st.push({ text: `Count the overlap: ${A.n} columns × ${B.n} rows = ${A.n * B.n} small pieces, and one whole has ${A.d} × ${B.d} = ${A.d * B.d} of them. That is why tops multiply and bottoms multiply.`, html: labelled("The overlap is the product", "ab", M.grid({ cols: A.d, rows: B.d, unitsW: uW, unitsH: uH, colOn, rowOn })) + symbolic(`${FH.fr(A.n, A.d)} × ${FH.fr(B.n, B.d)} = ${FH.fr(A.n * B.n, A.d * B.d)}`) });
      st.push({ text: `Tidy the answer: ${exp.slice(1).join(" ")}`, html: labelled("Answer", "fr-fill", M.barsFor(it.ans, "fr-fill")) + symbolic(`${q} ${FH.showAns(it.ans)}`) });
    } else if (it.op === "÷") {
      const av = A.n / A.d, bv = B.n / B.d, L = F.lcm(A.d, B.d);
      const full = Math.floor(av / bv + 1e-9), max = Math.max(1, Math.ceil(av));
      const jumps = []; for (let i = 0; i < full; i++) jumps.push({ from: i * bv, to: (i + 1) * bv, cls: "fb", label: String(i + 1) });
      if (full * bv < av - 1e-9) jumps.push({ from: full * bv, to: av, cls: "fb", partial: true, label: "part" });
      st.push({ text: `${q}. Dividing asks: how many ${FH.plain(B)}s fit into ${FH.plain(A)}? Here is ${FH.plain(A)} on a number line.`, html: labelled(`First amount ${FH.plain(A)}`, "fa", M.line({ max, d: Math.min(L, 24), bar: { to: av, cls: "fa" }, marks: [{ v: av, cls: "fa", label: FH.plain(A, "mixed") }] })) + symbolic(q) });
      st.push({ text: `Jump ${FH.plain(B)} at a time until you reach ${FH.plain(A)}: ${full} full jump${full === 1 ? "" : "s"}${full * bv < av - 1e-9 ? ` and a part of a jump (${FH.plain(F.red(Math.round((av - full * bv) * L * B.d), L * B.n))} of one)` : ", exactly"}.`, html: labelled(`Jumps of ${FH.plain(B)}`, "fb", M.line({ max, d: Math.min(L, 24), bar: { to: av, cls: "fa" }, jumps, marks: [{ v: av, cls: "fa", label: FH.plain(A, "mixed") }] })) + symbolic(`${q} ${FH.showAns(it.ans)}`) });
      st.push({ text: `The same answer by the rule: ${exp.slice(0, -1).join(" ")}`, html: labelled("Same-size pieces show why the rule works", "fa", M.cakesFor(A, "fa", { sub: L / A.d }) + M.cakesFor(B, "fb", { sub: L / B.d })) + symbolic(`${q} ${FH.showAns(it.ans)}`) });
      st.push({ text: `Answer: ${FH.plain(it.ans, "mixed")} — ${exp[exp.length - 1].replace(/Answer: /, "")}`, html: labelled("Answer", "fr-fill", M.barsFor(it.ans, "fr-fill")) + symbolic(`${q} ${FH.showAns(it.ans)}`) });
    } else {
      if (it.sub === "toMixed") {
        const w = Math.floor(A.n / A.d), r = A.n - w * A.d;
        st.push({ text: `${FH.plain(A)}: ${A.n} loose pieces, each one ${FH.words(A.d).replace(/s$/, "")}.`, html: labelled(`${A.n} ${FH.words(A.d)}`, "fa", M.pieces(A.n, A.d, "fa")) + symbolic(FH.fr(A.n, A.d)) });
        st.push({ text: `Fill whole cakes: every ${A.d} pieces make one whole. ${w} whole${w === 1 ? "" : "s"} and ${r} left over.`, html: labelled(`${w} whole${w === 1 ? "" : "s"} and ${r}/${A.d}`, "fa", M.cakesFor(A, "fa", { showCuts: true })) + symbolic(`${FH.fr(A.n, A.d)} = ${w} ${FH.fr(r, A.d)}`) });
        st.push({ text: exp.join(" "), html: labelled("Answer", "fr-fill", M.cakesFor(it.ans, "fr-fill")) + symbolic(`${FH.fr(A.n, A.d)} = ${FH.show(it.ans, "mixed")}`) });
      } else if (it.sub === "toImproper") {
        const m = F.mixed(A);
        st.push({ text: `${FH.plain(A)}: ${m.w} whole cake${m.w === 1 ? "" : "s"} and ${m.n} ${FH.words(A.d)}.`, html: labelled(FH.plain(A), "fa", M.cakesFor(A, "fa")) + symbolic(FH.show(A, "mixed")) });
        st.push({ text: `Cut every whole into ${A.d} ${FH.words(A.d)} so all the pieces match, then count them: ${m.w} × ${A.d} + ${m.n} = ${A.n}.`, html: labelled(`${A.n} ${FH.words(A.d)}`, "fa", M.cakesFor(A, "fa", { showCuts: true })) + symbolic(`${FH.show(A, "mixed")} = ${FH.fr(A.n, A.d)}`) });
        st.push({ text: exp.join(" "), html: labelled("Answer", "fr-fill", M.barsFor(it.ans, "fr-fill")) + symbolic(`${FH.show(A, "mixed")} = ${FH.show(it.ans, "improper")}`) });
      } else if (it.sub === "simplify") {
        const g = F.gcd(A.n, A.d);
        st.push({ text: `${FH.plain(A)} as a bar: ${A.n} of ${A.d} pieces shaded.`, html: labelled(FH.plain(A), "fa", M.bar({ d: A.d, fills: Array.from({ length: A.d }, (_, i) => (i < A.n ? "fa" : "")), w: 420, h: 52 })) + symbolic(FH.fr(A.n, A.d)) });
        st.push({ text: `Group the pieces in ${g}s (${g} divides both ${A.n} and ${A.d}). The shading is the same amount with fewer, bigger pieces: ${A.n / g} of ${A.d / g}.`, html: labelled("Grouped", "fa", M.bar({ d: A.d / g, fills: Array.from({ length: A.d / g }, (_, i) => (i < A.n / g ? "fa" : "")), sub: g, w: 420, h: 52 })) + symbolic(`${FH.fr(A.n, A.d)} = ${FH.fr(A.n / g, A.d / g)}`) });
        st.push({ text: exp.join(" "), html: labelled("Answer", "fr-fill", M.bar({ d: it.ans.d, fills: Array.from({ length: it.ans.d }, (_, i) => (i < it.ans.n ? "fr-fill" : "")), w: 420, h: 52 })) + symbolic(`${FH.fr(A.n, A.d)} = ${FH.show(it.ans)}`) });
      } else {
        const t = it.target, up = t.d > A.d, k = up ? t.d / A.d : A.d / t.d;
        st.push({ text: `${FH.plain(A, "improper")} as a bar.`, html: labelled(FH.plain(A, "improper"), "fa", M.bar({ d: A.d, fills: Array.from({ length: A.d }, (_, i) => (i < A.n ? "fa" : "")), w: 420, h: 52 })) + symbolic(q) });
        st.push({ text: up ? `Cut each piece in ${k}: ${A.d} × ${k} = ${t.d} pieces, and the shaded part is cut too: ${A.n} × ${k} = ${t.n}. Same amount, more pieces.` : `Group the pieces in ${k}s: ${A.d} ÷ ${k} = ${t.d} pieces, and the shaded part groups too: ${A.n} ÷ ${k} = ${t.n}. Same amount, fewer pieces.`, html: labelled(`${t.n}/${t.d}`, "fa", up ? M.bar({ d: A.d, fills: Array.from({ length: A.d }, (_, i) => (i < A.n ? "fa" : "")), sub: k, w: 420, h: 52 }) : M.bar({ d: t.d, fills: Array.from({ length: t.d }, (_, i) => (i < t.n ? "fa" : "")), sub: k, w: 420, h: 52 })) + symbolic(`${FH.fr(A.n, A.d)} = ${FH.fr(t.n, t.d)}`) });
        st.push({ text: exp.join(" "), html: labelled("Answer", "fr-fill", M.bar({ d: t.d, fills: Array.from({ length: t.d }, (_, i) => (i < t.n ? "fr-fill" : "")), w: 420, h: 52 })) + symbolic(`${FH.fr(A.n, A.d)} = ${FH.fr(t.n, t.d)}`) });
      }
    }
    return st;
  }
  function startWatch() {
    teach.phase = "watch";
    teach.stages = watchStages(teach.examples[teach.exIdx]);
    teach.stage = 0;
    renderWatch();
  }
  function renderWatch() {
    const it = teach.examples[teach.exIdx];
    const s = teach.stages[teach.stage], total = teach.stages.length;
    teachHead(`Watch · example ${teach.exIdx + 1} of ${teach.examples.length}`, 10 + ((teach.exIdx * total + teach.stage + 1) / (total * teach.examples.length)) * 25, `${cellName(teach.cellId)} · step ${teach.stage + 1} of ${total}`);
    $("teachContent").innerHTML = `<div class="watch-q">${FH.promptFor(it) ? `<span class="prompt">${FH.promptFor(it)}:</span> ` : ""}${FH.questionHtml(it)}</div>
      <div class="watch-text">${s.text}</div>
      <div class="models">${s.html}</div>${M.legend(it.op === "×" ? ["fa", "fb", "ab", "fr-fill"] : it.op === "−" ? ["fa", "fb", "fx", "fr-fill"] : ["fa", "fb", "fr-fill"])}`;
    const last = teach.stage === total - 1;
    const lastEx = teach.exIdx === teach.examples.length - 1;
    nextBtn(last ? (lastEx ? "Now you build one" : "Another example") : "Next step");
  }

  /* ---- Build (We do): scripted construction with judgement ---- */
  function startBuild() {
    teach.phase = "build";
    teach.buildIdx = 0;
    startBuildItem();
  }
  function startBuildItem() {
    const it = teach.builds[teach.buildIdx];
    teach.script = buildScript(it);
    teach.stepIdx = 0;
    renderBuildStep(true);
  }
  function renderBuildStep(fresh) {
    const it = teach.builds[teach.buildIdx];
    const script = teach.script, step = script.steps[teach.stepIdx];
    teachHead(`Build · example ${teach.buildIdx + 1} of ${BUILD_ROUNDS}`, 38 + ((teach.buildIdx + (teach.stepIdx + 1) / script.steps.length) / BUILD_ROUNDS) * 24, `${cellName(teach.cellId)} · step ${teach.stepIdx + 1} of ${script.steps.length}`);
    if (fresh) {
      $("teachContent").innerHTML = `<div class="watch-q">${FH.promptFor(it) ? `<span class="prompt">${FH.promptFor(it)}:</span> ` : ""}${FH.questionHtml(it)}</div>
        <div class="build-say" id="buildSay"></div>
        <div id="buildStage"></div>
        <div id="buildAnswer"></div>
        <div class="teach-feedback" id="buildFb" aria-live="polite"></div>`;
      script.setup($("buildStage"));
    }
    $("buildSay").innerHTML = step.say;
    $("buildFb").className = "teach-feedback"; $("buildFb").innerHTML = "";
    const ans = $("buildAnswer");
    if (step.typed) {
      ans.innerHTML = fracInputHtml(it.form);
      wireFrac(ans, it.form, () => onBuildCheck());
      nextBtn("Check ↵");
    } else {
      ans.innerHTML = "";
      nextBtn("Check");
    }
    if (step.enter) step.enter();
  }
  function onBuildCheck() {
    const it = teach.builds[teach.buildIdx];
    const step = teach.script.steps[teach.stepIdx];
    const fb = $("buildFb");
    let r;
    if (step.typed) {
      const resp = readFrac($("buildAnswer"));
      const c = FH.check(it, resp);
      r = c.correct ? { ok: true, msg: `✓ ${FH.answerText(it)}. ${step.doneMsg || ""}` } : { ok: false, msg: `✗ ${givenText(resp)} — ${c.why || `the picture shows ${step.picture ? step.picture() : FH.answerText(it)}`}${c.why && step.picture ? ` The picture shows ${step.picture()}.` : ""}` };
    } else r = step.check();
    if (r === null) return;
    fb.className = "teach-feedback " + (r.ok ? "good" : "bad");
    fb.innerHTML = r.msg;
    if (r.ok) {
      if (step.typed) lockFrac($("buildAnswer"));
      $("teachNextBtn").disabled = true;
      setTimeout(() => {
        teach.stepIdx++;
        if (teach.stepIdx < teach.script.steps.length) { renderBuildStep(false); return; }
        teach.buildIdx++;
        if (teach.buildIdx < BUILD_ROUNDS) startBuildItem(); else startYouDo();
      }, step.typed ? 1400 : 900);
    }
  }

  // Scripts return { setup(host), steps:[{say, check|typed, picture?}] }
  function buildScript(it) {
    if (it.op === "+" ) return scriptAdd(it);
    if (it.op === "−") return scriptSub(it);
    if (it.op === "×") return scriptMul(it);
    if (it.op === "÷") return scriptDiv(it);
    return scriptConv(it);
  }
  const wordsOf = (d) => FH.words(d);
  function cakesSpec(f, cls, forBuilding) {
    // given whole cakes + one cake to build (or a given partial)
    const w = Math.floor(f.n / f.d), r = f.n - w * f.d;
    const cakes = [];
    for (let i = 0; i < w; i++) cakes.push({ cuts: 1, state: [cls], given: true });
    if (forBuilding) cakes.push({ cuts: 1, state: [""] });
    else if (r) cakes.push({ cuts: f.d, state: Array.from({ length: f.d }, (_, i) => (i < r ? cls : "")), given: true });
    return cakes;
  }
  function showOf(cb, gid) { const v = cb.value(gid); return v.n ? FH.plain(v, "mixed") : "nothing"; }
  function checkBuilt(cb, gid, target, label) {
    const v = cb.value(gid), cuts = cb.cutsOf(gid);
    const partD = target.d;
    if (!F.eq(v, target)) {
      const hint = cuts === null ? " The cakes in this group are cut into different sizes — use the same cut for the cake you are building." : (cuts !== partD && cuts % partD !== 0 ? ` The bottom number ${partD} says cut into ${partD} equal pieces; you have ${wordsOf(cuts)}.` : ` The top number says how many pieces to shade.`);
      return { ok: false, msg: `✗ That shows ${showOf(cb, gid)}, not ${FH.plain(target)}.${hint}` };
    }
    if (cuts !== null && cuts !== partD && target.n % target.d !== 0) return { ok: true, msg: `✓ That is ${FH.plain(target)} — ${wordsOf(cuts)} work because ${FH.plain(v)} is the same amount. ${wordsOf(partD)} would have been the quick way.` };
    return { ok: true, msg: `✓ ${label || "That shows"} ${FH.plain(target)}.` };
  }
  function scriptAdd(it) {
    const A = it.A, B = it.B, L = F.lcm(A.d, B.d);
    let cb;
    return {
      setup(host) {
        cb = FH.CakeBuilder(host, {
          groups: [{ id: "A", label: `First amount ${FH.plain(A)}`, cls: "fa", cakes: cakesSpec(A, "fa", true) }, { id: "B", label: `Second amount ${FH.plain(B)}`, cls: "fb", cakes: cakesSpec(B, "fb", true) }],
          controls: { cut: true, shade: true, dragFrom: [], dragTo: [] },
          onDrop: (r) => { const fb = $("buildFb"); fb.className = "teach-feedback " + (r.ok ? "good" : "bad"); fb.innerHTML = r.ok ? (r.whole ? "✓ A whole cake moved across." : "✓ Piece moved.") : "✗ " + r.why; },
        });
      },
      steps: [
        { say: `Show the first amount, <b>${FH.plain(A)}</b>: cut the empty cake${A.n > A.d ? " (the whole cakes are already there)" : ""} into ${A.d} and shade ${F.mixed(A).n || A.n} piece${(F.mixed(A).n || A.n) === 1 ? "" : "s"}. Tap a piece to shade it.`, check: () => checkBuilt(cb, "A", A, "The first cake shows") },
        { say: `Now the second amount, <b>${FH.plain(B)}</b>, in the second group.`, check: () => checkBuilt(cb, "B", B, "The second group shows") },
        ...(A.d !== B.d ? [{ say: `The pieces are different sizes (${wordsOf(A.d)} and ${wordsOf(B.d)}), so they cannot be counted together. Use <b>cut each piece in</b> until both groups have the same size pieces.`, check: () => {
          const ca = cb.cutsOf("A"), cbb = cb.cutsOf("B");
          if (ca === null || cbb === null) return { ok: false, msg: "✗ One group has cakes cut into different sizes. Every cake in a group needs the same cut." };
          if (ca !== cbb) return { ok: false, msg: `✗ Still ${wordsOf(ca)} and ${wordsOf(cbb)}. Cut the bigger pieces: ${ca < cbb ? `each ${wordsOf(ca).replace(/s$/, "")} into ${cbb % ca === 0 ? cbb / ca : L / ca}` : `each ${wordsOf(cbb).replace(/s$/, "")} into ${ca % cbb === 0 ? ca / cbb : L / cbb}`}${(ca % cbb && cbb % ca) ? `, and the other group into ${L}ths too` : ""}.` };
          if (ca !== L) return { ok: true, msg: `✓ Both in ${wordsOf(ca)} — that works. ${wordsOf(L)} would have been enough (the lowest common denominator of ${A.d} and ${B.d}).` };
          return { ok: true, msg: `✓ Both in ${wordsOf(L)}: the lowest common denominator of ${A.d} and ${B.d}.` };
        } }] : []),
        { say: `Drag every shaded piece and every whole cake from the second group into the first (or tap a piece, then tap the first group).`, enter: () => cb.setControls({ shade: false, cut: false, dragFrom: ["B"], dragTo: ["A"] }), check: () => cb.value("B").n === 0 ? { ok: true, msg: "✓ Everything is in one group now." } : { ok: false, msg: `✗ ${showOf(cb, "B")} is still in the second group.` } },
        { say: `Count what is in the first group and write the total in lowest terms.`, typed: true, picture: () => { const full = cb.fullCakes("A"); const list = cb.shadedList("A").filter((c) => c.shaded && c.shaded !== c.cuts); return `${full} full cake${full === 1 ? "" : "s"}${list.length ? ` and ${list.map((c) => `${c.shaded} of ${c.cuts}`).join(" + ")}` : ""} = ${FH.answerText(it)}`; }, doneMsg: "Same-size pieces, then count." },
      ],
    };
  }
  function scriptSub(it) {
    const A = it.A, B = it.B;
    let cb;
    return {
      setup(host) {
        cb = FH.CakeBuilder(host, {
          groups: [{ id: "A", label: `Start with ${FH.plain(A)}`, cls: "fa", cakes: cakesSpec(A, "fa", A.d !== 1) }, { id: "B", label: `Take away ${FH.plain(B)}`, cls: "fb", cakes: cakesSpec(B, "fb", false), fixed: true, readout: false }],
          controls: { cut: true, shade: true, cutWholes: true, dragFrom: [], dragTo: [] },
        });
      },
      steps: [
        ...(A.d !== 1 ? [{ say: `Show the starting amount, <b>${FH.plain(A)}</b>: cut the empty cake into ${A.d} and shade ${F.mixed(A).n} piece${F.mixed(A).n === 1 ? "" : "s"}.`, check: () => checkBuilt(cb, "A", A, "You have") }] : []),
        ...(A.d % B.d !== 0 ? [{ say: `We need to take away ${FH.plain(B)}, but there are no ${wordsOf(B.d)} here. Cut so the pieces are ${wordsOf(B.d)} (or a size both fit) — use <b>${A.d === 1 ? "cut a whole cake into" : "cut each piece in"}</b>.`, check: () => {
          const c = cb.cutsOf("A");
          const cakes = cb.group("A").cakes;
          const bad = cakes.find((k) => k.cuts > 1 && k.cuts % B.d !== 0) || (A.d === 1 ? cakes.find((k) => k.cuts === 1) : null);
          if (bad) return { ok: false, msg: `✗ A cake is still in ${wordsOf(bad.cuts)}; ${wordsOf(B.d)} do not fit into that. Cut it so ${B.d} divides the number of pieces.` };
          return { ok: true, msg: `✓ Now ${FH.plain(B)} can be taken out${c && c !== F.lcm(A.d, B.d) ? ` — ${wordsOf(F.lcm(A.d, B.d))} would have been enough` : ""}.` };
        } }] : []),
        { say: `Eat <b>${FH.plain(B)}</b>: tap pieces to eat them (they turn grey).${it.tags.includes("regroup") ? " There are not enough loose pieces — <b>cut a whole cake</b> into the same pieces and eat from it." : ""}`, enter: () => cb.setControls({ shade: false, eat: true }), check: () => {
          const e = cb.eaten("A");
          if (F.eq(e, B)) return { ok: true, msg: `✓ ${FH.plain(B)} eaten.` };
          if (e.n === 0) return { ok: false, msg: `✗ Nothing eaten yet. Tap ${B.n} piece${B.n === 1 ? "" : "s"} of the right size.` };
          const cmp = F.cmp(e, B);
          return { ok: false, msg: `✗ You ate ${FH.plain(e, "mixed")}, ${cmp < 0 ? "not enough — " : "too much — "}we take away ${FH.plain(B)}.${cmp < 0 && it.tags.includes("regroup") ? " Cut a whole cake into pieces to keep going." : ""} Tap a grey piece to put it back.` };
        } },
        { say: `How much is left (not grey)? Write it in lowest terms.`, typed: true, picture: () => `${showOf(cb, "A")} left`, doneMsg: "Match the pieces, then take away." },
      ],
    };
  }
  function scriptMul(it) {
    const A = it.A, B = it.B, uW = Math.ceil(A.n / A.d), uH = Math.ceil(B.n / B.d);
    let gb;
    const eqNote = (got, gotOf, want, wantOf, what) => {
      if (got * wantOf === want * gotOf) return { ok: true, msg: `✓ ${got} of ${gotOf} ${what} — that is the same amount as ${want}/${wantOf}.` };
      return { ok: false, msg: `✗ You have ${got} of ${gotOf} ${what} shaded, which is ${FH.plain(F.red(got, gotOf), "mixed")}, not ${FH.plain(F.red(want, wantOf), "mixed")}. Cut every whole into ${wantOf} and shade ${want}.` };
    };
    return {
      setup(host) { gb = FH.GridBuilder(host, { unitsW: uW, unitsH: uH }); },
      steps: [
        { say: `Show the first amount, <b>${FH.plain(A)}</b>, as columns: set the vertical cuts to ${A.d} per whole and shade ${A.n} column${A.n === 1 ? "" : "s"} by tapping the tabs above them.`, check: () => eqNote(gb.colsShaded(), gb.state.cols, A.n, A.d, "columns") },
        { say: `Now the second amount, <b>${FH.plain(B)}</b>, as rows across the same square: horizontal cuts ${B.d} per whole, shade ${B.n} row${B.n === 1 ? "" : "s"} with the tabs on the left.`, check: () => eqNote(gb.rowsShaded(), gb.state.rows, B.n, B.d, "rows") },
        { say: `The double-shaded pieces are ${FH.plain(A)} of ${FH.plain(B)}. Count them, count how many pieces make one whole, and write the product in lowest terms.`, typed: true, picture: () => `${gb.overlap()} double-shaded of ${gb.state.cols * gb.state.rows} in a whole`, doneMsg: "Tops multiply, bottoms multiply." },
      ],
    };
  }
  function scriptDiv(it) {
    const A = it.A, B = it.B, av = A.n / A.d, bv = B.n / B.d;
    let jl;
    return {
      setup(host) { jl = FH.JumpLine(host, { A, B }); },
      steps: [
        { say: `${FH.plain(A)} ÷ ${FH.plain(B)} asks how many <b>${FH.plain(B)}</b>s fit into <b>${FH.plain(A)}</b>. Jump ${FH.plain(B)} along the line until you reach ${FH.plain(A)}.`, check: () => {
          const reached = jl.reached();
          if (reached < av - 1e-9) return { ok: false, msg: `✗ You are at ${FH.plain(F.red(Math.round(reached * A.d * B.d), A.d * B.d), "mixed")}, not yet at ${FH.plain(A)}. Keep jumping.` };
          const full = jl.fullFit();
          return { ok: true, msg: `✓ ${full} full jump${full === 1 ? "" : "s"}${full * bv < av - 1e-9 ? " and part of a jump" : ", exactly"}.` };
        } },
        { say: `How many jumps of ${FH.plain(B)} fit into ${FH.plain(A)}? Count a part jump as a fraction of a jump (a jump is ${B.n} ${wordsOf(B.d)} long). Write it in lowest terms.`, typed: true, picture: () => `${jl.fullFit()} full jump${jl.fullFit() === 1 ? "" : "s"}${jl.fullFit() * bv < av - 1e-9 ? ` and ${FH.plain(F.red(Math.round((av - jl.fullFit() * bv) * A.d * B.d), A.d * B.n))} of a jump` : ""}`, doneMsg: `Keep the first, flip the second, multiply gives the same: ${FH.plain(A, "improper")} × ${B.d}/${B.n}.` },
      ],
    };
  }
  function scriptConv(it) {
    const A = it.A;
    if (it.sub === "toMixed") {
      let cb;
      return {
        setup(host) {
          cb = FH.CakeBuilder(host, {
            groups: [
              { id: "P", label: `${A.n} loose ${wordsOf(A.d)}`, cls: "fa", hideEmpty: true, fixed: true, readoutLabel: "Still loose:", cakes: Array.from({ length: A.n }, () => ({ cuts: A.d, state: Array.from({ length: A.d }, (_, i) => (i === 0 ? "fa" : "")) })) },
              { id: "C", label: "Cakes (each holds " + A.d + ")", cls: "fa", fixed: true, cakes: [{ cuts: A.d, state: Array(A.d).fill("") }] },
            ],
            controls: { cut: false, shade: false, dragFrom: ["P"], dragTo: ["C"] },
            onDrop: (r) => { if (!r.ok) { const fb = $("buildFb"); fb.className = "teach-feedback bad"; fb.innerHTML = "✗ " + r.why; } },
          });
        },
        steps: [
          { say: `Drag every loose piece onto the cakes (or tap a piece, then tap the cakes). A new cake appears when one is full.`, check: () => {
            if (cb.value("P").n) return { ok: false, msg: `✗ ${cb.pieceCount("P")} piece${cb.pieceCount("P") === 1 ? "" : "s"} still loose.` };
            const full = cb.fullCakes("C"), list = cb.shadedList("C").filter((c) => c.shaded && c.shaded !== c.cuts);
            return { ok: true, msg: `✓ ${full} full cake${full === 1 ? "" : "s"}${list.length ? ` and ${list[0].shaded} of ${list[0].cuts}` : ""}.` };
          } },
          { say: `Write ${FH.plain(A)} as a mixed number: full cakes, then the leftover pieces.`, typed: true, picture: () => `${cb.fullCakes("C")} full and ${(cb.shadedList("C").find((c) => c.shaded && c.shaded !== c.cuts) || { shaded: 0 }).shaded} of ${A.d}`, doneMsg: `${A.n} ÷ ${A.d}: the whole is the quotient, the remainder stays over ${A.d}.` },
        ],
      };
    }
    if (it.sub === "toImproper") {
      let cb;
      return {
        setup(host) { cb = FH.CakeBuilder(host, { groups: [{ id: "A", label: FH.plain(A), cls: "fa", cakes: cakesSpec(A, "fa", false) }], controls: { cut: true, shade: false, cutWholes: true } }); },
        steps: [
          { say: `Cut every whole cake into ${A.d} so that every piece is a ${wordsOf(A.d).replace(/s$/, "")}. Use <b>cut a whole cake into ${A.d}</b> for each whole.`, check: () => {
            const bad = cb.group("A").cakes.find((c) => c.cuts % A.d !== 0);
            if (bad) return { ok: false, msg: bad.cuts === 1 ? `✗ A whole cake is still uncut. Cut it into ${A.d}.` : `✗ A cake is in ${wordsOf(bad.cuts)}, not ${wordsOf(A.d)} — the pieces do not all match. Cut each of those pieces so the cake ends up in ${wordsOf(A.d)}, or count carefully in ${wordsOf(bad.cuts)}: the answer is the same amount.` };
            return { ok: true, msg: `✓ Every piece is a ${wordsOf(A.d).replace(/s$/, "")} now.` };
          } },
          { say: `Count all the pieces and write ${FH.plain(A)} as an improper fraction.`, typed: true, picture: () => `${cb.pieceCount("A")} ${wordsOf(A.d)}`, doneMsg: `Whole × ${A.d} + the part.` },
        ],
      };
    }
    if (it.sub === "simplify") {
      let bb;
      return {
        setup(host) { bb = FH.BarBuilder(host, { n: A.n, d: A.d, allowGroup: true }); },
        steps: [
          { say: `Group the pieces into equal bigger pieces until the bar cannot be grouped any further.`, check: () => {
            const s = bb.state, g = F.gcd(s.n, s.d);
            if (g > 1) return { ok: false, msg: `✗ ${s.n}/${s.d} can still be grouped: ${g} divides both ${s.n} and ${s.d}.` };
            return { ok: true, msg: `✓ ${s.n} of ${s.d} — nothing divides both, so this is lowest terms.` };
          } },
          { say: `Write ${FH.plain(A)} in lowest terms.`, typed: true, picture: () => `${bb.state.n} of ${bb.state.d}`, doneMsg: "Divide top and bottom by the highest common factor." },
        ],
      };
    }
    let bb;
    const t = it.target, up = t.d > A.d;
    return {
      setup(host) { bb = FH.BarBuilder(host, { n: A.n, d: A.d, allowCut: up, allowGroup: !up }); },
      steps: [
        { say: up ? `The bar has ${A.d} pieces; we want ${t.d}. Cut each piece so there are ${t.d}.` : `The bar has ${A.d} pieces; we want ${t.d}. Group the pieces so there are ${t.d}.`, check: () => {
          if (bb.state.d !== t.d) return { ok: false, msg: `✗ ${bb.state.d} pieces, not ${t.d}. ${up ? `${A.d} × ? = ${t.d}` : `${A.d} ÷ ? = ${t.d}`}.` };
          return { ok: true, msg: `✓ ${t.d} pieces, and ${bb.state.n} are shaded — the same amount as ${FH.plain(A, "improper")}.` };
        } },
        { say: `Now read off the missing number in ${FH.questionText(it)}.`, typed: true, picture: () => `${bb.state.n} of ${bb.state.d}`, doneMsg: "Whatever happens to the bottom happens to the top." },
      ],
    };
  }

  /* ---- Your turn (You do): typed, three in a row, picture after ---- */
  function startYouDo() {
    teach.phase = "youdo";
    teach.streak = 0;
    nextYouDo();
  }
  function nextYouDo() {
    teach.youdoItem = sample(teach.cellId, 1)[0];
    teach.answered = false;
    const it = teach.youdoItem;
    teachHead("Your turn", 64 + (teach.streak / YOUDO_TARGET) * 30, `${cellName(teach.cellId)} · ${teach.streak} of ${YOUDO_TARGET} in a row`);
    $("teachContent").innerHTML = `<div class="youdo-streak">Correct in a row: <b>${teach.streak}</b> / ${YOUDO_TARGET}</div>
      <div class="watch-q big">${FH.promptFor(it) ? `<span class="prompt">${FH.promptFor(it)}:</span> ` : ""}${FH.questionHtml(it)}</div>
      <div id="youdoAnswer">${fracInputHtml(it.form)}</div>
      <div class="teach-feedback" id="youdoFb" aria-live="polite"></div>
      <div id="youdoModels"></div>`;
    wireFrac($("youdoAnswer"), it.form, onYouDoCheck);
    nextBtn("Check ↵");
  }
  function onYouDoCheck() {
    if (teach.answered) { teach.streak >= YOUDO_TARGET ? finishTeach() : nextYouDo(); return; }
    const it = teach.youdoItem;
    const resp = readFrac($("youdoAnswer"));
    const r = FH.check(it, resp);
    teach.answered = true;
    teach.youdoTotal++;
    lockFrac($("youdoAnswer"));
    const fb = $("youdoFb");
    if (r.correct) {
      teach.streak++; teach.youdoRight++;
      fb.className = "teach-feedback good";
      fb.innerHTML = `✓ Correct: ${FH.showAns(it.ans)}.`;
      nextBtn(teach.streak >= YOUDO_TARGET ? "Finish" : "Next ↵");
    } else {
      teach.streak = 0;
      teach.youdoWrongs.push(FH.questionText(it));
      fb.className = "teach-feedback bad";
      fb.innerHTML = `✗ ${givenText(resp)} — ${r.why || `answer: ${FH.answerText(it)}.`}<ol class="steps">${FH.explain(it).map((s) => `<li>${s}</li>`).join("")}</ol>`;
      $("youdoModels").innerHTML = `<div class="models small">${it.op === "→" ? "" : labelled("First amount", "fa", M.cakesFor(it.A, "fa"))}${it.B ? labelled("Second amount", "fb", M.cakesFor(it.B, "fb")) : ""}${labelled("Answer", "fr-fill", it.form === "number" ? M.bar({ d: it.target.d, fills: Array.from({ length: it.target.d }, (_, i) => (i < it.target.n ? "fr-fill" : "")), w: 300, h: 40 }) : M.cakesFor(it.ans, "fr-fill"))}</div>`;
      nextBtn("Next ↵");
    }
    $("teachNextBtn").focus();
  }
  function finishTeach() {
    teach.phase = "done";
    store.teach[teach.cellId] = { date: today(), youdoRight: teach.youdoRight, youdoTotal: teach.youdoTotal, wrongs: teach.youdoWrongs.slice(-5) };
    store.history.push({ date: today(), kind: "teach", cell: teach.cellId, right: teach.youdoRight, total: teach.youdoTotal, wrongs: teach.youdoWrongs });
    save();
    teachHead("Done", 100);
    $("teachContent").innerHTML = `<div class="li-box"><div class="eyebrow">Teach cycle finished</div><div class="li-text">${esc(cellName(teach.cellId))}</div></div>
      <p class="muted">Your turn: ${teach.youdoRight} right out of ${teach.youdoTotal} typed, ending with ${YOUDO_TARGET} in a row. ${teach.youdoWrongs.length ? `Missed on the way: ${teach.youdoWrongs.map(esc).join(", ")}.` : "No misses."}</p>
      <p class="muted">Next: drill this cell against the clock, or go back to the grid. The cell now shows <span class="ttick">taught</span>.</p>
      <div class="row-actions"><button type="button" class="primary-btn inline" id="teachDrillBtn">Drill this cell</button><button type="button" class="secondary-btn inline" id="teachBackBtn">Back to the grid</button></div>`;
    $("teachDrillBtn").addEventListener("click", () => { mode = "drill"; drillSel = new Set([teach.cellId]); teach = null; buildModeToggle(); buildMatrix(); updateToolbar(); show("grid"); });
    $("teachBackBtn").addEventListener("click", () => { teach = null; buildMatrix(); updateToolbar(); show("grid"); });
    nextBtn("", false);
  }
  $("teachNextBtn").addEventListener("click", () => {
    if (!teach) return;
    if (teach.phase === "goals") startWatch();
    else if (teach.phase === "watch") {
      teach.stage++;
      if (teach.stage < teach.stages.length) renderWatch();
      else if (teach.exIdx < teach.examples.length - 1) { teach.exIdx++; teach.stages = watchStages(teach.examples[teach.exIdx]); teach.stage = 0; renderWatch(); }
      else startBuild();
    } else if (teach.phase === "build") onBuildCheck();
    else if (teach.phase === "youdo") onYouDoCheck();
  });
  $("teachQuitBtn").addEventListener("click", () => { teach = null; buildMatrix(); updateToolbar(); show("grid"); });

  /* ================= DRILL ================= */
  function requestFullscreenSafe() {
    const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) { try { const p = req.call(el); if (p && p.catch) p.catch(() => {}); } catch (e) { /* needs a gesture */ } }
  }
  function exitFullscreenSafe() {
    if (document.fullscreenElement) { try { const p = document.exitFullscreen(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } }
  }
  function buildQueue(cells) {
    const q = [];
    cells.forEach((id) => {
      const lvl = +id.split("-")[1], row = id.split("-")[0];
      const earlier = FH.LEVELS.filter((l) => l < lvl).map((l) => `${row}-${l}`);
      const nTarget = earlier.length ? PER_CELL - REVIEW_PER_CELL : PER_CELL;
      sample(id, nTarget).forEach((it) => q.push({ item: it, forCell: id, review: false }));
      if (earlier.length) for (let i = 0; i < REVIEW_PER_CELL; i++) { const from = pick(earlier); q.push({ item: pick(FH.bank(from)), forCell: id, review: true, fromCell: from }); }
    });
    return shuffle(q);
  }
  function startDrill(afterLeave) {
    if (!drillSel.size) return;
    clearTimeout(advanceTimeout);
    const cells = [...drillSel];
    drill = { cells, tier, queue: buildQueue(cells), idx: 0, total: cells.length * tier.seconds, remaining: cells.length * tier.seconds, right: 0, attempted: 0, log: [], locked: false, answered: false, startedAt: Date.now() };
    save();
    requestFullscreenSafe();
    $("hudCells").textContent = cells.length === 1 ? FH.CELLS[cells[0]].name : `${cells.length} cells`;
    $("hudTier").textContent = `${tier.label} × ${cells.length}`;
    $("timerBar").style.width = "100%"; $("timerBar").style.background = "";
    $("drillLogBody").innerHTML = "";
    $("cheatBanner").classList.toggle("hidden", !afterLeave);
    if (afterLeave) setTimeout(() => $("cheatBanner").classList.add("hidden"), 4000);
    show("drill");
    showDrillQuestion();
    tick();
    timerHandle = setInterval(tick, 1000);
  }
  function tick() {
    if (!drill) return;
    $("hudTimer").textContent = fmtTime(drill.remaining);
    const pct = Math.max(0, (drill.remaining / drill.total) * 100);
    $("timerBar").style.width = pct + "%";
    if (pct < 25) $("timerBar").style.background = "linear-gradient(90deg,#f87171,#fb923c)";
    else if (pct < 50) $("timerBar").style.background = "linear-gradient(90deg,#fbbf24,#facc15)";
    if (drill.remaining <= 0) { finishDrill(false); return; }
    drill.remaining -= 1;
  }
  function showDrillQuestion() {
    const e = drill.queue[drill.idx], it = e.item;
    drill.answered = false; drill.locked = false;
    $("hudDone").textContent = `${drill.idx} / ${drill.queue.length}`;
    $("qTag").innerHTML = `${e.review ? `<span class="review-tag">review</span> ${esc(cellName(e.fromCell))}` : esc(cellName(e.forCell))}`;
    $("qPrompt").textContent = FH.promptFor(it);
    $("qText").innerHTML = FH.questionHtml(it);
    const host = $("qAnswer");
    host.innerHTML = fracInputHtml(it.form);
    wireFrac(host, it.form, submitDrill);
    $("qFeedback").className = "feedback"; $("qFeedback").innerHTML = "";
    $("qNextBtn").classList.add("hidden");
    $("qCheckBtn").classList.remove("hidden");
  }
  function submitDrill() {
    if (!drill || drill.locked) return;
    if (drill.answered) { advanceDrill(); return; }
    const e = drill.queue[drill.idx], it = e.item;
    const resp = readFrac($("qAnswer"));
    const r = FH.check(it, resp);
    drill.locked = true; drill.answered = true;
    $("qCheckBtn").classList.add("hidden");
    drill.attempted++;
    if (r.correct) drill.right++;
    drill.log.push({ forCell: e.forCell, review: e.review, q: FH.questionText(it), given: givenText(resp), ans: FH.answerText(it), correct: r.correct, why: r.why || "", rule: FH.explain(it) });
    lockFrac($("qAnswer"));
    const fb = $("qFeedback");
    const tr = document.createElement("tr");
    tr.className = r.correct ? "row-correct" : "row-wrong";
    tr.innerHTML = `<td>${drill.idx + 1}</td><td>${esc(FH.questionText(it))}</td><td>${esc(givenText(resp))}${r.correct ? " ✓" : ` ✗ <small>(${esc(FH.answerText(it))})</small>`}</td>`;
    $("drillLogBody").appendChild(tr);
    if (r.correct) {
      fb.className = "feedback correct"; fb.textContent = "✓ Correct";
      drill.locked = false;
      advanceTimeout = setTimeout(advanceDrill, 350);
    } else {
      const steps = FH.explain(it);
      fb.className = "feedback wrong";
      fb.innerHTML = `✗ ${r.why ? esc(r.why) : `Answer: ${FH.showAns(it.ans)}`}<div class="rule">${steps.slice(0, Math.min(3, steps.length - 1)).join(" ")}</div>`;
      $("qNextBtn").classList.remove("hidden");
      drill.locked = false;
      $("qNextBtn").focus();
    }
  }
  function advanceDrill() {
    clearTimeout(advanceTimeout);
    if (!drill) return;
    drill.idx++;
    if (drill.idx >= drill.queue.length) finishDrill(true); else showDrillQuestion();
  }
  $("qNextBtn").addEventListener("click", advanceDrill);
  $("qCheckBtn").addEventListener("click", submitDrill);
  // Enter anywhere on the drill screen advances after a wrong answer — unless
  // focus is on a button or input, which handle Enter themselves.
  document.addEventListener("keydown", (e) => {
    if (!drill || !drill.answered || e.key !== "Enter" || $("qNextBtn").classList.contains("hidden")) return;
    if (e.target.closest && e.target.closest("button, input")) return;
    e.preventDefault(); advanceDrill();
  });
  $("quitBtn").addEventListener("click", () => { voidDrill(); show("grid"); });

  function voidDrill() {
    clearInterval(timerHandle); timerHandle = null; clearTimeout(advanceTimeout);
    drill = null;
  }
  // Leaving the drill screen (tab, window, fullscreen) voids the attempt —
  // the clock is the whole point and a calculator tab defeats it. Nothing
  // resumes automatically; Play restarts the same selection.
  function handleLeave() {
    if (!drill) return;
    pendingResume = { cells: drill.cells, tier: drill.tier };
    voidDrill();
    $("qText").innerHTML = ""; $("qAnswer").innerHTML = ""; $("drillLogBody").innerHTML = "";
    $("pauseOverlay").classList.remove("hidden");
  }
  $("pausePlayBtn").addEventListener("click", () => { $("pauseOverlay").classList.add("hidden"); drillSel = new Set(pendingResume.cells); tier = pendingResume.tier; startDrill(true); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) handleLeave(); });
  window.addEventListener("blur", handleLeave);
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && drill) handleLeave(); });

  function finishDrill(finished) {
    clearInterval(timerHandle); timerHandle = null; clearTimeout(advanceTimeout);
    const d = drill; drill = null;
    const elapsed = finished ? d.total - d.remaining : d.total;
    const perCell = {};
    d.cells.forEach((id) => { perCell[id] = { right: 0, total: 0 }; });
    d.log.forEach((l) => { perCell[l.forCell].total++; if (l.correct) perCell[l.forCell].right++; });
    const accuracy = d.attempted ? Math.round((d.right / d.attempted) * 100) : 0;
    // credit: every pace whose total time the finish beats, per cell with ≥4/5
    const credited = {};
    d.cells.forEach((id) => {
      credited[id] = [];
      const pc = perCell[id];
      const cellOk = finished && pc.total === PER_CELL && pc.right >= BEAT_MIN_RIGHT;
      TIERS.forEach((t) => {
        const within = finished && elapsed <= t.seconds * d.cells.length;
        const key = t.id;
        store.records[id] = store.records[id] || {};
        const prior = store.records[id][key] || { beaten: false, bestRight: 0, attempts: 0 };
        const attemptedHere = t.id === d.tier.id;
        if (cellOk && within) { prior.beaten = true; credited[id].push(t); prior.bestSeconds = Math.min(prior.bestSeconds || 1e9, elapsed); }
        if (attemptedHere || (cellOk && within)) {
          prior.attempts += attemptedHere ? 1 : 0;
          prior.bestRight = Math.max(prior.bestRight, pc.right);
          prior.total = PER_CELL;
          prior.lastPlayed = today();
          store.records[id][key] = prior;
        }
      });
    });
    const misses = d.log.filter((l) => !l.correct).map((l) => ({ cell: l.forCell, q: l.q, given: l.given, ans: l.ans, rule: l.rule[0] || "" }));
    store.history.push({ date: today(), kind: "drill", cells: d.cells, tier: d.tier.id, seconds: elapsed, finished, right: d.right, attempted: d.attempted, planned: d.queue.length, perCell, misses });
    save();
    renderResults({ d, finished, elapsed, perCell, accuracy, credited, misses });
  }
  function renderResults(r) {
    const { d, finished, elapsed, perCell, accuracy, credited, misses } = r;
    $("resultsTitle").textContent = finished ? `Finished in ${fmtTime(elapsed)}` : "Time's up";
    $("resCorrect").textContent = d.right; $("resTotal").textContent = d.attempted; $("resPlanned").textContent = d.queue.length;
    $("resAccuracy").textContent = accuracy + "%"; $("resTime").textContent = fmtTime(elapsed);
    $("resCells").innerHTML = d.cells.map((id) => {
      const pc = perCell[id];
      const chips = credited[id].length ? credited[id].map((t) => `<span class="chip ${t.cls}">beaten at ${t.label}</span>`).join("") : `<span class="chip none">${finished ? (pc.right < BEAT_MIN_RIGHT ? `needs ${BEAT_MIN_RIGHT} of ${PER_CELL}` : "over time") : "not finished"}</span>`;
      return `<div class="skill-row"><span class="skill-name">${esc(cellName(id))}</span><span>${chips}<span class="skill-score ${pc.right === pc.total && pc.total ? "ok" : pc.right >= BEAT_MIN_RIGHT ? "mid" : "low"}">${pc.right}/${pc.total}</span></span></div>`;
    }).join("");
    $("resMisses").innerHTML = misses.length
      ? `<h3>Missed — the rule each time</h3>` + misses.map((m) => `<div class="miss-row"><b>${esc(m.q)}</b> — you wrote ${esc(m.given)}, answer ${esc(m.ans)}<div class="rule">${m.rule}</div></div>`).join("")
      : `<p class="muted">Nothing missed.</p>`;
    const weakest = d.cells.slice().sort((a, b) => perCell[a].right - perCell[b].right)[0];
    $("resTeachBtn").textContent = `Teach: ${FH.CELLS[weakest].name}`;
    $("resTeachBtn").onclick = () => { mode = "teach"; teachTarget = weakest; buildModeToggle(); buildMatrix(); updateToolbar(); startTeach(weakest); };
    show("results");
    buildMatrix();
  }
  $("retryBtn").addEventListener("click", () => startDrill());
  $("resBackBtn").addEventListener("click", () => { exitFullscreenSafe(); updateToolbar(); show("grid"); });

  /* ================= REPORT ================= */
  function renderReport() {
    const cells = FH.cellIds();
    const anyBeaten = cells.filter((id) => TIERS.some((t) => beaten(id, t.id))).length;
    const drills = store.history.filter((h) => h.kind === "drill");
    const teaches = store.history.filter((h) => h.kind === "teach");
    const secs = drills.reduce((s, h) => s + (h.seconds || 0), 0);
    $("reportOverview").innerHTML = `
      <div class="overview-card"><span>${anyBeaten}/${cells.length}</span><label>cells beaten (any pace)</label></div>
      <div class="overview-card"><span>${cells.filter((id) => beaten(id, "60")).length}/${cells.length}</span><label>beaten at 1:00</label></div>
      <div class="overview-card"><span>${Object.keys(store.teach).length}/${cells.length}</span><label>teach cycles done</label></div>
      <div class="overview-card"><span>${drills.length}</span><label>drills logged</label></div>
      <div class="overview-card"><span>${fmtTime(secs)}</span><label>time on drills</label></div>`;

    const wrap = $("reportMatrix");
    wrap.innerHTML = `<div class="mrow mhead"><div class="mcell rowlabel"></div>${FH.LEVELS.map((l) => `<div class="mcell colhead">${l}</div>`).join("")}</div>` +
      FH.ROWS.map((row) => `<div class="mrow"><div class="mcell rowlabel"><span>${row.name}</span><span class="rowsym">${row.sym}</span></div>` +
        FH.LEVELS.map((l) => {
          const id = `${row.id}-${l}`;
          const best = TIERS.map((t) => rec(id, t.id)).filter(Boolean).reduce((m, x) => Math.max(m, x.bestRight || 0), 0);
          const tried = TIERS.some((t) => rec(id, t.id));
          return `<div class="mcell cell static${tried ? "" : " untried"}"><span class="cell-name">${esc(FH.CELLS[id].name)}</span><span class="cell-foot"><span class="dots">${TIERS.map((t) => `<i class="dot${beaten(id, t.id) ? " " + t.cls : ""}"></i>`).join("")}</span>${store.teach[id] ? `<span class="ttick">taught</span>` : ""}${tried ? `<small>best ${best}/${PER_CELL}</small>` : ""}</span></div>`;
        }).join("") + `</div>`).join("");

    // misses rolled up by cell, most-missed first (this is the actionable part)
    const byCell = {};
    drills.forEach((h) => (h.misses || []).forEach((m) => { const c = byCell[m.cell] = byCell[m.cell] || { n: 0, eg: [] }; c.n++; if (c.eg.length < 3) c.eg.push(m.q); }));
    const missRows = Object.entries(byCell).sort((a, b) => b[1].n - a[1].n).slice(0, 8);
    $("reportMisses").innerHTML = missRows.length
      ? `<h3>Most missed</h3>` + missRows.map(([id, c]) => `<div class="skill-row"><span class="skill-name">${esc(cellName(id))}</span><span><small class="muted">e.g. ${c.eg.map(esc).join(" · ")}</small> <span class="skill-score low">${c.n} miss${c.n === 1 ? "" : "es"}</span></span></div>`).join("")
      : `<p class="muted">No drill misses saved yet.</p>`;

    const recent = store.history.slice(-12).reverse();
    $("reportHistory").innerHTML = recent.length
      ? `<h3>Recent sessions</h3><div class="table-scroll"><table class="prog-table"><tr><th>Date</th><th>What</th><th>Cells</th><th>Score</th><th>Time</th></tr>` +
        recent.map((h) => h.kind === "drill"
          ? `<tr><td>${h.date}</td><td>Drill · ${TIERS.find((t) => t.id === h.tier).label} per cell</td><td>${h.cells.map((id) => esc(FH.CELLS[id].name)).join(", ")}</td><td class="num">${h.right}/${h.attempted} of ${h.planned}${h.finished ? "" : " (time ran out)"}</td><td class="num">${fmtTime(h.seconds)}</td></tr>`
          : `<tr><td>${h.date}</td><td>Teach</td><td>${esc(cellName(h.cell))}</td><td class="num">your turn ${h.right}/${h.total}</td><td class="num">—</td></tr>`).join("") + `</table></div>`
      : `<p class="muted">Finish a drill or a teach cycle and it will show up here.</p>`;
    $("studentName").value = store.name || "";
  }
  $("studentName").addEventListener("input", () => { store.name = $("studentName").value; save(); });
  function tsvRow() {
    const name = store.name || "";
    const head = ["name", "date"], vals = [name, today()];
    FH.cellIds().forEach((id) => {
      head.push(id + " paces beaten", id + " best");
      vals.push(TIERS.filter((t) => beaten(id, t.id)).map((t) => t.label).join("/") || "-");
      const best = TIERS.map((t) => rec(id, t.id)).filter(Boolean).reduce((m, x) => Math.max(m, x.bestRight || 0), -1);
      vals.push(best < 0 ? "-" : `${best}/${PER_CELL}`);
    });
    head.push("teach cycles done"); vals.push(Object.keys(store.teach).length);
    return head.join("\t") + "\n" + vals.join("\t");
  }
  function teacherText() {
    let t = `FRACTIONS HUB — ${store.name || "(no name)"} — ${today()}\n`;
    t += `First-try answers in timed drills. Cannot tell whether a calculator or a friend helped.\n\n`;
    FH.cellIds().forEach((id) => {
      const paces = TIERS.filter((t2) => beaten(id, t2.id)).map((t2) => t2.label).join(", ");
      const best = TIERS.map((t2) => rec(id, t2.id)).filter(Boolean).reduce((m, x) => Math.max(m, x.bestRight || 0), -1);
      if (paces || best >= 0 || store.teach[id]) t += `  ${cellName(id)}: ${paces ? "beaten at " + paces : "not beaten"}${best >= 0 ? `, best ${best}/${PER_CELL}` : ""}${store.teach[id] ? ", taught " + store.teach[id].date : ""}\n`;
    });
    const drills = store.history.filter((h) => h.kind === "drill");
    const misses = [];
    drills.slice(-5).forEach((h) => (h.misses || []).forEach((m) => misses.push(`${cellName(m.cell)}: ${m.q} → wrote ${m.given}, answer ${m.ans}`)));
    if (misses.length) t += `\nMisses (last 5 drills):\n` + misses.map((m) => "  " + m).join("\n") + "\n";
    return t;
  }
  function csvText() {
    const c = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    let s = "name,date,kind,tier,cells,right,attempted,planned,seconds,finished,misses\n";
    store.history.forEach((h) => {
      s += [store.name || "", h.date, h.kind, h.tier || "", h.kind === "drill" ? h.cells.join(" ") : h.cell, h.right, h.attempted != null ? h.attempted : h.total, h.planned || "", h.seconds || "", h.finished == null ? "" : h.finished, (h.misses || h.wrongs || []).map((m) => (typeof m === "string" ? m : m.q)).join(" | ")].map(c).join(",") + "\n";
    });
    return s;
  }
  function note(msg) { $("copyNote").textContent = msg; }
  $("copyTsvBtn").addEventListener("click", () => navigator.clipboard.writeText(tsvRow()).then(() => note("Row copied — paste into the class sheet.")).catch(() => note("Copy failed — try the CSV.")));
  $("copyTextBtn").addEventListener("click", () => navigator.clipboard.writeText(teacherText()).then(() => note("Teacher text copied.")).catch(() => note("Copy failed.")));
  $("downloadCsvBtn").addEventListener("click", () => {
    const csv = csvText();
    try {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" }), url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = `fractions-hub-${(store.name || "student").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${today()}.csv`;
      document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
      note("CSV downloaded.");
    } catch (e) { navigator.clipboard.writeText(csv).then(() => note("Download blocked — CSV copied instead.")); }
  });
  $("printBtn").addEventListener("click", () => window.print());
  $("resetBtn").addEventListener("click", () => {
    if (confirm("Reset all saved fractions progress on this device? This cannot be undone.")) { store = { v: 1, name: store.name, records: {}, history: [], teach: {}, lastServed: {} }; save(); renderReport(); buildMatrix(); }
  });

  // test/debug hook: read-only access to the live sessions
  FH.debug = { teach: () => teach, drill: () => drill, store: () => store };

  /* ---------------- boot ---------------- */
  applyDeepLink();
  buildModeToggle();
  buildTierChips();
  buildMatrix();
  updateToolbar();
  show("grid");
  $("buildTag").textContent = "build " + BUILD;
  if ("serviceWorker" in navigator) window.addEventListener("load", () => { navigator.serviceWorker.register("../sw.js").catch(() => {}); });
})();
