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

// Fighters drawn with the model's own head (prototype): a hairstyle from the
// library in their hair colour, their eye colour, and a bow for Gleh. The
// rest keep the alliance member's picture as the head.
const HEADS = {
  ruko: { hair: 'simpleparted', color: '#1a1416' },
  zelrith: { hair: 'simpleparted', color: '#f3cf4a', eyes: '#4fbf6a' },
  meru: { hair: 'long', color: '#161214' },
  gleh: { hair: 'long', color: '#141012', bow: '#b8a2e6' },
};

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

// Clothes painted on the body itself. Each corner of the skin carries how
// much of it is under the top, the trousers and the shoes (the share of its
// skin that follows those bones); the graphics card blends that across each
// triangle and, where it is over a half, draws cloth in the fighter's colour
// instead of skin - so hems are smooth lines rather than the stairs of whole
// triangles, and the clothes cost no extra mesh, draw or triangle.
function dress(THREE, skin, colours, { bareChest }) {
  const g = skin.geometry;
  const bones = skin.skeleton.bones;
  const si = g.attributes.skinIndex;
  const sw = g.attributes.skinWeight;
  const get = ['getX', 'getY', 'getZ', 'getW']; // (r128 has no getComponent)
  const n = si.count;
  const wear = new Float32Array(n * 3);
  for (let v = 0; v < n; v++)
    for (let k = 0; k < 4; k++) {
      const kind = OUTFIT.indexOf(WEAR[bones[si[get[k]](v)]?.name]);
      if (kind < 0 || (bareChest && kind === 0)) continue;
      wear[v * 3 + kind] += sw[get[k]](v);
    }
  g.setAttribute('wear', new THREE.BufferAttribute(wear, 3));
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  const uniforms = { cTop: { value: lin(colours.primary) }, cLegs: { value: lin(colours.secondary) }, cShoes: { value: lin(colours.accent) } };
  const mat = skin.material;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 wear;\nvarying vec3 vWear;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWear = wear;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWear;\nuniform vec3 cTop;\nuniform vec3 cLegs;\nuniform vec3 cShoes;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float clothed = step(0.5, vWear.x + vWear.y + vWear.z);
        float m = max(vWear.x, max(vWear.y, vWear.z));
        vec3 cloth = vWear.x >= m ? cTop : vWear.y >= m ? cLegs : cShoes;
        // (a little of the skin's shading shows through: muscle under a tight suit)
        diffuseColor.rgb = mix(diffuseColor.rgb, cloth * (0.75 + 0.5 * dot(diffuseColor.rgb, vec3(0.33))), clothed);`,
      );
  };
  mat.needsUpdate = true;
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
      // stays the face. (Unless this fighter has a head of their own.)
      const own = HEADS[char.id];
      if (!own) bones.Head.scale.setScalar(0.001);
      // Clothes in the fighter's colours (the sumo fights bare-chested).
      let skin = null;
      root.traverse((o) => {
        if (o.isSkinnedMesh && (!skin || o.geometry.attributes.position.count > skin.geometry.attributes.position.count)) skin = o;
      });
      if (skin) dress(THREE, skin, lookColors(char.id, opts?.look ?? 0), { bareChest: char.build === 'sumo' });
      base.lean.add(root);
      // Hide the shapes, keep the picture head and what the fighter wears
      // (skirt, ponytail, scarf, pads: drawn from the same pose).
      // (Not the pads nor the trailing scarf: made for the shapes, they
      // looked wrong on this body. The scarf becomes a wrap round the neck.)
      const { scarf, pads } = base.gearParts;
      const drop = new Set([...(pads || []), ...(scarf ? [scarf.knot, scarf.a, scarf.b] : [])]);
      if (own) for (const m of [base.head, base.gearParts.knot, ...base.gearParts.tail]) drop.add(m); // (the hairstyle replaces the ponytail)
      const keep = new Set([root, base.head, ...base.worn.filter((m) => !drop.has(m))]);
      if (own) keep.delete(base.head);
      if (own && skin) wearHead(own, skin, bones);
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
      base.head.scale.multiplyScalar(0.72);
      if (base.gearParts.skirt) {
        base.gearParts.skirt.userData.r *= 0.8; // (a slimmer waist)
        base.gearParts.skirt.userData.rz *= 0.8;
      }
    })
    .catch((e) => console.warn('Quaternius body unavailable:', e.message));

  // The model's own head: eye colour now, the hairstyle (and a bow) when it
  // arrives, skinned to this body's head bone.
  function wearHead(own, skin, bones) {
    const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
    skin.parent.traverse((o) => {
      if (o.isMesh && own.eyes && /eye/i.test(o.material.name)) o.material.color = lin(own.eyes);
    });
    Promise.all([gltfLoader(THREE), fetchFile(`q/hair-${own.hair}.json`)])
      .then(([gl, buf]) => new Promise((resolve, reject) => gl.parse(buf.slice(0), '', resolve, reject)))
      .then((g) => {
        if (gone) return;
        let hair = null;
        g.scene.traverse((o) => {
          if (o.isSkinnedMesh) hair = o;
        });
        if (!hair) throw new Error('no hair mesh');
        const sk = hair.skeleton;
        hair.bind(new THREE.Skeleton(sk.bones.map((b) => bones[b.name]), sk.boneInverses), hair.bindMatrix);
        hair.material.color = lin(own.color);
        hair.material.alphaTest = 0.4;
        hair.material.side = THREE.DoubleSide;
        hair.castShadow = true;
        hair.frustumCulled = false;
        skin.parent.add(hair);
        if (own.bow) {
          // Two loops and a knot at the back of the head.
          const m = new THREE.MeshStandardMaterial({ color: lin(own.bow), roughness: 0.6 });
          const bow = new THREE.Group();
          for (const side of [-1, 1]) {
            const loop = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), m);
            loop.scale.set(1, 0.6, 0.35);
            loop.position.set(side * 0.05, 0, 0);
            bow.add(loop);
          }
          bow.add(new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), m));
          bones.Head.add(bow);
          bow.position.set(0, 0.12, -0.1); // (head bone space: up the head, at the back)
        }
      })
      .catch((e) => console.warn('Hairstyle unavailable:', e.message));
  }

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
      if (body?.wrap) {
        body.wrap.geometry.dispose();
        body.wrap.material.dispose();
      }
      base.dispose();
    },
  };
}
