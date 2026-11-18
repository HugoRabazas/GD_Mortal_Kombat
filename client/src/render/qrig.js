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

const SKIRT_N = 28; // points round the skirt's waist and hem

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
const OUTFIT = ['top', 'legs', 'shoes', 'skirt']; // ('skirt': the hips under one, in its colour)

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
  for (let v = 0; v < n; v++)
    for (let k = 0; k < 4; k++) {
      const name = bones[si[get[k]](v)]?.name;
      // Under a skirt, the hips are dressed in its colour, so no band of
      // trousers shows between the top and the skirt; the legs keep one
      // colour from the hip to the ankle (leggings), so a leg that kicks out
      // of the skirt is not half one colour and half another.
      const kind = OUTFIT.indexOf(skirt && name === 'pelvis' ? 'skirt' : WEAR[name]);
      if (kind < 0 || (bareChest && kind === 0)) continue;
      wear[v * 4 + kind] += sw[get[k]](v);
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
      // The skirt: its own cone, which widens wherever a leg would push
      // through it (see the update).
      if (base.gearParts.skirt) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SKIRT_N * 2 * 3), 3));
        const idx = [];
        for (let i = 0; i < SKIRT_N; i++) {
          const j = (i + 1) % SKIRT_N;
          idx.push(i, SKIRT_N + i, j, j, SKIRT_N + i, SKIRT_N + j);
        }
        geo.setIndex(idx);
        const mat = base.gearParts.skirt.material.clone();
        mat.side = THREE.DoubleSide;
        body.skirt = new THREE.Mesh(geo, mat);
        body.skirt.castShadow = true;
        body.skirt.frustumCulled = false;
        base.lean.add(body.skirt);
      }
    })
    .catch((e) => console.warn('Quaternius body unavailable:', e.message));

  // The skirt, every frame: a cone from the waist down, its hem pushed out
  // wherever a thigh reaches past it, so a kick or a wide stance never pokes
  // through the cloth. For each direction round the waist, the hem goes at
  // least as far as is needed to keep every point of both thighs (sampled
  // from hip to knee, with the thigh's thickness) inside the cone.
  const sk = { up: new THREE.Vector3(), x: new THREE.Vector3(), z: new THREE.Vector3(), waist: new THREE.Vector3(), p: new THREE.Vector3(), d: new THREE.Vector3(), hip: new THREE.Vector3(), knee: new THREE.Vector3() };
  const legPts = Array.from({ length: 10 }, () => new THREE.Vector3());
  function layOutSkirt(mesh, J, u) {
    const { up, x, z, waist, p, d } = sk;
    up.subVectors(J.neck, J.hip).normalize(); // up the spine
    // The waistband starts inside the body, under the top's hem, so the
    // skirt comes out of the body with no gap to see the waist through.
    waist.copy(J.hip).addScaledVector(up, 0.14 * u);
    x.set(1, 0, 0).addScaledVector(up, -up.x).normalize(); // forward, square to the spine
    z.crossVectors(x, up);
    // The waistband goes round the hips themselves (seen from above, what
    // shows inside it is the hips, dressed in the skirt's colour).
    const top = 0.24 * u;
    const len = 0.4 * u; // waistband to hem
    const thick = 0.11 * u; // a thigh's radius, and a little room
    let n = 0;
    // (the model's own thighs - where its legs really are - from the hip
    // joint to the knee)
    for (const side of ['l', 'r']) {
      body.bones[`thigh_${side}`].getWorldPosition(sk.hip);
      body.bones[`calf_${side}`].getWorldPosition(sk.knee);
      base.lean.worldToLocal(sk.hip);
      base.lean.worldToLocal(sk.knee);
      for (let i = 0; i < 5; i++) legPts[n++].lerpVectors(sk.hip, sk.knee, i / 4);
    }
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < SKIRT_N; i++) {
      const a = (i / SKIRT_N) * Math.PI * 2;
      d.copy(x).multiplyScalar(Math.cos(a)).addScaledVector(z, Math.sin(a));
      let hem = 0.34 * u; // the hem's radius when nothing pushes it
      for (const q of legPts) {
        p.subVectors(q, waist);
        const depth = -p.dot(up); // how far below the waist
        if (depth < 0.01 * u) continue;
        const out = p.dot(d) + thick; // how far out in this direction
        // The cone's radius at that depth must reach `out`: so the hem's must
        // reach at least this much.
        hem = Math.max(hem, top + ((out - top) * len) / Math.min(Math.max(depth, 0.1 * u), len));
      }
      hem = Math.min(hem, 1.1 * u); // (a high kick lifts it right out)
      pos.setXYZ(i, waist.x + d.x * top, waist.y + d.y * top, waist.z + d.z * top);
      p.copy(waist).addScaledVector(up, -len).addScaledVector(d, hem);
      pos.setXYZ(SKIRT_N + i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
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
      if (body.skirt) layOutSkirt(body.skirt, J, poseLeg);
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
