(() => {
  "use strict";

  // ---------- Level definitions (mirrors the original workbook's sheets) ----------
  // Every level is a full multiplication grid over `axis` — exactly like the
  // spreadsheets, which always show the whole table. `target(r, c)` marks the
  // highlighted cells that are actually the task; those show the question
  // ("6 × 6") faintly and are typed over. Big Picture mode trims away rows and
  // columns that contain no target cells.
  const DECIMAL_AXIS = [0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2];
  const between = (v, lo, hi) => v >= lo - 1e-9 && v <= hi + 1e-9;

  // ---------- Fraction axes ----------
  // Every multiple of 1/d up to `cap`, reduced to lowest terms and deduped
  // across denominators (so 2/2 and 1 collapse to the same point). Sorted by
  // value — the resulting axis is only evenly spaced for a single
  // denominator; combining denominators is exactly what makes the gaps
  // "wonky", which the proportional grid layout then shows visually.
  function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
  function buildFractionAxis(denominators, cap) {
    const points = new Map(); // value -> { label, n, d }
    denominators.forEach((d) => {
      for (let k = 1; k <= cap * d; k++) {
        const g = gcd(k, d);
        const n = k / g, rd = d / g;
        const value = n / rd;
        if (!points.has(value)) points.set(value, { label: rd === 1 ? String(n) : `${n}/${rd}`, n, d: rd });
      }
    });
    const axis = Array.from(points.keys()).sort((a, b) => a - b);
    const labels = new Map();
    const parts = new Map();
    points.forEach((v, k) => { labels.set(k, v.label); parts.set(k, { n: v.n, d: v.d }); });
    return { axis, labels, parts };
  }

  const FRACTIONS_HALVES = buildFractionAxis([2], 3);
  const FRACTIONS_THIRDS = buildFractionAxis([3], 2);
  const FRACTIONS_HALVES_THIRDS = buildFractionAxis([2, 3], 2);
  const FRACTIONS_FOURTHS = buildFractionAxis([4], 2);
  const FRACTIONS_FIFTHS = buildFractionAxis([5], 2);

  // Level select groups levels by `category`:
  //  "core"       — Times Tables section
  //  "playground" — the untimed reference chart, shown as its own banner
  //  "extension"  — squares, decimals, fractions, decimal weak-spots
  const LEVELS = [
    { id: "A", name: "1–5 × 1–5", desc: "Small numbers warm-up", domain: "int", category: "core",
      axis: range(1, 12), target: (r, c) => r <= 5 && c <= 5 },
    { id: "B", name: "Evens", desc: "Even times tables", domain: "int", category: "core",
      axis: range(1, 12), target: (r, c) => r % 2 === 0 && c % 2 === 0 },
    { id: "C", name: "6–9 × 3–5", desc: "Mid-range mix", domain: "int", category: "core",
      axis: range(1, 12), target: (r, c) => between(r, 6, 9) && between(c, 3, 5) },
    { id: "D", name: "7s and 9s", desc: "Focus on the 7 and 9 tables", domain: "int", category: "core",
      axis: range(1, 12), target: (r, c) => r === 7 || r === 9 || c === 7 || c === 9 },
    { id: "E", name: "6–10 × 6–10", desc: "Higher numbers", domain: "int", category: "core",
      axis: range(1, 12), target: (r, c) => between(r, 6, 10) && between(c, 6, 10) },
    { id: "F", name: "Odd × Odd", desc: "Odd numbers only", domain: "int", category: "core",
      axis: range(1, 12), target: (r, c) => r % 2 !== 0 && c % 2 !== 0 },
    { id: "TEN", name: "10s", desc: "Focus on the 10 times table", domain: "int", category: "core",
      axis: range(1, 12), target: (r, c) => r === 10 || c === 10 },
    { id: "PZ_INT", name: "My Weak Spots", desc: "Personalized — your most-missed times tables",
      domain: "int", category: "core", dynamic: true, axis: [], target: () => false },
    { id: "FULL", name: "Full 12×12 Chart", desc: "Every cell is a question — answer it and find out right away, no timer",
      category: "playground", immediateFeedback: true, untimed: true, domain: "int",
      axis: range(1, 12), target: () => true },
    { id: "G", name: "Squares to 15", desc: "n × n up to 15", domain: "int", category: "extension",
      axis: range(1, 15), target: (r, c) => r === c },
    { id: "H", name: "Squares to 25", desc: "Extension: n × n from 11 to 25", domain: "int", category: "extension",
      axis: range(11, 25), target: (r, c) => r === c },
    { id: "I", name: "Squares to 30", desc: "Extension: n × n from 16 to 30", domain: "int", category: "extension",
      axis: range(16, 30), target: (r, c) => r === c },
    { id: "J", name: "Decimals (all)", desc: "Every decimal pair 0.2–2", domain: "decimal", category: "extension",
      axis: DECIMAL_AXIS, target: () => true },
    { id: "K", name: "Decimals 0.2–1", desc: "Smaller decimal pairs", domain: "decimal", category: "extension",
      axis: DECIMAL_AXIS, target: (r, c) => between(r, 0.2, 1) && between(c, 0.2, 1) },
    { id: "L", name: "Decimals 0.6–1.4", desc: "Middle decimal pairs", domain: "decimal", category: "extension",
      axis: DECIMAL_AXIS, target: (r, c) => between(r, 0.6, 1.4) && between(c, 0.6, 1.4) },
    { id: "PZ_DEC", name: "My Weak Spots (Decimals)", desc: "Personalized — your most-missed decimal facts",
      domain: "decimal", category: "extension", dynamic: true, axis: DECIMAL_AXIS, target: () => false },
    { id: "FR_HALVES", name: "Halves to 3", desc: "Fractions: ½ steps up to 3", domain: "fraction", category: "extension",
      proportional: true, axis: FRACTIONS_HALVES.axis, fractionLabels: FRACTIONS_HALVES.labels, fractionParts: FRACTIONS_HALVES.parts, target: () => true },
    { id: "FR_THIRDS", name: "Thirds to 2", desc: "Fractions: ⅓ steps up to 2", domain: "fraction", category: "extension",
      proportional: true, prereq: "FR_HALVES", axis: FRACTIONS_THIRDS.axis, fractionLabels: FRACTIONS_THIRDS.labels, fractionParts: FRACTIONS_THIRDS.parts, target: () => true },
    { id: "FR_HALVES_THIRDS", name: "Halves & Thirds to 2", desc: "Fractions: ½s and ⅓s combined", domain: "fraction", category: "extension",
      proportional: true, prereq: "FR_THIRDS", axis: FRACTIONS_HALVES_THIRDS.axis, fractionLabels: FRACTIONS_HALVES_THIRDS.labels, fractionParts: FRACTIONS_HALVES_THIRDS.parts, target: () => true },
    { id: "FR_FOURTHS", name: "Fourths to 2", desc: "Fractions: ¼ steps up to 2", domain: "fraction", category: "extension",
      proportional: true, prereq: "FR_HALVES_THIRDS", axis: FRACTIONS_FOURTHS.axis, fractionLabels: FRACTIONS_FOURTHS.labels, fractionParts: FRACTIONS_FOURTHS.parts, target: () => true },
    { id: "FR_FIFTHS", name: "Fifths to 2", desc: "Fractions: ⅕ steps up to 2", domain: "fraction", category: "extension",
      proportional: true, prereq: "FR_FOURTHS", axis: FRACTIONS_FIFTHS.axis, fractionLabels: FRACTIONS_FIFTHS.labels, fractionParts: FRACTIONS_FIFTHS.parts, target: () => true },
  ];

  const TIMER_MODES = [
    { id: "120", label: "2:00", seconds: 120 },
    { id: "60", label: "1:00", seconds: 60 },
    { id: "30", label: "0:30", seconds: 30 },
    { id: "20", label: "0:20", seconds: 20 },
  ];

  // Untimed levels get a single "Practice" slot instead of the timer tiers.
  const FREE_MODE = { id: "free", label: "Practice", seconds: null };

  function modesFor(level) { return level.untimed ? [FREE_MODE] : TIMER_MODES; }
  const ALL_MODE_IDS = new Set([...TIMER_MODES.map((m) => m.id), FREE_MODE.id]);

  function range(a, b) {
    const out = [];
    for (let i = a; i <= b; i++) out.push(i);
    return out;
  }
  function round2(n) { return Math.round(n * 100) / 100; }
  function shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // ---------- Progress storage ----------
  const STORAGE_KEY = "multab_progress_v1";

  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }
  function saveProgress(p) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  }
  function progressKey(levelId, modeId) { return `${levelId}__${modeId}`; }

  // ---------- Fact-level tracking (feeds "My Weak Spots") ----------
  // Every graded cell across every level (not just the personalized ones)
  // updates this, keyed per domain so integer and decimal misses never mix.
  const FACT_STATS_KEY = "multab_fact_stats_v1";
  let factStats = loadFactStats();

  function loadFactStats() {
    try {
      return JSON.parse(localStorage.getItem(FACT_STATS_KEY)) || {};
    } catch (e) {
      return {};
    }
  }
  function saveFactStats() {
    localStorage.setItem(FACT_STATS_KEY, JSON.stringify(factStats));
  }
  function factKey(a, b) {
    return a <= b ? `${a},${b}` : `${b},${a}`;
  }
  function recordFactResult(domain, r, c, correct) {
    if (!domain) return;
    const bucket = factStats[domain] || (factStats[domain] = {});
    const key = factKey(r, c);
    const entry = bucket[key] || (bucket[key] = { wrong: 0, right: 0, lastWrongAt: null });
    if (correct) entry.right += 1;
    else { entry.wrong += 1; entry.lastWrongAt = Date.now(); }
  }

  // Picks 15–25 facts to drill: recently-missed facts first (most recent
  // miss wins ties), falling back to unseen facts from a modest range if
  // there isn't enough miss history yet to fill the set.
  function pickWeakFacts(domain) {
    const bucket = factStats[domain] || {};
    const missed = Object.keys(bucket)
      .map((key) => {
        const [a, b] = key.split(",").map(Number);
        return { a, b, ...bucket[key] };
      })
      .filter((f) => f.wrong > 0)
      .sort((x, y) => (y.lastWrongAt || 0) - (x.lastWrongAt || 0) || y.wrong - x.wrong);

    const picked = missed.slice(0, 25);
    if (picked.length < 15) {
      const pool = domain === "decimal" ? DECIMAL_AXIS : range(1, 12);
      const seen = new Set(picked.map((p) => factKey(p.a, p.b)));
      const candidates = shuffle(pool.flatMap((a) => pool.filter((b) => b >= a).map((b) => ({ a, b }))));
      for (const cand of candidates) {
        const key = factKey(cand.a, cand.b);
        if (seen.has(key)) continue;
        picked.push(cand);
        seen.add(key);
        if (picked.length >= 15) break;
      }
    }
    return picked;
  }

  // Personalized levels have no fixed axis/target — rebuild them from the
  // current weakest-facts pick right before each attempt starts.
  function refreshDynamicLevel(level) {
    const picked = pickWeakFacts(level.domain);
    const axisSet = new Set();
    picked.forEach((p) => { axisSet.add(p.a); axisSet.add(p.b); });
    level.axis = Array.from(axisSet).sort((a, b) => a - b);
    level.target = (r, c) => picked.some((p) => (p.a === r && p.b === c) || (p.a === c && p.b === r));
  }

  function starsFor(correct, accuracy) {
    if (correct >= 10 && accuracy >= 90) return 3;
    if (correct >= 6 && accuracy >= 75) return 2;
    if (correct >= 1 && accuracy >= 50) return 1;
    return 0;
  }

  // A timer mode counts as "beaten" only on a perfect run (every target
  // cell correct) with a real number of questions attempted — no partial
  // credit, so a tick actually means they've got it.
  const BEAT_ACCURACY = 100;
  const BEAT_MIN_CORRECT = 5;
  function isBeaten(correct, accuracy) {
    return correct >= BEAT_MIN_CORRECT && accuracy >= BEAT_ACCURACY;
  }

  // ---------- State ----------
  let progress = loadProgress();
  let selectedLevel = null;
  let selectedMode = TIMER_MODES[0]; // default 1:00
  let session = null; // active quiz session
  let timerHandle = null;
  let bannerTimeout = null;
  let pendingAdvanceTimeout = null;
  let pendingResumeLevel = null;
  let pendingResumeMode = null;
  let bigPictureMode = localStorage.getItem("multab_big_picture") === "1";
  let extensionExpanded = localStorage.getItem("multab_extension_expanded") === "1";

  // ---------- DOM refs ----------
  const $ = (sel) => document.querySelector(sel);
  const levelSections = $("#level-sections");
  const timerSelect = $("#timer-select");
  const timerSelectHeading = $("#timer-select-heading");
  const startBtn = $("#start-btn");

  const levelSelectView = $("#level-select-view");
  const quizView = $("#quiz-view");
  const resultsView = $("#results-view");

  const hudLevel = $("#hud-level");
  const hudTimer = $("#hud-timer");
  const hudScore = $("#hud-score");
  const hudStreak = $("#hud-streak");
  const timerBar = $("#timer-bar");
  const timerBarTrack = timerBar.parentElement;
  const cheatBanner = $("#cheat-banner");
  const finishBtn = $("#finish-btn");
  const quitBtn = $("#quit-btn");
  const finishWarning = $("#finish-warning");
  const tableHint = $("#table-hint");
  const bigPictureControl = $("#big-picture-control");
  const bigPictureToggle = $("#big-picture-toggle");
  const tableContainer = $("#table-container");
  const resultsTableContainer = $("#results-table-container");
  const pauseOverlay = $("#pause-overlay");
  const installBanner = $("#install-banner");
  const installBannerText = $("#install-banner-text");
  const installBtn = $("#install-btn");
  const installDismissBtn = $("#install-dismiss-btn");

  // ---------- Tabs ----------
  // The whole Play tab (level select, quiz, results) stays fullscreen; only
  // Report drops out of fullscreen, since it's for reviewing progress, not play.
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.tab !== "play" && session) handlePotentialCheat();
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      $(`#tab-${btn.dataset.tab}`).classList.add("active");
      if (btn.dataset.tab === "report") {
        exitFullscreenSafe();
        renderReport();
      } else {
        requestFullscreenSafe();
      }
    });
  });

  // ---------- Level select rendering ----------
  function isLevelBeaten(levelId) {
    return Object.values(progress).some((r) => r.levelId === levelId && r.beaten);
  }

  const LEVEL_SECTIONS = [
    { key: "core", title: "Times Tables" },
    { key: "playground", title: "Playground" },
    { key: "extension", title: "Extension" },
  ];

  function buildLevelCard(lvl) {
    const locked = lvl.prereq && !isLevelBeaten(lvl.prereq);
    const card = document.createElement("button");
    card.className = "level-card" + (locked ? " locked" : "") + (lvl.immediateFeedback ? " playground-card" : "");
    card.type = "button";
    card.disabled = locked;
    if (selectedLevel && selectedLevel.id === lvl.id) card.classList.add("selected");

    if (locked) {
      const prereqName = LEVELS.find((l) => l.id === lvl.prereq)?.name || lvl.prereq;
      card.innerHTML = `
        <div class="level-code">🔒 Locked</div>
        <div class="level-name">${lvl.name}</div>
        <div class="level-lock-hint">Beat "${prereqName}" to unlock</div>
      `;
      card.title = `Beat ${prereqName} first`;
      return card;
    }

    if (lvl.immediateFeedback) {
      card.innerHTML = `
        <div class="level-code">🧮 Playground</div>
        <div class="level-name">${lvl.name}</div>
        <div class="level-desc">${lvl.desc}</div>
      `;
    } else {
      const bestStars = bestStarsAcrossModes(lvl.id);
      const ticks = modesFor(lvl).map((m) => {
        const rec = progress[progressKey(lvl.id, m.id)];
        const beaten = !!rec?.beaten;
        return `<span class="mode-tick ${beaten ? "beaten" : ""}" title="${m.label}${beaten ? " — beaten" : ""}">${beaten ? "✓" : "·"}</span>`;
      }).join("");
      card.innerHTML = `
        <div class="level-code">Level ${lvl.id}${lvl.untimed ? " · free" : ""}</div>
        <div class="level-name">${lvl.name}</div>
        <div class="level-stars">${bestStars > 0 ? "★".repeat(bestStars) + "☆".repeat(3 - bestStars) : ""}</div>
        <div class="level-ticks">${ticks}</div>
      `;
    }
    card.title = lvl.desc;
    card.addEventListener("click", () => {
      requestFullscreenSafe();
      selectedLevel = lvl;
      renderLevelGrid();
      renderTimerSelect();
      updateStartBtn();
    });
    return card;
  }

  function renderLevelGrid() {
    levelSections.innerHTML = "";
    LEVEL_SECTIONS.forEach((section) => {
      const levelsInSection = LEVELS.filter((l) => l.category === section.key);
      if (!levelsInSection.length) return;

      // Extension is squares/decimals/fractions — extra material, not the
      // core curriculum — so it stays tucked behind a toggle by default.
      if (section.key === "extension") {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "section-toggle";
        toggle.innerHTML = `<span>${extensionExpanded ? "▾" : "▸"} ${section.title}</span><span class="section-toggle-count">${levelsInSection.length} level${levelsInSection.length === 1 ? "" : "s"}</span>`;
        toggle.addEventListener("click", () => {
          extensionExpanded = !extensionExpanded;
          localStorage.setItem("multab_extension_expanded", extensionExpanded ? "1" : "0");
          renderLevelGrid();
        });
        levelSections.appendChild(toggle);
        if (!extensionExpanded) return;
      } else {
        const heading = document.createElement("h2");
        heading.textContent = section.title;
        levelSections.appendChild(heading);
      }

      const grid = document.createElement("div");
      grid.className = "level-grid" + (section.key === "playground" ? " playground-grid" : "");
      levelsInSection.forEach((lvl) => grid.appendChild(buildLevelCard(lvl)));
      levelSections.appendChild(grid);
    });
  }

  function bestStarsAcrossModes(levelId) {
    const level = LEVELS.find((l) => l.id === levelId);
    let best = 0;
    modesFor(level).forEach((m) => {
      const rec = progress[progressKey(levelId, m.id)];
      if (rec && rec.stars > best) best = rec.stars;
    });
    return best;
  }

  // An untimed level has no timer to choose, so the chips are replaced by a note.
  function renderTimerSelect() {
    timerSelect.innerHTML = "";
    if (selectedLevel?.untimed) {
      timerSelectHeading.textContent = "No timer";
      const note = document.createElement("p");
      note.className = "timer-note";
      note.textContent = selectedLevel.immediateFeedback
        ? "Answer any cell and find out right away — no timer, no Finish button, just play."
        : "Free practice — take as long as you like. The clock counts up so you can still see your time.";
      timerSelect.appendChild(note);
      return;
    }
    timerSelectHeading.textContent = "Choose a timer";
    TIMER_MODES.forEach((mode) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "timer-chip";
      if (selectedMode.id === mode.id) chip.classList.add("selected");
      chip.textContent = mode.label;
      chip.addEventListener("click", () => {
        requestFullscreenSafe();
        selectedMode = mode;
        renderTimerSelect();
      });
      timerSelect.appendChild(chip);
    });
  }

  function updateStartBtn() {
    startBtn.disabled = !selectedLevel;
    startBtn.textContent = selectedLevel?.immediateFeedback ? "Open Playground" : "Start Level";
  }

  startBtn.addEventListener("click", () => startSession());
  quitBtn.addEventListener("click", () => endSession());
  $("#retry-btn").addEventListener("click", () => startSession());
  $("#back-btn").addEventListener("click", () => showView("select"));

  // ---------- Quiz session ----------
  function showView(name) {
    levelSelectView.classList.toggle("hidden", name !== "select");
    quizView.classList.toggle("hidden", name !== "quiz");
    resultsView.classList.toggle("hidden", name !== "results");
  }

  function requestFullscreenSafe() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (req) {
      try { req.call(el).catch(() => {}); } catch (e) { /* ignore: needs a user gesture */ }
    }
  }

  function exitFullscreenSafe() {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (exit) { try { exit.call(document).catch(() => {}); } catch (e) { /* ignore */ } }
    }
  }

  // ---------- Excel-style table rendering ----------
  // The whole grid is always drawn, exactly like the spreadsheets. Highlighted
  // target cells are real <input>s showing the question ("6 × 6") as faint
  // ghost text you type over; the rest are plain reference cells showing their
  // question too, so the sheet reads the same but only the task is editable.
  function cellId(ri, ci) { return `cell-${ri}-${ci}`; }
  function fmt(n, level) {
    const label = level?.fractionLabels?.get(n);
    return label ?? String(round2(n));
  }

  // Big Picture mode drops rows/columns that contain no target cells, so a
  // level like "1-5 x 1-5" collapses from the full 12x12 down to just its block.
  function visibleAxes(level) {
    if (!bigPictureMode) return { rows: level.axis, cols: level.axis };
    return {
      rows: level.axis.filter((r) => level.axis.some((c) => level.target(r, c))),
      cols: level.axis.filter((c) => level.axis.some((r) => level.target(r, c))),
    };
  }

  // Turns a sorted list of numeric positions into proportional shares (%) of
  // a line, using the midpoint between neighbors as each point's boundary —
  // so points close together get a thin share and points far apart get a
  // wide one. Only visibly "wonky" when the axis mixes step sizes (e.g.
  // combined halves+thirds); a single-denominator axis is evenly spaced
  // anyway and comes out uniform here too.
  function proportionalShares(values) {
    const n = values.length;
    if (n === 1) return [100];
    const bounds = [values[0] - (values[1] - values[0]) / 2];
    for (let i = 0; i < n - 1; i++) bounds.push((values[i] + values[i + 1]) / 2);
    bounds.push(values[n - 1] + (values[n - 1] - values[n - 2]) / 2);
    const widths = [];
    for (let i = 0; i < n; i++) widths.push(bounds[i + 1] - bounds[i]);
    const total = widths.reduce((a, b) => a + b, 0);
    return widths.map((w) => (w / total) * 100);
  }

  function buildGridTable(level, axisRows, axisCols, targetCells) {
    const table = document.createElement("table");
    table.className = "excel-table" + (level.proportional ? " proportional" : "");
    const headRow = axisCols.map((c) => `<th>${fmt(c, level)}</th>`).join("");
    table.innerHTML = `<thead><tr><th class="corner">×</th>${headRow}</tr></thead>`;

    if (level.proportional) {
      const labelShare = 10;
      const colShares = proportionalShares(axisCols).map((s) => (s / 100) * (100 - labelShare));
      const colgroup = document.createElement("colgroup");
      const labelCol = document.createElement("col");
      labelCol.style.width = `${labelShare}%`;
      colgroup.appendChild(labelCol);
      colShares.forEach((s) => {
        const col = document.createElement("col");
        col.style.width = `${s}%`;
        colgroup.appendChild(col);
      });
      table.insertBefore(colgroup, table.firstChild);
    }

    const rowHeights = level.proportional
      ? proportionalShares(axisRows).map((s) => Math.max(30, (s / 100) * axisRows.length * 46))
      : null;

    const tbody = document.createElement("tbody");
    axisRows.forEach((r, ri) => {
      const tr = document.createElement("tr");
      if (rowHeights) tr.style.height = `${rowHeights[ri]}px`;
      tr.appendChild(document.createElement("th")).textContent = fmt(r, level);
      axisCols.forEach((c, ci) => {
        const td = document.createElement("td");
        const question = `${fmt(r, level)} × ${fmt(c, level)}`;
        if (level.target(r, c)) {
          td.className = "cell-data";
          if (level.fractionParts) {
            const rp = level.fractionParts.get(r);
            const cp = level.fractionParts.get(c);
            const rawN = rp.n * cp.n, rawD = rp.d * cp.d;
            const g = gcd(rawN, rawD);
            td.appendChild(buildFractionCellInput(ri, ci, rawN / g, rawD / g, question, r, c));
          } else {
            td.appendChild(buildCellInput(ri, ci, round2(r * c), question, r, c));
          }
          targetCells.push({ id: cellId(ri, ci), ri, ci });
        } else {
          td.className = "cell-ref";
          td.textContent = question;
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function buildCellInput(ri, ci, answer, question, r, c) {
    const input = document.createElement("input");
    input.type = "number";
    input.step = "any";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.className = "cell-input";
    input.id = cellId(ri, ci);
    input.dataset.ri = ri;
    input.dataset.ci = ci;
    input.dataset.answer = answer;
    input.dataset.question = question;
    input.dataset.factR = r;
    input.dataset.factC = c;
    input.placeholder = question; // the QUESTION, faint — typing writes over it
    return input;
  }

  // Fraction answers can't be typed as "n/d" (no slash on a numeric keypad,
  // and it reads badly anyway) — instead render the classic stacked
  // numerator-over-denominator box with a dividing line, like on paper.
  // Enter moves numerator -> denominator -> (once both are filled) on to the
  // next blank cell.
  function buildFractionCellInput(ri, ci, answerN, answerD, question, r, c) {
    const wrap = document.createElement("div");
    wrap.className = "cell-fraction";
    wrap.title = question;

    const num = document.createElement("input");
    num.type = "number";
    num.step = "1";
    num.inputMode = "numeric";
    num.autocomplete = "off";
    num.className = "cell-input frac-num";
    num.id = cellId(ri, ci);
    num.dataset.ri = ri;
    num.dataset.ci = ci;
    num.dataset.answerN = answerN;
    num.dataset.answerD = answerD;
    num.dataset.question = question;
    num.dataset.factR = r;
    num.dataset.factC = c;
    num.dataset.fracPart = "n";
    num.placeholder = "n";

    const bar = document.createElement("div");
    bar.className = "frac-bar";

    const den = document.createElement("input");
    den.type = "number";
    den.step = "1";
    den.inputMode = "numeric";
    den.autocomplete = "off";
    den.className = "cell-input frac-den";
    den.id = `${cellId(ri, ci)}-d`;
    den.dataset.ri = ri;
    den.dataset.ci = ci;
    den.dataset.fracPart = "d";
    den.placeholder = "d";

    wrap.appendChild(num);
    wrap.appendChild(bar);
    wrap.appendChild(den);
    return wrap;
  }

  // A fraction cell is really two inputs (numerator id, denominator id+"-d")
  // but everywhere else in the app treats it as one logical cell keyed by the
  // numerator's id — these helpers bridge that.
  function fractionDenomEl(el) {
    return el.dataset.fracPart === "n" ? document.getElementById(`${el.id}-d`) : null;
  }
  function fractionNumEl(el) {
    return el.dataset.fracPart === "d" ? document.getElementById(el.id.slice(0, -2)) : null;
  }
  function isCellFilled(el) {
    const denom = fractionDenomEl(el);
    if (denom) return el.value !== "" && denom.value !== "";
    return el.value !== "";
  }
  function markCellMissing(el) {
    el.classList.add("cell-missing");
    const denom = fractionDenomEl(el);
    if (denom) denom.classList.add("cell-missing");
  }
  function clearCellMissing(el) {
    el.classList.remove("cell-missing");
    const denom = fractionDenomEl(el);
    if (denom) denom.classList.remove("cell-missing");
    const num = fractionNumEl(el);
    if (num) num.classList.remove("cell-missing");
  }

  // Toggling mid-level rebuilds the table (the visible rows/cols change), so
  // carry any answers already typed across to the new layout.
  bigPictureToggle.checked = bigPictureMode;
  bigPictureToggle.addEventListener("change", () => {
    bigPictureMode = bigPictureToggle.checked;
    localStorage.setItem("multab_big_picture", bigPictureMode ? "1" : "0");
    if (session) rebuildTablePreservingAnswers();
  });

  function rebuildTablePreservingAnswers() {
    const level = session.level;
    const saved = new Map();
    session.cells.forEach((cell) => {
      const el = document.getElementById(cell.id);
      if (!el) return;
      const denom = fractionDenomEl(el);
      if (denom) {
        if (el.value !== "" || denom.value !== "") {
          saved.set(`${session.axisRows[cell.ri]}x${session.axisCols[cell.ci]}`, { n: el.value, d: denom.value });
        }
      } else if (el.value !== "") {
        saved.set(`${session.axisRows[cell.ri]}x${session.axisCols[cell.ci]}`, el.value);
      }
    });

    const { rows, cols } = visibleAxes(level);
    session.axisRows = rows;
    session.axisCols = cols;
    session.cells = [];
    tableContainer.innerHTML = "";
    tableContainer.appendChild(buildGridTable(level, rows, cols, session.cells));

    session.cells.forEach((cell) => {
      const key = `${rows[cell.ri]}x${cols[cell.ci]}`;
      if (!saved.has(key)) return;
      const el = document.getElementById(cell.id);
      const value = saved.get(key);
      const denom = fractionDenomEl(el);
      if (denom && typeof value === "object") { el.value = value.n; denom.value = value.d; }
      else if (!denom) el.value = value;
    });
    finishWarning.classList.add("hidden");
    updateBlanksLeftHud();
    const firstEmpty = session.cells.map((c) => document.getElementById(c.id)).find((el) => el && !isCellFilled(el));
    if (firstEmpty) firstEmpty.focus();
  }

  const hudScoreLabel = hudScore.previousElementSibling;
  const hudStreakLabel = hudStreak.previousElementSibling;
  const resultStreakLabel = $("#result-best-streak").nextElementSibling;

  function startSession(afterLeave) {
    if (!selectedLevel) return;
    clearTimeout(pendingAdvanceTimeout);
    pendingAdvanceTimeout = null;
    requestFullscreenSafe();
    const level = selectedLevel;
    if (level.dynamic) refreshDynamicLevel(level);
    quitBtn.textContent = "Quit";
    const mode = level.untimed ? FREE_MODE : selectedMode;
    const { rows, cols } = visibleAxes(level);
    session = {
      level,
      mode,
      remaining: mode.seconds,
      elapsed: 0,
      axisRows: rows,
      axisCols: cols,
      cells: [],
      locked: false,
      score: 0,
      streak: 0,
    };
    hudLevel.textContent = `${level.id} · ${mode.label}`;
    timerBarTrack.classList.toggle("hidden", !!level.untimed);
    timerBar.style.width = "100%";
    timerBar.style.background = "";

    tableContainer.innerHTML = "";
    tableContainer.appendChild(buildGridTable(level, rows, cols, session.cells));

    tableHint.classList.toggle("hidden", !!level.immediateFeedback);
    bigPictureControl.classList.remove("hidden");

    showView("quiz");
    if (afterLeave) {
      cheatBanner.classList.remove("hidden");
      clearTimeout(bannerTimeout);
      bannerTimeout = setTimeout(() => cheatBanner.classList.add("hidden"), 4000);
    } else {
      cheatBanner.classList.add("hidden");
    }

    if (level.immediateFeedback) {
      // Playground: every answer is graded the instant it's entered, so the
      // HUD tracks a running score/streak instead of a "left to do" count,
      // and there's no Finish button — just play until you're done.
      hudScoreLabel.textContent = "Score";
      hudStreakLabel.textContent = "Streak";
      hudScore.textContent = "0";
      hudStreak.textContent = "0";
      finishBtn.classList.add("hidden");
      finishWarning.classList.add("hidden");
    } else {
      // No live right/wrong feedback while playing — the HUD tracks how many
      // cells are left instead, so progress shows without spoiling correctness.
      // Everything gets graded and revealed at the end.
      hudScoreLabel.textContent = "Left";
      hudStreakLabel.textContent = "To do";
      hudScore.textContent = String(session.cells.length);
      hudStreak.textContent = String(session.cells.length);
      finishWarning.classList.add("hidden");
      finishBtn.classList.remove("hidden");
      finishBtn.classList.remove("ready");
    }
    const first = document.getElementById(session.cells[0].id);
    if (first) first.focus();

    tick(); // immediate render
    timerHandle = setInterval(tick, 1000);
  }

  // ---------- Grid cell navigation (click / arrow keys / Enter) ----------
  // Arrow keys land only on target cells — plain reference cells hold no input,
  // so cellAt() returns null for them and the search keeps stepping past.
  function cellAt(ri, ci) {
    return document.getElementById(cellId(ri, ci));
  }

  function moveWithArrow(input, key) {
    const rows = session.axisRows.length;
    const cols = session.axisCols.length;
    let ri = parseInt(input.dataset.ri, 10);
    let ci = parseInt(input.dataset.ci, 10);
    const dRi = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0;
    const dCi = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
    if (!dRi && !dCi) return;

    let r = ri, c = ci;
    while (true) {
      r += dRi;
      c += dCi;
      if (r < 0 || r >= rows || c < 0 || c >= cols) return; // hit the edge — no header cells to land on
      const candidate = cellAt(r, c);
      if (candidate && !candidate.disabled) { candidate.focus(); return; }
      // already-answered cell in the way — keep skipping to the next one
    }
  }

  // No live right/wrong feedback: Enter just confirms a value is present and
  // moves on to a nearby still-empty blank. Everything gets graded only once
  // the whole table is filled in or the timer runs out.
  function moveToNearbyEmptyCell(input) {
    const cells = session.cells;
    const idx = cells.findIndex((cell) => cell.id === input.id);
    for (let step = 1; step <= cells.length; step++) {
      const next = cells[(idx + step) % cells.length];
      const el = document.getElementById(next.id);
      if (el && !isCellFilled(el)) { el.focus(); return; }
    }
    input.blur();
  }

  function emptyCells() {
    return session.cells
      .map((c) => document.getElementById(c.id))
      .filter((el) => el && !isCellFilled(el));
  }

  function updateBlanksLeftHud() {
    if (!session) return;
    const left = emptyCells().length;
    hudScore.textContent = String(left);
    // Nudge towards Finish once nothing is left blank.
    finishBtn.classList.toggle("ready", left === 0);
  }

  tableContainer.addEventListener("keydown", (e) => {
    const input = e.target.closest("input.cell-input");
    if (!input || !session) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (input.disabled) return;
      if (input.dataset.fracPart === "n") {
        // Numerator -> denominator, no matter what's typed yet.
        const denom = fractionDenomEl(input);
        if (denom) denom.focus();
        return;
      }
      const cellEl = fractionNumEl(input) || input;
      if (!isCellFilled(cellEl)) return;
      if (session.level.immediateFeedback) {
        const isCorrect = gradeOneCell(cellEl);
        saveFactStats();
        session.score += isCorrect ? 1 : 0;
        session.streak = isCorrect ? session.streak + 1 : 0;
        hudScore.textContent = String(session.score);
        hudStreak.textContent = String(session.streak);
        moveToNearbyEmptyCell(cellEl);
      } else {
        moveToNearbyEmptyCell(cellEl);
        updateBlanksLeftHud();
      }
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      moveWithArrow(input, e.key);
    }
  });

  // Typing anywhere refreshes the count and clears any "you missed this"
  // marker on that cell.
  tableContainer.addEventListener("input", (e) => {
    const input = e.target.closest("input.cell-input");
    if (!input || !session) return;
    clearCellMissing(input);
    if (session.level.immediateFeedback) return;
    if (!tableContainer.querySelector(".cell-missing")) finishWarning.classList.add("hidden");
    updateBlanksLeftHud();
  });

  // Finish only submits a complete table — otherwise it points out what's
  // still empty and sends them back to the first one.
  finishBtn.addEventListener("click", () => {
    if (!session) return;
    const empties = emptyCells();
    if (empties.length === 0) {
      finishWarning.classList.add("hidden");
      finishEarly();
      return;
    }
    empties.forEach((el) => markCellMissing(el));
    finishWarning.textContent = `Still ${empties.length} to go — fill in the highlighted cell${empties.length === 1 ? "" : "s"} before finishing.`;
    finishWarning.classList.remove("hidden");
    empties[0].scrollIntoView({ block: "center", behavior: "smooth" });
    empties[0].focus();
  });

  // ---------- Anti-cheat: leaving the tab/window/fullscreen pauses and blanks the level ----------
  // Nothing resumes automatically — the player must click Play again, which is
  // also what lets us re-request fullscreen (browsers require a real user
  // gesture for that, so an automatic resume couldn't re-enter fullscreen anyway).
  function handlePotentialCheat() {
    if (!session) return;
    pendingResumeLevel = session.level;
    pendingResumeMode = session.mode;
    clearInterval(timerHandle);
    timerHandle = null;
    clearTimeout(pendingAdvanceTimeout);
    pendingAdvanceTimeout = null;
    session = null;

    // Blank the screen so nothing useful is visible while they're away.
    tableContainer.innerHTML = "";
    hudTimer.textContent = "0:00";
    hudScore.textContent = "0";
    hudStreak.textContent = "0";
    timerBar.style.width = "0%";
    cheatBanner.classList.add("hidden");
    pauseOverlay.classList.remove("hidden");
  }

  $("#pause-play-btn").addEventListener("click", () => {
    pauseOverlay.classList.add("hidden");
    selectedLevel = pendingResumeLevel;
    selectedMode = pendingResumeMode;
    startSession(true);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) handlePotentialCheat();
  });
  window.addEventListener("blur", handlePotentialCheat);
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && session) handlePotentialCheat();
  });

  function tick() {
    if (!session) return;

    // Untimed levels just count up and never expire.
    if (session.level.untimed) {
      hudTimer.textContent = formatTime(session.elapsed);
      session.elapsed += 1;
      return;
    }

    hudTimer.textContent = formatTime(session.remaining);
    const pct = Math.max(0, (session.remaining / session.mode.seconds) * 100);
    timerBar.style.width = pct + "%";
    if (pct < 25) timerBar.style.background = "linear-gradient(90deg,#f87171,#fb923c)";
    else if (pct < 50) timerBar.style.background = "linear-gradient(90deg,#fbbf24,#facc15)";

    if (session.remaining <= 0) {
      const { correct, attempted } = gradeInteractiveSession();
      finishSession({ correct, attempted, finishedEarly: false, elapsedSeconds: session.mode.seconds });
      return;
    }
    session.remaining -= 1;
  }

  function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  // Grades one cell: figures out right/wrong, records it against the fact
  // stats, and swaps the input(s) for static result markup. On a miss shows
  // the right answer AND what they actually put, so a red cell can't be
  // misread as "this number is wrong" when it's the correct one being
  // revealed. Shared by the delayed (whole-table-at-once) and immediate
  // (Playground, per-cell) grading paths.
  function gradeOneCell(el) {
    const denom = fractionDenomEl(el);
    let isCorrect, answerDisplay, givenDisplay;
    if (denom) {
      const gn = el.value === "" ? null : parseInt(el.value, 10);
      const gd = denom.value === "" ? null : parseInt(denom.value, 10);
      const an = Number(el.dataset.answerN);
      const ad = Number(el.dataset.answerD);
      // Cross-multiply so equivalent-but-unreduced fractions (e.g. 2/4) still count.
      isCorrect = gn !== null && gd !== null && gd !== 0 && gn * ad === an * gd;
      answerDisplay = `${an}/${ad}`;
      givenDisplay = gn === null && gd === null ? "—" : `${gn ?? "?"}/${gd ?? "?"}`;
    } else {
      const answer = parseFloat(el.dataset.answer);
      const given = el.value;
      isCorrect = given !== "" && Math.abs(parseFloat(given) - answer) < 0.001;
      answerDisplay = el.dataset.answer;
      givenDisplay = given === "" ? "—" : given;
    }
    recordFactResult(session.level.domain, Number(el.dataset.factR), Number(el.dataset.factC), isCorrect);

    const result = document.createElement("div");
    result.className = "cell-result";
    result.id = el.id; // keep the id alive so lookups/navigation still find this cell

    const answerEl = document.createElement("span");
    answerEl.className = "cell-answer";
    answerEl.textContent = answerDisplay;
    result.appendChild(answerEl);

    if (!isCorrect) {
      const yours = document.createElement("span");
      yours.className = "cell-yours";
      yours.textContent = `you: ${givenDisplay}`;
      result.appendChild(yours);
    }

    const td = el.closest("td");
    td.innerHTML = "";
    td.appendChild(result);
    td.classList.remove("cell-data");
    td.classList.add(isCorrect ? "cell-correct" : "cell-wrong");
    return isCorrect;
  }

  // Nothing is graded while playing — every blank is revealed and scored only
  // once the table is finished (early) or the timer runs out.
  function gradeInteractiveSession() {
    let correct = 0;
    session.cells.forEach((c) => {
      const el = document.getElementById(c.id);
      if (!el) return;
      if (gradeOneCell(el)) correct += 1;
    });
    saveFactStats();
    return { correct, attempted: session.cells.length };
  }

  function finishEarly() {
    if (!session) return;
    clearInterval(timerHandle);
    timerHandle = null;
    clearTimeout(pendingAdvanceTimeout);
    pendingAdvanceTimeout = null;
    const elapsedSeconds = session.level.untimed
      ? session.elapsed
      : session.mode.seconds - session.remaining;
    const { correct, attempted } = gradeInteractiveSession();
    finishSession({ correct, attempted, finishedEarly: true, elapsedSeconds });
  }

  // timeSeconds is the exact wall-clock time a completed run took — only
  // passed when the whole table was actually finished, never on a timeout.
  // The fastest one ever recorded for this level+mode is kept as bestTimeSeconds.
  function saveLevelResult(level, mode, correct, attempted, accuracy, beaten, timeSeconds) {
    const key = progressKey(level.id, mode.id);
    const prior = progress[key];
    const stars = starsFor(correct, accuracy);
    const bestTimeSeconds = timeSeconds == null
      ? prior?.bestTimeSeconds ?? null
      : prior?.bestTimeSeconds != null ? Math.min(prior.bestTimeSeconds, timeSeconds) : timeSeconds;
    const record = {
      levelId: level.id,
      modeId: mode.id,
      correct,
      attempted,
      accuracy,
      stars,
      beaten: beaten || !!prior?.beaten,
      bestTimeSeconds,
      attempts: (prior?.attempts || 0) + 1,
      lastPlayed: new Date().toISOString(),
    };
    if (!prior || betterThan(record, prior)) {
      record.beaten = beaten || !!prior?.beaten;
      progress[key] = record;
    } else {
      prior.attempts += 1;
      prior.lastPlayed = record.lastPlayed;
      prior.beaten = prior.beaten || beaten;
      prior.bestTimeSeconds = bestTimeSeconds;
      progress[key] = prior;
    }
  }

  // Finishing all blanks before time's up credits every timer tier the
  // finish time also beats — race through in 45s on a 3:00 attempt and all
  // three modes get ticked off at once.
  function finishSession({ correct, attempted, finishedEarly, elapsedSeconds }) {
    // Stop the clock here too — the timer-expiry path reaches this without
    // going through finishEarly(), and a surviving interval would tick again
    // after session is cleared below.
    clearInterval(timerHandle);
    timerHandle = null;
    clearTimeout(pendingAdvanceTimeout);
    pendingAdvanceTimeout = null;

    const level = session.level;
    const mode = session.mode;
    const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
    const stars = starsFor(correct, accuracy);
    const beatenSelected = isBeaten(correct, accuracy);

    // Only a genuinely completed run has a real "how fast" to record.
    const timeSeconds = finishedEarly ? elapsedSeconds : null;

    // Only timed levels earn tier ticks; free practice just records its own slot.
    const tickedModes = [];
    if (finishedEarly && beatenSelected && !level.untimed) {
      TIMER_MODES.forEach((m) => {
        if (elapsedSeconds <= m.seconds) {
          saveLevelResult(level, m, correct, attempted, accuracy, true, timeSeconds);
          tickedModes.push(m);
        }
      });
    }
    if (!tickedModes.some((m) => m.id === mode.id)) {
      saveLevelResult(level, mode, correct, attempted, accuracy, beatenSelected, timeSeconds);
    }
    saveProgress(progress);

    resultsTableContainer.innerHTML = "";
    resultsTableContainer.appendChild(tableContainer.firstElementChild.cloneNode(true));

    resultStreakLabel.textContent = "Finish time";
    $("#result-best-streak").textContent = finishedEarly ? formatTime(elapsedSeconds) : "—";

    $("#results-title").textContent = finishedEarly
      ? `Finished in ${formatTime(elapsedSeconds)}! 🎉`
      : beatenSelected ? "Level beaten! 🎉" : "Time's up!";
    $("#result-correct").textContent = correct;
    $("#result-total").textContent = attempted;
    $("#result-accuracy").textContent = accuracy + "%";
    $("#result-stars").textContent = "★".repeat(stars) + "☆".repeat(3 - stars);
    $("#result-message").textContent = tickedModes.length > 1
      ? `You finished fast enough to beat ${tickedModes.map((m) => m.label).join(", ")} — all ticked off in your Report!`
      : !beatenSelected
        ? "Not quite there — hit Retry to give it another go."
        : level.untimed
          ? `Nice practice run on the full table — ticked off in your Report.`
          : `You beat ${level.id} at ${mode.label} — that mode is now ticked off in your Report.`;

    showView("results");
    session = null;
    renderLevelGrid();
  }

  // Quitting abandons the attempt without grading or recording anything.
  function endSession() {
    clearInterval(timerHandle);
    timerHandle = null;
    clearTimeout(pendingAdvanceTimeout);
    pendingAdvanceTimeout = null;
    session = null;
    showView("select");
    renderLevelGrid();
  }

  function betterThan(a, b) {
    if (a.stars !== b.stars) return a.stars > b.stars;
    if (a.correct !== b.correct) return a.correct > b.correct;
    return a.accuracy > b.accuracy;
  }

  // ---------- Report tab ----------
  function renderReport() {
    const overview = $("#report-overview");
    const headRow = $("#report-head-row");
    const body = $("#report-body");

    // Only count records for modes that still exist — retiring a timer (e.g.
    // the old 3:00) leaves orphaned entries that shouldn't skew the totals.
    const records = Object.values(progress).filter((r) => ALL_MODE_IDS.has(r.modeId));
    const totalSlots = LEVELS.reduce((sum, lvl) => sum + modesFor(lvl).length, 0);
    const levelsStarted = new Set(records.map((r) => r.levelId)).size;
    const totalStars = LEVELS.reduce((sum, lvl) => sum + bestStarsAcrossModes(lvl.id), 0);
    const totalBeaten = records.filter((r) => r.beaten).length;
    const totalAttempts = records.reduce((s, r) => s + (r.attempts || 0), 0);
    const avgAccuracy = records.length
      ? Math.round(records.reduce((s, r) => s + r.accuracy, 0) / records.length)
      : 0;

    overview.innerHTML = `
      <div class="overview-card"><span>${levelsStarted}/${LEVELS.length}</span><label>Levels started</label></div>
      <div class="overview-card"><span>${totalBeaten}/${totalSlots}</span><label>Beaten ✓</label></div>
      <div class="overview-card"><span>${totalStars}/${LEVELS.length * 3}</span><label>Total stars</label></div>
      <div class="overview-card"><span>${totalAttempts}</span><label>Attempts logged</label></div>
      <div class="overview-card"><span>${avgAccuracy}%</span><label>Avg accuracy</label></div>
    `;

    // table head: Level | mode1 | mode2 | mode3
    headRow.innerHTML = "<th>Level</th>" + TIMER_MODES.map((m) => `<th>${m.label}</th>`).join("");

    function resultCell(rec, extraClass) {
      if (!rec) return `<td class="cell-empty${extraClass ? " " + extraClass : ""}">—</td>`;
      const badge = rec.beaten ? '<span class="cell-beaten" title="Beaten">✓</span> ' : "";
      const timeLine = rec.bestTimeSeconds != null ? `<br><small class="cell-time">⏱ ${formatTime(rec.bestTimeSeconds)}</small>` : "";
      return `<td${extraClass ? ` class="${extraClass}"` : ""}>${badge}<span class="cell-stars">${"★".repeat(rec.stars)}${"☆".repeat(3 - rec.stars)}</span><br><small>${rec.correct}/${rec.attempted} · ${rec.accuracy}%</small>${timeLine}</td>`;
    }

    body.innerHTML = "";
    LEVELS.forEach((lvl) => {
      const tr = document.createElement("tr");
      let html = `<td><strong>${lvl.id}</strong> — ${lvl.name}</td>`;
      if (lvl.untimed) {
        // One "Practice" result spanning where the timer columns would be.
        const rec = progress[progressKey(lvl.id, FREE_MODE.id)];
        html += resultCell(rec, "cell-practice").replace("<td", `<td colspan="${TIMER_MODES.length}"`);
      } else {
        TIMER_MODES.forEach((mode) => {
          html += resultCell(progress[progressKey(lvl.id, mode.id)]);
        });
      }
      tr.innerHTML = html;
      body.appendChild(tr);
    });
  }

  $("#reset-progress-btn").addEventListener("click", () => {
    if (confirm("Reset all saved progress? This cannot be undone.")) {
      progress = {};
      saveProgress(progress);
      renderReport();
      renderLevelGrid();
    }
  });

  // ---------- PWA install ----------
  const INSTALL_DISMISSED_KEY = "multab_install_dismissed";
  const isStandalone = window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  let deferredInstallPrompt = null;

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  function showInstallBanner(text) {
    if (isStandalone || localStorage.getItem(INSTALL_DISMISSED_KEY) === "1") return;
    if (text) installBannerText.textContent = text;
    installBanner.classList.remove("hidden");
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    installBtn.classList.remove("hidden");
    showInstallBanner("📲 Install this app on your device for quick access and offline play.");
  });

  window.addEventListener("appinstalled", () => {
    installBanner.classList.add("hidden");
    deferredInstallPrompt = null;
  });

  installBtn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installBanner.classList.add("hidden");
  });

  installDismissBtn.addEventListener("click", () => {
    installBanner.classList.add("hidden");
    localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
  });

  // iOS Safari never fires beforeinstallprompt — show manual instructions instead.
  if (isIOS && !isStandalone) {
    installBtn.classList.add("hidden");
    showInstallBanner("📲 Install this app: tap the Share icon, then \"Add to Home Screen\".");
  }

  // ---------- Init ----------
  renderLevelGrid();
  renderTimerSelect();
  updateStartBtn();
  showView("select");
})();
