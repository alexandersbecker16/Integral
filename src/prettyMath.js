const SUPER = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "n": "ⁿ",
  "i": "ⁱ",
};

const SUB = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
};

const SUPER_REV = Object.fromEntries(Object.entries(SUPER).map(([k, v]) => [v, k]));
const SUB_REV = Object.fromEntries(Object.entries(SUB).map(([k, v]) => [v, k]));

function digitsToSuper(digits) {
  return [...String(digits)].map((c) => SUPER[c] ?? c).join("");
}

function digitsToSub(digits) {
  return [...String(digits)].map((c) => SUB[c] ?? c).join("");
}

function superToAscii(run) {
  return [...run].map((c) => SUPER_REV[c] ?? c).join("");
}

function subToAscii(run) {
  return [...run].map((c) => SUB_REV[c] ?? c).join("");
}

/** Display form: x^2 → x², x^-2 → x⁻², log10( → log₁₀(, sqrt( → √( */
export function toPretty(expr) {
  if (!expr) return expr;

  let s = expr;

  // sqrt( → √(
  s = s.replace(/\bsqrt\s*\(/gi, "√(");

  // log10( / log2( / logN( → log with subscript base
  s = s.replace(/\blog(\d+)\s*\(/g, (_, n) => `log${digitsToSub(n)}(`);

  // log(expr, base) → log_base(expr) for numeric bases
  s = s.replace(/\blog\s*\(\s*([^,()]+)\s*,\s*(\d+)\s*\)/g, (_, inner, base) => {
    return `log${digitsToSub(base)}(${inner.trim()})`;
  });

  // Negative / positive exponents → superscripts
  // ^(-2) / ^(+3) / (-2) style first, then bare ^-2 / ^2
  s = s.replace(/\^\((-?\d+)\)/g, (_, n) => {
    if (n.startsWith("-")) return SUPER["-"] + digitsToSuper(n.slice(1));
    if (n.startsWith("+")) return SUPER["+"] + digitsToSuper(n.slice(1));
    return digitsToSuper(n);
  });
  s = s.replace(/\^-(\d+)/g, (_, d) => SUPER["-"] + digitsToSuper(d));
  s = s.replace(/\^\+(\d+)/g, (_, d) => SUPER["+"] + digitsToSuper(d));
  s = s.replace(/\^(\d+)/g, (_, d) => digitsToSuper(d));

  // ^n / ^i
  s = s.replace(/\^([ni])/g, (_, c) => SUPER[c]);

  return s;
}

/** Rewrite logN(args) → log(args, N) so any numeric base works in mathjs */
function rewriteLogBaseCalls(s) {
  const re = /\blog(\d+)\s*\(/g;
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    const base = m[1];
    const openIdx = m.index + m[0].length - 1;
    let depth = 0;
    let i = openIdx;
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (i >= s.length) break;
    const inner = s.slice(openIdx + 1, i);
    out += s.slice(last, m.index) + `log(${inner}, ${base})`;
    last = i + 1;
    re.lastIndex = last;
  }
  return out + s.slice(last);
}

/** Parser form for mathjs */
export function toAscii(expr) {
  if (!expr) return expr;

  let s = expr;

  // √( → sqrt(
  s = s.replace(/√\s*\(/g, "sqrt(");
  s = s.replace(/√\s*([A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?)/g, "sqrt($1)");

  // log₁₀( → log10(  (then rewritten to log(..., 10) below)
  s = s.replace(/log([₀₁₂₃₄₅₆₇₈₉]+)\s*\(/g, (_, sub) => `log${subToAscii(sub)}(`);

  // log5(x) / log10(x) / log2(sin(x)) → log(…, base)
  s = rewriteLogBaseCalls(s);

  // Superscript runs → ^digits / ^(-digits) / ^(…)
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿⁱ]+/g, (run) => {
    const mapped = superToAscii(run);
    if (/^\d+$/.test(mapped)) return `^${mapped}`;
    if (/^-\d+$/.test(mapped)) return `^(${mapped})`;
    if (/^\+\d+$/.test(mapped)) return `^(${mapped})`;
    return `^(${mapped})`;
  });

  return s;
}

/** Beautify an input element in place, keeping the caret in a sensible spot */
export function beautifyField(input) {
  const old = input.value;
  const start = input.selectionStart ?? old.length;
  const end = input.selectionEnd ?? start;
  const pretty = toPretty(old);
  if (pretty === old) return false;

  const newStart = toPretty(old.slice(0, start)).length;
  const newEnd = toPretty(old.slice(0, end)).length;
  input.value = pretty;
  input.setSelectionRange(newStart, newEnd);
  return true;
}
