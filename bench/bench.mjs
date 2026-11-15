// bench/bench.mjs — cold start + >=5 repeats, median/p95/stddev, writes
// bench/result.json.  No number in the README may come from anywhere else.
import { readFileSync, writeFileSync } from "node:fs";
import { accumulateTangents, certify, classifyHandedness } from "../src/core.mjs";
import { naiveClassify, naiveAccumulateTangents } from "../baseline/naive.mjs";

const data = JSON.parse(readFileSync(new URL("../data/meshes.json", import.meta.url), "utf8"));
const mesh = data.meshes.find((m) => m.name === "mirror-sphere");

const now = () => Number(process.hrtime.bigint()) / 1e6;
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { min: +s[0].toFixed(4), median: +q(0.5).toFixed(4), p95: +q(0.95).toFixed(4), max: +s[s.length - 1].toFixed(4), stddev: +sd.toFixed(4), relStddev: +(sd / mean).toFixed(4), samples: s.length };
};

// --- core scan (classify + accumulate) ---
const t0 = now();
classifyHandedness(mesh); accumulateTangents(mesh);
const coreCold = +(now() - t0).toFixed(4);
const coreRuns = [];
for (let i = 0; i < 7; i++) { const t = now(); classifyHandedness(mesh); accumulateTangents(mesh); coreRuns.push(now() - t); }

// --- naive baseline scan (O(V*F)) ---
const t1 = now();
naiveClassify(mesh); naiveAccumulateTangents(mesh);
const naiveCold = +(now() - t1).toFixed(4);
const naiveRuns = [];
for (let i = 0; i < 5; i++) { const t = now(); naiveClassify(mesh); naiveAccumulateTangents(mesh); naiveRuns.push(now() - t); }

// --- full certificate ---
const t2 = now();
const c = certify(mesh);
const fullCold = +(now() - t2).toFixed(4);
const fullRuns = [];
for (let i = 0; i < 5; i++) { const t = now(); certify(mesh); fullRuns.push(now() - t); }

const core = stats(coreRuns), naive = stats(naiveRuns), full = stats(fullRuns);
const result = {
  node: process.version,
  mesh: { name: mesh.name, triangles: mesh.indices.length / 3, vertices: mesh.positions.length / 3 },
  scanCertificate: { core, coldMs: coreCold, naive, naiveColdMs: naiveCold, speedupMedian: +(naive.median / core.median).toFixed(2) },
  fullCertificate: { stats: full, coldMs: fullCold },
  correctness: {
    triangles: c.triangles, mirrored: c.mirrored, rightHanded: c.rightHanded, degenerateUv: c.degenerateUv,
    authoredMeanMirroredDeg: +c.authoredMeanMirrored.toFixed(6), authoredMaxMirroredDeg: +c.authoredMaxMirrored.toFixed(6),
    authoredWorstSampleMirroredDeg: +c.authoredWorstSampleMirrored.toFixed(6),
    correctedWorstSampleAllDeg: +c.correctedMaxSampleAll.toFixed(9),
    authoredMaxRightDeg: +c.authoredMaxRight.toFixed(6), correctedMaxAllDeg: +c.correctedMaxAll.toFixed(9),
    epsRel: c.epsRel, maxAbsArea: c.maxAbsArea, samplesPerTriangle: c.samplesPerTriangle,
  },
};
writeFileSync(new URL("./result.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
