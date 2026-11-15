// baseline/naive.mjs — independent, deliberately naive implementations used as
// the timing baseline and as a second opinion on the classification counts.
// Shares no constants with src/core.mjs: its tolerance is relative to the sum
// of |UV areas| (not to the maximum), and the tangent accumulation is the O(V*F)
// per-vertex scan instead of a single pass over faces.

import { vertexNormals } from "../src/core.mjs";

export function naiveClassify(mesh) {
  const { uvs, indices } = mesh;
  const faces = [];
  for (let t = 0; t < indices.length / 3; t++) faces.push([indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]]);
  let areaSum = 0;
  const areas = faces.map(([a, b, c]) => {
    const area = (uvs[b * 2] - uvs[a * 2]) * (uvs[c * 2 + 1] - uvs[a * 2 + 1]) -
      (uvs[c * 2] - uvs[a * 2]) * (uvs[b * 2 + 1] - uvs[a * 2 + 1]);
    areaSum += Math.abs(area);
    return area;
  });
  const eps = (areaSum / areas.length) * 1e-10; // mean-area-relative, not max-relative
  let mirrored = 0, degenerate = 0, right = 0;
  for (const area of areas) {
    if (Math.abs(area) <= eps) degenerate++;
    else if (area > 0) right++;
    else mirrored++;
  }
  return { mirrored, degenerate, rightHanded: right, triangles: areas.length };
}

export function naiveAccumulateTangents(mesh) {
  const { positions, uvs, indices } = mesh;
  const nv = positions.length / 3;
  const faces = [];
  for (let t = 0; t < indices.length / 3; t++) faces.push([indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]]);
  const tan = new Float64Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    for (const [a, b, c] of faces) {
      if (a !== v && b !== v && c !== v) continue; // O(V*F) scan
      const p1 = [positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2]];
      const e1 = [positions[b * 3] - p1[0], positions[b * 3 + 1] - p1[1], positions[b * 3 + 2] - p1[2]];
      const e2 = [positions[c * 3] - p1[0], positions[c * 3 + 1] - p1[1], positions[c * 3 + 2] - p1[2]];
      const du1 = uvs[b * 2] - uvs[a * 2], dv1 = uvs[b * 2 + 1] - uvs[a * 2 + 1];
      const du2 = uvs[c * 2] - uvs[a * 2], dv2 = uvs[c * 2 + 1] - uvs[a * 2 + 1];
      const det = du1 * dv2 - du2 * dv1;
      if (det === 0) continue;
      tan[v * 3] += (e1[0] * dv2 - e2[0] * dv1) / det;
      tan[v * 3 + 1] += (e1[1] * dv2 - e2[1] * dv1) / det;
      tan[v * 3 + 2] += (e1[2] * dv2 - e2[2] * dv1) / det;
    }
  }
  const nrm = vertexNormals(mesh);
  for (let v = 0; v < nv; v++) {
    const d = tan[v * 3] * nrm[v * 3] + tan[v * 3 + 1] * nrm[v * 3 + 1] + tan[v * 3 + 2] * nrm[v * 3 + 2];
    tan[v * 3] -= d * nrm[v * 3]; tan[v * 3 + 1] -= d * nrm[v * 3 + 1]; tan[v * 3 + 2] -= d * nrm[v * 3 + 2];
  }
  return tan;
}

export function naiveScan(mesh) {
  return { counts: naiveClassify(mesh), tangents: naiveAccumulateTangents(mesh) };
}
