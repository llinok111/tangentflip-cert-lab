// bench/verify.mjs — assertions over the real sample data.  Prints every value
// it asserts.  Exit 0 iff all assertions pass.
import { readFileSync } from "node:fs";
import { certify, oracleSigns, uvAreas } from "../src/core.mjs";
import { naiveClassify } from "../baseline/naive.mjs";

const data = JSON.parse(readFileSync(new URL("../data/meshes.json", import.meta.url), "utf8"));
const byName = Object.fromEntries(data.meshes.map((m) => [m.name, m]));
const scaleMesh = (m, s, uvScale = 1) => ({
  positions: m.positions.map((x) => x * s),
  uvs: m.uvs.map((x) => x * uvScale),
  indices: m.indices,
});
const NAMES = ["mirror-sphere", "clean-sphere", "degen-sphere"];

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}  ${detail}`); }
  else { fail++; console.log(`  FAIL ${name}  ${detail}`); }
};

console.log("== A. per-mesh certificate ==");
const C = {};
for (const name of NAMES) {
  const c = certify(byName[name]);
  C[name] = c;
  console.log(`  ${name}: ${c.triangles} tris / ${c.vertices} verts | mirrored=${c.mirrored} right=${c.rightHanded} degenerate=${c.degenerateUv}`);
  console.log(`     authored error on mirrored: mean=${c.authoredMeanMirrored.toFixed(4)}deg worst-sample=${c.authoredWorstSampleMirrored.toFixed(4)}deg`);
  console.log(`     authored error on right-handed: mean=${c.authoredMeanRight.toFixed(4)}deg max=${c.authoredMaxRight.toFixed(4)}deg`);
  console.log(`     certified-frame error (all tris): mean=${c.correctedMeanAll.toExponential(3)}deg worst-sample=${c.correctedMaxSampleAll.toExponential(3)}deg`);
  console.log(`     maxAbsUvArea=${c.maxAbsArea.toExponential(4)} epsRel=${c.epsRel} epsAbs=${c.epsAbsolute.toExponential(4)}`);
}
check("mirrored sphere has mirrored islands", C["mirror-sphere"].mirrored > 3000, `mirrored=${C["mirror-sphere"].mirrored}`);
check("mirrored sphere partition is total",
  C["mirror-sphere"].mirrored + C["mirror-sphere"].rightHanded + C["mirror-sphere"].degenerateUv === C["mirror-sphere"].triangles,
  `sum=${C["mirror-sphere"].mirrored + C["mirror-sphere"].rightHanded + C["mirror-sphere"].degenerateUv}/${C["mirror-sphere"].triangles}`);
check("clean sphere has zero mirrored triangles", C["clean-sphere"].mirrored === 0, `mirrored=${C["clean-sphere"].mirrored}`);
check("clean sphere has zero degenerate triangles", C["clean-sphere"].degenerateUv === 0, `degenerate=${C["clean-sphere"].degenerateUv}`);
check("degen sphere finds the collapsed UV column", C["degen-sphere"].degenerateUv >= 48, `degenerate=${C["degen-sphere"].degenerateUv}`);
check("degenerate triangles are not counted as mirrored", C["degen-sphere"].mirrored === 0, `mirrored=${C["degen-sphere"].mirrored}`);

console.log("== B. shading-error clause ==");
check("authored frame mis-shades mirrored islands (mean over 64 sampled normals)", C["mirror-sphere"].authoredMeanMirrored > 40,
  `mean=${C["mirror-sphere"].authoredMeanMirrored.toFixed(4)}deg`);
check("authored frame mis-shades by up to >73deg on some sampled normal", C["mirror-sphere"].authoredWorstSampleMirrored > 73,
  `worst-sample=${C["mirror-sphere"].authoredWorstSampleMirrored.toFixed(4)}deg`);
check("authored frame is exact on right-handed triangles", C["mirror-sphere"].authoredMaxRight === 0,
  `max=${C["mirror-sphere"].authoredMaxRight.toExponential(3)}deg`);
check("certified frame (w = handedness) is exact everywhere", C["mirror-sphere"].correctedMaxSampleAll === 0,
  `worst-sample=${C["mirror-sphere"].correctedMaxSampleAll.toExponential(3)}deg`);
check("certified frame is exact on the degenerate mesh too", C["degen-sphere"].correctedMaxSampleAll === 0,
  `worst-sample=${C["degen-sphere"].correctedMaxSampleAll.toExponential(3)}deg`);

console.log("== C. independent oracles (per triangle, all meshes) ==");
let disagree = 0, undecidable = 0, decisive = 0, coreNonZero = 0;
for (const name of NAMES) {
  const m = byName[name];
  const o = oracleSigns(m);
  const c = C[name];
  for (let t = 0; t < o.signs.length; t++) {
    const cls = c.handedness.signs[t];
    if (cls !== 0) coreNonZero++;
    if (o.signs[t] === 0) { if (cls !== 0) undecidable++; continue; }
    decisive++;
    if (o.signs[t] !== cls) disagree++;
  }
  const n = naiveClassify(m);
  check(`naive classification matches core on ${name}`,
    n.mirrored === c.mirrored && n.degenerate === c.degenerateUv && n.rightHanded === c.rightHanded,
    `naive(mir=${n.mirrored}, deg=${n.degenerate}, right=${n.rightHanded}) vs core(mir=${c.mirrored}, deg=${c.degenerateUv}, right=${c.rightHanded})`);
}
check("geometric oracle differs on 0 decidable triangles", disagree === 0,
  `disagreements=${disagree} of ${decisive} decidable; core non-zero=${coreNonZero}`);
console.log(`  note: ${undecidable} triangles are zero-3D-area pole fans, undecidable from geometry alone (documented limitation)`);

console.log("== D. scale behaviour (3D scale x UV scale) ==");
const base = C["mirror-sphere"];
let drift = 0, fields = 0;
for (const s of [1e-6, 1e-3, 1, 1e3, 1e6]) {
  const c = certify(scaleMesh(byName["mirror-sphere"], s));
  fields += 4;
  if (c.mirrored !== base.mirrored) drift++;
  if (c.degenerateUv !== base.degenerateUv) drift++;
  if (c.authoredMeanMirrored !== base.authoredMeanMirrored) drift++;
  if (c.correctedMaxSampleAll !== 0) drift++;
  console.log(`  geometry x${s.toExponential(0)}: mirrored=${c.mirrored} degenerate=${c.degenerateUv} meanErr=${c.authoredMeanMirrored.toFixed(9)}deg worst=${c.authoredWorstSampleMirrored.toFixed(9)}deg`);
}
for (const k of [1e-3, 1, 1e3]) {
  const c = certify(scaleMesh(byName["clean-sphere"], 1, k));
  fields += 2;
  if (c.mirrored !== 0 || c.degenerateUv !== 0) drift++;
  if (c.correctedMaxSampleAll !== 0) drift++;
  console.log(`  uv x${k.toExponential(0)}: mirrored=${c.mirrored} degenerate=${c.degenerateUv} maxAbsArea=${c.maxAbsArea.toExponential(4)}`);
}
check("verdict is scale invariant (bit-identical, not approximately)", drift === 0,
  `drift=${drift} over ${fields} compared fields (5 geometry scales + 3 uv scales)`);
const areaRatio = certify(scaleMesh(byName["clean-sphere"], 1, 1000)).maxAbsArea / C["clean-sphere"].maxAbsArea;
check("uv areas scale as k^2 (the only threshold is relative)", Math.abs(areaRatio - 1e6) / 1e6 < 1e-9,
  `maxAbsArea ratio=${areaRatio.toExponential(9)} vs k^2=1e6`);

console.log("== E. area bookkeeping ==");
const areas = uvAreas(byName["mirror-sphere"]);
let neg = 0, pos = 0, zero = 0;
for (const a of areas) (a > 0 ? pos++ : a < 0 ? neg++ : zero++);
check("signed UV areas partition the triangles", pos + neg + zero === areas.length, `pos=${pos} neg=${neg} zero=${zero}`);

console.log(`\nRESULT ${fail === 0 ? "PASS" : "FAIL"}: ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
