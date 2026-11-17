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
export const qbodyFor = (id) => Q !== null && (Q === '' || Q === 'all' || Q === '1' || Q.split(',').includes(id));

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
const OUTFIT = ['top', 'legs', 'shoes'];

// Clothes cut from the body itself: the triangles under each garment,
// pushed out a few millimetres along their normals and skinned to the same
// skeleton, so they bend exactly as the body does. One mesh, one draw per
// garment.
function dress(THREE, skin, colours, { bareChest }) {
  const g = skin.geometry;
  const bones = skin.skeleton.bones;
  const si = g.attributes.skinIndex;
  const sw = g.attributes.skinWeight;
  const wear = new Int8Array(si.count);
  const get = ['getX', 'getY', 'getZ', 'getW']; // (r128 has no getComponent)
  for (let v = 0; v < si.count; v++) {
    let best = 0;
    let bone = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw[get[k]](v);
      if (w > best) {
        best = w;
        bone = si[get[k]](v);
      }
    }
    const kind = WEAR[bones[bone]?.name];
    wear[v] = kind && !(bareChest && kind === 'top') ? OUTFIT.indexOf(kind) : -1;
  }
  const index = g.index ? g.index.array : Array.from({ length: si.count }, (_, i) => i);
  const parts = OUTFIT.map(() => []);
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [wear[index[t]], wear[index[t + 1]], wear[index[t + 2]]];
    // A triangle on a seam goes with the garment most of its corners are in.
    const kind = a === b || a === c ? a : b === c ? b : Math.max(a, b, c);
    if (kind >= 0) parts[kind].push(index[t], index[t + 1], index[t + 2]);
  }
  const cloth = g.clone();
  const pos = cloth.attributes.position;
  const nor = cloth.attributes.normal;
  const PUFF = [0.007, 0.009, 0.012]; // top, trousers, shoes: a little looser each
  const done = new Uint8Array(pos.count);
  const all = [];
  parts.forEach((list, k) => {
    for (const v of list)
      if (!done[v]) {
        done[v] = 1;
        pos.setXYZ(v, pos.getX(v) + nor.getX(v) * PUFF[k], pos.getY(v) + nor.getY(v) * PUFF[k], pos.getZ(v) + nor.getZ(v) * PUFF[k]);
      }
    cloth.addGroup(all.length, list.length, k);
    all.push(...list);
  });
  cloth.setIndex(all);
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  const mats = [
    new THREE.MeshStandardMaterial({ color: lin(colours.primary), roughness: 0.75, metalness: 0, skinning: true }),
    new THREE.MeshStandardMaterial({ color: lin(colours.secondary), roughness: 0.85, metalness: 0, skinning: true }),
    new THREE.MeshStandardMaterial({ color: lin(colours.accent), roughness: 0.5, metalness: 0.05, skinning: true }) // (r128 asks for skinning on the material),
  ];
  const mesh = new THREE.SkinnedMesh(cloth, mats);
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
        body.clothes = dress(THREE, skin, lookColors(char.id, opts?.look ?? 0), { bareChest: char.build === 'sumo' });
        skin.parent.add(body.clothes);
      }
      base.lean.add(root);
      // Hide the shapes, keep the picture head and what the fighter wears
      // (skirt, ponytail, scarf, pads: drawn from the same pose).
      const keep = new Set([root, base.head, ...base.worn]);
      for (const c of base.lean.children) if (!keep.has(c)) c.visible = false;
      // The picture head, sized to the model's head rather than the cartoon's.
      base.head.scale.multiplyScalar(0.72);
      if (base.gearParts.skirt) {
        base.gearParts.skirt.userData.r *= 0.8; // (a slimmer waist)
        base.gearParts.skirt.userData.rz *= 0.8;
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
      // Gear made for the shapes' proportions, moved onto this body: pads
      // on its shoulders, the topknot on top of the picture head.
      const { pads, knot } = base.gearParts;
      if (pads)
        [1, -1].forEach((side, i) => {
          bones[`upperarm_${body.sides[side]}`].getWorldPosition(v1);
          base.lean.worldToLocal(v1);
          pads[i].position.copy(v1);
          pads[i].position.y += 0.03;
          pads[i].scale.set(0.09, 0.05, 0.085);
        });
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
      if (body?.clothes) {
        body.clothes.geometry.dispose();
        for (const m of body.clothes.material) m.dispose();
      }
      base.dispose();
    },
  };
}
