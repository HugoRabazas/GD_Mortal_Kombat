// The Quaternius body (prototype, behind ?qbody in the address).
//
// A real skinned character - Quaternius "Universal Base Characters", CC0 -
// instead of the body built from shapes. It does not play its own clips:
// every frame it bends its bones to the joints the game's pose system has
// just solved (see `joints` in rig3d.js), so each of the game's moves, kicks
// and guards included, looks exactly as the rules time and aim them.
//
// The body under it (rig3d.js) still runs - it solves the pose, keeps the
// alliance member's picture as the head, and shows until the model arrives,
// or for good if it cannot load (offline, no WebGL extras): only its shapes
// are hidden once the model is in.
//
// The models load once, on the first fight that needs them, from q/ next to
// the page; the glTF reader is three.js's own (r128), from the same CDN
// family as three.js itself.

import { createRig } from './rig3d.js';
import { lookColors } from '../../../shared/fighters.js';

const LOADER_URL = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js';
const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('qbody') : null;

// Which fighters the address asks for: ?qbody (or ?qbody=all) for everyone,
// ?qbody=pixie,ruko for some.
// Settings › Bodies: Quaternius (beta) turns it on for everyone (kept on the
// device, read at each new fight); ?realbody=none in the address still wins.
const chosen = () => {
  try {
    return localStorage.getItem('gd-arena-body') === 'quaternius';
  } catch {
    return false;
  }
};
const NONE = typeof location !== 'undefined' && new URLSearchParams(location.search).get('realbody') === 'none';
const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug'); // (lets a test look at the rigs)
export const qbodyFor = (id) => !NONE && ((Q !== null && (Q === '' || Q === 'all' || Q === '1' || Q.split(',').includes(id))) || chosen());

// Those in a skirt get the female base body; the rest the male one.
const bodyFile = (char) => ((char.gear || []).includes('skirt') ? 'q/body-female.json' : 'q/body-male.json');

let loader = null; // the glTF reader, once its script has arrived
const files = new Map(); // file -> Promise<ArrayBuffer>

function gltfLoader(THREE) {
  if (!loader)
    loader = new Promise((resolve, reject) => {
      if (THREE.GLTFLoader) return resolve(new THREE.GLTFLoader());
      const s = document.createElement('script');
      s.src = LOADER_URL;
      s.onload = () => (THREE.GLTFLoader ? resolve(new THREE.GLTFLoader()) : reject(new Error('no GLTFLoader')));
      s.onerror = () => reject(new Error('GLTFLoader did not load'));
      document.head.appendChild(s);
    });
  return loader;
}

function fetchFile(file) {
  if (!files.has(file))
    files.set(
      file,
      fetch(file).then((r) => {
        if (!r.ok) throw new Error(`${file}: ${r.status}`);
        return r.arrayBuffer();
      }),
    );
  return files.get(file);
}

// Bones by name, and the pairs aimed every frame: [bone, the joint it points
// at, which of the game's joints that is].
const ARM = (s) => [
  [`upperarm_${s}`, `lowerarm_${s}`, 'elbow'],
  [`lowerarm_${s}`, `hand_${s}`, 'hand'],
];
const LEG = (s) => [
  [`thigh_${s}`, `calf_${s}`, 'knee'],
  [`calf_${s}`, `foot_${s}`, 'ankle'],
];

// Closed fists: the fingers as the library's own Punch_Jab clip holds them
// (left hand; the right is its mirror, y and z negated).
const FIST = {
  index_01: [0.4452, 0.5494, -0.4452, 0.5494],
  index_02: [0.6233, 0, 0, 0.7819],
  index_03: [0.6233, 0, 0, 0.7819],
  middle_01: [0.4321, 0.5387, -0.458, 0.5597],
  middle_02: [0.6233, 0.0009, 0.0012, 0.7819],
  middle_03: [0.6233, -0.0007, -0.0009, 0.7819],
  ring_01: [0.4353, 0.5414, -0.4549, 0.5572],
  ring_02: [0.6233, 0, 0, 0.7819],
  ring_03: [0.6233, -0.0007, -0.0008, 0.7819],
  pinky_01: [0.5041, 0.5115, -0.4352, 0.543],
  pinky_02: [0.6232, -0.0201, 0.0149, 0.7817],
  pinky_03: [0.6233, 0.0004, 0.0005, 0.7819],
  thumb_01: [0.2908, 0.9496, 0.1146, 0.0212],
  thumb_02: [0.2194, 0.0238, -0.0053, 0.9753],
  thumb_03: [0.6874, -0.0003, -0.0004, 0.7263],
};

// What each bone's skin is dressed in: a top over the trunk and the upper
// arms, trousers from the hips down, shoes; forearms, hands and neck stay
// bare. (A bone not listed: bare.)
const WEAR = {
  spine_01: 'top', spine_02: 'top', spine_03: 'top', clavicle_l: 'top', clavicle_r: 'top', upperarm_l: 'top', upperarm_r: 'top',
  pelvis: 'legs', thigh_l: 'legs', thigh_r: 'legs', calf_l: 'legs', calf_r: 'legs',
  foot_l: 'shoes', foot_r: 'shoes', ball_l: 'shoes', ball_r: 'shoes',
};
const OUTFIT = ['top', 'legs', 'shoes', 'skirt']; // ('skirt': what one covers, in its colour)

// Clothes painted on the body itself. Each corner of the skin carries how
// much of it is under the top, the trousers and the shoes (the share of its
// skin that follows those bones); the graphics card blends that across each
// triangle and, where it is over a half, draws cloth in the fighter's colour
// instead of skin - so hems are smooth lines rather than the stairs of whole
// triangles, and the clothes cost no extra mesh, draw or triangle.
function dress(THREE, skin, colours, { bareChest, skirt }) {
  const g = skin.geometry;
  const bones = skin.skeleton.bones;
  const si = g.attributes.skinIndex;
  const sw = g.attributes.skinWeight;
  const get = ['getX', 'getY', 'getZ', 'getW']; // (r128 has no getComponent)
  const n = si.count;
  const wear = new Float32Array(n * 4);
  // Under a skirt, what it covers - the hips, and the legs down to its hem -
  // is dressed in the skirt's colour: wherever a leg shows through or out
  // of it, it reads as the skirt. The line on the leg is drawn at the hem's
  // height, from a share that goes smoothly from 0 to 1 across it, so it is
  // as clean as the hems of the top.
  const fr = skirt ? skirtFrame(THREE, skin) : null;
  const pos = g.attributes.position;
  const p = new THREE.Vector3();
  for (let v = 0; v < n; v++) {
    let under = 0;
    if (fr) under = THREE.MathUtils.clamp(p.fromBufferAttribute(pos, v).sub(fr.bottom).dot(fr.up) / 0.03 + 0.5, 0, 1);
    for (let k = 0; k < 4; k++) {
      const name = bones[si[get[k]](v)]?.name;
      let kind = OUTFIT.indexOf(WEAR[name]);
      if (kind < 0 || (bareChest && kind === 0)) continue;
      const w = sw[get[k]](v);
      if (fr && (name === 'pelvis' || WEAR[name] === 'legs')) {
        wear[v * 4 + 3] += w * under;
        kind = 1;
        wear[v * 4 + kind] += w * (1 - under);
        continue;
      }
      wear[v * 4 + kind] += w;
    }
  }
  g.setAttribute('wear', new THREE.BufferAttribute(wear, 4));
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  const uniforms = { cTop: { value: lin(colours.primary) }, cLegs: { value: lin(colours.secondary) }, cShoes: { value: lin(colours.accent) }, cSkirt: { value: lin(skirt || colours.accent) } };
  const mat = skin.material;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 wear;\nvarying vec4 vWear;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWear = wear;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vWear;\nuniform vec3 cTop;\nuniform vec3 cLegs;\nuniform vec3 cShoes;\nuniform vec3 cSkirt;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float clothed = step(0.5, vWear.x + vWear.y + vWear.z + vWear.w);
        float m = max(max(vWear.x, vWear.y), max(vWear.z, vWear.w));
        vec3 cloth = vWear.x >= m ? cTop : vWear.y >= m ? cLegs : vWear.z >= m ? cShoes : cSkirt;
        // (a little of the skin's shading shows through: muscle under a tight
        // suit - but not under a skirt: there it is the skirt's own plain
        // cloth, so the skin lying right under the skirt cannot be told from it)
        float plain = clothed * step(m, vWear.w) * step(0.001, vWear.w);
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(cloth * (0.75 + 0.5 * dot(diffuseColor.rgb, vec3(0.33))), cloth, plain), clothed);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.8, plain);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, geometryNormal, plain));');
  };
  mat.needsUpdate = true;
  return uniforms;
}

// Where a skirt sits on this body, in its rest pose and the mesh's own
// space: the hem a little above the knees, the waistband a little above the
// hip joints, and the directions up, to the left thigh and forward.
const SKIRT_HEM = 0.28; // how far above the knee the hem is, as a share of the thigh
const EASE = 0.02; // how far off the skin the cloth sits (m, at the model's size)
function skirtFrame(THREE, skin) {
  const bones = skin.skeleton.bones;
  // (the mesh's space when it was bound - not bindMatrixInverse, which three
  // keeps re-making from wherever the mesh stands now)
  const toMesh = new THREE.Matrix4().copy(skin.bindMatrix).invert();
  const at = (name) => {
    const i = bones.findIndex((b) => b.name === name);
    // Where the bone stood when the body was bound.
    const m = new THREE.Matrix4().copy(skin.skeleton.boneInverses[i]).invert();
    return { i, p: new THREE.Vector3().setFromMatrixPosition(m).applyMatrix4(toMesh) };
  };
  const pelvis = at('pelvis');
  const L = at('thigh_l');
  const R = at('thigh_r');
  const kneeL = at('calf_l');
  const kneeR = at('calf_r');
  const hips = new THREE.Vector3().addVectors(L.p, R.p).multiplyScalar(0.5);
  const knees = new THREE.Vector3().addVectors(kneeL.p, kneeR.p).multiplyScalar(0.5);
  const up = new THREE.Vector3().subVectors(hips, knees);
  const legLen = up.length();
  up.normalize();
  const side = new THREE.Vector3().subVectors(L.p, R.p);
  side.addScaledVector(up, -side.dot(up)).normalize(); // towards the left thigh
  const fwd = new THREE.Vector3().crossVectors(side, up);
  const top = hips.clone().addScaledVector(up, 0.1 * legLen); // the waistband, a little above the hip joints
  const bottom = knees.clone().addScaledVector(up, SKIRT_HEM * legLen); // the hem
  const height = top.distanceTo(bottom);
  return { pelvis, L, R, up, side, fwd, legLen, top, bottom, height };
}

// The skirt.
//
// Made once from the body it is for: in the body's rest pose (standing, legs
// straight) it is cut in rings from the waist to the hem; each ring follows
// the outline of the hips and thighs at that height - for each direction
// round the body, as far out as the body's skin reaches (so between the legs
// it spans the gap, as cloth does) - smoothed, never tucking in below the
// hips' widest ring, plus a little ease that grows towards the hem. Above
// the waistband one more ring follows the waist just inside the skin, so
// the skirt runs up into the body with no open edge to look into.
//
// Then, every frame, it is laid round the body as it stands (`lay`). That
// rest skirt hangs from the hips and moves with them. The hips and thighs
// themselves are worked out as they are this frame, point by point, the way
// the graphics card bends the skin. The skirt drawn is the cloth pulled taut
// round both: ring by ring, for each direction round the body, whichever
// lies furthest out that way - the skirt as it hangs, or the body's own
// skin in that ring's band (plus the ease). So where nothing pushes it the
// skirt hangs as it was cut, and no part of a leg can come through it,
// whatever the pose: a thigh that steps forward or kicks carries the cloth
// out on itself, and the cloth runs straight from there back to where it
// hangs. (A skirt skinned to the hips and thighs, as a first try was, blends
// their movements: the cloth ends half way between two legs that part, and
// the forward thigh comes through. A cone widened round the legs' joints,
// the try before, does not know how thick a leg is or where its skin is.)
const SKIRT_ROWS = 12;
const SKIRT_COLS = 40;
function tailorSkirt(THREE, skin, colour) {
  const g = skin.geometry;
  const fr = skirtFrame(THREE, skin);
  const { up, side, fwd, bottom, height } = fr;
  const N = SKIRT_COLS;
  const cosA = new Float32Array(N);
  const sinA = new Float32Array(N);
  for (let c = 0; c < N; c++) {
    cosA[c] = Math.cos((c / N) * Math.PI * 2);
    sinA[c] = Math.sin((c / N) * Math.PI * 2);
  }
  const bones = skin.skeleton.bones;
  const inverses = skin.skeleton.boneInverses;
  const YOKE = 0.05; // how far above the waistband the skirt runs into the body
  const spacing = height / (SKIRT_ROWS - 1);
  // The skin of the hips and legs near the skirt (not a hand that hangs
  // beside them): where each point is at rest - its height above the hem,
  // and across - and what it needs to be bent like the skin.
  const pos = g.attributes.position;
  const si = g.attributes.skinIndex;
  const sw = g.attributes.skinWeight;
  const get = ['getX', 'getY', 'getZ', 'getW'];
  const legs = new Set(['pelvis', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r']);
  const at = []; // per point: h, across to the side, across forward
  const restP = [];
  const boneOf = [];
  const weightOf = [];
  const legOf = []; // per point: how much of it is the left leg's, the right leg's
  const used = new Map(); // bone index -> its slot among the bones this skin needs
  for (const b of [fr.pelvis.i, fr.L.i, fr.R.i]) used.set(b, used.size); // (always: the rings' directions come from them)
  const v = new THREE.Vector3();
  for (let k = 0; k < pos.count; k++) {
    let share = 0;
    for (let j = 0; j < 4; j++) if (legs.has(bones[si[get[j]](k)]?.name)) share += sw[get[j]](k);
    if (share < 0.5) continue;
    v.fromBufferAttribute(pos, k);
    const h = v.clone().sub(bottom).dot(up);
    if (h < -0.6 * spacing || h > height + YOKE * 1.6) continue;
    restP.push(v.x, v.y, v.z);
    at.push(h, v.clone().sub(bottom).dot(side), v.clone().sub(bottom).dot(fwd));
    let onL = 0;
    let onR = 0;
    for (let j = 0; j < 4; j++) {
      const b = si[get[j]](k);
      const w = sw[get[j]](k);
      if (w > 0 && !used.has(b)) used.set(b, used.size);
      boneOf.push(w > 0 ? used.get(b) : 0);
      weightOf.push(w);
      const name = bones[b]?.name;
      if (name === 'thigh_l' || name === 'calf_l') onL += w;
      if (name === 'thigh_r' || name === 'calf_r') onR += w;
    }
    legOf.push(onL, onR);
  }
  const count = at.length / 3;
  // How far out the skin reaches at one height, in each direction.
  const outline = (h) => {
    const ring = [];
    for (let c = 0; c < N; c++) {
      let out = 0.02;
      for (let k = 0; k < at.length; k += 3) if (Math.abs(at[k] - h) < spacing * 0.75) out = Math.max(out, at[k + 1] * cosA[c] + at[k + 2] * sinA[c]);
      ring.push(out);
    }
    // Smoothed round the ring (no notches or spikes), never inside the body.
    for (let pass = 0; pass < 3; pass++) {
      const was = ring.slice();
      for (let c = 0; c < N; c++) {
        const avg = (was[(c + N - 1) % N] + 2 * was[c] + was[(c + 1) % N]) / 4;
        ring[c] = Math.max(avg, was[c] * 0.985, (was[(c + N - 1) % N] + was[(c + 1) % N]) / 2);
      }
    }
    return ring;
  };
  // Rings: row 0 is the yoke (inside the body), row 1 the waistband, the
  // last the hem.
  const ROWS = SKIRT_ROWS + 1;
  const hang = new Float32Array(ROWS * N * 3); // the skirt as it hangs from the hips
  const band = []; // per ring: which points of the skin it has to go round
  let above = null;
  const centre = new THREE.Vector3();
  for (let row = 0; row < ROWS; row++) {
    const yoke = row === 0;
    const t = yoke ? 0 : (row - 1) / (SKIRT_ROWS - 1);
    const h = yoke ? height + YOKE : height * (1 - t);
    const ring = outline(h);
    // Cloth falls from the hips: below the widest ring it does not tuck in
    // between or round the thighs.
    if (above) for (let c = 0; c < N; c++) ring[c] = Math.max(ring[c], above[c]);
    if (!yoke) above = ring;
    centre.copy(bottom).addScaledVector(up, h);
    for (let c = 0; c < N; c++) {
      const out = yoke ? Math.max(0.02, ring[c] - 0.014) : ring[c] + EASE + 0.03 * t * t; // close at the waist, a little flare at the hem
      v.copy(centre).addScaledVector(side, cosA[c] * out).addScaledVector(fwd, sinA[c] * out);
      v.toArray(hang, (row * N + c) * 3);
    }
    const mine = [];
    // (the yoke stays inside the body; the hem ring does not reach for the
    // leg below the hem)
    if (!yoke) for (let k = 0; k < count; k++) if (Math.abs(at[k * 3] - h) <= spacing * 0.6 && (row < ROWS - 1 || at[k * 3] > -0.005)) mine.push(k);
    band.push(mine);
  }
  const idx = [];
  for (let row = 0; row < ROWS - 1; row++)
    for (let c = 0; c < N; c++) {
      const a = row * N + c;
      const b = row * N + ((c + 1) % N);
      idx.push(a, b, a + N, b, b + N, a + N); // (wound so that its outside is its front)
    }
  const geo = new THREE.BufferGeometry();
  const out = new THREE.BufferAttribute(new Float32Array(ROWS * N * 3), 3);
  const nor = new THREE.BufferAttribute(new Float32Array(ROWS * N * 3), 3);
  geo.setAttribute('position', out);
  geo.setAttribute('normal', nor);
  geo.setIndex(idx);
  // (Drawn a touch nearer the eye than it is: where the cloth lies right on
  // the skin - over a raised thigh - the skin must not show through in dots.)
  const cloth = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.8, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  // Lit the same from either side: where the cloth gathers it folds back on
  // itself, and a fold seen from its back must not go dark like a crack.
  cloth.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
      vec3 normal = vNormal;
      float facing = length( normal );
      normal = facing > 0.0001 ? normal / facing : normalize( vViewPosition );
      if ( dot( normal, vViewPosition ) < 0.0 ) normal = -normal;
      vec3 geometryNormal = normal;`,
    );
  };
  const mesh = new THREE.Mesh(geo, cloth);
  mesh.castShadow = true;
  mesh.frustumCulled = false;

  // Laying it out. Where a bone takes the rest points this frame (as
  // skinning does), in `lean`'s space.
  const mats = [...used.keys()].map((i) => ({ i, m: new THREE.Matrix4() })); // (in the order of their slots)
  const slot = (i) => mats[used.get(i)].m.elements;
  const leanInv = new THREE.Matrix4();
  // (plain numbers: nothing is made per frame)
  const apply = (e, x, y, z, w, o, k) => {
    o[k] = e[0] * x + e[4] * y + e[8] * z + e[12] * w;
    o[k + 1] = e[1] * x + e[5] * y + e[9] * z + e[13] * w;
    o[k + 2] = e[2] * x + e[6] * y + e[10] * z + e[14] * w;
  };
  const posed = new Float32Array(count * 3); // the skin, as it is this frame
  const ring = new Float32Array(N * 3); // one ring of the hanging skirt, this frame
  const tmp = new Float32Array(21);
  const keep = new Float32Array(2); // how much of each thigh's length the skirt still goes round
  const hipsMid = fr.L.p.clone().add(fr.R.p).multiplyScalar(0.5);
  const smooth = (a, b, x) => {
    const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  function lay(lean) {
    leanInv.copy(lean.matrixWorld).invert();
    for (const b of mats) b.m.multiplyMatrices(bones[b.i].matrixWorld, inverses[b.i]).multiply(skin.bindMatrix).premultiply(leanInv);
    const eP = slot(fr.pelvis.i);
    const eL = slot(fr.L.i);
    const eR = slot(fr.R.i);
    // Which way is down for the hips, and along each thigh; where the hip
    // joints are.
    // tmp: 0 hips' down, 3 left thigh's, 6 right thigh's, 9 to the left, 12 left hip joint, 15 right, 18 between them
    apply(eP, -up.x, -up.y, -up.z, 0, tmp, 0);
    apply(eL, -up.x, -up.y, -up.z, 0, tmp, 3);
    apply(eR, -up.x, -up.y, -up.z, 0, tmp, 6);
    apply(eP, side.x, side.y, side.z, 0, tmp, 9);
    for (let k = 0; k < 9; k += 3) {
      const l = Math.hypot(tmp[k], tmp[k + 1], tmp[k + 2]) || 1;
      tmp[k] /= l;
      tmp[k + 1] /= l;
      tmp[k + 2] /= l;
    }
    apply(eL, fr.L.p.x, fr.L.p.y, fr.L.p.z, 1, tmp, 12);
    apply(eR, fr.R.p.x, fr.R.p.y, fr.R.p.z, 1, tmp, 15);
    apply(eP, hipsMid.x, hipsMid.y, hipsMid.z, 1, tmp, 18);
    // Riding up. Cloth pulled over a thigh lifted in a step or a kick
    // reaches its hem line; lifted high - a knee drawn to the chest, a
    // crouch, a roll - a skirt rides up the thigh and gathers at the hip
    // instead (and stretched to a knee up there it would be a tent, not a
    // skirt). So past a thigh raised most of the way to level the skirt takes
    // that thigh as shorter than it is, the more the higher it goes: its
    // skin, from the hip joint on, is drawn in along the thigh. The skirt as
    // it hangs shortens the same way, with whichever thigh is higher (it
    // would otherwise hang through the leg), and draws in - so that round
    // the other thigh it is that thigh's own skin, at its full length, that
    // the cloth goes round, and the hem stays down on the leg that stands.
    for (let i = 0; i < 2; i++) {
      const cos = tmp[0] * tmp[3 + i * 3] + tmp[1] * tmp[4 + i * 3] + tmp[2] * tmp[5 + i * 3];
      const lifted = (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
      keep[i] = 1 - 0.7 * smooth(72, 125, lifted);
    }
    const keepHang = Math.min(keep[0], keep[1]);
    // The skin under the skirt, bent as the graphics card bends it.
    for (let k = 0; k < count; k++) {
      const x = restP[k * 3];
      const y = restP[k * 3 + 1];
      const z = restP[k * 3 + 2];
      let px = 0;
      let py = 0;
      let pz = 0;
      for (let j = 0; j < 4; j++) {
        const w = weightOf[k * 4 + j];
        if (w === 0) continue;
        const e = mats[boneOf[k * 4 + j]].m.elements;
        px += w * (e[0] * x + e[4] * y + e[8] * z + e[12]);
        py += w * (e[1] * x + e[5] * y + e[9] * z + e[13]);
        pz += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
      }
      for (let i = 0; i < 2; i++) {
        const mine = legOf[k * 2 + i];
        if (mine === 0 || keep[i] === 1) continue;
        const a = 3 + i * 3; // (that thigh's direction)
        const j = 12 + i * 3; // (its hip joint)
        const along = (px - tmp[j]) * tmp[a] + (py - tmp[j + 1]) * tmp[a + 1] + (pz - tmp[j + 2]) * tmp[a + 2];
        if (along <= 0) continue;
        const back = along * (1 - keep[i]) * mine;
        px -= tmp[a] * back;
        py -= tmp[a + 1] * back;
        pz -= tmp[a + 2] * back;
      }
      posed[k * 3] = px;
      posed[k * 3 + 1] = py;
      posed[k * 3 + 2] = pz;
    }
    // The rings' own directions: down (n) leans towards where the thighs
    // point - so that over a raised thigh it is its top that counts as
    // furthest out, and the cloth lies on it, not under it - with
    // to-the-left (s) and forward (f) square to it.
    let nx = 2 * tmp[0] + keep[0] * tmp[3] + keep[1] * tmp[6];
    let ny = 2 * tmp[1] + keep[0] * tmp[4] + keep[1] * tmp[7];
    let nz = 2 * tmp[2] + keep[0] * tmp[5] + keep[1] * tmp[8];
    let l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    let sx = tmp[9];
    let sy = tmp[10];
    let sz = tmp[11];
    const sn = sx * nx + sy * ny + sz * nz;
    sx -= nx * sn;
    sy -= ny * sn;
    sz -= nz * sn;
    l = Math.hypot(sx, sy, sz) || 1;
    sx /= l;
    sy /= l;
    sz /= l;
    const fx = ny * sz - nz * sy; // f = n x s
    const fy = nz * sx - nx * sz;
    const fz = nx * sy - ny * sx;
    const o = out.array;
    for (let row = 0; row < ROWS; row++) {
      for (let c = 0; c < N; c++) {
        const k = (row * N + c) * 3;
        apply(eP, hang[k], hang[k + 1], hang[k + 2], 1, ring, c * 3);
        if (keepHang < 1) {
          const q = c * 3;
          const below = (ring[q] - tmp[18]) * tmp[0] + (ring[q + 1] - tmp[19]) * tmp[1] + (ring[q + 2] - tmp[20]) * tmp[2];
          if (below > 0) {
            // (in towards the hips' axis, then up it)
            const inK = (1 - keepHang) * 0.7 * smooth(0, 0.4 * height, below);
            const ox = ring[q] - tmp[18] - tmp[0] * below;
            const oy = ring[q + 1] - tmp[19] - tmp[1] * below;
            const oz = ring[q + 2] - tmp[20] - tmp[2] * below;
            ring[q] -= ox * inK + tmp[0] * below * (1 - keepHang);
            ring[q + 1] -= oy * inK + tmp[1] * below * (1 - keepHang);
            ring[q + 2] -= oz * inK + tmp[2] * below * (1 - keepHang);
          }
        }
      }
      const mine = band[row];
      // The cloth pulled taut: for each direction round the ring, the
      // furthest out that way - of the hanging skirt, or of the skin here
      // (and then the ease beyond it).
      for (let c = 0; c < N; c++) {
        const dx = sx * cosA[c] + fx * sinA[c];
        const dy = sy * cosA[c] + fy * sinA[c];
        const dz = sz * cosA[c] + fz * sinA[c];
        let far = -Infinity;
        let bx = 0;
        let by = 0;
        let bz = 0;
        for (let k = 0; k < N * 3; k += 3) {
          const d = ring[k] * dx + ring[k + 1] * dy + ring[k + 2] * dz;
          if (d > far) {
            far = d;
            bx = ring[k];
            by = ring[k + 1];
            bz = ring[k + 2];
          }
        }
        for (let j = 0; j < mine.length; j++) {
          const k = mine[j] * 3;
          const d = posed[k] * dx + posed[k + 1] * dy + posed[k + 2] * dz + EASE;
          if (d > far) {
            far = d;
            bx = posed[k] + dx * EASE;
            by = posed[k + 1] + dy * EASE;
            bz = posed[k + 2] + dz * EASE;
          }
        }
        const k = (row * N + c) * 3;
        o[k] = bx;
        o[k + 1] = by;
        o[k + 2] = bz;
      }
    }
    out.needsUpdate = true;
    // Which way each point of the cloth faces, for the light: square to the
    // cloth round the ring and down the skirt there. (Worked out here rather
    // than from the triangles: where a ring puts several of its points on
    // one spot - a corner of the body - the triangles between them have no
    // size and no facing, and the light drew dark scratches along them.)
    const q = nor.array;
    for (let row = 0; row < ROWS; row++) {
      const r0 = (row > 0 ? row - 1 : row) * N;
      const r1 = (row < ROWS - 1 ? row + 1 : row) * N;
      for (let c = 0; c < N; c++) {
        const k = (row * N + c) * 3;
        // round the ring: the nearest points either way that are somewhere else
        let a = k;
        let b = k;
        for (let step = 1; step < N / 4; step++) {
          a = (row * N + ((c + step) % N)) * 3;
          if ((o[a] - o[k]) ** 2 + (o[a + 1] - o[k + 1]) ** 2 + (o[a + 2] - o[k + 2]) ** 2 > 1e-8) break;
        }
        for (let step = 1; step < N / 4; step++) {
          b = (row * N + ((c + N - step) % N)) * 3;
          if ((o[b] - o[k]) ** 2 + (o[b + 1] - o[k + 1]) ** 2 + (o[b + 2] - o[k + 2]) ** 2 > 1e-8) break;
        }
        const ux = o[a] - o[b];
        const uy = o[a + 1] - o[b + 1];
        const uz = o[a + 2] - o[b + 2];
        // down the skirt (or, where the rings above and below meet, plain down)
        const d0 = (r0 + c) * 3;
        const d1 = (r1 + c) * 3;
        let vx = o[d1] - o[d0];
        let vy = o[d1 + 1] - o[d0 + 1];
        let vz = o[d1 + 2] - o[d0 + 2];
        if (vx * vx + vy * vy + vz * vz < 1e-8) {
          vx = nx;
          vy = ny;
          vz = nz;
        }
        let x = uy * vz - uz * vy;
        let y = uz * vx - ux * vz;
        let z = ux * vy - uy * vx;
        let l = Math.hypot(x, y, z);
        // straight out from the ring, this way round it
        const ox = sx * cosA[c] + fx * sinA[c];
        const oy = sy * cosA[c] + fy * sinA[c];
        const oz = sz * cosA[c] + fz * sinA[c];
        if (l < 1e-9) {
          // (nothing to go by)
          x = ox;
          y = oy;
          z = oz;
          l = 1;
        } else if (x * ox + y * oy + z * oz < 0) {
          // (where rings cross as the cloth gathers, the facing comes out
          // inwards: next to outward ones it would blend to nothing, and
          // nothing is drawn black)
          l = -l;
        }
        // (leaning a little towards straight out: neighbours then never
        // face opposite ways, which between them would blend to nothing)
        x = x / l + ox * 0.4;
        y = y / l + oy * 0.4;
        z = z / l + oz * 0.4;
        l = Math.hypot(x, y, z);
        q[k] = x / l;
        q[k + 1] = y / l;
        q[k + 2] = z / l;
      }
    }
    nor.needsUpdate = true;
  }
  return { mesh, lay, frame: fr };
}

export function createQRig(THREE, scene, char, opts) {
  const base = createRig(THREE, scene, char, opts);
  let body = null; // { root, bones, rest, scale, sides }
  let gone = false;

  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const v3 = new THREE.Vector3();
  const q1 = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  const Z_AXIS = new THREE.Vector3(0, 0, 1); // (a torus's axis)

  Promise.all([gltfLoader(THREE), fetchFile(bodyFile(char))])
    .then(([gl, buf]) => new Promise((resolve, reject) => gl.parse(buf.slice(0), '', resolve, reject)))
    .then((gltf) => {
      if (gone) return;
      const root = gltf.scene;
      const bones = {};
      root.traverse((o) => {
        if (o.isBone) bones[o.name] = o;
        if (o.isMesh) {
          o.castShadow = true;
          o.frustumCulled = false; // (skinned: its box does not follow the pose)
          if (o.material.map) o.material.map.encoding = THREE.sRGBEncoding;
        }
      });
      if (!bones.pelvis || !bones.Head) throw new Error('unexpected skeleton');
      // The model faces +z; the pose is drawn facing +x (side view).
      root.rotation.y = Math.PI / 2;
      // Sized so its legs are as long as the pose's.
      root.updateMatrixWorld(true);
      const p = (b) => b.getWorldPosition(new THREE.Vector3());
      const legLen = p(bones.thigh_l).distanceTo(p(bones.calf_l)) + p(bones.calf_l).distanceTo(p(bones.foot_l));
      // Fists closed, for good: the pose's hands are always fists.
      for (const [name, [x, y, z, w]] of Object.entries(FIST)) {
        bones[`${name}_l`]?.quaternion.set(x, y, z, w);
        bones[`${name}_r`]?.quaternion.set(x, -y, -z, w);
      }
      body = { root, bones, rest: new Map(), legLen, sides: null };
      for (const b of Object.values(bones)) body.rest.set(b, b.quaternion.clone());
      // The sumo's build: a belly (the lower spine widened, the chest
      // above it kept), thick thighs and calves. Each bone hands its scale
      // down to its children, so the next one along undoes it.
      if (char.build === 'sumo') {
        const widen = (name, k, child) => {
          bones[name].scale.set(k, 1, k);
          if (child) bones[child].scale.set(1 / k, 1, 1 / k);
        };
        widen('spine_01', 1.9, null);
        bones.spine_02.scale.set(1.2 / 1.9, 1, 1.2 / 1.9); // (the chest a little broad too)
        bones.spine_03.scale.set(1 / 1.2, 1, 1 / 1.2);
        for (const s of ['l', 'r']) {
          widen(`thigh_${s}`, 1.4, null);
          bones[`calf_${s}`].scale.set(1.25 / 1.4, 1, 1.25 / 1.4);
          bones[`foot_${s}`].scale.set(1 / 1.25, 1, 1 / 1.25);
        }
      }
      // The model's own head is folded away: the alliance member's picture
      // stays the face.
      bones.Head.scale.setScalar(0.001);
      // Clothes in the fighter's colours (the sumo fights bare-chested).
      let skin = null;
      root.traverse((o) => {
        if (o.isSkinnedMesh && (!skin || o.geometry.attributes.position.count > skin.geometry.attributes.position.count)) skin = o;
      });
      if (skin) {
        const skirtMat = base.gearParts.skirt?.material;
        body.paint = dress(THREE, skin, lookColors(char.id, opts?.look ?? 0), { bareChest: char.build === 'sumo', skirt: skirtMat ? '#' + skirtMat.color.clone().convertLinearToSRGB().getHexString() : null });
      }
      base.lean.add(root);
      // Hide the shapes, keep the picture head and what the fighter wears
      // (skirt, ponytail, scarf, pads: drawn from the same pose).
      // (Not the pads nor the trailing scarf: made for the shapes, they
      // looked wrong on this body. The scarf becomes a wrap round the neck.)
      const { scarf, pads } = base.gearParts;
      const drop = new Set([...(pads || []), ...(scarf ? [scarf.knot, scarf.a, scarf.b] : []), base.gearParts.skirt]);
      const keep = new Set([root, base.head, ...base.worn.filter((m) => !drop.has(m))]);
      if (scarf) {
        const col = lookColors(char.id, opts?.look ?? 0);
        const wrap = new THREE.Mesh(
          new THREE.TorusGeometry(0.075, 0.038, 10, 24),
          new THREE.MeshStandardMaterial({ color: new THREE.Color(col.accent).convertSRGBToLinear(), roughness: 0.8, metalness: 0 }),
        );
        wrap.castShadow = true;
        base.lean.add(wrap); // (laid round the neck every frame, in update)
        body.wrap = wrap;
      }
      for (const c of base.lean.children) if (!keep.has(c)) c.visible = false;
      // The picture head, sized to the model's head rather than the cartoon's.
      base.head.scale.multiplyScalar(0.64);
      // A slim frame round the picture, metal rather than glowing: a medallion
      // worn as a face, not a halo.
      for (const c of base.head.children)
        if (c.geometry?.type === 'TorusGeometry') {
          c.geometry = new THREE.TorusGeometry(1.0, 0.035, 8, 48);
          body.frame = c.geometry;
        }
      for (const t of base.gearParts.tail) t.scale.multiplyScalar(0.7); // (sized to the smaller head)
      base.gearParts.ring.emissiveIntensity = 0.12;
      base.gearParts.ring.metalness = 0.75;
      base.gearParts.ring.roughness = 0.3;
      // The skirt: cut to the body's own hips and thighs, and laid round the
      // legs every frame (see tailorSkirt).
      if (base.gearParts.skirt && skin) {
        body.skirt = tailorSkirt(THREE, skin, base.gearParts.skirt.material.color);
        base.lean.add(body.skirt.mesh); // (its points are worked out in `lean`'s space)
      }
      if (DEBUG) (window.gdQ = window.gdQ || []).push({ id: char.id, skin, bones, skirt: body.skirt?.mesh, frame: body.skirt?.frame, paint: body.paint, lean: base.lean });
    })
    .catch((e) => console.warn('Quaternius body unavailable:', e.message));

  // Turns `bone` (in world space) so the direction to `child` points at `target`.
  function aim(bone, child, target) {
    bone.getWorldPosition(v1);
    child.getWorldPosition(v2);
    v2.sub(v1).normalize();
    v3.copy(target).sub(v1);
    if (v3.lengthSq() < 1e-8) return;
    v3.normalize();
    q1.setFromUnitVectors(v2, v3); // the turn needed, in world space
    bone.getWorldQuaternion(q2);
    q2.premultiply(q1); // the bone's new world rotation
    bone.parent.getWorldQuaternion(q1).invert();
    bone.quaternion.copy(q1.multiply(q2));
    bone.updateMatrixWorld(true);
  }

  const world = (v) => base.lean.localToWorld(v3.copy(v)).clone();

  return {
    ...base,
    update(f, now, camera) {
      base.update(f, now, camera);
      if (!body) return;
      const { root, bones, rest } = body;
      const J = base.joints;
      for (const [b, r] of rest) b.quaternion.copy(r);
      // Scale to the pose's leg length (the pose's units are already world units).
      const poseLeg = J.side[1].hip.distanceTo(J.side[1].knee) + J.side[1].knee.distanceTo(J.side[1].ankle);
      root.scale.setScalar(poseLeg / body.legLen);
      // Pelvis on the pose's hips.
      root.position.set(0, 0, 0);
      root.updateMatrixWorld(true);
      bones.pelvis.getWorldPosition(v1);
      base.lean.worldToLocal(v1);
      root.position.add(v2.copy(J.hip).sub(v1));
      root.updateMatrixWorld(true);
      // Which of the model's sides is the pose's near (+z) side: whichever its
      // left thigh sits on.
      if (!body.sides) {
        bones.thigh_l.getWorldPosition(v1);
        base.lean.worldToLocal(v1);
        body.sides = v1.z > 0 ? { 1: 'l', [-1]: 'r' } : { 1: 'r', [-1]: 'l' };
      }
      // Spine to the neck, neck to the head.
      aim(bones.spine_01, bones.neck_01, world(J.neck));
      aim(bones.neck_01, bones.Head, world(J.head));
      for (const side of [1, -1]) {
        const s = body.sides[side];
        const L = J.side[side];
        for (const [b, c, key] of [...ARM(s), ...LEG(s)]) aim(bones[b], bones[c], world(L[key]));
      }
      if (body.skirt) body.skirt.lay(base.lean);
      // The neck wrap: round the neck, just above the shoulders, square to it.
      if (body.wrap) {
        const w = body.wrap;
        v1.subVectors(J.head, J.neck);
        w.position.copy(J.neck).addScaledVector(v1, 0.18);
        w.quaternion.setFromUnitVectors(Z_AXIS, v1.normalize());
        w.scale.setScalar(root.scale.x * 1.05);
      }
      // The topknot, made for the shapes' proportions, moved onto the
      // picture head.
      // The picture sits on the model's neck: its centre where the model's
      // head would be (the head bone, a little up), and the ponytail moves
      // with it.
      bones.Head.getWorldPosition(v1);
      base.lean.worldToLocal(v1);
      v1.y += base.head.scale.y * 0.78;
      v2.copy(base.head.position); // (where the pose put it)
      base.head.position.copy(v1);
      // (the ponytail drawn closer in, as the head is smaller)
      for (const t of base.gearParts.tail) t.position.sub(v2).multiplyScalar(0.7).add(v1);
      const { knot } = base.gearParts;
      if (knot) {
        knot.position.copy(base.head.position);
        knot.position.y += base.head.scale.y * 0.95;
      }
    },
    setOutline(on) {
      base.setOutline(on);
    },
    dispose() {
      gone = true;
      body?.frame?.dispose();
      body?.skirt?.mesh.geometry.dispose();
      body?.skirt?.mesh.material.dispose();
      if (body?.wrap) {
        body.wrap.geometry.dispose();
        body.wrap.material.dispose();
      }
      base.dispose();
    },
  };
}
