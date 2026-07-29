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

## Files

- `index.html` — page structure and tabs (Play / Report)
- `styles.css` — styling
- `app.js` — level/question generation, timer + scoring logic, progress tracking and report rendering
