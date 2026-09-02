/* ============================================================
   FRACTIONS HUB — CONTENT (data lane)
   ------------------------------------------------------------
   The engine knows nothing about fractions beyond what is here.
   This file owns:
     - fraction arithmetic helpers (FH.F)
     - the matrix: ROWS (operations + conversions) × LEVELS (columns)
     - one generator per cell that enumerates the WHOLE question
       space for that cell (the "bank"); the engine samples from it
     - the checker (value + lowest terms + required form)
     - the explanation for every item: the rule, pointed at the
       trigger (the denominators / the carry / the flip)
     - learning intention + success criteria per cell

   Columns get harder left to right and every row uses the same
   ladder:  1 same denominator (all numbers under 6)
            2 related denominators (one divides the other, to 10)
            3 unlike denominators (lowest common denominator, to 10)
            4 mixed numbers (and whole numbers)
            5 mixed numbers with unlike denominators
   The Convert row has its own ladder (improper→mixed, mixed→improper,
   simplify, equivalent, both ways with simplifying).

   Item shape (every generator returns these):
     { cell, row, level, op, A, B, ans, form, tags, sub?, blank?, target? }
     A, B   operands as improper fractions {n, d, mixed:bool}
            (d === 1 means a whole number; mixed means "show as a
            mixed number")
     ans    the reduced answer {n, d}
     form   "any"      — improper or mixed both fine (lowest terms)
            "mixed"    — must be a mixed number (or whole)
            "improper" — must be a single fraction, no whole part
            "number"   — a single whole number (equivalent-fraction blanks)
   ============================================================ */
(function () {
  const FH = (window.FH = window.FH || {});

  /* ---------------- fraction arithmetic ---------------- */
  const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
  const lcm = (a, b) => (a / gcd(a, b)) * b;
  const red = (n, d) => { const g = gcd(n, d) || 1; return { n: n / g, d: d / g }; };
  const F = {
    gcd, lcm, red,
    add: (x, y) => red(x.n * y.d + y.n * x.d, x.d * y.d),
    sub: (x, y) => red(x.n * y.d - y.n * x.d, x.d * y.d),
    mul: (x, y) => red(x.n * y.n, x.d * y.d),
    div: (x, y) => red(x.n * y.d, x.d * y.n),
    cmp: (x, y) => x.n * y.d - y.n * x.d,
    eq: (x, y) => x.n * y.d === y.n * x.d,
    whole: (f) => Math.floor(f.n / f.d),
    mixed: (f) => { const w = Math.floor(f.n / f.d); return { w, n: f.n - w * f.d, d: f.d }; },
    value: (f) => f.n / f.d,
  };
  FH.F = F;

  /* ---------------- display helpers (HTML) ---------------- */
  function fr(n, d) { return `<span class="fr"><span class="fn">${n}</span><span class="fd">${d}</span></span>`; }
  // A value shown as: whole number | proper/improper fraction | mixed number.
  function show(f, style) {
    style = style || (f.mixed ? "mixed" : "improper");
    if (f.d === 1) return `<span class="wh">${f.n}</span>`;
    if (style === "mixed" && f.n >= f.d) {
      const m = F.mixed(f);
      if (m.n === 0) return `<span class="wh">${m.w}</span>`;
      return `<span class="mx"><span class="wh">${m.w}</span>${fr(m.n, m.d)}</span>`;
    }
    return fr(f.n, f.d);
  }
  // Answers: show the reduced value, and both forms when it is over 1.
  function showAns(f) {
    const r = red(f.n, f.d);
    if (r.d === 1) return show(r);
    if (r.n > r.d) return `${show(r, "improper")} = ${show(r, "mixed")}`;
    return show(r);
  }
  function words(d) {
    const w = { 1: "wholes", 2: "halves", 3: "thirds", 4: "quarters", 5: "fifths", 6: "sixths", 7: "sevenths", 8: "eighths", 9: "ninths", 10: "tenths", 11: "elevenths", 12: "twelfths" };
    return w[d] || `${d}ths`;
  }
  FH.fr = fr; FH.show = show; FH.showAns = showAns; FH.words = words;

  /* ---------------- the matrix ---------------- */
  FH.ROWS = [
    { id: "add", name: "Add", op: "+", sym: "+" },
    { id: "sub", name: "Subtract", op: "−", sym: "−" },
    { id: "mul", name: "Multiply", op: "×", sym: "×" },
    { id: "div", name: "Divide", op: "÷", sym: "÷" },
    { id: "conv", name: "Convert", op: "→", sym: "→" },
  ];
  FH.LEVELS = [1, 2, 3, 4, 5];

  // Cell metadata: what the cell is, an example, and the goals shown in
  // Teach. `against` states the rule against the near-miss it has to beat.
  FH.CELLS = {
    "add-1": { name: "Same denominator", example: "2/5 + 1/5", li: "I can add fractions that have the same denominator.", sc: "I add the numerators and keep the denominator, then write the answer in lowest terms.", against: "Add the tops only — never the bottoms. 2/5 + 1/5 is 3/5, not 3/10: the pieces are still fifths." },
    "add-2": { name: "Related denominators", example: "1/2 + 1/4", li: "I can add fractions when one denominator divides the other.", sc: "I re-cut one fraction so both have the same denominator, then add the numerators.", against: "Halves and quarters are different sizes, so you cannot count them together. Re-cut the halves into quarters first; the amount does not change." },
    "add-3": { name: "Unlike denominators", example: "2/3 + 1/4", li: "I can add any two fractions.", sc: "I find the lowest common denominator, re-cut both fractions, add, then simplify.", against: "Neither denominator divides the other, so both fractions get re-cut. The lowest common denominator is the smallest number both go into — not always the product." },
    "add-4": { name: "Mixed numbers", example: "1 1/2 + 2 3/4", li: "I can add mixed numbers.", sc: "I add the wholes and the parts separately, and carry when the parts make more than one whole.", against: "Do not leave a fraction part that is bigger than 1. If the parts add to 5/4, that is one more whole and 1/4." },
    "add-5": { name: "Mixed, unlike denominators", example: "2 2/3 + 1 3/4", li: "I can add mixed numbers with any denominators.", sc: "I re-cut both parts to the lowest common denominator, add wholes and parts, carry, and simplify.", against: "Everything from the earlier columns at once: match the pieces first, then add, then tidy. Skipping the match is the usual error." },

    "sub-1": { name: "Same denominator", example: "4/5 − 1/5", li: "I can subtract fractions that have the same denominator.", sc: "I subtract the numerators and keep the denominator, then write the answer in lowest terms.", against: "Take away pieces, not the denominator: 4/5 − 1/5 is 3/5, not 3/0 or 3/5ths of something else." },
    "sub-2": { name: "Related denominators", example: "3/4 − 1/2", li: "I can subtract fractions when one denominator divides the other.", sc: "I re-cut one fraction so the pieces match, then take away.", against: "You cannot take a half out of quarters until the half is cut into quarters. Re-cut, then take away." },
    "sub-3": { name: "Unlike denominators", example: "2/3 − 1/4", li: "I can subtract any two fractions.", sc: "I find the lowest common denominator, re-cut both, subtract, then simplify.", against: "Re-cut both fractions to the lowest common denominator. Subtracting the tops before the pieces match gives a wrong size." },
    "sub-4": { name: "Mixed numbers (regrouping)", example: "3 1/4 − 1 3/4", li: "I can subtract from a mixed number or a whole number.", sc: "When the fraction part is too small to take away from, I break one whole into pieces first.", against: "3 1/4 − 1 3/4 is not 2 2/4 the wrong way round. 1/4 is smaller than 3/4, so break a whole: 3 1/4 = 2 5/4, then take away." },
    "sub-5": { name: "Mixed, unlike denominators", example: "2 5/6 − 1 3/4", li: "I can subtract mixed numbers with any denominators.", sc: "I re-cut both parts to the lowest common denominator, regroup if I need to, subtract, and simplify.", against: "Match the pieces, then check whether you need to break a whole, then subtract. Order matters." },

    "mul-1": { name: "Same denominator", example: "2/3 × 2/3", li: "I can multiply two fractions.", sc: "I multiply the numerators and multiply the denominators, then simplify.", against: "Unlike adding, here you DO multiply the bottoms. 2/3 × 2/3 is 4/9 — two thirds OF two thirds, and the pieces get smaller." },
    "mul-2": { name: "Related denominators", example: "2/3 × 5/6", li: "I can multiply fractions and keep the numbers small.", sc: "I cancel a common factor across top and bottom before multiplying, then multiply and simplify.", against: "Cancelling is dividing a top and a bottom by the same number. You can never cancel two tops or two bottoms." },
    "mul-3": { name: "Unlike denominators", example: "2/5 × 3/7", li: "I can multiply any two fractions.", sc: "I multiply tops, multiply bottoms, then write the product in lowest terms.", against: "There is no common denominator step in multiplying. Matching the pieces first is not wrong, but it is wasted work." },
    "mul-4": { name: "Mixed and whole numbers", example: "1 1/2 × 2/3", li: "I can multiply with mixed and whole numbers.", sc: "I change mixed and whole numbers to improper fractions before multiplying.", against: "1 1/2 × 2/3 is not 1 2/6. Multiply the whole number too: change 1 1/2 to 3/2 first." },
    "mul-5": { name: "Mixed × mixed", example: "1 2/3 × 2 1/4", li: "I can multiply two mixed numbers.", sc: "I change both to improper fractions, cancel where I can, multiply, and give the answer as a mixed number in lowest terms.", against: "Wholes × wholes and parts × parts misses two of the four products. Improper fractions first, always." },

    "div-1": { name: "Same denominator", example: "4/5 ÷ 2/5", li: "I can divide fractions that have the same denominator.", sc: "I ask how many groups of the second fraction fit in the first: same-size pieces, so I divide the numerators.", against: "4/5 ÷ 2/5 asks how many two-fifths fit in four-fifths. The answer is 2 — not 2/5, because the pieces cancel out." },
    "div-2": { name: "Related denominators", example: "3/4 ÷ 1/2", li: "I can divide fractions when one denominator divides the other.", sc: "I make the pieces the same size and count how many fit — or keep the first, flip the second, and multiply.", against: "Dividing by a half gives MORE, not less: 3/4 ÷ 1/2 = 1 1/2. If your answer is smaller than 3/4, you multiplied." },
    "div-3": { name: "Unlike denominators", example: "2/3 ÷ 3/4", li: "I can divide any two fractions.", sc: "I keep the first fraction, flip the second, multiply, then simplify.", against: "Flip only the second fraction. Flipping the first, or both, gives the wrong answer." },
    "div-4": { name: "Mixed and whole numbers", example: "1 1/2 ÷ 1/4", li: "I can divide with mixed and whole numbers.", sc: "I change mixed and whole numbers to improper fractions, then keep, flip, multiply.", against: "3 ÷ 2/3 asks how many two-thirds fit in 3 wholes: 4 1/2 of them. A whole number is a fraction over 1." },
    "div-5": { name: "Mixed ÷ mixed", example: "2 1/2 ÷ 1 1/4", li: "I can divide two mixed numbers.", sc: "I change both to improper fractions, keep, flip, multiply, and simplify.", against: "Change BOTH to improper fractions before flipping. Flipping a mixed number in place is not a fraction at all." },

    "conv-1": { name: "Improper → mixed", example: "7/5 → 1 2/5", li: "I can write an improper fraction as a mixed number.", sc: "I divide the numerator by the denominator: the quotient is the whole, the remainder stays over the same denominator.", against: "7/5 is not 1 2/7. The denominator never changes: seven fifths is one whole (five fifths) and two fifths left over." },
    "conv-2": { name: "Mixed → improper", example: "1 2/5 → 7/5", li: "I can write a mixed number as an improper fraction.", sc: "I multiply the whole by the denominator and add the numerator; the denominator stays the same.", against: "1 2/5 is not 3/5. The whole is worth five fifths, so it is 5 + 2 = 7 fifths." },
    "conv-3": { name: "Simplify", example: "6/8 → 3/4", li: "I can write a fraction in lowest terms.", sc: "I divide top and bottom by their highest common factor.", against: "Dividing top and bottom by the same number keeps the amount. Dividing only the top changes it. 6/8 = 3/4, not 3/8." },
    "conv-4": { name: "Equivalent fractions", example: "3/4 = ?/12", li: "I can find a missing number in an equivalent fraction.", sc: "Whatever the bottom was multiplied or divided by, I do the same to the top.", against: "3/4 = ?/12: the bottom was multiplied by 3, so the top is too — 9, not 11 (adding 8 to both is the classic error)." },
    "conv-5": { name: "Both ways, simplified", example: "18/12 → 1 1/2", li: "I can convert either way and simplify the result.", sc: "I convert, then check the fraction part is in lowest terms.", against: "18/12 = 1 6/12 is only half done. The leftover 6/12 simplifies to 1/2." },
  };

  /* ---------------- generators ---------------- */
  const range = (a, b) => { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; };
  const opnd = (n, d, mixed) => ({ n, d, mixed: !!mixed });
  // operands are always in lowest terms — only the Simplify cells show 2/4
  const proper = (d) => range(1, d - 1).filter((n) => gcd(n, d) === 1).map((n) => opnd(n, d));
  const properAny = (d) => range(1, d - 1).map((n) => opnd(n, d));
  // mixed operands with whole w and a proper part n/d, stored improper
  const mixedOpnd = (w, n, d) => opnd(w * d + n, d, true);

  // Column 1 cap: "numerator and denominator below 6". The space is small
  // (Subtract has 8 questions in lowest terms); raise this to widen it.
  const COL1_MAX = 5;
  function pairsSame(max) { return range(2, max).map((d) => [d, d]); }
  function pairsRelated(max) {
    const out = [];
    for (let b = 2; b <= max; b++) for (let d = 2; d <= max; d++) if (b !== d && (d % b === 0 || b % d === 0)) out.push([b, d]);
    return out;
  }
  function pairsUnlike(max, lcmCap) {
    const out = [];
    for (let b = 2; b <= max; b++) for (let d = 2; d <= max; d++) if (b !== d && d % b !== 0 && b % d !== 0 && lcm(b, d) <= lcmCap) out.push([b, d]);
    return out;
  }
  const isProper = (f) => f.n < f.d;

  function mk(cell, op, A, B, ans, form, tags, extra) {
    const [row, lvl] = cell.split("-");
    return Object.assign({ cell, row, level: +lvl, op, A, B, ans, form: form || "any", tags: tags || [] }, extra || {});
  }
  function opTags(A, B, ans) {
    const t = [];
    if (A.d === B.d) t.push("same-denominator");
    else if (A.d % B.d === 0 || B.d % A.d === 0) t.push("related-denominators");
    else t.push("unlike-denominators");
    if (A.mixed || B.mixed) t.push("mixed");
    if (A.d === 1 || B.d === 1) t.push("whole-number");
    if (ans.n > ans.d && ans.d !== 1) t.push("answer-over-1");
    return t;
  }

  // ---- ADD ----
  function genAdd(level) {
    const out = [];
    const push = (cell, A, B) => { const ans = F.add(A, B); out.push(mk(cell, "+", A, B, ans, "any", opTags(A, B, ans))); };
    if (level === 1) {
      pairsSame(COL1_MAX).forEach(([b]) => proper(b).forEach((A) => proper(b).forEach((B) => { if (A.n + B.n <= b) push("add-1", A, B); })));
    } else if (level === 2) {
      pairsRelated(10).forEach(([b, d]) => proper(b).forEach((A) => proper(d).forEach((B) => { if (F.cmp(F.add(A, B), { n: 1, d: 1 }) <= 0) push("add-2", A, B); })));
    } else if (level === 3) {
      pairsUnlike(10, 30).forEach(([b, d]) => proper(b).forEach((A) => proper(d).forEach((B) => push("add-3", A, B))));
    } else if (level === 4) {
      // mixed + fraction, mixed + mixed; denominators same or related, to 8
      const pairs = pairsSame(8).concat(pairsRelated(8));
      pairs.forEach(([b, d]) => range(1, 3).forEach((w) => proper(b).forEach((a) => {
        const A = mixedOpnd(w, a.n, b);
        proper(d).forEach((c) => {
          push("add-4", A, c);
          range(1, 3).forEach((w2) => { if (w + w2 <= 5) push("add-4", A, mixedOpnd(w2, c.n, d)); });
        });
      })));
    } else {
      pairsUnlike(8, 24).forEach(([b, d]) => range(1, 4).forEach((w) => proper(b).forEach((a) => range(1, 4).forEach((w2) => proper(d).forEach((c) => {
        if (w + w2 <= 6) push("add-5", mixedOpnd(w, a.n, b), mixedOpnd(w2, c.n, d));
      })))));
    }
    return out;
  }

  // ---- SUBTRACT ----
  function genSub(level) {
    const out = [];
    const push = (cell, A, B, extraTags) => {
      if (F.cmp(A, B) <= 0) return;
      const ans = F.sub(A, B);
      out.push(mk(cell, "−", A, B, ans, "any", opTags(A, B, ans).concat(extraTags || [])));
    };
    if (level === 1) {
      pairsSame(COL1_MAX).forEach(([b]) => proper(b).forEach((A) => proper(b).forEach((B) => push("sub-1", A, B))));
    } else if (level === 2) {
      pairsRelated(10).forEach(([b, d]) => proper(b).forEach((A) => proper(d).forEach((B) => push("sub-2", A, B))));
    } else if (level === 3) {
      pairsUnlike(10, 30).forEach(([b, d]) => proper(b).forEach((A) => proper(d).forEach((B) => push("sub-3", A, B))));
    } else if (level === 4) {
      const pairs = pairsSame(8).concat(pairsRelated(8));
      pairs.forEach(([b, d]) => range(1, 4).forEach((w) => proper(b).forEach((a) => {
        const A = mixedOpnd(w, a.n, b);
        proper(d).forEach((c) => {
          const regroup = F.cmp(a, c) < 0 ? ["regroup"] : [];
          push("sub-4", A, c, regroup);
          range(1, 3).forEach((w2) => push("sub-4", A, mixedOpnd(w2, c.n, d), regroup));
        });
      })));
      // whole number minus a fraction (always regroups)
      range(1, 4).forEach((w) => range(2, 8).forEach((d) => proper(d).forEach((c) => push("sub-4", opnd(w, 1), c, ["regroup", "from-whole"]))));
    } else {
      pairsUnlike(8, 24).forEach(([b, d]) => range(1, 4).forEach((w) => proper(b).forEach((a) => range(1, 3).forEach((w2) => proper(d).forEach((c) => {
        push("sub-5", mixedOpnd(w, a.n, b), mixedOpnd(w2, c.n, d), F.cmp(a, c) < 0 ? ["regroup"] : []);
      })))));
    }
    return out;
  }

  // ---- MULTIPLY ----
  function genMul(level) {
    const out = [];
    const push = (cell, A, B, extraTags) => {
      const ans = F.mul(A, B);
      if (ans.d > 36) return; // keep the mixed-number cells drillable in the head
      const t = opTags(A, B, ans).concat(extraTags || []);
      if (gcd(A.n * B.n, A.d * B.d) > 1) t.push("cancels");
      out.push(mk(cell, "×", A, B, ans, "any", t));
    };
    if (level === 1) {
      pairsSame(COL1_MAX).forEach(([b]) => proper(b).forEach((A) => proper(b).forEach((B) => push("mul-1", A, B))));
    } else if (level === 2) {
      pairsRelated(10).forEach(([b, d]) => proper(b).forEach((A) => proper(d).forEach((B) => push("mul-2", A, B))));
    } else if (level === 3) {
      pairsUnlike(10, 100).forEach(([b, d]) => { if (b * d <= 40) proper(b).forEach((A) => proper(d).forEach((B) => push("mul-3", A, B))); });
    } else if (level === 4) {
      range(2, 6).forEach((b) => range(1, 3).forEach((w) => proper(b).forEach((a) => {
        const A = mixedOpnd(w, a.n, b);
        range(2, 6).forEach((d) => proper(d).forEach((B) => { push("mul-4", A, B); push("mul-4", B, A); }));
      })));
      range(2, 6).forEach((k) => range(2, 8).forEach((d) => proper(d).forEach((B) => { push("mul-4", opnd(k, 1), B); push("mul-4", B, opnd(k, 1)); })));
    } else {
      range(2, 6).forEach((b) => range(2, 6).forEach((d) => { if (b * d <= 24) range(1, 3).forEach((w) => proper(b).forEach((a) => range(1, 3).forEach((w2) => proper(d).forEach((c) => {
        push("mul-5", mixedOpnd(w, a.n, b), mixedOpnd(w2, c.n, d));
      })))); }));
    }
    return out;
  }

  // ---- DIVIDE ----
  function genDiv(level) {
    const out = [];
    const push = (cell, A, B, extraTags) => {
      const ans = F.div(A, B);
      if (ans.d > 30 || ans.n > 60) return; // keep the mixed-number cells drillable in the head
      out.push(mk(cell, "÷", A, B, ans, "any", opTags(A, B, ans).concat(extraTags || [])));
    };
    if (level === 1) {
      pairsSame(COL1_MAX).forEach(([b]) => proper(b).forEach((A) => proper(b).forEach((B) => push("div-1", A, B))));
    } else if (level === 2) {
      pairsRelated(10).forEach(([b, d]) => proper(b).forEach((A) => proper(d).forEach((B) => push("div-2", A, B))));
    } else if (level === 3) {
      pairsUnlike(8, 100).forEach(([b, d]) => proper(b).forEach((A) => proper(d).forEach((B) => push("div-3", A, B))));
    } else if (level === 4) {
      range(2, 6).forEach((b) => range(1, 3).forEach((w) => proper(b).forEach((a) => {
        const A = mixedOpnd(w, a.n, b);
        range(2, 6).forEach((d) => proper(d).forEach((B) => { push("div-4", A, B); push("div-4", B, A); }));
      })));
      range(2, 6).forEach((k) => range(2, 8).forEach((d) => proper(d).forEach((B) => { push("div-4", opnd(k, 1), B); push("div-4", B, opnd(k, 1)); })));
    } else {
      range(2, 6).forEach((b) => range(2, 6).forEach((d) => range(1, 3).forEach((w) => proper(b).forEach((a) => range(1, 3).forEach((w2) => proper(d).forEach((c) => {
        push("div-5", mixedOpnd(w, a.n, b), mixedOpnd(w2, c.n, d));
      }))))));
    }
    return out;
  }

  // ---- CONVERT ----
  // sub: "toMixed" | "toImproper" | "simplify" | "equiv"
  function genConv(level) {
    const out = [];
    const conv = (cell, sub, A, ans, form, tags, extra) => out.push(mk(cell, "→", A, null, ans, form, [sub].concat(tags || []), Object.assign({ sub }, extra || {})));
    if (level === 1) {
      range(2, 5).forEach((d) => range(d + 1, 3 * d - 1).forEach((n) => { if (n % d !== 0 && gcd(n % d, d) === 1) conv("conv-1", "toMixed", opnd(n, d), red(n, d), "mixed"); }));
    } else if (level === 2) {
      range(2, 5).forEach((d) => range(1, 3).forEach((w) => proper(d).forEach((p) => { if (gcd(p.n, d) === 1) conv("conv-2", "toImproper", mixedOpnd(w, p.n, d), red(w * d + p.n, d), "improper"); })));
    } else if (level === 3) {
      range(4, 12).forEach((d) => properAny(d).forEach((p) => { if (gcd(p.n, d) > 1) conv("conv-3", "simplify", p, red(p.n, d), "any", ["hcf-" + gcd(p.n, d)]); }));
    } else if (level === 4) {
      // a/b (lowest terms) = ?/D or a/b = N/? with D up to 20; and the reverse (dividing down)
      range(2, 10).forEach((b) => proper(b).forEach((p) => { if (gcd(p.n, b) !== 1) return;
        range(2, 6).forEach((k) => { const D = b * k; if (D > 20) return;
          conv("conv-4", "equiv", p, opnd(p.n * k, 1), "number", ["scale-up", "blank-numerator"], { blank: "n", target: opnd(p.n * k, D) });
          conv("conv-4", "equiv", p, opnd(D, 1), "number", ["scale-up", "blank-denominator"], { blank: "d", target: opnd(p.n * k, D) });
          conv("conv-4", "equiv", opnd(p.n * k, D), opnd(p.n, 1), "number", ["scale-down", "blank-numerator"], { blank: "n", target: p });
          conv("conv-4", "equiv", opnd(p.n * k, D), opnd(b, 1), "number", ["scale-down", "blank-denominator"], { blank: "d", target: p });
        });
      }));
    } else {
      range(2, 12).forEach((d) => range(d + 1, 10 * d - 1).forEach((n) => { if (n % d !== 0 && n <= 60) conv("conv-5", "toMixed", opnd(n, d), red(n, d), "mixed", gcd(n, d) > 1 ? ["simplifies"] : []); }));
      range(2, 12).forEach((d) => range(1, 9).forEach((w) => properAny(d).forEach((p) => conv("conv-5", "toImproper", mixedOpnd(w, p.n, d), red(w * d + p.n, d), "improper", gcd(p.n, d) > 1 ? ["simplifies"] : []))));
    }
    return out;
  }

  const GEN = { add: genAdd, sub: genSub, mul: genMul, div: genDiv, conv: genConv };
  const bankCache = {};
  FH.bank = function (cellId) {
    if (!bankCache[cellId]) {
      const [row, lvl] = cellId.split("-");
      bankCache[cellId] = GEN[row](+lvl).map((it, i) => Object.assign(it, { uid: cellId + "#" + i }));
    }
    return bankCache[cellId];
  };
  FH.cellIds = function () { const o = []; FH.ROWS.forEach((r) => FH.LEVELS.forEach((l) => o.push(`${r.id}-${l}`))); return o; };
  FH.cellOf = (id) => Object.assign({ id, row: id.split("-")[0], level: +id.split("-")[1] }, FH.CELLS[id]);
  FH.rowOf = (id) => FH.ROWS.find((r) => r.id === id.split("-")[0]);

  /* ---------------- question text ---------------- */
  FH.questionHtml = function (it) {
    if (it.op !== "→") return `${show(it.A)} <span class="op">${it.op}</span> ${show(it.B)} <span class="op">=</span>`;
    if (it.sub === "equiv") {
      const t = it.target, blankN = it.blank === "n";
      const box = `<span class="blank">?</span>`;
      const rhs = `<span class="fr"><span class="fn">${blankN ? box : t.n}</span><span class="fd">${blankN ? t.d : box}</span></span>`;
      return `${show(it.A, "improper")} <span class="op">=</span> ${rhs}`;
    }
    return `${show(it.A)} <span class="op">→</span>`;
  };
  FH.promptFor = function (it) {
    if (it.op !== "→") return "";
    return { toMixed: "Write as a mixed number", toImproper: "Write as an improper fraction", simplify: "Write in lowest terms", equiv: "Find the missing number" }[it.sub];
  };
  // Plain-text version for logs and exports.
  function plain(f, style) {
    style = style || (f.mixed ? "mixed" : "improper");
    if (f.d === 1) return String(f.n);
    if (style === "mixed" && f.n >= f.d) { const m = F.mixed(f); return m.n === 0 ? String(m.w) : `${m.w} ${m.n}/${m.d}`; }
    return `${f.n}/${f.d}`;
  }
  FH.plain = plain;
  FH.questionText = function (it) {
    if (it.op !== "→") return `${plain(it.A)} ${it.op} ${plain(it.B)}`;
    if (it.sub === "equiv") { const t = it.target; return `${plain(it.A, "improper")} = ${it.blank === "n" ? "?" : t.n}/${it.blank === "d" ? "?" : t.d}`; }
    return `${plain(it.A)} → ${FH.promptFor(it).toLowerCase()}`;
  };
  FH.answerText = function (it) {
    if (it.form === "number") return String(it.ans.n);
    if (it.form === "improper") return plain(it.ans, "improper");
    if (it.form === "mixed") return plain(it.ans, "mixed");
    const r = it.ans; return r.n > r.d && r.d !== 1 ? `${plain(r, "improper")} = ${plain(r, "mixed")}` : plain(r);
  };

  /* ---------------- the checker ----------------
     response: { w, n, d } strings from the three boxes (any may be "").
     Judge, never prevent: every response is evaluated and explained. */
  FH.check = function (it, resp) {
    const w = (resp.w || "").trim(), n = (resp.n || "").trim(), d = (resp.d || "").trim();
    const hasW = w !== "", hasN = n !== "", hasD = d !== "";
    const W = hasW ? parseInt(w, 10) : 0, N = hasN ? parseInt(n, 10) : 0, D = hasD ? parseInt(d, 10) : 1;
    const expected = FH.answerText(it);
    const bad = (why) => ({ correct: false, expected, why });

    if (it.form === "number") {
      if (!hasN) return bad("Type a number in the box.");
      if (!/^\d+$/.test(n)) return bad("Whole numbers only here.");
      if (N === it.ans.n) return { correct: true, expected };
      return bad(`Not ${N}.`);
    }
    if (!hasW && !hasN && !hasD) return bad("Nothing typed.");
    if (hasD && !hasN) return bad("A fraction needs a numerator (top) as well as a denominator (bottom).");
    if ([w, n, d].some((s) => s !== "" && !/^\d+$/.test(s))) return bad("Use whole numbers in the boxes: whole, top, bottom.");
    if (hasD && D === 0) return bad("A denominator cannot be 0 — you cannot cut a cake into zero pieces.");
    if (hasN && !hasD && !hasW) { // a lone top number reads as a whole number
      return FH.check(it, { w: n, n: "", d: "" });
    }
    if (hasN && !hasD && hasW) return bad("A fraction needs both a numerator (top) and a denominator (bottom).");

    const given = red(W * D + N, D);
    const ok = F.eq(given, it.ans);
    if (!ok) return bad("");
    // right amount — now the form
    if (hasD && gcd(N, D) !== 1) {
      const g = gcd(N, D);
      return bad(`${hasW ? W + " " : ""}${N}/${D} is the right amount but not in lowest terms: divide top and bottom by ${g} to get ${hasW ? W + " " : ""}${N / g}/${D / g}.`);
    }
    if (hasW && hasD && N >= D) return bad(`${W} ${N}/${D} is the right amount, but the fraction part must be smaller than 1 — ${N}/${D} is at least one more whole. Write it as ${plain(it.ans, "mixed")}.`);
    if (it.form === "mixed" && !hasW && hasD && N > D) return bad(`${N}/${D} is the right amount, but this cell asks for a mixed number: ${plain(it.ans, "mixed")}.`);
    if (it.form === "improper" && hasW && hasD) return bad(`${W} ${N}/${D} is the right amount, but this cell asks for a single improper fraction: ${plain(it.ans, "improper")}.`);
    if (it.form === "improper" && hasW && !hasD && it.ans.d !== 1) return bad(`This cell asks for an improper fraction: ${plain(it.ans, "improper")}.`);
    return { correct: true, expected };
  };

  /* ---------------- explanations (the rule, pointed at the trigger) ---------------- */
  const toL = (f, L) => ({ n: f.n * (L / f.d), d: L });
  function partsOf(A) { const m = F.mixed(A); return { w: A.mixed || A.d === 1 ? m.w : 0, p: A.mixed || A.d === 1 ? { n: m.n, d: A.d } : { n: A.n, d: A.d } }; }
  function tidySteps(raw) {
    // raw {n,d}: say how it simplifies / converts, ending in the answer line
    const s = [];
    const r = red(raw.n, raw.d);
    if (r.d !== raw.d) s.push(`Lowest terms: divide top and bottom by ${gcd(raw.n, raw.d)} → ${fr(raw.n, raw.d)} = ${show(r, "improper")}.`);
    if (r.d === 1 && raw.d !== 1) s[s.length - 1] = `${fr(raw.n, raw.d)} is ${raw.n} ÷ ${raw.d} = ${r.n} whole${r.n === 1 ? "" : "s"}.`;
    if (r.n > r.d && r.d !== 1) { const m = F.mixed(r); s.push(`${show(r, "improper")} is more than 1: ${r.d} goes into ${r.n} ${m.w} time${m.w === 1 ? "" : "s"} with ${m.n} left → ${show(r, "mixed")}.`); }
    return s;
  }
  function stepsAddSub(it) {
    const isAdd = it.op === "+";
    const a = partsOf(it.A), b = partsOf(it.B);
    const s = [];
    const L = lcm(a.p.d, b.p.d);
    let pa = a.p, pb = b.p;
    let wholes = isAdd ? a.w + b.w : a.w - b.w;
    const anyMixed = it.A.mixed || it.B.mixed || it.A.d === 1 || it.B.d === 1;
    if (anyMixed) s.push(`Wholes and parts separately: wholes ${a.w} ${it.op} ${b.w}; parts ${a.p.n ? fr(a.p.n, a.p.d) : "0"} ${it.op} ${b.p.n ? fr(b.p.n, b.p.d) : "0"}.`);
    if (a.p.n && b.p.n) {
      if (a.p.d === b.p.d) s.push(`Same-size pieces (${words(a.p.d)}): ${isAdd ? "add" : "subtract"} the tops, keep the bottom.`);
      else if (L === a.p.d || L === b.p.d) {
        const small = a.p.d < b.p.d ? a.p : b.p; const k = L / small.d;
        s.push(`${words(a.p.d)} and ${words(b.p.d)} are different sizes. Cut each ${small.d === 2 ? "half" : words(small.d).replace(/s$/, "")} into ${k}: ${fr(small.n, small.d)} = ${fr(small.n * k, L)}.`);
      } else {
        s.push(`Different sizes. Lowest common denominator of ${a.p.d} and ${b.p.d} is ${L}: ${fr(a.p.n, a.p.d)} = ${fr(a.p.n * L / a.p.d, L)} and ${fr(b.p.n, b.p.d)} = ${fr(b.p.n * L / b.p.d, L)}.`);
      }
      pa = toL(a.p, L); pb = toL(b.p, L);
    } else if (a.p.n) { pa = a.p; pb = { n: 0, d: a.p.d }; }
    else if (b.p.n) { pb = b.p; pa = { n: 0, d: b.p.d }; }
    if (!isAdd && pa.n < pb.n) {
      // regroup
      s.push(`${fr(pa.n, pa.d)} is smaller than ${fr(pb.n, pb.d)}, so break one whole into ${words(pa.d)}: ${wholes + b.w} ${fr(pa.n, pa.d)} = ${wholes + b.w - 1} ${fr(pa.n + pa.d, pa.d)}.`);
      wholes -= 1; pa = { n: pa.n + pa.d, d: pa.d };
    }
    const partN = isAdd ? pa.n + pb.n : pa.n - pb.n;
    const partD = pa.d;
    if (pa.n && pb.n) s.push(`${fr(pa.n, partD)} ${it.op} ${fr(pb.n, partD)} = ${fr(partN, partD)}.`);
    let total = { n: wholes * partD + partN, d: partD };
    if (anyMixed) {
      if (isAdd && partN >= partD) { const m = F.mixed({ n: partN, d: partD }); s.push(`${fr(partN, partD)} is more than a whole: carry ${m.w} → wholes ${wholes} + ${m.w} = ${wholes + m.w}, parts ${fr(m.n, partD)}.`); }
      s.push(`Wholes ${F.whole(total)}, parts ${fr(total.n - F.whole(total) * partD, partD)}.`);
    }
    s.push(...tidySteps(total));
    s.push(`Answer: ${showAns(it.ans)}`);
    return s;
  }
  function improperNote(X) {
    if (X.d === 1) return `${X.n} = ${fr(X.n, 1)}`;
    const m = F.mixed(X);
    return `${show(X, "mixed")} = ${fr(X.n, X.d)} (${m.w} × ${X.d} + ${m.n} = ${X.n})`;
  }
  function stepsMul(it) {
    const s = [];
    const A = it.A, B = it.B;
    const conv = [];
    if (A.mixed || A.d === 1) conv.push(improperNote(A));
    if (B.mixed || B.d === 1) conv.push(improperNote(B));
    if (conv.length) s.push(`Improper fractions first: ${conv.join("; ")}.`);
    const g = gcd(A.n * B.n, A.d * B.d);
    s.push(`Multiply tops, multiply bottoms: ${fr(A.n, A.d)} × ${fr(B.n, B.d)} = ${fr(A.n * B.n, A.d * B.d)}.`);
    if (g > 1) {
      const gA = gcd(A.n, B.d), gB = gcd(B.n, A.d);
      if (gA > 1 || gB > 1) s.push(`(Shortcut: cancel across first — ${gA > 1 ? `${A.n} and ${B.d} share ${gA}` : ""}${gA > 1 && gB > 1 ? "; " : ""}${gB > 1 ? `${B.n} and ${A.d} share ${gB}` : ""}.)`);
    }
    s.push(...tidySteps({ n: A.n * B.n, d: A.d * B.d }));
    s.push(`Answer: ${showAns(it.ans)}`);
    return s;
  }
  function stepsDiv(it) {
    const s = [];
    const A = it.A, B = it.B;
    if (A.d === B.d && !A.mixed && !B.mixed && A.d !== 1) {
      s.push(`Same-size pieces: ${A.n} ${words(A.d)} ÷ ${B.n} ${words(B.d)} — how many groups of ${B.n} in ${A.n}? ${A.n} ÷ ${B.n} = ${fr(A.n, B.n)}.`);
      s.push(...tidySteps({ n: A.n, d: B.n }));
      s.push(`Answer: ${showAns(it.ans)}`);
      return s;
    }
    const conv = [];
    if (A.mixed || A.d === 1) conv.push(improperNote(A));
    if (B.mixed || B.d === 1) conv.push(improperNote(B));
    if (conv.length) s.push(`Improper fractions first: ${conv.join("; ")}.`);
    s.push(`Keep the first, flip the second, multiply: ${fr(A.n, A.d)} × ${fr(B.d, B.n)} = ${fr(A.n * B.d, A.d * B.n)}.`);
    if (!A.mixed && !B.mixed && A.d !== 1 && B.d !== 1 && (A.d % B.d === 0 || B.d % A.d === 0)) {
      const L = lcm(A.d, B.d);
      s.push(`(Or match the pieces: ${fr(A.n * L / A.d, L)} ÷ ${fr(B.n * L / B.d, L)} = ${A.n * L / A.d} ÷ ${B.n * L / B.d} — same answer.)`);
    }
    s.push(...tidySteps({ n: A.n * B.d, d: A.d * B.n }));
    s.push(`Answer: ${showAns(it.ans)}`);
    return s;
  }
  function stepsConv(it) {
    const s = [];
    const A = it.A;
    if (it.sub === "toMixed") {
      const w = Math.floor(A.n / A.d), r = A.n - w * A.d;
      s.push(`${A.n} ÷ ${A.d} = ${w} remainder ${r}: ${w} whole${w === 1 ? "" : "s"} (${w} × ${A.d} = ${w * A.d} ${words(A.d)}) and ${r} ${words(A.d)} left → ${w} ${fr(r, A.d)}.`);
      if (gcd(r, A.d) > 1) s.push(`The part ${fr(r, A.d)} simplifies: divide top and bottom by ${gcd(r, A.d)} → ${fr(r / gcd(r, A.d), A.d / gcd(r, A.d))}.`);
      s.push(`Answer: ${show(it.ans, "mixed")}`);
    } else if (it.sub === "toImproper") {
      const m = F.mixed(A);
      s.push(`Each whole is ${A.d} ${words(A.d)}: ${m.w} × ${A.d} = ${m.w * A.d}, plus the ${m.n} → ${m.w * A.d + m.n} ${words(A.d)} = ${fr(A.n, A.d)}.`);
      if (gcd(A.n, A.d) > 1) s.push(`Lowest terms: divide top and bottom by ${gcd(A.n, A.d)} → ${show(it.ans, "improper")}.`);
      s.push(`Answer: ${show(it.ans, "improper")}`);
    } else if (it.sub === "simplify") {
      const g = gcd(A.n, A.d);
      s.push(`Highest common factor of ${A.n} and ${A.d} is ${g}. Divide both by ${g}: ${fr(A.n, A.d)} = ${fr(A.n / g, A.d / g)}.`);
      s.push(`Answer: ${show(it.ans)}`);
    } else {
      const t = it.target;
      const up = t.d > A.d;
      const k = up ? t.d / A.d : A.d / t.d;
      if (it.blank === "n") s.push(`The bottom went from ${A.d} to ${t.d} (${up ? "×" : "÷"} ${k}), so the top does the same: ${A.n} ${up ? "×" : "÷"} ${k} = ${t.n}.`);
      else s.push(`The top went from ${A.n} to ${t.n} (${up ? "×" : "÷"} ${k}), so the bottom does the same: ${A.d} ${up ? "×" : "÷"} ${k} = ${t.d}.`);
      s.push(`Answer: ${it.ans.n} — ${fr(A.n, A.d)} = ${fr(t.n, t.d)}`);
    }
    return s;
  }
  const cap = (s) => s.replace(/^(<[^>]+>)?([a-z])/, (m, tag, ch) => (tag || "") + ch.toUpperCase());
  FH.explain = function (it) {
    let steps;
    if (it.op === "+" || it.op === "−") steps = stepsAddSub(it);
    else if (it.op === "×") steps = stepsMul(it);
    else if (it.op === "÷") steps = stepsDiv(it);
    else steps = stepsConv(it);
    return steps.map(cap);
  };
})();
