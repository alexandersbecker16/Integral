import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { compile2D, integrate2D, formatNumber, formatBound } from "./math.js";

export class View3D {
  constructor(canvas, onUpdate) {
    this.canvas = canvas;
    this.onUpdate = onUpdate;

    this.expr = "sin(x) * cos(y) + 1.2";
    this.fn = compile2D(this.expr);
    this.valid = true;

    this.x0 = -1.5;
    this.x1 = 1.5;
    this.y0 = -1.2;
    this.y1 = 1.2;

    this.range = 4; // surface plot domain

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.camera.position.set(7.5, 5.5, 7.5);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0.8, 0);
    // Allow full orbit, including under the xy-plane / graph
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.screenSpacePanning = true;

    this.root = new THREE.Group();
    this.scene.add(this.root);

    const hemi = new THREE.HemisphereLight(0xf5f8fb, 0x8aa0a8, 1.1);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(5, 10, 4);
    this.scene.add(key);

    this.surfaceMesh = null;
    this.volumeMesh = null;
    this.boundGroup = new THREE.Group();
    this.root.add(this.boundGroup);

    this.handleMeshes = [];
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.dragHandle = null;
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.temp = new THREE.Vector3();

    this._onMove = (e) => this.onPointerMove(e);
    this._onUp = () => this.onPointerUp();

    canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.onHover(e));

    this.running = false;
    this._raf = null;

    this.buildAxes();
    this.rebuildSurface();
    this.rebuildBounds();
  }

  setEquation(expr) {
    try {
      this.fn = compile2D(expr);
      this.expr = expr;
      this.valid = true;
      this.rebuildSurface();
      this.rebuildVolume();
      this.rebuildBounds();
    } catch {
      this.valid = false;
    }
    this.emit();
  }

  setBounds(x0, x1, y0, y1) {
    this.x0 = x0;
    this.x1 = x1;
    this.y0 = y0;
    this.y1 = y1;
    this.rebuildBounds();
    this.emit();
  }

  buildAxes() {
    const axes = new THREE.Group();
    const mk = (from, to, color) => {
      const g = new THREE.BufferGeometry().setFromPoints([from, to]);
      return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 }));
    };
    const L = this.range + 0.5;
    axes.add(mk(new THREE.Vector3(-L, 0, 0), new THREE.Vector3(L, 0, 0), 0x2a3b48));
    axes.add(mk(new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, L, 0), 0x2a3b48));
    axes.add(mk(new THREE.Vector3(0, 0, -L), new THREE.Vector3(0, 0, L), 0x2a3b48));

    // Ground grid
    const grid = new THREE.GridHelper(this.range * 2, 16, 0x9aafb8, 0xc5d2d9);
    grid.position.y = 0;
    axes.add(grid);
    this.root.add(axes);
  }

  rebuildSurface() {
    if (this.surfaceMesh) {
      this.root.remove(this.surfaceMesh);
      this.surfaceMesh.geometry.dispose();
      this.surfaceMesh.material.dispose();
      this.surfaceMesh = null;
    }
    if (!this.valid) return;

    const segs = 64;
    const geo = new THREE.PlaneGeometry(this.range * 2, this.range * 2, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let y = this.fn(x, z);
      if (!Number.isFinite(y)) y = 0;
      pos.setY(i, y);
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: 0x1aa396,
      metalness: 0.05,
      roughness: 0.55,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.78,
    });
    this.surfaceMesh = new THREE.Mesh(geo, mat);
    this.root.add(this.surfaceMesh);

    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x0f7a72, transparent: true, opacity: 0.18 })
    );
    this.surfaceMesh.add(wire);
  }

  rebuildVolume() {
    if (this.volumeMesh) {
      this.root.remove(this.volumeMesh);
      this.volumeMesh.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
      this.volumeMesh = null;
    }
    if (!this.valid) return;

    const xa = Math.min(this.x0, this.x1);
    const xb = Math.max(this.x0, this.x1);
    const za = Math.min(this.y0, this.y1);
    const zb = Math.max(this.y0, this.y1);

    const nx = 28;
    const nz = 28;
    const positions = [];
    const indices = [];

    // Build a solid-ish volume: top surface + bottom on z=0 + walls
    const top = [];
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= nz; j++) {
        const x = xa + ((xb - xa) * i) / nx;
        const z = za + ((zb - za) * j) / nz;
        let y = this.fn(x, z);
        if (!Number.isFinite(y)) y = 0;
        top.push({ x, y, z });
        positions.push(x, y, z); // top verts 0..(nx+1)*(nz+1)-1
      }
    }
    const topCount = (nx + 1) * (nz + 1);
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= nz; j++) {
        const x = xa + ((xb - xa) * i) / nx;
        const z = za + ((zb - za) * j) / nz;
        positions.push(x, 0, z); // bottom
      }
    }

    const idx = (i, j, layer) => layer * topCount + i * (nz + 1) + j;

    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        // top
        indices.push(idx(i, j, 0), idx(i + 1, j, 0), idx(i + 1, j + 1, 0));
        indices.push(idx(i, j, 0), idx(i + 1, j + 1, 0), idx(i, j + 1, 0));
        // bottom (flip)
        indices.push(idx(i, j, 1), idx(i, j + 1, 1), idx(i + 1, j + 1, 1));
        indices.push(idx(i, j, 1), idx(i + 1, j + 1, 1), idx(i + 1, j, 1));
      }
    }

    // Walls
    for (let i = 0; i < nx; i++) {
      // z = za
      indices.push(idx(i, 0, 0), idx(i, 0, 1), idx(i + 1, 0, 1));
      indices.push(idx(i, 0, 0), idx(i + 1, 0, 1), idx(i + 1, 0, 0));
      // z = zb
      indices.push(idx(i, nz, 0), idx(i + 1, nz, 0), idx(i + 1, nz, 1));
      indices.push(idx(i, nz, 0), idx(i + 1, nz, 1), idx(i, nz, 1));
    }
    for (let j = 0; j < nz; j++) {
      // x = xa
      indices.push(idx(0, j, 0), idx(0, j + 1, 0), idx(0, j + 1, 1));
      indices.push(idx(0, j, 0), idx(0, j + 1, 1), idx(0, j, 1));
      // x = xb
      indices.push(idx(nx, j, 0), idx(nx, j, 1), idx(nx, j + 1, 1));
      indices.push(idx(nx, j, 0), idx(nx, j + 1, 1), idx(nx, j + 1, 0));
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: 0xe85d4c,
      metalness: 0.05,
      roughness: 0.45,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.volumeMesh = new THREE.Mesh(geo, mat);
    this.root.add(this.volumeMesh);

    // Base rectangle outline
    const basePts = [
      new THREE.Vector3(xa, 0.01, za),
      new THREE.Vector3(xb, 0.01, za),
      new THREE.Vector3(xb, 0.01, zb),
      new THREE.Vector3(xa, 0.01, zb),
      new THREE.Vector3(xa, 0.01, za),
    ];
    const baseLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(basePts),
      new THREE.LineBasicMaterial({ color: 0xe85d4c })
    );
    this.volumeMesh.add(baseLine);
  }

  rebuildBounds() {
    while (this.boundGroup.children.length) {
      const c = this.boundGroup.children.pop();
      c.geometry?.dispose();
      c.material?.dispose();
    }
    this.handleMeshes = [];

    const corners = [
      { id: "x0y0", x: this.x0, z: this.y0 },
      { id: "x1y0", x: this.x1, z: this.y0 },
      { id: "x1y1", x: this.x1, z: this.y1 },
      { id: "x0y1", x: this.x0, z: this.y1 },
    ];

    for (const c of corners) {
      let y = this.valid ? this.fn(c.x, c.z) : 0;
      if (!Number.isFinite(y)) y = 0;

      // Vertical guide
      const guide = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(c.x, 0, c.z),
          new THREE.Vector3(c.x, y, c.z),
        ]),
        new THREE.LineDashedMaterial({
          color: 0xe85d4c,
          dashSize: 0.12,
          gapSize: 0.08,
          transparent: true,
          opacity: 0.85,
        })
      );
      guide.computeLineDistances();
      this.boundGroup.add(guide);

      const handle = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 20, 20),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: 0xe85d4c,
          emissiveIntensity: 0.35,
          metalness: 0.1,
          roughness: 0.35,
        })
      );
      handle.position.set(c.x, y, c.z);
      handle.userData = { id: c.id, kind: "handle" };
      this.boundGroup.add(handle);
      this.handleMeshes.push(handle);

      const base = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0xe85d4c })
      );
      base.position.set(c.x, 0.02, c.z);
      base.userData = { id: c.id, kind: "base" };
      this.boundGroup.add(base);
      this.handleMeshes.push(base);
    }

    this.rebuildVolume();
  }

  setPointer(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  onPointerDown(e) {
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.handleMeshes, false);
    if (hits.length) {
      e.stopPropagation();
      this.controls.enabled = false;
      this.dragHandle = hits[0].object.userData.id;
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.classList.add("dragging");
      window.addEventListener("pointermove", this._onMove);
      window.addEventListener("pointerup", this._onUp);
    }
  }

  onPointerMove(e) {
    if (!this.dragHandle) return;
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.raycaster.ray.intersectPlane(this.plane, this.temp)) {
      const lim = this.range;
      const x = THREE.MathUtils.clamp(this.temp.x, -lim, lim);
      const z = THREE.MathUtils.clamp(this.temp.z, -lim, lim);
      switch (this.dragHandle) {
        case "x0y0":
          this.x0 = x;
          this.y0 = z;
          break;
        case "x1y0":
          this.x1 = x;
          this.y0 = z;
          break;
        case "x1y1":
          this.x1 = x;
          this.y1 = z;
          break;
        case "x0y1":
          this.x0 = x;
          this.y1 = z;
          break;
      }
      this.rebuildBounds();
      this.emit();
    }
  }

  onPointerUp() {
    this.dragHandle = null;
    this.controls.enabled = true;
    this.canvas.classList.remove("dragging");
    window.removeEventListener("pointermove", this._onMove);
    window.removeEventListener("pointerup", this._onUp);
  }

  onHover(e) {
    if (this.dragHandle) return;
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.handleMeshes, false);
    this.canvas.style.cursor = hits.length ? "grab" : "grab";
  }

  emit() {
    const value = this.valid
      ? integrate2D(this.fn, this.x0, this.x1, this.y0, this.y1)
      : NaN;
    this.onUpdate?.({
      value,
      boundsText: `x ∈ [${formatBound(Math.min(this.x0, this.x1))}, ${formatBound(Math.max(this.x0, this.x1))}] · y ∈ [${formatBound(Math.min(this.y0, this.y1))}, ${formatBound(Math.max(this.y0, this.y1))}]`,
      hint: "Drag coral corners · orbit (incl. under the graph) · pan / zoom",
      symbol: "∬",
      formatted: formatNumber(value),
    });
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  loop = () => {
    if (!this.running) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this._raf = requestAnimationFrame(this.loop);
  };

  activate() {
    this.running = true;
    this.resize();
    this.controls.enabled = true;
    this.emit();
    this.loop();
  }

  deactivate() {
    this.running = false;
    this.controls.enabled = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this.onPointerUp();
  }
}
