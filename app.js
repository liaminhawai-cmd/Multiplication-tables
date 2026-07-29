(() => {
  "use strict";

  // ---------- Level definitions (mirrors the original workbook's sheets) ----------
  // type "grid": a full rows × cols Excel-style multiplication grid, filled in as you answer.
  // type "squareList": a fixed n / n×n column, filled top to bottom.
  // type "randomList": an open-ended generated list (used for decimals), which grows as you answer.
  const LEVELS = [
    { id: "A", name: "1–5 × 1–5", desc: "Small numbers warm-up", type: "grid", rows: range(1, 5), cols: range(1, 5) },
    { id: "B", name: "Evens", desc: "2, 4, 6, 8, 10 tables", type: "grid", rows: evens(2, 10), cols: evens(2, 10) },
    { id: "C", name: "6–9 × 3–5", desc: "Mid-range mix", type: "grid", rows: range(6, 9), cols: range(3, 5) },
    { id: "D", name: "7s and 9s", desc: "Focus on 7 and 9 tables", type: "grid", rows: [7, 9], cols: range(1, 12) },
    { id: "E", name: "6–10 × 6–10", desc: "Higher numbers", type: "grid", rows: range(6, 10), cols: range(6, 10) },
    { id: "F", name: "Odd × Odd", desc: "Odd numbers only", type: "grid", rows: odds(1, 11), cols: odds(1, 11) },
    { id: "G", name: "Squares to 15", desc: "n × n up to 15", type: "squareList", values: range(1, 15) },
    { id: "FULL", name: "Full 12×12", desc: "Every table 1–12", type: "grid", rows: range(1, 12), cols: range(1, 12) },
    { id: "H", name: "Squares to 25", desc: "Extension: n × n up to 25", type: "squareList", values: range(1, 25) },
    { id: "I", name: "Squares to 30", desc: "Extension: n × n up to 30", type: "squareList", values: range(1, 30) },
    { id: "J", name: "Decimals ×1dp", desc: "e.g. 0.3 × 6", type: "randomList", gen: () => decimalTimesInt(1) },
    { id: "K", name: "Decimals ×2dp", desc: "e.g. 0.24 × 5", type: "randomList", gen: () => decimalTimesInt(2) },
    { id: "L", name: "Decimal × Decimal", desc: "e.g. 0.4 × 0.6", type: "randomList", gen: () => decimalTimesDecimal() },
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
  function evens(a, b) { return range(a, b).filter((n) => n % 2 === 0); }
  function odds(a, b) { return range(a, b).filter((n) => n % 2 !== 0); }
  function shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function decimalTimesInt(dp) {
    const frac = Math.floor(Math.random() * (dp === 1 ? 9 : 99)) + 1;
    const a = round2(parseFloat(`0.${dp === 1 ? frac : String(frac).padStart(2, "0")}`));
    const b = Math.floor(Math.random() * 9) + 2;
    return { a, b, answer: round2(a * b), display: `${a} × ${b}` };
  }
  function decimalTimesDecimal() {
    const a = round2((Math.floor(Math.random() * 9) + 1) / 10);
    const b = round2((Math.floor(Math.random() * 9) + 1) / 10);
    return { a, b, answer: round2(a * b), display: `${a} × ${b}` };
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
  let restartingAfterLeave = false;
  let bannerTimeout = null;

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
  const questionText = $("#question-text");
  const answerInput = $("#answer-input");
  const feedback = $("#feedback");
  const cheatBanner = $("#cheat-banner");
  const tableContainer = $("#table-container");
  const resultsTableContainer = $("#results-table-container");

  // ---------- Tabs ----------
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      $(`#tab-${btn.dataset.tab}`).classList.add("active");
      if (btn.dataset.tab === "report") renderReport();
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
  function cellId(r, c) { return `cell-${r}x${c}`; }

  function buildGridTable(level) {
    const table = document.createElement("table");
    table.className = "excel-table";
    const headRow = level.cols.map((c) => `<th>${c}</th>`).join("");
    table.innerHTML = `<thead><tr><th class="corner">×</th>${headRow}</tr></thead>`;
    const tbody = document.createElement("tbody");
    level.rows.forEach((r) => {
      const tr = document.createElement("tr");
      const cells = level.cols.map((c) => `<td id="${cellId(r, c)}" class="cell-pending"></td>`).join("");
      tr.innerHTML = `<th>${r}</th>${cells}`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function buildSquareListTable(level) {
    const table = document.createElement("table");
    table.className = "excel-table list-table";
    table.innerHTML = `<thead><tr><th>n</th><th>n × n</th></tr></thead>`;
    const tbody = document.createElement("tbody");
    level.values.forEach((n) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<th>${n}</th><td id="${cellId(n, n)}" class="cell-pending"></td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function buildRandomListTable() {
    const table = document.createElement("table");
    table.className = "excel-table list-table";
    table.innerHTML = `<thead><tr><th>#</th><th>Expression</th><th>Your answer</th></tr></thead><tbody id="random-list-body"></tbody>`;
    return table;
  }

  function buildSessionPairs(level) {
    if (level.type === "grid") {
      const pairs = [];
      level.rows.forEach((r) => level.cols.forEach((c) => pairs.push({ r, c })));
      return shuffle(pairs);
    }
    if (level.type === "squareList") {
      return level.values.map((n) => ({ r: n, c: n }));
    }
    return null; // randomList grows on the fly
  }

  function clearActiveCell() {
    const active = tableContainer.querySelector(".cell-active");
    if (active) active.classList.remove("cell-active");
  }

  function startSession(afterLeave) {
    if (!selectedLevel) return;
    requestFullscreenSafe();
    const level = selectedLevel;
    session = {
      level,
      mode: selectedMode,
      remaining: selectedMode.seconds,
      correct: 0,
      attempted: 0,
      streak: 0,
      bestStreak: 0,
      current: null,
      pairs: buildSessionPairs(level),
      pairIndex: 0,
      listCounter: 0,
    };
    hudLevel.textContent = `${level.id} · ${selectedMode.label}`;
    hudScore.textContent = "0";
    hudStreak.textContent = "0";
    timerBar.style.width = "100%";
    timerBar.style.background = "";

    tableContainer.innerHTML = "";
    const tableEl = level.type === "grid"
      ? buildGridTable(level)
      : level.type === "squareList"
        ? buildSquareListTable(level)
        : buildRandomListTable();
    tableContainer.appendChild(tableEl);

    showView("quiz");
    if (afterLeave) {
      cheatBanner.classList.remove("hidden");
      clearTimeout(bannerTimeout);
      bannerTimeout = setTimeout(() => cheatBanner.classList.add("hidden"), 4000);
    } else {
      cheatBanner.classList.add("hidden");
    }
    nextQuestion();
    answerInput.value = "";
    answerInput.focus();
    tick(); // immediate render
    timerHandle = setInterval(tick, 1000);
  }

  // ---------- Anti-cheat: leaving the tab/window/fullscreen resets the level ----------
  function handlePotentialCheat() {
    if (!session || restartingAfterLeave) return;
    restartingAfterLeave = true;
    const lvl = session.level;
    const mode = session.mode;
    clearInterval(timerHandle);
    timerHandle = null;
    session = null;
    selectedLevel = lvl;
    selectedMode = mode;
    setTimeout(() => {
      restartingAfterLeave = false;
      startSession(true);
    }, 30);
  }

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
      endSession(false);
      return;
    }
    session.remaining -= 1;
  }

  function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  function nextQuestion() {
    clearActiveCell();
    const level = session.level;

    if (level.type === "randomList") {
      const q = level.gen();
      session.listCounter += 1;
      session.current = { r: null, c: null, answer: q.answer, display: q.display, rowNum: session.listCounter };
      questionText.textContent = `${q.display} = `;
    } else {
      if (session.pairIndex >= session.pairs.length) {
        handleTableComplete();
        return;
      }
      const p = session.pairs[session.pairIndex];
      const answer = round2(p.r * p.c);
      session.current = { r: p.r, c: p.c, answer, display: `${p.r} × ${p.c}` };
      questionText.textContent = `${session.current.display} = `;
      const cellEl = document.getElementById(cellId(p.r, p.c));
      if (cellEl) cellEl.classList.add("cell-active");
    }

    feedback.textContent = "";
    feedback.className = "feedback";
    answerInput.value = "";
  }

  function handleTableComplete() {
    feedback.textContent = "Whole table filled in!";
    feedback.className = "feedback correct";
    endSession(false, true);
  }

  $("#answer-form").addEventListener("submit", (e) => {
    e.preventDefault();
    submitAnswer();
  });

  function submitAnswer() {
    if (!session || session.locked || answerInput.value === "") return;
    session.locked = true;
    const given = parseFloat(answerInput.value);
    const correct = Math.abs(given - session.current.answer) < 0.001;
    session.attempted += 1;
    if (correct) {
      session.correct += 1;
      session.streak += 1;
      session.bestStreak = Math.max(session.bestStreak, session.streak);
      feedback.textContent = "Correct!";
      feedback.className = "feedback correct";
    } else {
      session.streak = 0;
      feedback.textContent = `Answer: ${session.current.answer}`;
      feedback.className = "feedback wrong";
    }
    hudScore.textContent = String(session.correct);
    hudStreak.textContent = String(session.streak);

    if (session.level.type === "randomList") {
      appendRandomListRow(session.current, answerInput.value, correct);
    } else {
      const cellEl = document.getElementById(cellId(session.current.r, session.current.c));
      if (cellEl) {
        cellEl.textContent = answerInput.value;
        cellEl.classList.remove("cell-pending", "cell-active");
        cellEl.classList.add(correct ? "cell-correct" : "cell-wrong");
        if (!correct) cellEl.title = `Correct answer: ${session.current.answer}`;
      }
      session.pairIndex += 1;
    }

    setTimeout(() => {
      if (session) {
        session.locked = false;
        nextQuestion();
      }
      answerInput.focus();
    }, correct ? 250 : 650);
  }

  function appendRandomListRow(current, given, correct) {
    const body = document.getElementById("random-list-body");
    if (!body) return;
    const tr = document.createElement("tr");
    tr.className = correct ? "cell-correct" : "cell-wrong";
    const answerCell = correct ? given : `${given} <small>(≠ ${current.answer})</small>`;
    tr.innerHTML = `<td>${current.rowNum}</td><td>${current.display}</td><td>${answerCell}</td>`;
    body.appendChild(tr);
    const scrollHost = body.closest(".table-container");
    if (scrollHost) scrollHost.scrollTop = scrollHost.scrollHeight;
  }

  function endSession(quit, completed) {
    clearInterval(timerHandle);
    timerHandle = null;
    if (!session) { showView("select"); return; }

    const accuracy = session.attempted > 0 ? Math.round((session.correct / session.attempted) * 100) : 0;
    const stars = starsFor(session.correct, accuracy);
    const beaten = completed || isBeaten(session.correct, accuracy);

    if (!quit) {
      const key = progressKey(session.level.id, session.mode.id);
      const prior = progress[key];
      const record = {
        levelId: session.level.id,
        modeId: session.mode.id,
        correct: session.correct,
        attempted: session.attempted,
        accuracy,
        stars,
        beaten: beaten || !!prior?.beaten,
        bestStreak: session.bestStreak,
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
      saveProgress(progress);

      resultsTableContainer.innerHTML = "";
      resultsTableContainer.appendChild(tableContainer.firstElementChild.cloneNode(true));

      $("#results-title").textContent = completed ? "Whole table complete! 🎉" : beaten ? "Level beaten! 🎉" : "Time's up!";
      $("#result-correct").textContent = session.correct;
      $("#result-total").textContent = session.attempted;
      $("#result-accuracy").textContent = accuracy + "%";
      $("#result-best-streak").textContent = session.bestStreak;
      $("#result-stars").textContent = "★".repeat(stars) + "☆".repeat(3 - stars);
      $("#result-message").textContent = completed
        ? `You filled in the entire ${session.level.id} table with time to spare — ${session.mode.label} is ticked off in your Report.`
        : beaten
          ? `You beat ${session.level.id} at ${session.mode.label} — that mode is now ticked off in your Report.`
          : messageFor(stars);
      showView("results");
    } else {
      showView("select");
    }
    exitFullscreenSafe();
    session = null;
    renderLevelGrid();
  }

  function betterThan(a, b) {
    if (a.stars !== b.stars) return a.stars > b.stars;
    if (a.correct !== b.correct) return a.correct > b.correct;
    return a.accuracy > b.accuracy;
  }

  function messageFor(stars) {
    if (stars === 3) return "Outstanding! You beat this level with full marks.";
    if (stars === 2) return "Great work! Push for full accuracy to earn 3 stars.";
    if (stars === 1) return "Nice start — keep practicing to level up.";
    return "Keep going — try again to start scoring stars.";
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

  // ---------- Init ----------
  renderLevelGrid();
  renderTimerSelect();
  updateStartBtn();
  showView("select");
})();
