/* Sanity check for the fractions bank. Run: node fractions/validate.js
   - every cell has a bank, and it is big enough to drill from
   - every item's model answer grades correct against the checker
   - a wrong / unsimplified / wrong-form answer grades incorrect
   - every explanation renders without throwing
   Exit code 1 on any problem. */
global.window = {};
require("./data/cells.js");
const FH = window.FH;
const F = FH.F;
let problems = 0;
const say = (m) => { problems++; console.log("PROBLEM", m); };

function respFor(it) {
  const a = it.ans;
  if (it.form === "number") return { w: "", n: String(a.n), d: "" };
  if (a.d === 1) return { w: String(a.n), n: "", d: "" };
  if (it.form === "improper") return { w: "", n: String(a.n), d: a.d === 1 ? "" : String(a.d) };
  if (it.form === "mixed" || a.n > a.d) { const m = F.mixed(a); return m.n === 0 ? { w: String(m.w), n: "", d: "" } : { w: String(m.w), n: String(m.n), d: String(m.d) }; }
  return { w: "", n: String(a.n), d: a.d === 1 ? "" : String(a.d) };
}

const rows = [];
FH.cellIds().forEach((id) => {
  const bank = FH.bank(id);
  if (bank.length < 8) // column 1 is tiny by design (all numbers under 6)
    say(`${id}: bank only ${bank.length}`);
  const seen = new Set();
  bank.forEach((it) => {
    const key = FH.questionText(it);
    if (seen.has(key)) say(`${id}: duplicate ${key}`); seen.add(key);
    if (it.ans.n <= 0 || it.ans.d <= 0) say(`${id}: bad answer for ${key}`);
    const r = FH.check(it, respFor(it));
    if (!r.correct) say(`${id}: model answer rejected for ${key} -> ${r.why}`);
    // exploits: wrong value, unsimplified value, wrong form
    const wrong = FH.check(it, { w: "", n: String(it.ans.n + 1), d: it.form === "number" ? "" : String(it.ans.d) });
    if (wrong.correct) say(`${id}: off-by-one accepted for ${key}`);
    if (it.form !== "number" && it.ans.d !== 1) {
      const uns = FH.check(it, { w: "", n: String(it.ans.n * 2), d: String(it.ans.d * 2) });
      if (uns.correct) say(`${id}: unsimplified accepted for ${key}`);
    }
    if (it.form === "mixed") { const imp = FH.check(it, { w: "", n: String(it.ans.n), d: String(it.ans.d) }); if (imp.correct && it.ans.n > it.ans.d) say(`${id}: improper accepted in mixed cell ${key}`); }
    try { const ex = FH.explain(it); if (!ex.length || !/Answer/.test(ex[ex.length - 1])) say(`${id}: explanation odd for ${key}`); }
    catch (e) { say(`${id}: explain threw for ${key}: ${e.message}`); }
    FH.questionHtml(it);
  });
  rows.push(`${id.padEnd(7)} ${String(bank.length).padStart(5)}  e.g. ${FH.questionText(bank[Math.floor(bank.length / 2)])} = ${FH.answerText(bank[Math.floor(bank.length / 2)])}`);
});
console.log(rows.join("\n"));
console.log(problems ? `${problems} problem(s)` : "bank ok");
process.exit(problems ? 1 : 0);
