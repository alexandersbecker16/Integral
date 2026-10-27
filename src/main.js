import { View2D } from "./view2d.js";
import { View3D } from "./view3d.js";
import { toPretty, beautifyField } from "./prettyMath.js";

const PRESETS_2D = [
  { label: "sin(x)+1.5", expr: "sin(x) + 1.5" },
  { label: "x²", expr: "x^2" },
  { label: "x⁻²", expr: "x^-2", bounds: [0.5, 3] },
  { label: "ln(x)", expr: "ln(x)", bounds: [0.5, 4] },
  { label: "log₁₀(x)", expr: "log10(x)", bounds: [0.5, 10] },
  { label: "log₂(x)", expr: "log(x, 2)", bounds: [0.5, 8] },
  { label: "exp(-x²)", expr: "exp(-x^2)" },
  { label: "√(x)", expr: "sqrt(x)", bounds: [0.25, 4] },
  { label: "cos(x)·x", expr: "cos(x) * x" },
];

const PRESETS_3D = [
  { label: "sin(x)cos(y)+1.2", expr: "sin(x) * cos(y) + 1.2" },
  { label: "x² + y²", expr: "x^2 + y^2" },
  { label: "ln(x²+y²+1)", expr: "ln(x^2 + y^2 + 1)", bounds: [-1.5, 1.5, -1.5, 1.5] },
  { label: "log₁₀(x+3)", expr: "log10(x + 3)", bounds: [-1, 2, -1.5, 1.5] },
  { label: "exp(-(x²+y²))", expr: "exp(-(x^2 + y^2))" },
  { label: "sin(√(x²+y²))", expr: "sin(sqrt(x^2 + y^2)) + 0.5" },
];

const canvas2d = document.getElementById("view-2d");
const canvas3d = document.getElementById("view-3d");
const equationInput = document.getElementById("equation");
const eqLabel = document.getElementById("eq-label");
const resultSymbol = document.getElementById("result-symbol");
const resultValue = document.getElementById("result-value");
const boundsText = document.getElementById("bounds-text");
const hintText = document.getElementById("hint-text");
const presetsEl = document.getElementById("presets");
const modeButtons = document.querySelectorAll(".mode-btn");

let mode = "2d";
const saved = {
  "2d": toPretty("sin(x) + 1.5"),
  "3d": toPretty("sin(x) * cos(y) + 1.2"),
};

function onUpdate(info) {
  resultSymbol.textContent = info.symbol;
  resultValue.textContent = info.formatted;
  boundsText.textContent = info.boundsText;
  hintText.textContent = info.hint;
}

const view2d = new View2D(canvas2d, onUpdate);
const view3d = new View3D(canvas3d, onUpdate);

function setEquationText(expr) {
  equationInput.value = toPretty(expr);
}

function renderPresets() {
  const list = mode === "2d" ? PRESETS_2D : PRESETS_3D;
  presetsEl.innerHTML = "";
  for (const p of list) {
    const btn = document.createElement("button");
    btn.className = "preset";
    btn.type = "button";
    btn.textContent = p.label;
    btn.addEventListener("click", () => {
      setEquationText(p.expr);
      saved[mode] = equationInput.value;
      applyEquation();
      if (p.bounds) {
        if (mode === "2d") view2d.setBounds(p.bounds[0], p.bounds[1]);
        else view3d.setBounds(p.bounds[0], p.bounds[1], p.bounds[2], p.bounds[3]);
      }
    });
    presetsEl.appendChild(btn);
  }
}

function applyEquation() {
  const expr = equationInput.value.trim();
  if (!expr) return;
  saved[mode] = equationInput.value;
  if (mode === "2d") view2d.setEquation(expr);
  else view3d.setEquation(expr);
}

function setMode(next) {
  if (next === mode) return;
  saved[mode] = equationInput.value.trim() || saved[mode];
  mode = next;

  modeButtons.forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });

  canvas2d.classList.toggle("active", mode === "2d");
  canvas3d.classList.toggle("active", mode === "3d");

  if (mode === "2d") {
    view3d.deactivate();
    eqLabel.textContent = "f(x) =";
    setEquationText(saved["2d"]);
    view2d.activate();
  } else {
    view2d.deactivate();
    eqLabel.textContent = "f(x, y) =";
    setEquationText(saved["3d"]);
    view3d.activate();
  }

  renderPresets();
  applyEquation();
}

let eqTimer = null;
equationInput.addEventListener("input", () => {
  beautifyField(equationInput);
  clearTimeout(eqTimer);
  eqTimer = setTimeout(applyEquation, 180);
});

equationInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    clearTimeout(eqTimer);
    beautifyField(equationInput);
    applyEquation();
  }
});

modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

window.addEventListener("resize", () => {
  if (mode === "2d") view2d.resize();
  else view3d.resize();
});

setEquationText(saved["2d"]);
renderPresets();
view2d.activate();
applyEquation();
