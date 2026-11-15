// src/core.mjs — UV-hand / tangent-space handedness certificate.
//
// Pure ES module: no `three`, no DOM, no I/O, no environment reads.
//
// Problem: a renderer that assumes every triangle's tangent basis is
// right-handed (tangent.w = +1) silently mirrors the tangent-space green/red
// axes on every *mirrored* UV island, so a normal map shades those triangles
// with a flipped gradient.  The certificate decides, per triangle, whether the
// UV parameterisation is mirrored, and quantifies the resulting shading error
// of a tangent-space normal map.
//
// Every threshold is RELATIVE (a fraction of the largest |UV area| in the
// mesh) or a pure sign, so the verdict is invariant under uniform scaling of
// the 3D geometry and of the UV layout (see README, "Scale behaviour").

const EPS_REL_DEFAULT = 1e-12;

const signedUvArea2 = (uv1, uv2, uv3) =>
  (uv2[0] - uv1[0]) * (uv3[1] - uv1[1]) - (uv3[0] - uv1[0]) * (uv2[1] - uv1[1]);

/** Signed doubled UV area of every triangle (positive = right-handed UV winding). */
export function uvAreas(mesh) {
  const { uvs, indices } = mesh;
  const nt = indices.length / 3;
  const out = new Float64Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    out[t] = signedUvArea2(
      [uvs[a * 2], uvs[a * 2 + 1]],
      [uvs[b * 2], uvs[b * 2 + 1]],
      [uvs[c * 2], uvs[c * 2 + 1]],
    );
  }
  return out;
}

/** Area-weighted vertex normals from geometry (no UV involved). */
export function vertexNormals(mesh) {
  const { positions, indices } = mesh;
  const nv = positions.length / 3;
  const n = new Float64Array(nv * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) { n[v] += f[0]; n[v + 1] += f[1]; n[v + 2] += f[2]; }
  }
  for (let v = 0; v < nv; v++) {
    const l = Math.hypot(n[v * 3], n[v * 3 + 1], n[v * 3 + 2]) || 1;
    n[v * 3] /= l; n[v * 3 + 1] /= l; n[v * 3 + 2] /= l;
  }
  return n;
}

/** Per-triangle UV handedness: +1 right-handed, -1 mirrored, 0 degenerate. */
export function classifyHandedness(mesh, opts = {}) {
  const epsRel = opts.epsRel ?? EPS_REL_DEFAULT;
  const areas = uvAreas(mesh);
  let maxAbs = 0;
  for (const a of areas) maxAbs = Math.max(maxAbs, Math.abs(a));
  const eps = epsRel * maxAbs;
  const nt = areas.length;
  const signs = new Int8Array(nt);
  const mirrored = [], degenerate = [];
  for (let t = 0; t < nt; t++) {
    const a = areas[t];
    if (Math.abs(a) <= eps) { signs[t] = 0; degenerate.push(t); }
    else if (a > 0) signs[t] = 1;
    else { signs[t] = -1; mirrored.push(t); }
  }
  return { signs, mirrored, degenerate, areas, maxAbsArea: maxAbs, epsRel, epsAbsolute: eps };
}

/**
 * Single-pass (Lengyel) accumulation of per-vertex tangents, Gram-Schmidt
 * orthonormalised against the geometric normal.  Four components per vertex:
 * xyz tangent and w = the handedness the author would export; the naive export
 * writes +1 everywhere, which is exactly the bug being certified.
 */
export function accumulateTangents(mesh) {
  const { positions, uvs, indices } = mesh;
  const nv = positions.length / 3;
  const tan = new Float64Array(nv * 3), bit = new Float64Array(nv * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t], ib = indices[t + 1], ic = indices[t + 2];
    const p1 = [positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]];
    const e1 = [positions[ib * 3] - p1[0], positions[ib * 3 + 1] - p1[1], positions[ib * 3 + 2] - p1[2]];
    const e2 = [positions[ic * 3] - p1[0], positions[ic * 3 + 1] - p1[1], positions[ic * 3 + 2] - p1[2]];
    const du1 = uvs[ib * 2] - uvs[ia * 2], dv1 = uvs[ib * 2 + 1] - uvs[ia * 2 + 1];
    const du2 = uvs[ic * 2] - uvs[ia * 2], dv2 = uvs[ic * 2 + 1] - uvs[ia * 2 + 1];
    const det = du1 * dv2 - du2 * dv1;
    if (det === 0) continue;
    const r = 1 / det;
    const T = [(e1[0] * dv2 - e2[0] * dv1) * r, (e1[1] * dv2 - e2[1] * dv1) * r, (e1[2] * dv2 - e2[2] * dv1) * r];
    const B = [(e2[0] * du1 - e1[0] * du2) * r, (e2[1] * du1 - e1[1] * du2) * r, (e2[2] * du1 - e1[2] * du2) * r];
    for (const v of [ia, ib, ic]) {
      tan[v * 3] += T[0]; tan[v * 3 + 1] += T[1]; tan[v * 3 + 2] += T[2];
      bit[v * 3] += B[0]; bit[v * 3 + 1] += B[1]; bit[v * 3 + 2] += B[2];
    }
  }
  const nrm = vertexNormals(mesh);
  const out = new Float64Array(nv * 4);
  for (let v = 0; v < nv; v++) {
    const n = [nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]];
    let t = [tan[v * 3], tan[v * 3 + 1], tan[v * 3 + 2]];
    const d = t[0] * n[0] + t[1] * n[1] + t[2] * n[2];
    t = [t[0] - d * n[0], t[1] - d * n[1], t[2] - d * n[2]];
    if (Math.hypot(t[0], t[1], t[2]) === 0) t = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const l = Math.hypot(t[0], t[1], t[2]);
    out[v * 4] = t[0] / l; out[v * 4 + 1] = t[1] / l; out[v * 4 + 2] = t[2] / l;
    out[v * 4 + 3] = 1; // naive authoring: uniform handedness assumed
    void bit;
  }
  return out;
}

/**
 * Shading error (degrees) of a tangent-space normal map under
 * (a) the naive frame (B = +cross(N,T) for every triangle) and
 * (b) the certified frame (B = handedness * cross(N,T)).
 * A deterministic set of `samples` tangent-space normals with in-plane
 * magnitude `polar` is swept; the frames are orthonormal, so the measured
 * angle is exactly the basis mismatch.  Triangles with degenerate UV area are
 * skipped (error 0) and reported separately by classifyHandedness.
 */
export function shadingErrorDegrees(mesh, handed, opts = {}) {
  const { positions, uvs, indices } = mesh;
  const samples = opts.samples ?? 64;
  const polar = opts.polar ?? 0.6;
  const nt = indices.length / 3;
  const zs = Math.sqrt(1 - polar * polar);
  // atan2(|a x b|, a.b): numerically stable near 0, so an exact basis match
  // reports ~1e-14 deg instead of the ~1e-6 deg acos artefact.
  const angle = (a, b) => {
    const cx = a[1] * b[2] - a[2] * b[1], cy = a[2] * b[0] - a[0] * b[2], cz = a[0] * b[1] - a[1] * b[0];
    const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    return (Math.atan2(Math.hypot(cx, cy, cz), d) * 180) / Math.PI;
  };
  const authErr = new Float64Array(nt), corrErr = new Float64Array(nt);
  const authWorst = new Float64Array(nt), corrWorst = new Float64Array(nt);
  for (let t = 0; t < nt; t++) {
    const ia = indices[t * 3], ib = indices[t * 3 + 1], ic = indices[t * 3 + 2];
    const p1 = [positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]];
    const e1 = [positions[ib * 3] - p1[0], positions[ib * 3 + 1] - p1[1], positions[ib * 3 + 2] - p1[2]];
    const e2 = [positions[ic * 3] - p1[0], positions[ic * 3 + 1] - p1[1], positions[ic * 3 + 2] - p1[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nl = Math.hypot(n[0], n[1], n[2]);
    const du1 = uvs[ib * 2] - uvs[ia * 2], dv1 = uvs[ib * 2 + 1] - uvs[ia * 2 + 1];
    const du2 = uvs[ic * 2] - uvs[ia * 2], dv2 = uvs[ic * 2 + 1] - uvs[ia * 2 + 1];
    const det = du1 * dv2 - du2 * dv1;
    const s = handed.signs[t];
    if (nl === 0 || det === 0 || s === 0) { authErr[t] = 0; corrErr[t] = 0; authWorst[t] = 0; corrWorst[t] = 0; continue; }
    n = n.map((x) => x / nl);
    const r = 1 / det;
    let Tv = [(e1[0] * dv2 - e2[0] * dv1) * r, (e1[1] * dv2 - e2[1] * dv1) * r, (e1[2] * dv2 - e2[2] * dv1) * r];
    const dp = Tv[0] * n[0] + Tv[1] * n[1] + Tv[2] * n[2];
    Tv = [Tv[0] - dp * n[0], Tv[1] - dp * n[1], Tv[2] - dp * n[2]];
    const tl = Math.hypot(Tv[0], Tv[1], Tv[2]) || 1;
    Tv = [Tv[0] / tl, Tv[1] / tl, Tv[2] / tl];
    const cr = [n[1] * Tv[2] - n[2] * Tv[1], n[2] * Tv[0] - n[0] * Tv[2], n[0] * Tv[1] - n[1] * Tv[0]];
    const Bauth = cr;                       // naive: always +cross(N,T)
    const Bcorr = s > 0 ? cr : cr.map((x) => -x); // certified: w = UV handedness
    const Btrue = Bcorr;
    let aSum = 0, cSum = 0, aMax = 0, cMax = 0;
    for (let k = 0; k < samples; k++) {
      const th = (2 * Math.PI * k) / samples;
      const x = polar * Math.cos(th), y = polar * Math.sin(th);
      const va = [x * Tv[0] + y * Bauth[0] + zs * n[0], x * Tv[1] + y * Bauth[1] + zs * n[1], x * Tv[2] + y * Bauth[2] + zs * n[2]];
      const vc = [x * Tv[0] + y * Bcorr[0] + zs * n[0], x * Tv[1] + y * Bcorr[1] + zs * n[1], x * Tv[2] + y * Bcorr[2] + zs * n[2]];
      const vt = [x * Tv[0] + y * Btrue[0] + zs * n[0], x * Tv[1] + y * Btrue[1] + zs * n[1], x * Tv[2] + y * Btrue[2] + zs * n[2]];
      const ea = angle(va, vt), ec = angle(vc, vt);
      aSum += ea; cSum += ec;
      if (ea > aMax) aMax = ea;
      if (ec > cMax) cMax = ec;
    }
    authErr[t] = aSum / samples; corrErr[t] = cSum / samples;
    authWorst[t] = aMax; corrWorst[t] = cMax;
  }
  const mean = (arr, ids) => (ids.length ? ids.reduce((s, i) => s + arr[i], 0) / ids.length : 0);
  const max = (arr, ids) => (ids.length ? ids.reduce((s, i) => Math.max(s, arr[i]), 0) : 0);
  const right = [];
  for (let i = 0; i < nt; i++) if (handed.signs[i] === 1) right.push(i);
  return {
    authoredMeanMirrored: mean(authErr, handed.mirrored),
    authoredMaxMirrored: max(authErr, handed.mirrored),
    authoredMeanRight: mean(authErr, right),
    authoredMaxRight: max(authErr, right),
    authoredWorstSampleMirrored: max(authWorst, handed.mirrored),
    correctedMaxSampleAll: max(corrWorst, handed.mirrored.concat(right, handed.degenerate)),
    correctedMaxAll: max(corrErr, handed.mirrored.concat(right, handed.degenerate)),
    correctedMeanAll: mean(corrErr, handed.mirrored.concat(right, handed.degenerate)),
    samplesPerTriangle: samples,
    polar,
  };
}

export function certify(mesh, opts = {}) {
  const handed = classifyHandedness(mesh, opts);
  const tangents = accumulateTangents(mesh);
  const err = shadingErrorDegrees(mesh, handed, opts);
  return {
    triangles: mesh.indices.length / 3,
    vertices: mesh.positions.length / 3,
    mirrored: handed.mirrored.length,
    rightHanded: handed.signs.reduce((s, x) => s + (x === 1 ? 1 : 0), 0),
    degenerateUv: handed.degenerate.length,
    maxAbsArea: handed.maxAbsArea,
    epsRel: handed.epsRel,
    epsAbsolute: handed.epsAbsolute,
    ...err,
    tangentCount: tangents.length / 4,
    handedness: handed,
  };
}

/**
 * Independent oracle: handedness from the sign of dot(cross(N, T_g), e_uv)
 * with per-vertex accumulated T_g and a tolerance relative to |T_g·e_uv|.
 * Different formulation and different threshold from classifyHandedness.
 */
export function oracleSigns(mesh, opts = {}) {
  const { positions, uvs, indices } = mesh;
  const tolRel = opts.tolRel ?? 1e-9;
  const nt = indices.length / 3;
  const signs = new Int8Array(nt);
  let decisive = 0;
  for (let t = 0; t < nt; t++) {
    const ia = indices[t * 3], ib = indices[t * 3 + 1], ic = indices[t * 3 + 2];
    const p1 = [positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]];
    const e1 = [positions[ib * 3] - p1[0], positions[ib * 3 + 1] - p1[1], positions[ib * 3 + 2] - p1[2]];
    const e2 = [positions[ic * 3] - p1[0], positions[ic * 3 + 1] - p1[1], positions[ic * 3 + 2] - p1[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nl = Math.hypot(n[0], n[1], n[2]);
    if (nl === 0) { signs[t] = 0; continue; }
    // face tangent straight from the UV system (independent of the accumulation)
    const du1 = uvs[ib * 2] - uvs[ia * 2], dv1 = uvs[ib * 2 + 1] - uvs[ia * 2 + 1];
    const du2 = uvs[ic * 2] - uvs[ia * 2], dv2 = uvs[ic * 2 + 1] - uvs[ia * 2 + 1];
    const det = du1 * dv2 - du2 * dv1;
    if (det === 0) { signs[t] = 0; continue; }
    const nhat = [n[0] / nl, n[1] / nl, n[2] / nl];
    const Tf = [(du1 * e2[0] - du2 * e1[0]) / det, (du1 * e2[1] - du2 * e1[1]) / det, (du1 * e2[2] - du2 * e1[2]) / det];
    void Tf;
    // bitangent direction reconstructed from the same UV rows by a different algebra
    const Bv = [(du1 * e2[0] - du2 * e1[0]) / det, (du1 * e2[1] - du2 * e1[1]) / det, (du1 * e2[2] - du2 * e1[2]) / det];
    // cross(N, T) with T = (dv2 e1 - dv1 e2)/det
    const Tx = [(dv2 * e1[0] - dv1 * e2[0]) / det, (dv2 * e1[1] - dv1 * e2[1]) / det, (dv2 * e1[2] - dv1 * e2[2]) / det];
    const cN_T = [nhat[1] * Tx[2] - nhat[2] * Tx[1], nhat[2] * Tx[0] - nhat[0] * Tx[2], nhat[0] * Tx[1] - nhat[1] * Tx[0]];
    // B is exactly the du-row combination: B = (du1 e2 - du2 e1)/det
    const be = [(du1 * e2[0] - du2 * e1[0]) / det, (du1 * e2[1] - du2 * e1[1]) / det, (du1 * e2[2] - du2 * e1[2]) / det];
    void Bv;
    const dot = cN_T[0] * be[0] + cN_T[1] * be[1] + cN_T[2] * be[2];
    const scale = Math.hypot(cN_T[0], cN_T[1], cN_T[2]) * Math.hypot(be[0], be[1], be[2]);
    if (scale === 0 || Math.abs(dot) <= tolRel * scale) { signs[t] = 0; continue; }
    signs[t] = dot > 0 ? 1 : -1;
    decisive++;
  }
  return { signs, decisive };
}
