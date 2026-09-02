/* ============================================================
   FRACTIONS HUB — INTERACTIVES (the "We do" builders)
   ------------------------------------------------------------
   Stateful widgets the teach flow drives. Each judges nothing on
   its own: it exposes state, and the teach scripts in engine.js
   decide what to say. The one rule enforced here is the physical
   one: a piece only drops into a cake whose pieces are the same
   size, and a refused drop reports why (the builder never blocks
   silently).

     FH.CakeBuilder(host, opts)   cakes you cut, shade, eat, and drag
     FH.GridBuilder(host, opts)   the area model for multiplying
     FH.JumpLine(host, opts)      jumps along a number line (dividing)
     FH.BarBuilder(host, opts)    one bar you group or re-cut (convert)
   ============================================================ */
(function () {
  const FH = (window.FH = window.FH || {});
  const M = FH.M;
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

  /* ---- pointer drag with a ghost element ---- */
  function startDrag(e, ghostHtml, onDrop) {
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.innerHTML = ghostHtml;
    document.body.appendChild(ghost);
    const move = (ev) => { ghost.style.left = ev.clientX + "px"; ghost.style.top = ev.clientY + "px"; };
    move(e);
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      ghost.remove();
      onDrop(ev.clientX, ev.clientY);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }
  function elementAt(x, y, sel) {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest(sel) : null;
  }

  /* ================= CakeBuilder =================
     groups: [{ id, label, cls, cakes:[{cuts, state:[cls|""|"x"], given}], hideEmpty }]
     controls: { cut, shade, eat, dragFrom:[ids], dragTo:[ids] }
     A "pile" group is just a group of one-slice cakes with hideEmpty. */
  FH.CakeBuilder = function (host, opts) {
    const groups = opts.groups.map((g) => Object.assign({ cakes: [] }, g));
    // cutWholes: whether given whole cakes may be cut (needed to regroup when
    // subtracting, or to count a mixed number as pieces; not when adding).
    let controls = Object.assign({ cut: true, shade: true, eat: false, cutWholes: false, dragFrom: [], dragTo: [] }, opts.controls || {});
    let selected = null; // {gid, ci, i} piece picked by tap (keyboard/touch alternative to drag)
    const api = {};

    const G = (id) => groups.find((g) => g.id === id);
    api.group = G;
    api.addCake = (gid, cake) => { G(gid).cakes.push(Object.assign({ cuts: 1, state: [""], given: false }, cake)); render(); };
    api.setControls = (c) => { controls = Object.assign(controls, c); selected = null; render(); };
    api.setNote = (gid, note) => { G(gid).note = note; render(); };

    // value of a group = shaded (not eaten) pieces as a fraction of the group's common cut
    api.value = (gid) => {
      const g = G(gid);
      let n = 0, d = 1;
      g.cakes.forEach((c) => {
        const k = c.state.filter((s) => s && s !== "x").length;
        if (!k) return;
        const L = FH.F.lcm(d, c.cuts);
        n = n * (L / d) + k * (L / c.cuts); d = L;
      });
      return FH.F.red(n, d);
    };
    api.eaten = (gid) => {
      let n = 0, d = 1;
      G(gid).cakes.forEach((c) => { const k = c.state.filter((s) => s === "x").length; if (!k) return; const L = FH.F.lcm(d, c.cuts); n = n * (L / d) + k * (L / c.cuts); d = L; });
      return FH.F.red(n, d);
    };
    // the common cut of a group's cut cakes (whole cakes are wholes whatever
    // the cut); null when the cut cakes disagree, 1 when nothing is cut yet
    api.cutsOf = (gid) => { const cs = new Set(G(gid).cakes.filter((c) => c.cuts > 1).map((c) => c.cuts)); return cs.size === 1 ? [...cs][0] : (cs.size === 0 ? 1 : null); };
    api.fullCakes = (gid) => G(gid).cakes.filter((c) => c.state.every((s) => s && s !== "x")).length;
    api.pieceCount = (gid) => { let n = 0; G(gid).cakes.forEach((c) => { n += c.state.filter((s) => s && s !== "x").length; }); return n; };
    api.shadedList = (gid) => G(gid).cakes.map((c) => ({ cuts: c.cuts, shaded: c.state.filter((s) => s && s !== "x").length, eaten: c.state.filter((s) => s === "x").length }));

    // "Cut into n": the empty cake being built. "Cut each piece in k": the
    // cakes already cut. "Cut a whole cake into n": one given whole, only
    // when the step allows it (regrouping, counting a mixed number).
    function cutInto(cake, n) {
      if (cake.cuts !== 1 || cake.state[0]) return;
      cake.cuts = n; cake.state = Array(n).fill("");
    }
    function cutEach(cake, k) {
      if (cake.cuts === 1) return; // wholes are cut with the whole-cake button
      const st = [];
      cake.state.forEach((s) => { for (let j = 0; j < k; j++) st.push(s); });
      cake.cuts *= k; cake.state = st;
    }
    function cutWhole(cake, n) {
      cake.cuts = n; cake.state = Array(n).fill(cake.state[0]);
    }
    const isWhole = (c) => c.cuts === 1 && !!c.state[0] && c.state[0] !== "x";
    api.cutInto = (gid, n) => { G(gid).cakes.forEach((c) => cutInto(c, n)); render(); };
    api.cutEach = (gid, k) => { G(gid).cakes.forEach((c) => cutEach(c, k)); render(); };
    api.cutWhole = (gid, n) => { const c = G(gid).cakes.find(isWhole); if (c) cutWhole(c, n); render(); };
    api.reset = (gid, cakes) => { G(gid).cakes = cakes.map((c) => Object.assign({ cuts: 1, state: [""], given: false }, c)); render(); };

    function movePiece(from, to) {
      // from: {gid, ci, i}; to: gid. Returns {ok, why}
      const sg = G(from.gid), cake = sg.cakes[from.ci], cls = cake.state[from.i];
      const tg = G(to);
      if (cake.cuts === 1) { // a whole cake moves as a unit
        sg.cakes.splice(from.ci, 1);
        tg.cakes.push(cake);
        return { ok: true, whole: true };
      }
      const targetCuts = api.cutsOf(to);
      if (targetCuts !== null && targetCuts !== 1 && targetCuts !== cake.cuts) {
        return { ok: false, why: `A ${FH.words(cake.cuts).replace(/s$/, "")} piece does not fit a cake cut into ${FH.words(targetCuts)} — the pieces are different sizes. Cut so both cakes have the same size pieces first.` };
      }
      let dest = tg.cakes.find((c) => c.cuts === cake.cuts && c.state.some((s) => s === ""));
      if (!dest) { dest = { cuts: cake.cuts, state: Array(cake.cuts).fill(""), given: false }; tg.cakes.push(dest); }
      dest.state[dest.state.indexOf("")] = cls;
      cake.state[from.i] = "";
      return { ok: true };
    }

    function render() {
      host.innerHTML = groups.map((g) => {
        const cakes = g.cakes.map((c, ci) => {
          const empty = c.state.every((s) => !s);
          if (g.hideEmpty && empty) return "";
          const draggable = controls.dragFrom.includes(g.id) ? "draggable" : "";
          return `<div class="cake-wrap ${draggable}" data-ci="${ci}">${M.cake({ d: c.cuts, fills: c.state.map((s) => (s === "x" ? "fx" : s)), size: g.size || (g.hideEmpty ? 48 : 112) })}</div>`;
        }).join("");
        const dropTarget = controls.dragTo.includes(g.id) ? " drop-target" : "";
        let cutBtns = "";
        if (controls.cut && !g.fixed) {
          const hasEmpty = g.cakes.some((c) => c.cuts === 1 && !c.state[0]);
          const hasCut = g.cakes.some((c) => c.cuts > 1);
          const hasWhole = g.cakes.some(isWhole);
          const common = api.cutsOf(g.id);
          let rows = "";
          if (hasEmpty) rows += `<div class="cb-controls"><span class="cb-lab">Cut into</span>${[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => `<button type="button" class="mini" data-act="into" data-n="${n}">${n}</button>`).join("")}</div>`;
          if (hasCut) rows += `<div class="cb-controls"><span class="cb-lab">Cut each piece in</span>${[2, 3, 4, 5, 6, 7].map((n) => `<button type="button" class="mini" data-act="each" data-n="${n}">${n}</button>`).join("")}</div>`;
          if (controls.cutWholes && hasWhole) {
            rows += common && common > 1
              ? `<div class="cb-controls"><span class="cb-lab">Cut a whole cake into</span><button type="button" class="mini" data-act="whole" data-n="${common}">${common}</button></div>`
              : `<div class="cb-controls"><span class="cb-lab">Cut a whole cake into</span>${[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => `<button type="button" class="mini" data-act="whole" data-n="${n}">${n}</button>`).join("")}</div>`;
          }
          cutBtns = rows;
        }
        const v = api.value(g.id);
        const readout = g.readout === false ? "" : `<div class="cb-readout">${g.readoutLabel || "Shaded:"} ${v.n === 0 ? "0" : FH.show(v, "mixed")}${api.eaten(g.id).n ? ` · eaten: ${FH.show(api.eaten(g.id), "mixed")}` : ""}</div>`;
        return `<div class="cake-group${dropTarget}" data-gid="${g.id}">
          <div class="cb-head"><span class="cb-label"><i class="sw ${g.cls}"></i>${esc(g.label)}</span>${g.note ? `<span class="cb-note">${g.note}</span>` : ""}</div>
          <div class="cake-row cb-cakes">${cakes || `<span class="cb-empty">empty</span>`}</div>
          ${readout}${cutBtns}
        </div>`;
      }).join("");
      if (selected) {
        const el = host.querySelector(`.cake-group[data-gid="${selected.gid}"] .cake-wrap[data-ci="${selected.ci}"] .slice[data-i="${selected.i}"]`);
        if (el) el.classList.add("picked");
      }
      if (opts.onChange) opts.onChange(api);
    }

    host.addEventListener("click", (e) => {
      const btn = e.target.closest("button.mini");
      if (btn) {
        const gid = btn.closest(".cake-group").dataset.gid, n = +btn.dataset.n;
        if (btn.dataset.act === "into") api.cutInto(gid, n);
        else if (btn.dataset.act === "whole") api.cutWhole(gid, n);
        else api.cutEach(gid, n);
        return;
      }
      const slice = e.target.closest(".slice");
      if (slice) {
        const wrap = slice.closest(".cake-wrap"), gid = wrap.closest(".cake-group").dataset.gid;
        const ci = +wrap.dataset.ci, i = +slice.dataset.i, cake = G(gid).cakes[ci];
        // tap-to-move: pick a piece, then tap a target group
        if (controls.dragFrom.includes(gid) && cake.state[i] && cake.state[i] !== "x") {
          selected = selected && selected.gid === gid && selected.ci === ci && selected.i === i ? null : { gid, ci, i };
          render(); return;
        }
        if (controls.eat) {
          if (cake.state[i] && cake.state[i] !== "x") cake.state[i] = "x";
          else if (cake.state[i] === "x") cake.state[i] = G(gid).cls; // un-eat
          render(); return;
        }
        if (controls.shade) {
          if (cake.given && cake.state[i]) return; // given wholes stay given
          cake.state[i] = cake.state[i] ? "" : G(gid).cls;
          render(); return;
        }
      }
      const grp = e.target.closest(".cake-group");
      if (grp && selected && controls.dragTo.includes(grp.dataset.gid) && grp.dataset.gid !== selected.gid) {
        const r = movePiece(selected, grp.dataset.gid);
        selected = null; render();
        if (opts.onDrop) opts.onDrop(r);
      }
    });

    host.addEventListener("pointerdown", (e) => {
      const slice = e.target.closest(".slice");
      if (!slice) return;
      const wrap = slice.closest(".cake-wrap"), gid = wrap.closest(".cake-group").dataset.gid;
      if (!controls.dragFrom.includes(gid)) return;
      const ci = +wrap.dataset.ci, i = +slice.dataset.i, cake = G(gid).cakes[ci];
      if (!cake.state[i] || cake.state[i] === "x") return;
      e.preventDefault();
      const from = { gid, ci, i };
      const ghost = cake.cuts === 1 ? M.cake({ d: 1, fills: [cake.state[0]], size: 64 }) : M.cake({ d: cake.cuts, fills: cake.state.map((s, j) => (j === i ? s : "")), size: 64 });
      let moved = false;
      const onMove = () => { moved = true; };
      window.addEventListener("pointermove", onMove, { once: true });
      startDrag(e, ghost, (x, y) => {
        window.removeEventListener("pointermove", onMove);
        if (!moved) return; // it was a tap — the click handler deals with it
        const grp = elementAt(x, y, ".cake-group");
        if (!grp || grp.dataset.gid === gid || !controls.dragTo.includes(grp.dataset.gid)) return;
        const r = movePiece(from, grp.dataset.gid);
        selected = null; render();
        if (opts.onDrop) opts.onDrop(r);
      });
    });

    render();
    return api;
  };

  /* ================= GridBuilder (area model) ================= */
  FH.GridBuilder = function (host, opts) {
    const st = { cols: 1, rows: 1, unitsW: opts.unitsW || 1, unitsH: opts.unitsH || 1, colOn: [], rowOn: [] };
    const api = {};
    api.state = st;
    api.set = (o) => { Object.assign(st, o); fit(); render(); };
    function fit() { st.colOn = Array.from({ length: st.unitsW * st.cols }, (_, i) => !!st.colOn[i]); st.rowOn = Array.from({ length: st.unitsH * st.rows }, (_, i) => !!st.rowOn[i]); }
    api.overlap = () => { let n = 0; st.rowOn.forEach((r) => { if (r) st.colOn.forEach((c) => { if (c) n++; }); }); return n; };
    api.colsShaded = () => st.colOn.filter(Boolean).length;
    api.rowsShaded = () => st.rowOn.filter(Boolean).length;
    function render() {
      host.innerHTML = `<div class="gb">
        <div class="gb-controls">
          <span class="cb-lab"><i class="sw fa"></i>Vertical cuts per whole</span>
          <button type="button" class="mini" data-act="cols" data-d="-1">−</button><b class="gb-n">${st.cols}</b><button type="button" class="mini" data-act="cols" data-d="1">+</button>
          <span class="cb-lab"><i class="sw fb"></i>Horizontal cuts per whole</span>
          <button type="button" class="mini" data-act="rows" data-d="-1">−</button><b class="gb-n">${st.rows}</b><button type="button" class="mini" data-act="rows" data-d="1">+</button>
        </div>
        <div class="gb-hint">Tap the tabs above a column to shade it (first amount), the tabs beside a row to shade it (second amount).</div>
        ${M.grid({ cols: st.cols, rows: st.rows, unitsW: st.unitsW, unitsH: st.unitsH, colOn: st.colOn, rowOn: st.rowOn, headers: true, unit: opts.unit || 110 })}
        <div class="cb-readout">Columns shaded: ${api.colsShaded()} of ${st.unitsW * st.cols} · rows shaded: ${api.rowsShaded()} of ${st.unitsH * st.rows} · pieces in one whole: ${st.cols * st.rows}</div>
      </div>`;
      if (opts.onChange) opts.onChange(api);
    }
    host.addEventListener("click", (e) => {
      const b = e.target.closest("button.mini");
      if (b) {
        const k = b.dataset.act, d = +b.dataset.d;
        st[k] = Math.max(1, Math.min(12, st[k] + d));
        fit(); render(); return;
      }
      const tc = e.target.closest(".tab-c"); if (tc) { st.colOn[+tc.dataset.c] = !st.colOn[+tc.dataset.c]; render(); return; }
      const tr = e.target.closest(".tab-r"); if (tr) { st.rowOn[+tr.dataset.r] = !st.rowOn[+tr.dataset.r]; render(); }
    });
    fit(); render();
    return api;
  };

  /* ================= JumpLine (measurement division) ================= */
  FH.JumpLine = function (host, opts) {
    const A = opts.A, B = opts.B; // {n,d} improper
    const d = FH.F.lcm(A.d, B.d);
    const max = Math.max(1, Math.ceil(A.n / A.d));
    let jumps = 0;
    const api = {};
    const bv = B.n / B.d, av = A.n / A.d;
    api.jumps = () => jumps;
    api.reached = () => Math.min(av, jumps * bv);
    api.fullFit = () => Math.floor(av / bv + 1e-9);
    function render() {
      const js = [];
      for (let i = 0; i < jumps; i++) {
        const from = i * bv, to = Math.min((i + 1) * bv, av);
        js.push({ from, to, cls: "fb", partial: (i + 1) * bv > av + 1e-9, label: (i + 1) * bv > av + 1e-9 ? "part of a jump" : `${i + 1}` });
      }
      const over = jumps * bv > av + 1e-9;
      const remaining = FH.F.red(Math.round((av - Math.min(av, (jumps) * bv)) * d), d);
      host.innerHTML = `<div class="jl">
        ${M.line({ max, d: Math.min(d, 24), bar: { to: av, cls: "fa" }, jumps: js, marks: [{ v: av, cls: "fa", label: FH.plain(A, "mixed") }] })}
        <div class="gb-controls">
          <button type="button" class="mini big" data-act="jump">Jump ${FH.plain(B)} →</button>
          <button type="button" class="mini" data-act="undo">Undo</button>
          <span class="cb-readout">Jumps so far: <b>${jumps}</b>${over ? ` · the last jump only fits ${FH.plain(FH.F.red(Math.round((av - (jumps - 1) * bv) * d * B.d), d * B.n))} of a jump` : (remaining.n ? ` · still to cover: ${FH.plain(remaining)}` : (jumps ? " · exactly covered" : ""))}</span>
        </div>
      </div>`;
      if (opts.onChange) opts.onChange(api);
    }
    host.addEventListener("click", (e) => {
      const b = e.target.closest("button.mini"); if (!b) return;
      if (b.dataset.act === "jump") { if (jumps * bv < av - 1e-9 && jumps < 40) jumps++; }
      else jumps = Math.max(0, jumps - 1);
      render();
    });
    render();
    return api;
  };

  /* ================= BarBuilder (group / re-cut one bar) ================= */
  FH.BarBuilder = function (host, opts) {
    const st = { n: opts.n, d: opts.d, cls: opts.cls || "fa", history: [] };
    const api = {};
    api.state = st;
    api.group = (k) => {
      if (st.d % k !== 0) return { ok: false, why: `You cannot group ${FH.words(st.d)} in ${k}s — ${st.d} is not a multiple of ${k}, so the groups would not be equal.` };
      if (st.n % k !== 0) return { ok: false, why: `Grouping in ${k}s would split the shaded part: ${st.n} shaded pieces do not make whole groups of ${k}. Try a number that divides both ${st.n} and ${st.d}.` };
      st.history.push({ n: st.n, d: st.d }); st.n /= k; st.d /= k; render(); return { ok: true };
    };
    api.cut = (k) => { st.history.push({ n: st.n, d: st.d }); st.n *= k; st.d *= k; render(); return { ok: true }; };
    api.undo = () => { const h = st.history.pop(); if (h) { st.n = h.n; st.d = h.d; render(); } };
    function render() {
      host.innerHTML = `<div class="bb">
        ${M.bar({ d: st.d, fills: Array.from({ length: st.d }, (_, i) => (i < st.n ? st.cls : "")), w: 420, h: 52 })}
        <div class="cb-readout">${st.n} of ${st.d} pieces shaded = ${FH.plain({ n: st.n, d: st.d })}</div>
        <div class="gb-controls">
          ${opts.allowGroup ? `<span class="cb-lab">Group pieces in</span>${[2, 3, 4, 5, 6].map((k) => `<button type="button" class="mini" data-act="group" data-k="${k}">${k}s</button>`).join("")}` : ""}
          ${opts.allowCut ? `<span class="cb-lab">Cut each piece in</span>${[2, 3, 4, 5, 6].map((k) => `<button type="button" class="mini" data-act="cut" data-k="${k}">${k}</button>`).join("")}` : ""}
          <button type="button" class="mini" data-act="undo">Undo</button>
        </div>
        <div class="cb-msg" id="bbMsg" aria-live="polite"></div>
      </div>`;
      if (opts.onChange) opts.onChange(api);
    }
    host.addEventListener("click", (e) => {
      const b = e.target.closest("button.mini"); if (!b) return;
      const k = +b.dataset.k;
      let r = { ok: true };
      if (b.dataset.act === "group") r = api.group(k);
      else if (b.dataset.act === "cut") r = api.cut(k);
      else api.undo();
      if (!r.ok) { const m = host.querySelector("#bbMsg"); if (m) m.textContent = "✗ " + r.why; }
    });
    render();
    return api;
  };
})();
