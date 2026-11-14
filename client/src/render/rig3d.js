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
// chested wrestler with a belly and a thick belt) and 'slim' (a lighter frame
// with a skirt and a ponytail).

import { LEN, ALT, joint, currentPose } from './fighter.js';
import { heads } from '../assets.js';

const S = 0.01; // world units per arena pixel
const OUTLINE = 0.022; // thickness of the dark cartoon outline
const BOSS = { primary: '#2a1436', secondary: '#0d0812', accent: '#ffd34d', glow: '#ffb020' };

const BUILDS = {
  standard: { limb: 1, torso: [0.155, 0.205], chest: [0.18, 0.15, 0.245], pelvis: [0.17, 0.14, 0.2], shoulder: 0.2, hip: 0.1, scale: 1 },
  sumo: { limb: 1.5, torso: [0.25, 0.3], chest: [0.26, 0.2, 0.33], pelvis: [0.27, 0.2, 0.31], shoulder: 0.3, hip: 0.16, scale: 1.1 },
  slim: { limb: 0.8, torso: [0.12, 0.16], chest: [0.14, 0.125, 0.185], pelvis: [0.14, 0.12, 0.17], shoulder: 0.165, hip: 0.085, scale: 0.97 },
};

let geo = null;

function shared(THREE) {
  if (!geo) {
    geo = {
      cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
      cone: new THREE.CylinderGeometry(0.5, 1, 1, 16),
      ball: new THREE.SphereGeometry(1, 20, 14),
      ring: new THREE.TorusGeometry(1.03, 0.075, 8, 36),
      head: new THREE.SphereGeometry(1, 32, 24),
    };
    // Wrap the picture over the head as if projected from the front, so the
    // round portrait fills the visible face of the ball.
    const pos = geo.head.attributes.position;
    const uv = geo.head.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) * 0.5 + 0.5, pos.getY(i) * 0.5 + 0.5);
  }
  return geo;
}

export function createRig(THREE, scene, char, { alt = false, boss = false } = {}) {
  const g = shared(THREE);
  const build = BUILDS[char.build] || BUILDS.standard;
  const sumo = char.build === 'sumo';
  const slim = char.build === 'slim';
  const col = { ...char.colors, ...(alt ? ALT : null), ...(boss ? BOSS : null) };
  // Colours are written the way a designer picks them (sRGB); the renderer
  // does its lighting maths in linear light, so convert on the way in.
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  const cloth = (hex, rough = 0.7) => new THREE.MeshStandardMaterial({ color: lin(hex), roughness: rough, metalness: 0.05 });
  const mats = {
    primary: cloth(col.primary),
    secondary: cloth(col.secondary, 0.8),
    accent: cloth(col.accent, 0.45),
    skin: cloth(col.skin, 0.6),
    hair: cloth(col.hair || col.secondary, 0.5),
  };
  const bodyMats = Object.values(mats);
  const hull = new THREE.MeshBasicMaterial({ color: 0x0b070d, side: THREE.BackSide });
  const glow = lin(col.glow);
  const white = new THREE.Color(0xffffff);
  const black = new THREE.Color(0x000000);

  // turn: where the fighter stands and which way it faces.
  // lean: the whole-body rotation used when falling over.
  const turn = new THREE.Group();
  const lean = new THREE.Group();
  turn.add(lean);
  scene.add(turn);
  // Drawn a little larger than life so fighters read clearly from the high camera.
  turn.scale.setScalar(1.16 * build.scale * (boss ? 1.12 : 1));

  const outlined = (mesh, sx, sy, sz) => {
    const o = new THREE.Mesh(mesh.geometry, hull);
    o.scale.set(sx, sy, sz);
    mesh.add(o);
    mesh.castShadow = true;
    lean.add(mesh);
    return mesh;
  };
  // A limb segment: stretched between two points every frame.
  const seg = (r, mat, rz = r, geometry = g.cyl) => {
    const m = outlined(new THREE.Mesh(geometry, mat), 1 + OUTLINE / r, 1, 1 + OUTLINE / rz);
    m.userData = { r, rz };
    return m;
  };
  // A joint, fist, foot or body mass.
  const ball = (rx, ry, rz, mat) => {
    const m = outlined(new THREE.Mesh(g.ball, mat), 1 + OUTLINE / rx, 1 + OUTLINE / ry, 1 + OUTLINE / rz);
    m.scale.set(rx, ry, rz);
    return m;
  };

  const L = build.limb;
  const bare = sumo ? mats.skin : mats.primary; // the sumo fights bare-chested
  const legMat = sumo ? mats.skin : mats.secondary;
  const limb = (side) => ({
    side,
    shoulder: ball(0.09 * L, 0.09 * L, 0.09 * L, bare),
    upper: seg(0.068 * L, bare),
    elbow: ball(0.062 * L, 0.062 * L, 0.062 * L, mats.skin),
    fore: seg(0.056 * L, mats.skin),
    fist: ball(0.1 * Math.sqrt(L), 0.1 * Math.sqrt(L), 0.1 * Math.sqrt(L), mats.accent),
    thigh: seg(0.09 * L, legMat),
    knee: ball(0.078 * L, 0.078 * L, 0.078 * L, legMat),
    shin: seg(0.07 * L, legMat),
    foot: ball(0.15, 0.075, 0.09 * Math.sqrt(L), sumo ? mats.skin : mats.accent),
  });
  const left = limb(1);
  const right = limb(-1);
  const pelvis = ball(...build.pelvis, sumo ? mats.accent : mats.secondary);
  const torso = seg(build.torso[0], bare, build.torso[1]);
  const belt = seg(build.torso[0] + 0.017, mats.accent, build.torso[1] + 0.017);
  const chest = ball(...build.chest, bare);
  const neck = seg(0.055 * L, mats.skin);
  const belly = sumo ? ball(0.31, 0.27, 0.33, mats.skin) : null;
  const apron = sumo ? ball(0.07, 0.17, 0.15, mats.accent) : null; // the front flap of the belt
  const skirt = slim ? seg(0.27, mats.accent, 0.3, g.cone) : null;
  const tail = slim ? [ball(0.1, 0.1, 0.1, mats.hair), ball(0.085, 0.085, 0.085, mats.hair), ball(0.065, 0.065, 0.065, mats.hair)] : [];
  const knot = sumo ? ball(0.09, 0.07, 0.09, mats.secondary) : null; // topknot

  // Accessories.
  const gear = char.gear || [];
  const scarf = gear.includes('scarf') ? { knot: ball(0.11, 0.075, 0.13, mats.accent), a: seg(0.03, mats.accent, 0.085), b: seg(0.026, mats.accent, 0.07) } : null;
  const pads = gear.includes('pads') ? [ball(0.135, 0.075, 0.13, mats.accent), ball(0.135, 0.075, 0.13, mats.accent)] : null;

  // Head.
  const tex = new THREE.CanvasTexture(heads.get(char.id));
  tex.encoding = THREE.sRGBEncoding;
  const headMat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.6 });
  const head = new THREE.Mesh(g.head, headMat);
  const R = LEN.head * S * 0.97;
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

  return {
    // Where the top of the head is, in world units (for name tags).
    top: () => turn.position.y + 2.05 * turn.scale.y,

    update(f, now, camera) {
      const p = currentPose(f, now);

      // Stand on the fighter's spot and turn, by the shortest way round, to
      // face where the fighter faces.
      turn.position.set(f.x * S, f.h * S, f.z * S);
      const targetYaw = -f.dir;
      if (yaw === null) yaw = targetYaw;
      let d = targetYaw - yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      yaw += d * 0.35;
      turn.rotation.y = yaw;
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

      put(pelvis, hx, hy, 0);
      stretch(torso, hx, hy - 2, 0, sx, sy + 6, 0);
      stretch(belt, hx, hy - 3, 0, hx + (sx - hx) * 0.16, hy + (sy - hy) * 0.16, 0);
      put(chest, sx - Math.sin(p.lean) * 6, sy + 9, 0);
      chest.rotation.z = -p.lean;
      stretch(neck, sx, sy, 0, nx, ny, 0);
      if (belly) {
        put(belly, hx + (sx - hx) * 0.42 + 9, hy + (sy - hy) * 0.42, 0);
        put(apron, hx + 24, hy + 8, 0);
        put(knot, nx - 4, ny - LEN.head - 3, 0);
      }
      if (skirt) stretch(skirt, hx, hy + 14, 0, hx + (sx - hx) * 0.12, hy + (sy - hy) * 0.12 - 2, 0);
      // The ponytail trails behind the head and swings with movement.
      for (let i = 0; i < tail.length; i++) {
        const sway = Math.sin(now / 170 + i) * 2 + (f.state === 'walk' ? 5 : 0) * i;
        put(tail[i], nx - 30 - i * 9 - sway, ny - 8 + i * 13, 0);
      }

      if (scarf) {
        // The scarf hangs at rest and streams out behind when the fighter moves.
        const rushing = f.state === 'attack' && (f.move === 'dash' || f.move === 'super');
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

        const zh = build.hip * l.side;
        const leg = joint(hx, hy, footX, footY, LEN.thigh, LEN.shin, -1);
        stretch(l.thigh, hx, hy, zh, leg.jx, leg.jy, zh * 1.2);
        put(l.knee, leg.jx, leg.jy, zh * 1.2);
        stretch(l.shin, leg.jx, leg.jy, zh * 1.2, leg.ex, leg.ey - 6, zh * 1.3);
        put(l.foot, leg.ex + 5, leg.ey - 6, zh * 1.3);
      }

      // The head looks at the camera whatever the body is doing, and rolls
      // with the body when the fighter is knocked over.
      put(head, nx, ny, 0);
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
      } else if (f.state === 'attack' && !f.move.startsWith('punch') && f.move !== 'kick' && f.move !== 'grab') {
        tint = glow;
        amount = 0.55 + 0.2 * Math.sin(now / 40);
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

    dispose() {
      scene.remove(turn);
      for (const m of bodyMats) m.dispose();
      headMat.dispose();
      ringMat.dispose();
      hull.dispose();
      tex.dispose();
    },
  };
}
