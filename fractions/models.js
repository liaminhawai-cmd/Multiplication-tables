/* ============================================================
   FRACTIONS HUB — MODELS (representations)
   ------------------------------------------------------------
   Pure functions returning SVG/HTML strings. Nothing here reads or
   writes state; the engine and the interactives call these to draw.

   Colour is a taxonomy (see the legend in index.html):
     .fa  first amount      .fb  second amount
     .fr-fill  the answer   .fx  taken away (eaten)
     .ab  where the two amounts overlap (multiplication)
   Correctness is never carried by these colours.
   ============================================================ */
(function () {
  const FH = (window.FH = window.FH || {});
  const M = {};

  const polar = (cx, cy, r, deg) => { const a = ((deg - 90) * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  function slicePath(cx, cy, r, a0, a1) {
    const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1);
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`;
  }

  /* A cake cut into d slices. fills[i] is the class for slice i ("" = empty).
     sub = draw thin lines splitting every slice into `sub` (for "re-cut"). */
  M.cake = function ({ d, fills, sub, size, attrs }) {
    size = size || 120; fills = fills || [];
    const cx = size / 2, cy = size / 2, r = size / 2 - 3;
    let s = `<svg class="cake" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" ${attrs || ""} role="img">`;
    if (d === 1) {
      s += `<circle class="slice ${fills[0] || ""}" data-i="0" cx="${cx}" cy="${cy}" r="${r}"/>`;
    } else {
      const step = 360 / d;
      for (let i = 0; i < d; i++) s += `<path class="slice ${fills[i] || ""}" data-i="${i}" d="${slicePath(cx, cy, r, i * step, (i + 1) * step)}"/>`;
      if (sub > 1) for (let i = 0; i < d; i++) for (let j = 1; j < sub; j++) {
        const [x, y] = polar(cx, cy, r, i * step + (j * step) / sub);
        s += `<line class="subline" x1="${cx}" y1="${cy}" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}"/>`;
      }
    }
    return s + `</svg>`;
  };

  /* A row of cakes for any value: full cakes then a partial. */
  M.cakesFor = function (f, cls, opts) {
    opts = opts || {};
    const size = opts.size || 96;
    const whole = Math.floor(f.n / f.d), rem = f.n - whole * f.d;
    let s = `<div class="cake-row">`;
    for (let i = 0; i < whole; i++) s += M.cake({ d: opts.showCuts ? f.d : 1, fills: Array(opts.showCuts ? f.d : 1).fill(cls), sub: opts.sub, size });
    if (rem > 0 || (whole === 0)) s += M.cake({ d: f.d, fills: Array.from({ length: f.d }, (_, i) => (i < rem ? cls : "")), sub: opts.sub, size });
    return s + `</div>`;
  };

  /* n loose single pieces, each one d-th. */
  M.pieces = function (n, d, cls, size) {
    size = size || 46;
    let s = `<div class="cake-row pieces">`;
    for (let i = 0; i < n; i++) s += M.cake({ d, fills: [cls], size });
    return s + `</div>`;
  };

  /* A bar cut into d pieces. */
  M.bar = function ({ d, fills, sub, w, h, attrs }) {
    w = w || 260; h = h || 44; fills = fills || [];
    const pw = w / d;
    let s = `<svg class="bar" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" ${attrs || ""} role="img">`;
    for (let i = 0; i < d; i++) s += `<rect class="slice ${fills[i] || ""}" data-i="${i}" x="${(i * pw).toFixed(2)}" y="1" width="${pw.toFixed(2)}" height="${h - 2}"/>`;
    if (sub > 1) for (let i = 0; i < d; i++) for (let j = 1; j < sub; j++) { const x = (i * pw + (j * pw) / sub).toFixed(2); s += `<line class="subline" x1="${x}" y1="1" x2="${x}" y2="${h - 1}"/>`; }
    return s + `</svg>`;
  };
  M.barsFor = function (f, cls, opts) {
    opts = opts || {};
    const whole = Math.floor(f.n / f.d), rem = f.n - whole * f.d;
    let s = `<div class="bar-row">`;
    for (let i = 0; i < whole; i++) s += M.bar({ d: f.d, fills: Array(f.d).fill(cls), sub: opts.sub, w: opts.w || 200 });
    if (rem > 0 || whole === 0) s += M.bar({ d: f.d, fills: Array.from({ length: f.d }, (_, i) => (i < rem ? cls : "")), sub: opts.sub, w: opts.w || 200 });
    return s + `</div>`;
  };

  /* Area model: unitsW × unitsH whole squares, each cut into cols × rows.
     colOn[c] / rowOn[r] index across the whole width / height. */
  M.grid = function ({ cols, rows, unitsW, unitsH, colOn, rowOn, unit, headers }) {
    unit = unit || 120; unitsW = unitsW || 1; unitsH = unitsH || 1; colOn = colOn || []; rowOn = rowOn || [];
    const totalC = unitsW * cols, totalR = unitsH * rows;
    const cw = unit / cols, rh = unit / rows;
    const pad = headers ? 22 : 2;
    const W = unitsW * unit + pad + 2, H = unitsH * unit + pad + 2;
    let s = `<svg class="grid" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">`;
    for (let r = 0; r < totalR; r++) for (let c = 0; c < totalC; c++) {
      const cls = colOn[c] && rowOn[r] ? "ab" : colOn[c] ? "fa" : rowOn[r] ? "fb" : "";
      s += `<rect class="cell ${cls}" x="${(pad + c * cw).toFixed(2)}" y="${(pad + r * rh).toFixed(2)}" width="${cw.toFixed(2)}" height="${rh.toFixed(2)}"/>`;
    }
    for (let u = 0; u <= unitsW; u++) s += `<line class="unitline" x1="${pad + u * unit}" y1="${pad}" x2="${pad + u * unit}" y2="${pad + unitsH * unit}"/>`;
    for (let u = 0; u <= unitsH; u++) s += `<line class="unitline" x1="${pad}" y1="${pad + u * unit}" x2="${pad + unitsW * unit}" y2="${pad + u * unit}"/>`;
    if (headers) {
      for (let c = 0; c < totalC; c++) s += `<rect class="tab tab-c ${colOn[c] ? "on" : ""}" data-c="${c}" x="${(pad + c * cw + 1).toFixed(2)}" y="2" width="${(cw - 2).toFixed(2)}" height="16" rx="3"/>`;
      for (let r = 0; r < totalR; r++) s += `<rect class="tab tab-r ${rowOn[r] ? "on" : ""}" data-r="${r}" x="2" y="${(pad + r * rh + 1).toFixed(2)}" width="16" height="${(rh - 2).toFixed(2)}" rx="3"/>`;
    }
    return s + `</svg>`;
  };

  /* Number line from 0 to max with ticks every 1/d.
     marks: [{v, cls, label}]  jumps: [{from, to, cls, partial}]  bar: {to, cls} */
  M.line = function ({ max, d, marks, jumps, bar, w }) {
    w = w || 560; const h = 96, y = 58, x0 = 24, x1 = w - 24;
    const X = (v) => x0 + ((x1 - x0) * v) / max;
    let s = `<svg class="numline" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">`;
    if (bar) s += `<rect class="linebar ${bar.cls}" x="${X(0)}" y="${y - 10}" width="${(X(bar.to) - X(0)).toFixed(2)}" height="20"/>`;
    s += `<line class="axis" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>`;
    for (let i = 0; i <= max * d; i++) {
      const v = i / d, big = i % d === 0;
      s += `<line class="tick ${big ? "big" : ""}" x1="${X(v).toFixed(2)}" y1="${y - (big ? 12 : 6)}" x2="${X(v).toFixed(2)}" y2="${y + (big ? 12 : 6)}"/>`;
      if (big) s += `<text class="ticklabel" x="${X(v).toFixed(2)}" y="${y + 28}" text-anchor="middle">${v}</text>`;
    }
    (jumps || []).forEach((j) => {
      const a = X(j.from), b = X(j.to), mid = (a + b) / 2, lift = Math.min(34, 10 + Math.abs(b - a) / 3);
      s += `<path class="jump ${j.cls || ""} ${j.partial ? "partial" : ""}" d="M${a.toFixed(2)},${y - 10} Q${mid.toFixed(2)},${(y - 10 - lift).toFixed(2)} ${b.toFixed(2)},${y - 10}"/>`;
      if (j.label) s += `<text class="jumplabel" x="${mid.toFixed(2)}" y="${(y - 14 - lift / 2).toFixed(2)}" text-anchor="middle">${j.label}</text>`;
    });
    (marks || []).forEach((m) => {
      s += `<circle class="mark ${m.cls || ""}" cx="${X(m.v).toFixed(2)}" cy="${y}" r="7"/>`;
      if (m.label) s += `<text class="marklabel" x="${X(m.v).toFixed(2)}" y="${y - 20}" text-anchor="middle">${m.label}</text>`;
    });
    return s + `</svg>`;
  };

  M.legend = function (keys) {
    const all = { fa: "first amount", fb: "second amount", "fr-fill": "answer", fx: "taken away", ab: "overlap (the product)" };
    return `<div class="legend">` + (keys || Object.keys(all)).map((k) => `<span class="lg"><i class="sw ${k}"></i>${all[k]}</span>`).join("") + `</div>`;
  };

  FH.M = M;
})();
