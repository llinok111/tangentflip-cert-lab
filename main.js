// main.js — render layer only.  All numbers come from src/core.mjs (the same
// module bench/verify.mjs imports); the renderer never re-implements a check.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { accumulateTangents, certify } from "./src/core.mjs";

const view = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(view.clientWidth, view.clientHeight);
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
const camera = new THREE.PerspectiveCamera(45, view.clientWidth / view.clientHeight, 0.01, 100);
camera.position.set(0, 0.6, 3.4);
const controls = new OrbitControls(camera, renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(2, 3, 2);
scene.add(key);

// deterministic procedural tangent-space normal map (a bump grid)
function normalMap(size = 128, freq = 7, amp = 0.55) {
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = -amp * Math.sin((2 * Math.PI * freq * x) / size);
      const ny = -amp * Math.sin((2 * Math.PI * freq * y) / size);
      const l = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      px[i] = 128 + (nx / l) * 127; px[i + 1] = 128 + (ny / l) * 127; px[i + 2] = 128 + (127 / l); px[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(px, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

const material = new THREE.MeshStandardMaterial({
  color: 0x9aa7b4, roughness: 0.45, metalness: 0.0,
  normalMap: normalMap(), normalScale: new THREE.Vector2(1.6, 1.6),
  vertexColors: true, side: THREE.DoubleSide,
});
let mesh = null, report = null, framing = "authored";

function build(data, name) {
  const src = data.meshes.find((m) => m.name === name);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(src.positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(src.uvs, 2));
  g.setIndex(src.indices);
  g.computeVertexNormals();
  const tangents = accumulateTangents(src);
  g.setAttribute("tangent", new THREE.Float32BufferAttribute(tangents, 4));
  report = certify(src);
  const col = new Float32Array(src.positions.length);
  for (let t = 0; t < report.handedness.signs.length; t++) {
    const s = report.handedness.signs[t];
    const c = s === 1 ? [0.25, 0.75, 0.35] : s === -1 ? [0.95, 0.30, 0.30] : [0.45, 0.45, 0.45];
    for (let k = 0; k < 3; k++) {
      const v = src.indices[t * 3 + k];
      col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2];
    }
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
  mesh = new THREE.Mesh(g, material);
  scene.add(mesh);
  applyFraming();
  render();
}

function applyFraming() {
  const t = mesh.geometry.getAttribute("tangent");
  const signs = report.handedness.signs;
  for (let v = 0; v < t.count; v++) t.setW(v, 1); // naive: every vertex w = +1
  if (framing === "certified") {
    // per-vertex certified handedness: unanimous sign over incident triangles
    const acc = new Float64Array(t.count);
    for (let i = 0; i < signs.length; i++) for (let k = 0; k < 3; k++) acc[mesh.geometry.index.getX(i * 3 + k)] += signs[i];
    for (let v = 0; v < t.count; v++) t.setW(v, acc[v] < 0 ? -1 : 1);
  }
  t.needsUpdate = true;
}

function render() {
  const rows = [
    ["triangles", report.triangles],
    ["mirrored UV triangles", report.mirrored],
    ["zero-UV-area triangles", report.degenerateUv],
    ["framing", framing === "authored" ? "as authored (w = +1)" : "certified (w = handedness)"],
    ["authored mean shading error (mirrored)", report.authoredMeanMirrored.toFixed(4) + " deg"],
    ["authored worst sampled error", report.authoredWorstSampleMirrored.toFixed(4) + " deg"],
    ["certified worst sampled error", report.correctedMaxSampleAll.toExponential(2) + " deg"],
    ["eps = rel x maxAbsUvArea", report.epsRel + " x " + report.maxAbsArea.toExponential(3)],
  ];
  document.getElementById("out").innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
  renderer.render(scene, camera);
}

let data;
document.querySelectorAll("#mesh button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("#mesh button").forEach((x) => x.classList.remove("on"));
  b.classList.add("on");
  build(data, b.dataset.mesh);
}));
document.querySelectorAll("#frame button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("#frame button").forEach((x) => x.classList.remove("on"));
  b.classList.add("on");
  framing = b.dataset.frame;
  applyFraming();
  render();
}));
addEventListener("resize", () => {
  camera.aspect = view.clientWidth / view.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(view.clientWidth, view.clientHeight);
  render();
});
data = await (await fetch("./data/meshes.json")).json();
build(data, "mirror-sphere");
(function loop() { requestAnimationFrame(loop); if (mesh) mesh.rotation.y += 0.004; renderer.render(scene, camera); })();
