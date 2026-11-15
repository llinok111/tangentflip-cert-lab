// bench/bench.mjs — cold start + >=5 repeats, median/p95/stddev, writes
// bench/result.json.  No number in the README may come from anywhere else.
//
// The core scan takes ~1-2 ms, short enough that JIT/GC noise dominates a single
// call, so EVERY sample (core, naive baseline, full certificate) times the same
// batch of `BATCH` consecutive calls and divides - the comparison stays
// apples-to-apples, no side is batched more than the other.
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
  return {
    min: +s[0].toFixed(4), median: +q(0.5).toFixed(4), p95: +q(0.95).toFixed(4),
    max: +s[s.length - 1].toFixed(4), stddev: +sd.toFixed(4),
    relStddev: +(sd / mean).toFixed(4), samples: s.length,
  };
};
const batchTime = (fn, n) => { const t = now(); for (let i = 0; i < n; i++) fn(); return (now() - t) / n; };

const BATCH = 8, CORE_SAMPLES = 15, NAIVE_SAMPLES = 5, FULL_SAMPLES = 5;
const coreScan = () => { classifyHandedness(mesh); accumulateTangents(mesh); };
const naiveScan = () => { naiveClassify(mesh); naiveAccumulateTangents(mesh); };
const fullScan = () => certify(mesh);

const coreCold = +batchTime(coreScan, 1).toFixed(4);
const coreRuns = []; for (let i = 0; i < CORE_SAMPLES; i++) coreRuns.push(batchTime(coreScan, BATCH));
const naiveCold = +batchTime(naiveScan, 1).toFixed(4);
const naiveRuns = []; for (let i = 0; i < NAIVE_SAMPLES; i++) naiveRuns.push(batchTime(naiveScan, BATCH));
const fullCold = +batchTime(fullScan, 1).toFixed(4);
const fullRuns = []; for (let i = 0; i < FULL_SAMPLES; i++) fullRuns.push(batchTime(fullScan, BATCH));

const c = certify(mesh);
const core = stats(coreRuns), naive = stats(naiveRuns), full = stats(fullRuns);
const result = {
  node: process.version,
  mesh: { name: mesh.name, triangles: mesh.indices.length / 3, vertices: mesh.positions.length / 3 },
  scanCertificate: {
    core, coldMs: coreCold, coreBatch: BATCH,
    naive, naiveColdMs: naiveCold, naiveBatch: BATCH,
    speedupMedian: +(naive.median / core.median).toFixed(2),
    speedupMin: +(naive.min / core.min).toFixed(2),
  },
  fullCertificate: { stats: full, coldMs: fullCold, batch: BATCH },
  correctness: {
    triangles: c.triangles, mirrored: c.mirrored, rightHanded: c.rightHanded, degenerateUv: c.degenerateUv,
    authoredMeanMirroredDeg: +c.authoredMeanMirrored.toFixed(6),
    authoredMaxMirroredDeg: +c.authoredMaxMirrored.toFixed(6),
    authoredWorstSampleMirroredDeg: +c.authoredWorstSampleMirrored.toFixed(6),
    correctedWorstSampleAllDeg: +c.correctedMaxSampleAll.toFixed(9),
    authoredMaxRightDeg: +c.authoredMaxRight.toFixed(6),
    correctedMaxAllDeg: +c.correctedMaxAll.toFixed(9),
    epsRel: c.epsRel, maxAbsArea: c.maxAbsArea, samplesPerTriangle: c.samplesPerTriangle,
  },
};
writeFileSync(new URL("./result.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
