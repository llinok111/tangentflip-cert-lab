// tools/gen-sample.mjs — deterministic sample meshes (two UV spheres + one with
// a collapsed UV column).  Usage: node tools/gen-sample.mjs -> data/meshes.json
import { writeFileSync, mkdirSync } from "node:fs";

function uvSphere({ rings, segs, mirrorHalf = false, collapseLon = -1, radius = 1 }) {
  const positions = [], uvs = [], indices = [];
  for (let iy = 0; iy <= rings; iy++) {
    const theta = (Math.PI * iy) / rings;
    for (let il = 0; il <= segs; il++) {
      const phi = (2 * Math.PI * il) / segs;
      positions.push(radius * Math.sin(theta) * Math.cos(phi), radius * Math.cos(theta), radius * Math.sin(theta) * Math.sin(phi));
      let u = il / segs;
      if (mirrorHalf && il >= segs / 2) u = 1 - il / segs;
      // the whole collapsed column maps to a single UV point -> zero UV area
      if (il === collapseLon) uvs.push(0.25, 0.25);
      else uvs.push(u, iy / rings);
    }
  }
  const row = segs + 1;
  for (let iy = 0; iy < rings; iy++) {
    for (let il = 0; il < segs; il++) {
      const a = iy * row + il, b = a + 1, c = a + row, d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  return { positions, uvs, indices };
}

const meshes = [
  { name: "mirror-sphere", ...uvSphere({ rings: 48, segs: 72, mirrorHalf: true }) },
  { name: "clean-sphere", ...uvSphere({ rings: 24, segs: 32 }) },
  { name: "degen-sphere", ...uvSphere({ rings: 24, segs: 32, collapseLon: 8 }) },
];

mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
const out = new URL("../data/meshes.json", import.meta.url);
writeFileSync(out, JSON.stringify({ version: 1, generator: "tools/gen-sample.mjs", meshes }));
const summary = meshes.map((m) => `${m.name}: ${m.positions.length / 3}v/${m.indices.length / 3}t`).join(", ");
console.log(`wrote data/meshes.json — ${summary}`);
