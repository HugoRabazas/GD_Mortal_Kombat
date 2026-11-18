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
        // (a little of the skin's shading shows through: muscle under a tight suit)
        diffuseColor.rgb = mix(diffuseColor.rgb, cloth * (0.75 + 0.5 * dot(diffuseColor.rgb, vec3(0.33))), clothed);`,
      );
  };
  mat.needsUpdate = true;
}

// Where a skirt sits on this body, in its rest pose and the mesh's own
// space: the hem just above the knees, the waistband a little above the
// hip joints, and the directions up, to the left thigh and forward.
function skirtFrame(THREE, skin) {
  const bones = skin.skeleton.bones;
  const at = (name) => {
    const i = bones.findIndex((b) => b.name === name);
    // Where the bone stood when the body was bound, in the mesh's own space.
    const m = new THREE.Matrix4().copy(skin.skeleton.boneInverses[i]).invert();
    return { i, p: new THREE.Vector3().setFromMatrixPosition(m).applyMatrix4(skin.bindMatrixInverse) };
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
  const bottom = knees.clone().addScaledVector(up, 0.12 * legLen); // the hem, just above the knees
  const height = top.distanceTo(bottom);
  return { pelvis, L, R, up, side, fwd, legLen, top, bottom, height };
}

// The skirt, made once from the body it is for. In the body's rest pose
// (standing, legs straight) it is cut in rings from the waist to just above
// the knee; each ring follows the outline of the hips and thighs at that
// height - for each direction round the body, as far out as the body's
// skin reaches (so between the legs it spans the gap, as cloth does) - plus
// a little ease that grows towards the hem. It is skinned to the same
// skeleton: the waist to the hips, and lower down more and more to the
// thigh on its own side (the front and back middle shared by both), so it
// moves with the legs, stretching between them in a kick, never left
// behind like a shape set on top.
const SKIRT_ROWS = 9;
const SKIRT_COLS = 40;
function tailorSkirt(THREE, skin, look) {
  const g = skin.geometry;
  const { pelvis, L, R, up, side, fwd, bottom, height } = skirtFrame(THREE, skin);
  // The body's skin, in that frame: height above the hem, and where it is.
  const pos = g.attributes.position;
  const pts = [];
  const v = new THREE.Vector3();
  for (let k = 0; k < pos.count; k++) {
    v.fromBufferAttribute(pos, k).sub(bottom);
    const h = v.dot(up);
    if (h < -0.05 * height || h > height * 1.05) continue;
    pts.push(h, v.dot(side), v.dot(fwd));
  }
  const n = SKIRT_ROWS * SKIRT_COLS;
  const P = new Float32Array(n * 3);
  const SI = new Uint16Array(n * 4);
  const SW = new Float32Array(n * 4);
  const band = (height / (SKIRT_ROWS - 1)) * 0.75;
  // How far out the body reaches, ring by ring, in each direction round it.
  const reach = [];
  for (let r = 0; r < SKIRT_ROWS; r++) {
    const h = height * (1 - r / (SKIRT_ROWS - 1));
    const ring = [];
    for (let c = 0; c < SKIRT_COLS; c++) {
      const a = (c / SKIRT_COLS) * Math.PI * 2;
      let out = 0.03;
      for (let k = 0; k < pts.length; k += 3) if (Math.abs(pts[k] - h) < band) out = Math.max(out, pts[k + 1] * Math.cos(a) + pts[k + 2] * Math.sin(a));
      ring.push(out);
    }
    // Smoothed round the ring (no notches or spikes), never inside the body.
    for (let pass = 0; pass < 3; pass++) {
      const was = ring.slice();
      for (let c = 0; c < SKIRT_COLS; c++) {
        const avg = (was[(c + SKIRT_COLS - 1) % SKIRT_COLS] + 2 * was[c] + was[(c + 1) % SKIRT_COLS]) / 4;
        ring[c] = Math.max(avg, was[c] * 0.985, (was[(c + SKIRT_COLS - 1) % SKIRT_COLS] + was[(c + 1) % SKIRT_COLS]) / 2);
      }
    }
    // Cloth falls from the hips: below the widest ring it does not tuck in
    // between or round the thighs.
    if (r > 0) for (let c = 0; c < SKIRT_COLS; c++) ring[c] = Math.max(ring[c], reach[r - 1][c]);
    reach.push(ring);
  }
  const centre = new THREE.Vector3();
  for (let r = 0; r < SKIRT_ROWS; r++) {
    const t = r / (SKIRT_ROWS - 1); // 0 at the waist, 1 at the hem
    const h = height * (1 - t);
    for (let c = 0; c < SKIRT_COLS; c++) {
      const a = (c / SKIRT_COLS) * Math.PI * 2;
      const ds = Math.cos(a);
      const df = Math.sin(a);
      const out = reach[r][c] + 0.012 + 0.035 * t * t; // close at the waist, a little flare at the hem
      centre.copy(bottom).addScaledVector(up, h);
      v.copy(centre).addScaledVector(side, ds * out).addScaledVector(fwd, df * out);
      const k = r * SKIRT_COLS + c;
      v.toArray(P, k * 3);
      // Hips at the top; lower down, the thigh on this side (the middle,
      // front and back, shared by both thighs).
      // (the hips keep a share all the way down, so a leg drawn far back or
      // up pulls the cloth with it softly, without a corner)
      const leg = 0.75 * t * t * (3 - 2 * t);
      const toL = THREE.MathUtils.clamp(0.5 + ds * 0.7, 0, 1);
      SI.set([pelvis.i, L.i, R.i, 0], k * 4);
      SW.set([1 - leg, leg * toL, leg * (1 - toL), 0], k * 4);
    }
  }
  const idx = [];
  for (let r = 0; r < SKIRT_ROWS - 1; r++)
    for (let c = 0; c < SKIRT_COLS; c++) {
      const a = r * SKIRT_COLS + c;
      const b = r * SKIRT_COLS + ((c + 1) % SKIRT_COLS);
      idx.push(a, a + SKIRT_COLS, b, b, a + SKIRT_COLS, b + SKIRT_COLS);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = look.clone();
  mat.side = THREE.DoubleSide;
  mat.skinning = true; // (r128 asks for it on the material)
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.bind(skin.skeleton, skin.bindMatrix);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  return mesh;
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
        dress(THREE, skin, lookColors(char.id, opts?.look ?? 0), { bareChest: char.build === 'sumo', skirt: skirtMat ? '#' + skirtMat.color.clone().convertLinearToSRGB().getHexString() : null });
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
      // The skirt: cut to the body's own hips and thighs, and skinned to
      // them (see tailorSkirt).
      if (base.gearParts.skirt && skin) {
        body.skirt = tailorSkirt(THREE, skin, base.gearParts.skirt.material);
        skin.parent.add(body.skirt);
      }
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
      body?.skirt?.geometry.dispose();
      body?.skirt?.material.dispose();
      if (body?.wrap) {
        body.wrap.geometry.dispose();
        body.wrap.material.dispose();
      }
      base.dispose();
    },
  };
}
