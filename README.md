# Times Tables Trainer

A hosted, browser-based multiplication tables practice game — no build step, no backend.

## Play it

Open `index.html` in a browser, or host the folder as a static site (e.g. GitHub Pages):

1. In the repo settings, enable **GitHub Pages** → Source: `main` branch, root folder.
2. Your game will be live at `https://<your-username>.github.io/<repo-name>/`.

## Features

- **13 levels** mirroring the original workbook sheets: small-number warm-ups, evens, odd × odd,
  focused 7s/9s, squares up to 15/25/30, the full 12×12 table, and decimal multiplication.
- **Timer modes** — race the clock at **3:00**, **1:30**, or **0:45** per level attempt.
- **Report tab** — a progress tracker showing your best star rating, accuracy, and correct/attempted
  counts for every level × timer combination, plus overall stats (levels started, total stars,
  attempts logged, average accuracy).
- Progress is saved locally in your browser (`localStorage`) — no account or server needed.

## Fractions Hub (`fractions/`)

A second app in the same folder, linked from the header: `fractions/index.html`. A 5 × 5 grid
(Add, Subtract, Multiply, Divide, Convert × five columns that get harder left to right) with two modes:

- **Teach** — pick one cell: learning goals, two worked examples stepped through as cakes, bars,
  area models and number lines, two examples the student builds by cutting, shading and dragging
  cake pieces, then three typed answers in a row (the picture appears only after answering).
- **Drill** — pick any cells: 5 typed questions per cell (4 from the cell, 1 from an earlier cell in
  the same row, never a harder one), a clock of 2:00 / 1:30 / 1:00 per cell scaled by the number
  of cells, and a colour per pace beaten. Wrong answers show the rule; the clock keeps running.
- **Report** — cells beaten per pace, most-missed cells, recent sessions, and copy/CSV/print
  exports for a teacher. Saved in `localStorage` (`fractionsHub.v1`).

Content (the matrix, the generators that enumerate each cell's question bank, the checker and the
explanations) lives in `fractions/data/cells.js`; run `node fractions/validate.js` after editing it.

## Files

- `index.html` — page structure and tabs (Play / Report)
- `styles.css` — styling
- `app.js` — level/question generation, timer + scoring logic, progress tracking and report rendering
- `fractions/` — the Fractions Hub: `index.html`, `styles.css`, `data/cells.js` (content), `models.js`
  (SVG cakes / bars / grids / number lines), `interactives.js` (cut-shade-drag builders), `engine.js`
  (teach cycle, drill, report), `validate.js` (bank check)
