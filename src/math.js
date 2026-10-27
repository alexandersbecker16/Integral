import { create, all } from "mathjs";
import { toAscii } from "./prettyMath.js";

const math = create(all, {});

// Student-friendly log aliases (mathjs uses log for ln by default)
math.import(
  {
    ln: (x) => math.log(x),
    loge: (x) => math.log(x),
    lg: (x) => math.log10(x),
    lb: (x) => math.log2(x),
  },
  { override: true }
);

function toReal(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  // mathjs Complex / BigNumber / etc. → not plotted
  return NaN;
}

export function compile1D(expr) {
  const node = math.parse(toAscii(expr));
  const compiled = node.compile();
  return (x) => toReal(compiled.evaluate({ x, X: x }));
}

export function compile2D(expr) {
  const node = math.parse(toAscii(expr));
  const compiled = node.compile();
  return (x, y) => toReal(compiled.evaluate({ x, y, X: x, Y: y }));
}

/** Composite Simpson's rule for ∫_a^b f(x) dx (skips non-real samples) */
export function integrate1D(f, a, b, n = 256) {
  if (a === b) return 0;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const sign = a <= b ? 1 : -1;
  if (n % 2 === 1) n += 1;
  const h = (hi - lo) / n;

  const sample = (x) => {
    const y = f(x);
    return Number.isFinite(y) ? y : 0;
  };

  let sum = sample(lo) + sample(hi);
  for (let i = 1; i < n; i++) {
    const y = sample(lo + i * h);
    sum += i % 2 === 0 ? 2 * y : 4 * y;
  }
  const result = sign * (h / 3) * sum;
  return Number.isFinite(result) ? result : 0;
}

/** Double integral over rectangle using nested Simpson */
export function integrate2D(f, x0, x1, y0, y1, nx = 48, ny = 48) {
  if (x0 === x1 || y0 === y1) return 0;
  const xa = Math.min(x0, x1);
  const xb = Math.max(x0, x1);
  const ya = Math.min(y0, y1);
  const yb = Math.max(y0, y1);
  const sx = x0 <= x1 ? 1 : -1;
  const sy = y0 <= y1 ? 1 : -1;

  if (nx % 2 === 1) nx += 1;
  if (ny % 2 === 1) ny += 1;

  const hx = (xb - xa) / nx;
  const hy = (yb - ya) / ny;

  let total = 0;
  for (let i = 0; i <= nx; i++) {
    const x = xa + i * hx;
    const wx = i === 0 || i === nx ? 1 : i % 2 === 0 ? 2 : 4;
    let row = 0;
    for (let j = 0; j <= ny; j++) {
      const y = ya + j * hy;
      const wy = j === 0 || j === ny ? 1 : j % 2 === 0 ? 2 : 4;
      const z = f(x, y);
      if (Number.isFinite(z)) row += wy * z;
      // non-real (e.g. log of negative) contributes 0
    }
    total += wx * row;
  }

  return sx * sy * ((hx * hy) / 9) * total;
}

export function formatNumber(n) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e6)) return n.toExponential(4);
  const s = n.toFixed(4);
  return s.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

export function formatBound(n) {
  if (!Number.isFinite(n)) return "?";
  return Number(n.toFixed(3)).toString();
}
