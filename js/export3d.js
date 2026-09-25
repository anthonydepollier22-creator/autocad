/*
 * export3d.js — Export de la scène 3D au format glTF binaire (.glb).
 *
 * Le fichier s'ouvre dans Blender, la visionneuse 3D de Windows, Aperçu
 * (macOS), les visionneuses en ligne ou un moteur de jeu. Une primitive par
 * couleur (matériau PBR mat, double face), dimensions en mètres, Y vers le
 * haut : le plan (x, y) devient (X, Z), comme dans la vue 3D.
 */
function buildGLB(faces, opts) {
  opts = opts || {};
  const scale = opts.scale || 0.01; // la scène est en centimètres
  const name = opts.name || 'ÉlectriCAD';

  // Regroupement par apparence : couleur, transparence, émission
  const groups = new Map();
  for (const f of faces) {
    if (!f.pts || f.pts.length < 3) continue;
    const alpha = f.alpha === undefined ? 1 : f.alpha;
    const em = (f.em || 0) > 0.3 ? 1 : 0;
    const key = f.color.join(',') + '|' + (alpha < 0.99 ? alpha.toFixed(2) : '1') + '|' + em;
    let g = groups.get(key);
    if (!g) { g = { color: f.color, alpha, em, pos: [], nor: [] }; groups.set(key, g); }
    const [a, b, c] = f.pts;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]);
    n = l > 1e-9 ? [n[0] / l, n[1] / l, n[2] / l] : [0, 1, 0];
    for (let i = 1; i < f.pts.length - 1; i++) {
      for (const p of [f.pts[0], f.pts[i], f.pts[i + 1]]) {
        g.pos.push(p[0] * scale, p[1] * scale, p[2] * scale);
        g.nor.push(n[0], n[1], n[2]);
      }
    }
  }

  const lin = (c) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  const json = {
    asset: { version: '2.0', generator: 'ÉlectriCAD' },
    scene: 0,
    scenes: [{ name, nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives: [] }],
    materials: [], accessors: [], bufferViews: [], buffers: [],
  };
  const chunks = [];
  let offset = 0;
  const addView = (arr) => {
    const bytes = new Uint8Array(arr.buffer);
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target: 34962 });
    chunks.push(bytes);
    offset += bytes.length; // Float32 : toujours multiple de 4
    return json.bufferViews.length - 1;
  };
  for (const g of groups.values()) {
    const count = g.pos.length / 3;
    if (!count) continue;
    const pos = new Float32Array(g.pos), nor = new Float32Array(g.nor);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) { if (pos[i + k] < min[k]) min[k] = pos[i + k]; if (pos[i + k] > max[k]) max[k] = pos[i + k]; }
    }
    json.accessors.push({ bufferView: addView(pos), componentType: 5126, count, type: 'VEC3', min, max });
    const aPos = json.accessors.length - 1;
    json.accessors.push({ bufferView: addView(nor), componentType: 5126, count, type: 'VEC3' });
    const aNor = json.accessors.length - 1;
    const rgb = g.color.map(lin);
    const mat = {
      pbrMetallicRoughness: { baseColorFactor: [rgb[0], rgb[1], rgb[2], g.alpha], metallicFactor: 0, roughnessFactor: 0.85 },
      doubleSided: true,
      alphaMode: g.alpha < 0.99 ? 'BLEND' : 'OPAQUE',
    };
    if (g.em) mat.emissiveFactor = rgb;
    json.materials.push(mat);
    json.meshes[0].primitives.push({ attributes: { POSITION: aPos, NORMAL: aNor }, material: json.materials.length - 1, mode: 4 });
  }
  json.buffers.push({ byteLength: offset });

  // Conteneur GLB : en-tête, bloc JSON (espaces de bourrage), bloc binaire
  const enc = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = Math.ceil(enc.length / 4) * 4, binLen = Math.ceil(offset / 4) * 4;
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const out = new ArrayBuffer(total), dv = new DataView(out), u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true); // « glTF »
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true); // « JSON »
  u8.set(enc, 20);
  for (let i = 20 + enc.length; i < 20 + jsonLen; i++) u8[i] = 0x20;
  let p = 20 + jsonLen;
  dv.setUint32(p, binLen, true);
  dv.setUint32(p + 4, 0x004e4942, true); // « BIN »
  p += 8;
  for (const c of chunks) { u8.set(c, p); p += c.length; }
  return out;
}
