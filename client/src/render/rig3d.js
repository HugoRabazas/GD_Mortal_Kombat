// A 3D fighter.
//
// The body is real geometry: rounded limbs built from cylinders and spheres,
// lit by the arena's lights and casting a shadow on the floor. It stands
// wherever the fighter is on the arena floor and turns to face whichever way
// the fighter faces. The head is a ball with the alliance member's picture
// wrapped over the front, and it always looks at the camera so the face is
// never hidden.
//
// The animation reuses the pose system from fighter.js: for every state there
// is a pose (hips, hands, feet) seen from the fighter's side; knees and elbows
// are solved with inverse kinematics; and here those points are given width -
// one arm and leg on each side of the body - to make a full 3D figure.
//
// Three builds share the same skeleton: 'standard', 'sumo' (a huge bare-
// chested wrestler with a belly and a thick belt) and 'slim' (a lighter
// frame; a skirt and a ponytail come as `gear`, for those who wear them).

import { LEN, joint, currentPose, vanished } from './fighter.js';
import { MOVES, ULT_MOVES } from '../../../shared/sim.js';
import { lookColors } from '../../../shared/fighters.js';
import { heads } from '../assets.js';
// Cloth relief for the realistic body (Poly Haven "Denim Fabric", Rob Tuytel,
// CC0, 256 px): folds, a seam, the weave.
import clothNorUrl from './tex/cloth_nor.jpg';
import clothRoughUrl from './tex/cloth_rough.jpg';

// The realistic body is the default (the alliance approved it, loop 239);
// Settings can switch to the classic body (kept on the device; read at each
// new fight). ?realbody=none in the address shows the classic body.
const REAL = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('realbody') : null;
export const BODY_KEY = 'gd-arena-body';
const realChosen = () => {
  try {
    return localStorage.getItem(BODY_KEY) !== 'classic'; // realistic unless classic was chosen
  } catch {
    return true;
  }
};
const realFor = (id) => (REAL === 'none' ? false : realChosen() || (REAL !== null && (REAL === 'all' || REAL === id)));

const S = 0.01; // world units per arena pixel
// Moves drawn glowing in the fighter's colour: the specials and the finisher.
const GLOWS = new Set(['dash', 'bolt', 'rise', 'quake', 'super', 'airDash', 'airBolt', 'bodyPress', 'airSpiral', ...ULT_MOVES]);
const OUTLINE = 0.022; // thickness of the dark cartoon outline
const BOSS = { primary: '#2a1436', secondary: '#0d0812', accent: '#ffd34d', glow: '#ffb020' };

const BUILDS = {
  standard: { limb: 1, torso: [0.155, 0.205], chest: [0.18, 0.15, 0.245], pelvis: [0.17, 0.14, 0.2], shoulder: 0.2, hip: 0.1, scale: 1 },
  sumo: { limb: 1.5, torso: [0.25, 0.3], chest: [0.26, 0.2, 0.33], pelvis: [0.27, 0.2, 0.31], shoulder: 0.3, hip: 0.16, scale: 1.1 },
  slim: { limb: 0.8, torso: [0.12, 0.16], chest: [0.14, 0.125, 0.185], pelvis: [0.14, 0.12, 0.17], shoulder: 0.165, hip: 0.085, scale: 0.97 },
};

let geo = null;
let weave = null; // the cloth's relief maps, loaded once

// A limb shaped like one (a lathe turned along y, -0.5 at the joint it starts
// from, +0.5 at the far end): `profile` gives the radius, as a share of the
// widest, at points along it - shoulder and biceps, calf, wrist, ankle.
function limbShape(THREE, profile) {
  const pts = profile.map(([y, r]) => new THREE.Vector2(r, y - 0.5));
  return new THREE.LatheGeometry(pts, 18);
}

function shared(THREE) {
  if (!geo) {
    geo = {
      cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
      cone: new THREE.CylinderGeometry(0.5, 1, 1, 16),
      ball: new THREE.SphereGeometry(1, 20, 14),
      ring: new THREE.TorusGeometry(1.03, 0.075, 8, 36),
      head: new THREE.SphereGeometry(1, 32, 24),
      // The realistic body's parts: points from the near joint (0) to the far one (1).
      upperArm: limbShape(THREE, [[0, 0.6], [0.05, 0.92], [0.25, 1], [0.55, 0.9], [0.9, 0.74], [1, 0.6]]),
      foreArm: limbShape(THREE, [[0, 0.7], [0.08, 0.95], [0.3, 1], [0.75, 0.72], [1, 0.58]]),
      thigh: limbShape(THREE, [[0, 0.75], [0.08, 1], [0.35, 0.95], [0.85, 0.72], [1, 0.62]]),
      shin: limbShape(THREE, [[0, 0.7], [0.12, 0.88], [0.32, 1], [0.7, 0.66], [0.95, 0.52], [1, 0.48]]),
      // hips (0) to shoulders (1): a waist, a chest, then the shoulder line.
      trunk: limbShape(THREE, [[0, 0.82], [0.12, 0.9], [0.38, 0.78], [0.72, 1.02], [0.9, 1], [1, 0.62]]),
    };
    // Wrap the picture over the head as if projected from the front, so the
    // round portrait fills the visible face of the ball.
    const pos = geo.head.attributes.position;
    const uv = geo.head.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) * 0.5 + 0.5, pos.getY(i) * 0.5 + 0.5);
  }
  return geo;
}

// look: the costume (see `looks` in the roster); -1 means plain alternate colours.
export function createRig(THREE, scene, char, { look = 0, boss = false } = {}) {
  const g = shared(THREE);
  const build = BUILDS[char.build] || BUILDS.standard;
  const sumo = char.build === 'sumo';
  const col = { ...lookColors(char.id, look), ...(boss ? BOSS : null) };
  // Colours are written the way a designer picks them (sRGB); the renderer
  // does its lighting maths in linear light, so convert on the way in.
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  const real = realFor(char.id);
  if (real && !weave) {
    const load = (url) => {
      const t = new THREE.TextureLoader().load(url);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(2, 2);
      return t;
    };
    weave = { normalMap: load(clothNorUrl), roughnessMap: load(clothRoughUrl) };
  }
  // Realistic: cloth with relief (and skin smooth); otherwise plain colour.
  const fabric = (hex, rough) => new THREE.MeshStandardMaterial({ color: lin(hex), roughness: Math.min(1, rough + 0.2), metalness: 0, normalMap: weave.normalMap, roughnessMap: weave.roughnessMap, normalScale: new THREE.Vector2(1.3, 1.3) });
  const cloth = (hex, rough = 0.7) => (real ? fabric(hex, rough) : new THREE.MeshStandardMaterial({ color: lin(hex), roughness: rough, metalness: 0.05 }));
  const mats = {
    primary: cloth(col.primary),
    secondary: cloth(col.secondary, 0.8),
    accent: cloth(col.accent, 0.45),
    skin: real ? new THREE.MeshStandardMaterial({ color: lin(col.skin), roughness: 0.55, metalness: 0 }) : cloth(col.skin, 0.6),
    hair: cloth(col.hair || col.secondary, 0.5),
  };
  const bodyMats = Object.values(mats);
  const hull = new THREE.MeshBasicMaterial({ color: 0x0b070d, side: THREE.BackSide });
  hull.visible = !real;
  const glow = lin(col.glow);
  const white = new THREE.Color(0xffffff);
  const ember = lin(0xff3a1e); // the red pulse of a last stand
  const black = new THREE.Color(0x000000);

  // turn: where the fighter stands and which way it faces.
  // lean: the whole-body rotation used when falling over.
  const turn = new THREE.Group();
  const lean = new THREE.Group();
  turn.add(lean);
  scene.add(turn);
  // Drawn a little larger than life so fighters read clearly from the high camera.
  turn.scale.setScalar(1.16 * build.scale * (boss ? 1.12 : 1));

  // Shadows come from the big parts only (see `casters` below): the shadow of
  // an elbow or a knee is lost inside the shadow of the limb anyway, and each
  // part that casts one costs the graphics card another draw.
  // `inner` parts (elbows, knees, the neck) sit inside the outline of the
  // parts around them, so they get no outline of their own: one draw fewer.
  const outlined = (mesh, sx, sy, sz, inner) => {
    if (!inner) {
      const o = new THREE.Mesh(mesh.geometry, hull);
      o.scale.set(sx, sy, sz);
      mesh.add(o);
    }
    lean.add(mesh);
    return mesh;
  };
  // A limb segment: stretched between two points every frame.
  const seg = (r, mat, rz = r, geometry = g.cyl, inner = false) => {
    const m = outlined(new THREE.Mesh(geometry, mat), 1 + OUTLINE / r, 1, 1 + OUTLINE / rz, inner);
    m.userData = { r, rz };
    return m;
  };
  // A joint, fist, foot or body mass.
  const ball = (rx, ry, rz, mat, inner = false) => {
    const m = outlined(new THREE.Mesh(g.ball, mat), 1 + OUTLINE / rx, 1 + OUTLINE / ry, 1 + OUTLINE / rz, inner);
    m.scale.set(rx, ry, rz);
    return m;
  };

  const L = build.limb;
  const bare = sumo ? mats.skin : mats.primary; // the sumo fights bare-chested
  const legMat = sumo ? mats.skin : mats.secondary;
  // Realistic: shaped limbs (a little fuller, as they taper), smaller hands
  // in a wrap, and shoes longer and flatter.
  const limb = real
    ? (side) => ({
        side,
        shoulder: ball(0.085 * L, 0.08 * L, 0.085 * L, bare),
        upper: seg(0.078 * L, bare, 0.078 * L, g.upperArm),
        elbow: ball(0.05 * L, 0.05 * L, 0.05 * L, mats.skin, true),
        fore: seg(0.066 * L, mats.skin, 0.066 * L, g.foreArm),
        fist: ball(0.068 * Math.sqrt(L), 0.062 * Math.sqrt(L), 0.058 * Math.sqrt(L), mats.accent),
        thigh: seg(0.108 * L, legMat, 0.108 * L, g.thigh),
        knee: ball(0.066 * L, 0.066 * L, 0.066 * L, legMat, true),
        shin: seg(0.085 * L, legMat, 0.085 * L, g.shin),
        foot: ball(0.135, 0.05, 0.065 * Math.sqrt(L), sumo ? mats.skin : mats.accent),
      })
    : (side) => ({
        side,
        shoulder: ball(0.09 * L, 0.09 * L, 0.09 * L, bare),
        upper: seg(0.068 * L, bare),
        elbow: ball(0.062 * L, 0.062 * L, 0.062 * L, mats.skin, true),
        fore: seg(0.056 * L, mats.skin),
        fist: ball(0.1 * Math.sqrt(L), 0.1 * Math.sqrt(L), 0.1 * Math.sqrt(L), mats.accent),
        thigh: seg(0.09 * L, legMat),
        knee: ball(0.078 * L, 0.078 * L, 0.078 * L, legMat, true),
        shin: seg(0.07 * L, legMat),
        foot: ball(0.15, 0.075, 0.09 * Math.sqrt(L), sumo ? mats.skin : mats.accent),
      });
  const left = limb(1);
  const right = limb(-1);
  // Realistic details: fighter's wraps on the wrists, a darker sole under
  // each shoe, a collar where the neck meets the shirt.
  const wrapMat = real ? cloth('#ece4d2', 0.85) : null;
  const soleMat = real ? new THREE.MeshStandardMaterial({ color: lin('#1c1416'), roughness: 0.9, metalness: 0 }) : null;
  if (real) {
    bodyMats.push(wrapMat); // (it flashes and glows with the rest)
    for (const l of [left, right]) {
      l.wrap = seg(0.07 * L, wrapMat, 0.07 * L, g.cyl, true);
      l.sole = ball(0.14, 0.02, 0.07 * Math.sqrt(L), soleMat, true);
    }
  }
  const collar = real && !sumo ? ball(build.torso[0] * 0.62, 0.035, build.torso[1] * 0.62, mats.secondary, true) : null;
  const pelvis = ball(...build.pelvis, sumo ? mats.accent : mats.secondary);
  const torso = real ? seg(build.torso[0] * 1.08, bare, build.torso[1] * 1.15, g.trunk) : seg(build.torso[0], bare, build.torso[1]);
  const belt = seg(build.torso[0] + 0.017, mats.accent, build.torso[1] + 0.017);
  // (Realistic: the trunk has its own chest; the ball stays as the pectorals.)
  const chest = real ? ball(build.chest[0] * 0.75, build.chest[1] * 0.7, build.chest[2] * 0.85, bare) : ball(...build.chest, bare);
  const neck = seg(0.055 * L, mats.skin, 0.055 * L, g.cyl, true);
  const belly = sumo ? ball(0.31, 0.27, 0.33, mats.skin) : null;
  const apron = sumo ? ball(0.07, 0.17, 0.15, mats.accent) : null; // the front flap of the belt
  // (A skirt and a ponytail are gear, not part of the slim build: Zelrith is
  // slim and wears neither.)
  const worn = char.gear || [];
  const skirt = worn.includes('skirt') ? seg(0.27, mats.accent, 0.3, g.cone) : null;
  const hk = real ? 0.75 : 1; // (hair scaled with the realistic body's smaller head)
  const tail = worn.includes('ponytail') ? [ball(0.1 * hk, 0.1 * hk, 0.1 * hk, mats.hair), ball(0.085 * hk, 0.085 * hk, 0.085 * hk, mats.hair), ball(0.065 * hk, 0.065 * hk, 0.065 * hk, mats.hair)] : [];
  const knot = sumo ? ball(0.09 * hk, 0.07 * hk, 0.09 * hk, mats.secondary) : null; // topknot
  // The parts whose shadows show: body, limbs and the feet that ground it.
  const casters = [pelvis, torso, chest, belly, left.upper, right.upper, left.fore, right.fore, left.thigh, right.thigh, left.shin, right.shin, left.foot, right.foot];
  for (const m of casters) if (m) m.castShadow = true;

  // Accessories.
  const gear = char.gear || [];
  const scarf = gear.includes('scarf') ? { knot: ball(0.11, 0.075, 0.13, mats.accent), a: seg(0.03, mats.accent, 0.085), b: seg(0.026, mats.accent, 0.07) } : null;
  const pads = gear.includes('pads') ? [ball(0.135, 0.075, 0.13, mats.accent), ball(0.135, 0.075, 0.13, mats.accent)] : null;

  // Head.
  const tex = new THREE.CanvasTexture(heads.get(char.id));
  tex.encoding = THREE.sRGBEncoding;
  const headMat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.6 });
  const head = new THREE.Mesh(g.head, headMat);
  // Realistic: a smaller head on the shoulders (the mask of a person, not a
  // cartoon's big head).
  const HEAD_K = real ? 0.7 : 1;
  const R = LEN.head * S * 0.97 * HEAD_K;
  head.scale.setScalar(R);
  head.castShadow = true;
  const headHull = new THREE.Mesh(g.head, hull);
  headHull.scale.setScalar(1 + OUTLINE / R);
  head.add(headHull);
  const ringMat = new THREE.MeshStandardMaterial({ color: lin(col.accent), roughness: 0.35, metalness: 0.5, emissive: lin(col.accent), emissiveIntensity: 0.35 });
  head.add(new THREE.Mesh(g.ring, ringMat));
  lean.add(head);

  // Scratch objects, reused every frame.
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const AXIS_Z = new THREE.Vector3(0, 0, 1);
  const q = new THREE.Quaternion();
  const want = new THREE.Quaternion();
  const roll = new THREE.Quaternion();
  let yaw = null;

  const stretch = (mesh, x1, y1, z1, x2, y2, z2) => {
    a.set(x1 * S, -y1 * S, z1);
    b.set(x2 * S, -y2 * S, z2);
    dir.subVectors(b, a);
    const len = dir.length() || 0.001;
    mesh.position.addVectors(a, b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, dir.divideScalar(len));
    mesh.scale.set(mesh.userData.r, len, mesh.userData.rz);
  };
  const put = (mesh, x, y, z) => mesh.position.set(x * S, -y * S, z);
  const scaleOut = new THREE.Vector3();
  // Where the skeleton's joints are this frame, in `lean`'s space (world
  // units): what the Quaternius body (qrig.js) bends its bones to.
  const V = () => new THREE.Vector3();
  const limbJoints = () => ({ shoulder: V(), elbow: V(), hand: V(), hip: V(), knee: V(), ankle: V() });
  const joints = { hip: V(), neck: V(), head: V(), side: { 1: limbJoints(), [-1]: limbJoints() } };
  const at = (v, x, y, z) => v.set(x * S, -y * S, z);

  // What the fighter wears over the body (kept on the Quaternius body too).
  const worn3d = [skirt, knot, ...tail, ...(scarf ? [scarf.knot, scarf.a, scarf.b] : []), ...(pads || [])].filter(Boolean);
  return {
    joints,
    lean,
    head,
    worn: worn3d,
    gearParts: { skirt, knot, pads, scarf, tail },
    // Where the top of the head is, in world units (for name tags).
    top: () => turn.position.y + 2.05 * turn.scale.y,
    // The middle of the head, in world units (for the breath in the cold).
    // Returns the head's radius.
    face: (out) => {
      head.getWorldPosition(out);
      return head.getWorldScale(scaleOut).x;
    },

    update(f, now, camera) {
      const p = currentPose(f, now);
      turn.visible = !vanished(f); // gone between Shadow's vanishing and reappearing

      // Stand on the fighter's spot and turn, by the shortest way round, to
      // face where the fighter faces.
      turn.position.set(f.x * S, f.h * S, f.z * S);
      // A celebration is drawn side-on (see victoryPose), so a winner turns to
      // show it three-quarters to the camera, whichever way they were facing.
      let face = f.dir;
      if (f.state === 'win') {
        const toCam = Math.atan2(camera.position.z - turn.position.z, camera.position.x - turn.position.x);
        const off = Math.PI / 2 - 0.5;
        const gap = (a) => Math.abs(Math.atan2(Math.sin(a - f.dir), Math.cos(a - f.dir)));
        face = gap(toCam + off) < gap(toCam - off) ? toCam + off : toCam - off;
      }
      const targetYaw = -face;
      if (yaw === null) yaw = targetYaw;
      let d = targetYaw - yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      yaw += d * 0.35;
      turn.rotation.y = yaw - p.spin;
      lean.rotation.z = -p.rot;
      lean.position.y = -p.lift * S;

      // Solve the skeleton in the side-view plane (x forward, y down, in arena
      // pixels), exactly like the flat renderer does.
      const hx = p.hipX;
      const hy = p.hipY;
      const sx = hx + Math.sin(p.lean) * LEN.torso;
      const sy = hy - Math.cos(p.lean) * LEN.torso;
      const nx = sx + Math.sin(p.lean + p.tilt) * LEN.neck;
      const ny = sy - Math.cos(p.lean + p.tilt) * LEN.neck;

      // The head's centre (a smaller head sits lower, its chin on the neck);
      // the topknot and the ponytail follow it, scaled with it.
      const hcx = nx - Math.sin(p.lean + p.tilt) * LEN.head * (1 - HEAD_K) * 0.9;
      const hcy = ny + Math.cos(p.lean + p.tilt) * LEN.head * (1 - HEAD_K) * 0.9;
      put(pelvis, hx, hy, 0);
      at(joints.hip, hx, hy, 0);
      at(joints.neck, sx, sy + 6, 0);
      stretch(torso, hx, hy - 2, 0, sx, sy + 6, 0);
      stretch(belt, hx, hy - 3, 0, hx + (sx - hx) * 0.16, hy + (sy - hy) * 0.16, 0);
      put(chest, sx - Math.sin(p.lean) * 6, sy + 9, 0);
      chest.rotation.z = -p.lean;
      stretch(neck, sx, sy, 0, nx, ny, 0);
      if (collar) {
        put(collar, sx, sy + 4, 0);
        collar.rotation.z = -p.lean;
      }
      if (belly) {
        put(belly, hx + (sx - hx) * 0.42 + 9, hy + (sy - hy) * 0.42, 0);
        put(apron, hx + 24, hy + 8, 0);
        put(knot, hcx - 4 * HEAD_K, hcy - (LEN.head + 3) * HEAD_K, 0);
      }
      if (skirt) stretch(skirt, hx, hy + 14, 0, hx + (sx - hx) * 0.12, hy + (sy - hy) * 0.12 - 2, 0);
      // The ponytail trails behind the head and swings with movement.
      for (let i = 0; i < tail.length; i++) {
        const sway = Math.sin(now / 170 + i) * 2 + (f.state === 'walk' ? 5 : 0) * i;
        put(tail[i], hcx - (30 + i * 9) * HEAD_K - sway, hcy + (-8 + i * 13) * HEAD_K, 0);
      }

      if (scarf) {
        // The scarf hangs at rest and streams out behind when the fighter moves.
        const rushing = f.state === 'attack' && !!MOVES[f.move]?.rush;
        const flow = rushing ? 1.5 : f.state === 'walk' || f.state === 'jump' ? 1 : 0.2;
        const wave = Math.sin(now / 140 + f.slot) * 3;
        const mx = sx - 12 - 20 * flow;
        const my = sy + 18 - 16 * flow + wave;
        put(scarf.knot, sx - 3, sy - 3, 0);
        stretch(scarf.a, sx - 8, sy - 2, 0.05, mx, my, 0.07);
        stretch(scarf.b, mx, my, 0.07, mx - 8 - 16 * flow, my + 16 - 14 * flow - wave, 0.03);
      }
      if (pads) {
        put(pads[0], sx, sy + 1, build.shoulder * 1.08);
        put(pads[1], sx, sy + 1, -build.shoulder * 1.08);
      }

      for (const [l, handX, handY, footX, footY] of [
        [left, p.hfx, p.hfy, p.ffx, p.ffy],
        [right, p.hbx, p.hby, p.fbx, p.fby],
      ]) {
        const zs = build.shoulder * l.side;
        const arm = joint(sx, sy + 6, sx + handX, sy + handY, LEN.upper, LEN.fore, 1);
        put(l.shoulder, sx, sy + 6, zs);
        stretch(l.upper, sx, sy + 6, zs, arm.jx, arm.jy, zs * 1.1);
        put(l.elbow, arm.jx, arm.jy, zs * 1.1);
        stretch(l.fore, arm.jx, arm.jy, zs * 1.1, arm.ex, arm.ey, zs * 0.7);
        put(l.fist, arm.ex, arm.ey, zs * 0.7);
        const J = joints.side[l.side];
        at(J.shoulder, sx, sy + 6, zs);
        at(J.elbow, arm.jx, arm.jy, zs * 1.1);
        at(J.hand, arm.ex, arm.ey, zs * 0.7);
        if (l.wrap) stretch(l.wrap, arm.jx + (arm.ex - arm.jx) * 0.72, arm.jy + (arm.ey - arm.jy) * 0.72, zs * 0.78, arm.ex, arm.ey, zs * 0.7);

        const zh = build.hip * l.side;
        const leg = joint(hx, hy, footX, footY, LEN.thigh, LEN.shin, -1);
        stretch(l.thigh, hx, hy, zh, leg.jx, leg.jy, zh * 1.2);
        put(l.knee, leg.jx, leg.jy, zh * 1.2);
        at(J.hip, hx, hy, zh);
        at(J.knee, leg.jx, leg.jy, zh * 1.2);
        at(J.ankle, leg.ex, leg.ey - 6, zh * 1.3);
        stretch(l.shin, leg.jx, leg.jy, zh * 1.2, leg.ex, leg.ey - 6, zh * 1.3);
        put(l.foot, leg.ex + 5, leg.ey - 6, zh * 1.3);
        if (l.sole) put(l.sole, leg.ex + 5, leg.ey - 2, zh * 1.3);
      }

      // The head looks at the camera whatever the body is doing, and rolls
      // with the body when the fighter is knocked over.
      put(head, hcx, hcy, 0);
      at(joints.head, hcx, hcy, 0);
      turn.updateMatrixWorld(true);
      lean.getWorldQuaternion(q).invert();
      want.setFromAxisAngle(UP, Math.atan2(camera.position.x - turn.position.x, camera.position.z - turn.position.z));
      roll.setFromAxisAngle(AXIS_Z, -p.rot * 0.75 * Math.sign(Math.cos(f.dir) || 1));
      head.quaternion.copy(q).multiply(want).multiply(roll);

      // Flash white when struck, glow in the fighter's colour during specials.
      let tint = black;
      let amount = 0;
      if (f.state === 'hit' && f.t < 5) {
        tint = white;
        amount = 0.75;
      } else if ((f.state === 'attack' || f.state === 'airAttack') && GLOWS.has(f.move)) {
        tint = glow;
        // A finisher that has caught its rival burns brighter: from here on
        // nobody else can stop it (see applyHit in sim.js).
        const caught = (ULT_MOVES.has(f.move) && f.ultOn >= 0) || f.ex; // (an EX special burns bright too)
        amount = caught ? 0.85 + 0.15 * Math.sin(now / 28) : 0.55 + 0.2 * Math.sin(now / 40);
      } else if (f.enraged && f.hp > 0) {
        // A boss's second wind: a hot red glow, pulsing fast, for the round.
        tint = ember;
        amount = 0.32 + 0.14 * Math.sin(now / 90);
      } else if (f.hp > 0 && f.hp < f.maxHp * 0.25 && f.state !== 'win' && f.state !== 'lose') {
        // Last stand: a slow red pulse, like a heartbeat (see LAST_STAND in sim.js).
        tint = ember;
        amount = 0.1 + 0.16 * Math.max(0, Math.sin(now / 160)) ** 4;
      } else if (boss) {
        tint = glow;
        amount = 0.12 + 0.06 * Math.sin(now / 300);
      }
      for (const m of bodyMats) {
        m.emissive.copy(tint);
        m.emissiveIntensity = amount;
      }
      // A knocked-out fighter dims, so the eye goes to those still fighting.
      headMat.emissiveIntensity = f.state === 'ko' ? 0.15 : 0.5;
    },

    // The cartoon outline costs one draw per body part; Graphics: Fast drops it.
    setOutline(on) {
      hull.visible = on && !real; // (the realistic body has none)
    },

    dispose() {
      scene.remove(turn);
      for (const m of bodyMats) m.dispose();
      soleMat?.dispose();
      headMat.dispose();
      ringMat.dispose();
      hull.dispose();
      tex.dispose();
    },
  };
}
