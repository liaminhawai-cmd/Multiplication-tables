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

  const LEVELS = [
    { id: "A", name: "1–5 × 1–5", desc: "Small numbers warm-up",
      axis: range(1, 12), target: (r, c) => r <= 5 && c <= 5 },
    { id: "B", name: "Evens", desc: "Even times tables",
      axis: range(1, 12), target: (r, c) => r % 2 === 0 && c % 2 === 0 },
    { id: "C", name: "6–9 × 3–5", desc: "Mid-range mix",
      axis: range(1, 12), target: (r, c) => between(r, 6, 9) && between(c, 3, 5) },
    { id: "D", name: "7s and 9s", desc: "Focus on the 7 and 9 tables",
      axis: range(1, 12), target: (r, c) => r === 7 || r === 9 || c === 7 || c === 9 },
    { id: "E", name: "6–10 × 6–10", desc: "Higher numbers",
      axis: range(1, 12), target: (r, c) => between(r, 6, 10) && between(c, 6, 10) },
    { id: "F", name: "Odd × Odd", desc: "Odd numbers only",
      axis: range(1, 12), target: (r, c) => r % 2 !== 0 && c % 2 !== 0 },
    { id: "G", name: "Squares to 15", desc: "n × n up to 15",
      axis: range(1, 15), target: (r, c) => r === c },
    { id: "FULL", name: "Full 12×12", desc: "Every table 1–12",
      axis: range(1, 12), target: () => true },
    { id: "H", name: "Squares to 25", desc: "Extension: n × n from 11 to 25",
      axis: range(11, 25), target: (r, c) => r === c },
    { id: "I", name: "Squares to 30", desc: "Extension: n × n from 16 to 30",
      axis: range(16, 30), target: (r, c) => r === c },
    { id: "J", name: "Decimals (all)", desc: "Every decimal pair 0.2–2",
      axis: DECIMAL_AXIS, target: () => true },
    { id: "K", name: "Decimals 0.2–1", desc: "Smaller decimal pairs",
      axis: DECIMAL_AXIS, target: (r, c) => between(r, 0.2, 1) && between(c, 0.2, 1) },
    { id: "L", name: "Decimals 0.6–1.4", desc: "Middle decimal pairs",
      axis: DECIMAL_AXIS, target: (r, c) => between(r, 0.6, 1.4) && between(c, 0.6, 1.4) },
  ];

  const TIMER_MODES = [
    { id: "180", label: "3:00", seconds: 180 },
    { id: "90", label: "1:30", seconds: 90 },
    { id: "45", label: "0:45", seconds: 45 },
  ];

  function range(a, b) {
    const out = [];
    for (let i = a; i <= b; i++) out.push(i);
    return out;
  }
  function round2(n) { return Math.round(n * 100) / 100; }

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

  function starsFor(correct, accuracy) {
    if (correct >= 10 && accuracy >= 90) return 3;
    if (correct >= 6 && accuracy >= 75) return 2;
    if (correct >= 1 && accuracy >= 50) return 1;
    return 0;
  }

  // A timer mode counts as "beaten" once accuracy is solid and a real
  // number of questions were attempted (stops a single lucky guess from
  // ticking a level off).
  const BEAT_ACCURACY = 80;
  const BEAT_MIN_CORRECT = 5;
  function isBeaten(correct, accuracy) {
    return correct >= BEAT_MIN_CORRECT && accuracy >= BEAT_ACCURACY;
  }

  // ---------- State ----------
  let progress = loadProgress();
  let selectedLevel = null;
  let selectedMode = TIMER_MODES[1]; // default 1:30
  let session = null; // active quiz session
  let timerHandle = null;
  let bannerTimeout = null;
  let pendingAdvanceTimeout = null;
  let pendingResumeLevel = null;
  let pendingResumeMode = null;
  let bigPictureMode = localStorage.getItem("multab_big_picture") === "1";

  // ---------- DOM refs ----------
  const $ = (sel) => document.querySelector(sel);
  const levelGrid = $("#level-grid");
  const timerSelect = $("#timer-select");
  const startBtn = $("#start-btn");

  const levelSelectView = $("#level-select-view");
  const quizView = $("#quiz-view");
  const resultsView = $("#results-view");

  const hudLevel = $("#hud-level");
  const hudTimer = $("#hud-timer");
  const hudScore = $("#hud-score");
  const hudStreak = $("#hud-streak");
  const timerBar = $("#timer-bar");
  const cheatBanner = $("#cheat-banner");
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
  function renderLevelGrid() {
    levelGrid.innerHTML = "";
    LEVELS.forEach((lvl) => {
      const card = document.createElement("button");
      card.className = "level-card";
      card.type = "button";
      if (selectedLevel && selectedLevel.id === lvl.id) card.classList.add("selected");
      const bestStars = bestStarsAcrossModes(lvl.id);
      const ticks = TIMER_MODES.map((m) => {
        const rec = progress[progressKey(lvl.id, m.id)];
        const beaten = !!rec?.beaten;
        return `<span class="mode-tick ${beaten ? "beaten" : ""}" title="${m.label}${beaten ? " — beaten" : ""}">${beaten ? "✓" : "·"}</span>`;
      }).join("");
      card.innerHTML = `
        <div class="level-code">Level ${lvl.id}</div>
        <div class="level-name">${lvl.name}</div>
        <div class="level-stars">${bestStars > 0 ? "★".repeat(bestStars) + "☆".repeat(3 - bestStars) : ""}</div>
        <div class="level-ticks">${ticks}</div>
      `;
      card.title = lvl.desc;
      card.addEventListener("click", () => {
        requestFullscreenSafe();
        selectedLevel = lvl;
        renderLevelGrid();
        updateStartBtn();
      });
      levelGrid.appendChild(card);
    });
  }

  function bestStarsAcrossModes(levelId) {
    let best = 0;
    TIMER_MODES.forEach((m) => {
      const rec = progress[progressKey(levelId, m.id)];
      if (rec && rec.stars > best) best = rec.stars;
    });
    return best;
  }

  function renderTimerSelect() {
    timerSelect.innerHTML = "";
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
  }

  startBtn.addEventListener("click", () => startSession());
  $("#quit-btn").addEventListener("click", () => endSession(true));
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
  function fmt(n) { return String(round2(n)); }

  // Big Picture mode drops rows/columns that contain no target cells, so a
  // level like "1-5 x 1-5" collapses from the full 12x12 down to just its block.
  function visibleAxes(level) {
    if (!bigPictureMode) return { rows: level.axis, cols: level.axis };
    return {
      rows: level.axis.filter((r) => level.axis.some((c) => level.target(r, c))),
      cols: level.axis.filter((c) => level.axis.some((r) => level.target(r, c))),
    };
  }

  function buildGridTable(level, axisRows, axisCols, targetCells) {
    const table = document.createElement("table");
    table.className = "excel-table";
    const headRow = axisCols.map((c) => `<th>${fmt(c)}</th>`).join("");
    table.innerHTML = `<thead><tr><th class="corner">×</th>${headRow}</tr></thead>`;
    const tbody = document.createElement("tbody");
    axisRows.forEach((r, ri) => {
      const tr = document.createElement("tr");
      tr.appendChild(document.createElement("th")).textContent = fmt(r);
      axisCols.forEach((c, ci) => {
        const td = document.createElement("td");
        const question = `${fmt(r)} × ${fmt(c)}`;
        if (level.target(r, c)) {
          td.className = "cell-data";
          td.appendChild(buildCellInput(ri, ci, round2(r * c), question));
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

  function buildCellInput(ri, ci, answer, question) {
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
    input.placeholder = question; // the QUESTION, faint — typing writes over it
    return input;
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
      if (el && el.value !== "") saved.set(`${session.axisRows[cell.ri]}x${session.axisCols[cell.ci]}`, el.value);
    });

    const { rows, cols } = visibleAxes(level);
    session.axisRows = rows;
    session.axisCols = cols;
    session.cells = [];
    tableContainer.innerHTML = "";
    tableContainer.appendChild(buildGridTable(level, rows, cols, session.cells));

    session.cells.forEach((cell) => {
      const key = `${rows[cell.ri]}x${cols[cell.ci]}`;
      if (saved.has(key)) document.getElementById(cell.id).value = saved.get(key);
    });
    updateBlanksLeftHud();
    const firstEmpty = session.cells.find((c) => document.getElementById(c.id).value === "");
    if (firstEmpty) document.getElementById(firstEmpty.id).focus();
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
    const { rows, cols } = visibleAxes(level);
    session = {
      level,
      mode: selectedMode,
      remaining: selectedMode.seconds,
      axisRows: rows,
      axisCols: cols,
      cells: [],
      locked: false,
    };
    hudLevel.textContent = `${level.id} · ${selectedMode.label}`;
    timerBar.style.width = "100%";
    timerBar.style.background = "";

    tableContainer.innerHTML = "";
    tableContainer.appendChild(buildGridTable(level, rows, cols, session.cells));

    tableHint.classList.remove("hidden");
    bigPictureControl.classList.remove("hidden");

    showView("quiz");
    if (afterLeave) {
      cheatBanner.classList.remove("hidden");
      clearTimeout(bannerTimeout);
      bannerTimeout = setTimeout(() => cheatBanner.classList.add("hidden"), 4000);
    } else {
      cheatBanner.classList.add("hidden");
    }

    // No live right/wrong feedback while playing — the HUD tracks how many
    // cells are left instead, so progress shows without spoiling correctness.
    // Everything gets graded and revealed at the end.
    hudScoreLabel.textContent = "Left";
    hudStreakLabel.textContent = "To do";
    hudScore.textContent = String(session.cells.length);
    hudStreak.textContent = String(session.cells.length);
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
      if (el && el.value === "") { el.focus(); return; }
    }
    input.blur();
  }

  function blanksRemaining() {
    return session.cells.filter((c) => {
      const el = document.getElementById(c.id);
      return !el || el.value === "";
    }).length;
  }

  function updateBlanksLeftHud() {
    hudScore.textContent = String(blanksRemaining());
  }

  tableContainer.addEventListener("keydown", (e) => {
    const input = e.target.closest("input.cell-input");
    if (!input || !session) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (input.disabled || input.value === "") return;
      moveToNearbyEmptyCell(input);
      updateBlanksLeftHud();
      if (blanksRemaining() === 0) finishEarly();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      moveWithArrow(input, e.key);
    }
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

  // Nothing is graded while playing — every blank is revealed and scored only
  // once the table is finished (early) or the timer runs out.
  function gradeInteractiveSession() {
    let correct = 0;
    session.cells.forEach((c) => {
      const el = document.getElementById(c.id);
      if (!el) return;
      const answer = parseFloat(el.dataset.answer);
      const given = parseFloat(el.value);
      const isCorrect = el.value !== "" && Math.abs(given - answer) < 0.001;
      if (isCorrect) {
        correct += 1;
      } else {
        el.value = el.dataset.answer; // reveal the right number where they were wrong or left it blank
      }
      el.disabled = true;
      el.classList.add(isCorrect ? "cell-correct" : "cell-wrong");
    });
    return { correct, attempted: session.cells.length };
  }

  function finishEarly() {
    if (!session) return;
    clearInterval(timerHandle);
    timerHandle = null;
    clearTimeout(pendingAdvanceTimeout);
    pendingAdvanceTimeout = null;
    const elapsedSeconds = session.mode.seconds - session.remaining;
    const { correct, attempted } = gradeInteractiveSession();
    finishSession({ correct, attempted, finishedEarly: true, elapsedSeconds });
  }

  function saveLevelResult(level, mode, correct, attempted, accuracy, beaten) {
    const key = progressKey(level.id, mode.id);
    const prior = progress[key];
    const stars = starsFor(correct, accuracy);
    const record = {
      levelId: level.id,
      modeId: mode.id,
      correct,
      attempted,
      accuracy,
      stars,
      beaten: beaten || !!prior?.beaten,
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
      progress[key] = prior;
    }
  }

  // Finishing all blanks before time's up credits every timer tier the
  // finish time also beats — race through in 45s on a 3:00 attempt and all
  // three modes get ticked off at once.
  function finishSession({ correct, attempted, finishedEarly, elapsedSeconds }) {
    const level = session.level;
    const mode = session.mode;
    const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
    const stars = starsFor(correct, accuracy);
    const beatenSelected = isBeaten(correct, accuracy);

    const tickedModes = [];
    if (finishedEarly && beatenSelected) {
      TIMER_MODES.forEach((m) => {
        if (elapsedSeconds <= m.seconds) {
          saveLevelResult(level, m, correct, attempted, accuracy, true);
          tickedModes.push(m);
        }
      });
    }
    if (!tickedModes.some((m) => m.id === mode.id)) {
      saveLevelResult(level, mode, correct, attempted, accuracy, beatenSelected);
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
      : beatenSelected
        ? `You beat ${level.id} at ${mode.label} — that mode is now ticked off in your Report.`
        : "Not quite there — hit Retry to give it another go.";

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

    // overview stats
    const records = Object.values(progress);
    const levelsStarted = new Set(records.map((r) => r.levelId)).size;
    const totalStars = LEVELS.reduce((sum, lvl) => sum + bestStarsAcrossModes(lvl.id), 0);
    const totalBeaten = records.filter((r) => r.beaten).length;
    const totalAttempts = records.reduce((s, r) => s + (r.attempts || 0), 0);
    const avgAccuracy = records.length
      ? Math.round(records.reduce((s, r) => s + r.accuracy, 0) / records.length)
      : 0;

    overview.innerHTML = `
      <div class="overview-card"><span>${levelsStarted}/${LEVELS.length}</span><label>Levels started</label></div>
      <div class="overview-card"><span>${totalBeaten}/${LEVELS.length * TIMER_MODES.length}</span><label>Timers beaten ✓</label></div>
      <div class="overview-card"><span>${totalStars}/${LEVELS.length * 3}</span><label>Total stars</label></div>
      <div class="overview-card"><span>${totalAttempts}</span><label>Attempts logged</label></div>
      <div class="overview-card"><span>${avgAccuracy}%</span><label>Avg accuracy</label></div>
    `;

    // table head: Level | mode1 | mode2 | mode3
    headRow.innerHTML = "<th>Level</th>" + TIMER_MODES.map((m) => `<th>${m.label}</th>`).join("");

    body.innerHTML = "";
    LEVELS.forEach((lvl) => {
      const tr = document.createElement("tr");
      let html = `<td><strong>${lvl.id}</strong> — ${lvl.name}</td>`;
      TIMER_MODES.forEach((mode) => {
        const rec = progress[progressKey(lvl.id, mode.id)];
        if (rec) {
          const badge = rec.beaten ? '<span class="cell-beaten" title="Beaten">✓</span> ' : "";
          html += `<td>${badge}<span class="cell-stars">${"★".repeat(rec.stars)}${"☆".repeat(3 - rec.stars)}</span><br><small>${rec.correct}/${rec.attempted} · ${rec.accuracy}%</small></td>`;
        } else {
          html += `<td class="cell-empty">—</td>`;
        }
      });
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
