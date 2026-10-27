import { compile1D, integrate1D, formatNumber, formatBound } from "./math.js";

export class View2D {
  constructor(canvas, onUpdate) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onUpdate = onUpdate;

    this.expr = "sin(x) + 1.5";
    this.fn = compile1D(this.expr);
    this.valid = true;

    this.centerX = 0.5;
    this.centerY = 1.2;
    this.scale = 70; // px per unit

    this.a = -1;
    this.b = 2;

    this.drag = null; // { type: 'pan'|'a'|'b', ox, oy, a0, b0, cx, cy }
    this.hover = null;

    this._boundMove = (e) => this.onPointerMove(e);
    this._boundUp = (e) => this.onPointerUp(e);

    canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.onHover(e));
    canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener("lostpointercapture", () => this.endDrag());
  }

  setEquation(expr) {
    try {
      this.fn = compile1D(expr);
      this.expr = expr;
      this.valid = true;
    } catch {
      this.valid = false;
    }
    this.draw();
    this.emit();
  }

  setBounds(a, b, { center = true } = {}) {
    this.a = a;
    this.b = b;
    if (center) {
      this.centerX = (a + b) / 2;
      const mid = this.safeY((a + b) / 2);
      this.centerY = Number.isFinite(mid) ? mid * 0.55 + 0.4 : this.centerY;
    }
    this.draw();
    this.emit();
  }

  worldFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    return this.worldFromPixel(px, py);
  }

  worldFromPixel(px, py) {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const x = this.centerX + (px - w / 2) / this.scale;
    const y = this.centerY - (py - h / 2) / this.scale;
    return { x, y, px, py };
  }

  pixelFromWorld(x, y) {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return {
      px: w / 2 + (x - this.centerX) * this.scale,
      py: h / 2 - (y - this.centerY) * this.scale,
    };
  }

  handleHits(px, py) {
    const ha = this.pixelFromWorld(this.a, this.safeY(this.a));
    const hb = this.pixelFromWorld(this.b, this.safeY(this.b));
    const r = 14;
    if ((px - ha.px) ** 2 + (py - ha.py) ** 2 <= r * r) return "a";
    if ((px - hb.px) ** 2 + (py - hb.py) ** 2 <= r * r) return "b";

    // Also allow dragging on the vertical guide near the axis
    const axisA = this.pixelFromWorld(this.a, 0);
    const axisB = this.pixelFromWorld(this.b, 0);
    if (Math.abs(px - axisA.px) < 10 && py > Math.min(ha.py, axisA.py) - 8 && py < Math.max(ha.py, axisA.py) + 8)
      return "a";
    if (Math.abs(px - axisB.px) < 10 && py > Math.min(hb.py, axisB.py) - 8 && py < Math.max(hb.py, axisB.py) + 8)
      return "b";
    return null;
  }

  safeY(x) {
    const y = this.fn(x);
    return Number.isFinite(y) ? y : 0;
  }

  onPointerDown(e) {
    const { x, y, px, py } = this.worldFromEvent(e);
    const hit = this.handleHits(px, py);
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.classList.add("dragging");

    if (hit) {
      this.drag = { type: hit, startX: x };
    } else {
      this.drag = {
        type: "pan",
        ox: e.clientX,
        oy: e.clientY,
        cx: this.centerX,
        cy: this.centerY,
      };
    }

    window.addEventListener("pointermove", this._boundMove);
    window.addEventListener("pointerup", this._boundUp);
  }

  onPointerMove(e) {
    if (!this.drag) return;
    if (this.drag.type === "pan") {
      const dx = (e.clientX - this.drag.ox) / this.scale;
      const dy = (e.clientY - this.drag.oy) / this.scale;
      this.centerX = this.drag.cx - dx;
      this.centerY = this.drag.cy + dy;
    } else {
      const { x } = this.worldFromEvent(e);
      if (this.drag.type === "a") this.a = x;
      if (this.drag.type === "b") this.b = x;
    }
    this.draw();
    this.emit();
  }

  onPointerUp() {
    this.endDrag();
  }

  endDrag() {
    this.drag = null;
    this.canvas.classList.remove("dragging");
    window.removeEventListener("pointermove", this._boundMove);
    window.removeEventListener("pointerup", this._boundUp);
  }

  onHover(e) {
    if (this.drag) return;
    const { px, py } = this.worldFromEvent(e);
    const hit = this.handleHits(px, py);
    this.hover = hit;
    this.canvas.style.cursor = hit ? "ew-resize" : "grab";
  }

  onWheel(e) {
    e.preventDefault();
    const { x, y } = this.worldFromEvent(e);
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const next = Math.min(280, Math.max(28, this.scale * factor));
    const ratio = next / this.scale;
    // Zoom toward cursor
    this.centerX = x - (x - this.centerX) / ratio;
    this.centerY = y - (y - this.centerY) / ratio;
    this.scale = next;
    this.draw();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  emit() {
    const value = this.valid ? integrate1D(this.fn, this.a, this.b) : NaN;
    this.onUpdate?.({
      value,
      boundsText: `a = ${formatBound(this.a)} · b = ${formatBound(this.b)}`,
      hint: "Drag coral handles · pan any direction (incl. below) · scroll to zoom",
      symbol: "∫",
      formatted: formatNumber(value),
    });
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    this.drawGrid(ctx, w, h);
    this.drawAxes(ctx, w, h);

    if (this.valid) {
      this.drawArea(ctx, w, h);
      this.drawCurve(ctx, w, h);
      this.drawBounds(ctx);
    } else {
      ctx.fillStyle = "rgba(232, 93, 76, 0.9)";
      ctx.font = "500 14px Sora, sans-serif";
      ctx.fillText("Could not parse equation", 24, 40);
    }
  }

  drawGrid(ctx, w, h) {
    const step = this.niceStep();
    const left = this.worldFromPixel(0, 0).x;
    const right = this.worldFromPixel(w, 0).x;
    const top = this.worldFromPixel(0, 0).y;
    const bottom = this.worldFromPixel(0, h).y;

    ctx.strokeStyle = "rgba(20, 33, 43, 0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(left / step) * step; x <= right; x += step) {
      const { px } = this.pixelFromWorld(x, 0);
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
    }
    for (let y = Math.floor(bottom / step) * step; y <= top; y += step) {
      const { py } = this.pixelFromWorld(0, y);
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
    }
    ctx.stroke();
  }

  niceStep() {
    const raw = 80 / this.scale;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const n = raw / pow;
    if (n < 1.5) return pow;
    if (n < 3.5) return 2 * pow;
    if (n < 7.5) return 5 * pow;
    return 10 * pow;
  }

  drawAxes(ctx, w, h) {
    const origin = this.pixelFromWorld(0, 0);
    ctx.strokeStyle = "rgba(20, 33, 43, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, origin.py);
    ctx.lineTo(w, origin.py);
    ctx.moveTo(origin.px, 0);
    ctx.lineTo(origin.px, h);
    ctx.stroke();

    // Labels
    ctx.fillStyle = "rgba(20, 33, 43, 0.45)";
    ctx.font = "600 12px JetBrains Mono, monospace";
    ctx.fillText("x", w - 18, origin.py - 10);
    ctx.fillText("y", origin.px + 10, 18);
  }

  drawCurve(ctx, w) {
    const samples = Math.max(200, Math.floor(w));
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= samples; i++) {
      const px = (i / samples) * w;
      const { x } = this.worldFromPixel(px, 0);
      const y = this.fn(x);
      if (!Number.isFinite(y)) {
        started = false;
        continue;
      }
      const p = this.pixelFromWorld(x, y);
      if (!started) {
        ctx.moveTo(p.px, p.py);
        started = true;
      } else {
        ctx.lineTo(p.px, p.py);
      }
    }
    ctx.strokeStyle = "#0f7a72";
    ctx.lineWidth = 2.6;
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  drawArea(ctx) {
    const lo = Math.min(this.a, this.b);
    const hi = Math.max(this.a, this.b);
    const steps = Math.max(40, Math.floor((hi - lo) * this.scale));

    ctx.beginPath();
    const start = this.pixelFromWorld(lo, 0);
    ctx.moveTo(start.px, start.py);

    for (let i = 0; i <= steps; i++) {
      const x = lo + ((hi - lo) * i) / steps;
      const y = this.fn(x);
      const p = this.pixelFromWorld(x, Number.isFinite(y) ? y : 0);
      ctx.lineTo(p.px, p.py);
    }

    const end = this.pixelFromWorld(hi, 0);
    ctx.lineTo(end.px, end.py);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, 0, 0, this.canvas.clientHeight);
    grad.addColorStop(0, "rgba(232, 93, 76, 0.38)");
    grad.addColorStop(1, "rgba(232, 93, 76, 0.08)");
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = "rgba(232, 93, 76, 0.55)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  drawBounds(ctx) {
    this.drawBoundLine(ctx, this.a, this.hover === "a" || this.drag?.type === "a");
    this.drawBoundLine(ctx, this.b, this.hover === "b" || this.drag?.type === "b");
  }

  drawBoundLine(ctx, x, active) {
    const top = this.pixelFromWorld(x, this.safeY(x));
    const base = this.pixelFromWorld(x, 0);

    ctx.strokeStyle = active ? "#e85d4c" : "rgba(232, 93, 76, 0.75)";
    ctx.lineWidth = active ? 2.4 : 1.8;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(base.px, base.py);
    ctx.lineTo(top.px, top.py);
    ctx.stroke();
    ctx.setLineDash([]);

    // Base tick on x-axis
    ctx.beginPath();
    ctx.arc(base.px, base.py, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#e85d4c";
    ctx.fill();

    // Draggable handle on curve
    ctx.beginPath();
    ctx.arc(top.px, top.py, active ? 9 : 7.5, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#e85d4c";
    ctx.stroke();
  }

  activate() {
    this.resize();
    this.emit();
  }

  deactivate() {
    this.endDrag();
  }
}
