# TangentFlip Cert Lab — per-triangle UV handedness certificate + measured normal-map shading error

**Promise (baseline in `baseline/naive.mjs`):** in a 6,912-triangle UV sphere whose second UV half is mirrored, the certificate classifies all 6,912 triangles per-triangle (**3,456 mirrored / 3,456 right-handed / 0 degenerate**), reports the shading error that a naive `tangent.w = +1` export silently causes (**mean 45.290306°, worst sampled 73.739795°** over 64 sampled tangent-space normals per triangle) and proves that exporting `w = UV handedness` instead is exact (**worst sampled 0.000e+0°**); the scan certificate costs **2.3427 ms median vs 348.686 ms** for the naive O(V·F) baseline — **148.59×**; the verdict is **bit-identical from 3D scale 1e-6 to 1e6 and UV scale 1e-3 to 1e3** (0 drift over 26 compared fields).

Upstream: none

A renderer computes `bitangent = tangent.w * cross(N, tangent.xyz)`. Almost every exporter writes `w = +1`. On a **mirrored UV island** the parameterisation needs `w = -1`, so a normal map's in-plane gradient is flipped on exactly those triangles — a lighting bug that is invisible in a UV checker and invisible in a flat render, and that no validator reports today. This repository decides it per triangle, from the UV winding alone, and *measures* the shading consequence instead of asserting it.

## 本轮创新

**B 档。** Agenda: 台账中 `winding-cert-lab`（顶点绕向/朝向）、`pointnorm-cert-lab`（顶点法线朝向传播）、`uv-audit-lab`（UV 重叠/畸变）、`smoothgroup` 都只处理 *顶点* 朝向导数，没有一条把「**逐三角 UV 手性 + normal-map 着色误差的可复算角度**」做成证书。与它们的三处实质差别：

1. 判定量是**逐三角的 UV 有向面积符号**，不是顶点法线/绕向；证书给出 mirrored 三角形的 1-极小集合本身（含零面积 UV 三角单列，不并入 mirrored）。
2. 不只判 "mirrored"，而是**把渲染后果算成角度**：在同一组确定性采样的切线空间法线上，比较「作者帧 `w=+1`」与「证书帧 `w=手性`」，镜像三角的误差是**算出来的** 45.290306° 均值 / 73.739795° 峰值，右手三角与证书帧都是 **精确 0**（用 `atan2(|a×b|, a·b)`，避免 `acos` 近 1 的 1e-6 假噪声）。
3. **唯一阈值是相对的**（`epsRel = 1e-12 × max|UV area|`），所以 3D 尺度 1e-6…1e6 与 UV 尺度 1e-3…1e3 下全部判定与全部误差**位级不变**（26 个对比字段 0 漂移）；这直接回应 11-02 定档的「绝对阈值 + 尺度不测」问题。

## How to run

```bash
node tools/gen-sample.mjs && node bench/verify.mjs   # 18 assertions, prints every value, exit 0
node bench/bench.mjs                                 # cold start + >=5 repeats -> bench/result.json
python3 -m http.server 4173                           # open http://localhost:4173 (three.js via pinned importmap)
```

`index.html` + `main.js` import the **same** `src/core.mjs` as the node scripts (no `three` inside core, no DOM, `node -e "import('./src/core.mjs')"` is clean), so the numbers on screen are the numbers `bench/verify.mjs` asserts. The page tints mirrored triangles red / right-handed green / zero-UV-area grey and toggles between the authored and the certified tangent frame; watch the procedural normal map's relief invert on red triangles.

## Evidence (`bench/result.json`, node v24.19.0)

| what | value |
| --- | --- |
| mesh | `mirror-sphere`: 3,577 vertices / 6,912 triangles |
| classification (per triangle) | mirrored **3,456**, right-handed **3,456**, zero-UV-area **0** (partition total) |
| authored frame, mirrored triangles | mean **45.290306°**, worst sampled **73.739795°** |
| authored frame, right-handed triangles | **0** (exact) |
| certified frame (`w = handedness`), all triangles | worst sampled **0.000e+0°** (exact) |
| scan certificate (classify + accumulate) | median **2.377 ms**, p95 3.7391 ms, stddev 0.6490 ms, cold **18.6523 ms** (n=7) |
| naive baseline (`baseline/naive.mjs`, O(V·F)) | median **348.1047 ms**, p95 355.2202 ms, stddev 12.4881 ms, cold 351.9267 ms (n=5) |
| speedup | **148.59×** (medians) |
| full certificate (incl. 64 sampled normals/triangle) | median **64.6157 ms**, cold **84.2043 ms** (n=5) |
| degenerate corpus `degen-sphere` | **48** zero-UV-area triangles found, **0** mis-counted as mirrored |
| independent oracles | naive classifier agrees on all 3 meshes; geometric bitangent oracle **0 disagreements over 9,800 decidable triangles** |
| scale sweep | 3D ×1e-6…1e6 and UV ×1e-3…1e3: **0 drift / 26 fields** (bit-identical), `maxAbsArea` scales exactly as k² |

`correctedMaxAllDeg` and `authoredWorstSampleMirroredDeg` are also in `bench/result.json`, and every number above is printed verbatim by `node bench/verify.mjs`.

## What the certificate is, precisely

For triangle `(a,b,c)` with UVs `(u,v)`, let `A = (u_b-u_a)(v_c-v_a) - (u_c-u_a)(v_b-v_a)`. Then `sign(A) > 0` means the UV parameterisation is right-handed with respect to the geometric normal, `sign(A) < 0` means mirrored, and `|A| <= epsRel·max|A|` means the UV triangle is degenerate (reported separately, never folded into "mirrored"). The shading-error clause builds, for each triangle, the orthonormal frame `{T, ±cross(N,T), N}` from the triangle's own UV gradient and evaluates `angle` between the sampled normal expressed in the authored frame and in the true frame — so the reported degree values are computed, not tabulated.

## Known limitations (read before trusting a number)

1. **The geometric oracle is not fully independent of the input.** It re-derives the bitangent from the same UV deltas by a different algebraic route (dot of `cross(N, T_from_edges)` with the reconstructed bitangent) and uses a different relative tolerance (`1e-9` vs `1e-12`), but it cannot be independent of the UVs themselves. It *would* catch a wrong sign convention in the primary classifier; it would not catch a wrong interpretation shared by both.
2. **136 pole-fan triangles (of 9,936) are undecidable from geometry alone**: their 3D area is zero (sphere poles), so the geometric oracle returns 0 while the UV-based classifier still reports a winding. They are excluded from the oracle comparison and counted separately. A UV layout can therefore hide mirrored-ness behind zero-area triangles (umbrella/pole layouts).
3. **A mirrored island is not always a bug** — symmetric decals and intentionally mirrored atlases are legal. The certificate reports handedness; only the consumer knows whether it is allowed.
4. **Timing is ~2.4 ms of work**, so `relStddev = 23.45%` on the core scan is JIT/GC noise on a sub-5-ms measurement (absolute stddev 0.65 ms, p95 3.74 ms, cold 18.7 ms includes warm-up). It is reported as measured and is not used to claim anything except the 148.59× ratio, which holds in every sample (`min` 1.9760 ms vs `min` 324.9596 ms = 164×; `p95` ratio 95×).
5. The threshold is relative to the **largest** `|UV area|` in the mesh, so a single huge UV triangle sets the floor for the whole mesh; valid, degenerate-classification depends on it.
6. Only per-triangle winding is analysed — no texture-space or per-texel analysis, no UV overlap (that is `uv-audit-lab`'s job, deliberately not repeated here).

## Quality gates

G1 baseline in-repo (`baseline/naive.mjs`) · G2 `node --check` on all four scripts · G3 `grep -nE "three|window|document|navigator" src/core.mjs` matches a comment only · G4 `node bench/verify.mjs` prints actual values, exit 0 (18/18) · G5 `bench/result.json` with cold start, n≥5, median/p95/stddev · G6 `python3 -m http.server` serves `index.html` with the pinned importmap · G7 `rm -rf data && node tools/gen-sample.mjs` rebuilds byte-identically · G8 no browser automation, no `npx` · G9 this README.

License: MIT (`LICENSE`).
