// A 3D fighter.
//
// The body is real geometry: rounded limbs built from cylinders and spheres,
// lit by the arena's lights and casting a shadow on the floor. The head is a
// ball with the alliance member's picture wrapped over the front, and it
// always turns to look at the camera so the face is never hidden.
//
// The animation reuses the pose system from fighter.js: for every state there
// is a pose (hips, hands, feet), knees and elbows are solved with inverse
// kinematics in the fighter's side-view plane, and here those points are given
// depth - the left arm and leg sit nearer the camera, the right ones further -
// so the result is a full 3D body.

import { ARENA } from '../../../shared/constants.js';
import { LEN, ALT, joint, currentPose } from './fighter.js';
import { heads } from '../assets.js';

const S = 0.01; // world units per arena pixel
const OUTLINE = 0.022; // thickness of the dark cartoon outline
const TURN = 0.32; // how far the body opens towards the camera, in radians
const BOSS = { primary: '#2a1436', secondary: '#0d0812', accent: '#ffd34d', glow: '#ffb020' };

let geo = null;

function shared(THREE) {
  if (!geo) {
    geo = {
      cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
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
  if (boss) turn.scale.setScalar(1.12);

  const outlined = (mesh, sx, sy, sz) => {
    const o = new THREE.Mesh(mesh.geometry, hull);
    o.scale.set(sx, sy, sz);
    mesh.add(o);
    mesh.castShadow = true;
    lean.add(mesh);
    return mesh;
  };
  // A limb segment: stretched between two points every frame.
  const seg = (r, mat, rz = r) => {
    const m = outlined(new THREE.Mesh(g.cyl, mat), 1 + OUTLINE / r, 1, 1 + OUTLINE / rz);
    m.userData = { r, rz };
    return m;
  };
  // A joint, fist, foot or body mass.
  const ball = (rx, ry, rz, mat) => {
    const m = outlined(new THREE.Mesh(g.ball, mat), 1 + OUTLINE / rx, 1 + OUTLINE / ry, 1 + OUTLINE / rz);
    m.scale.set(rx, ry, rz);
    return m;
  };

  const limb = (z) => ({
    z,
    shoulder: ball(0.09, 0.09, 0.09, mats.primary),
    upper: seg(0.068, mats.primary),
    elbow: ball(0.062, 0.062, 0.062, mats.skin),
    fore: seg(0.056, mats.skin),
    fist: ball(0.1, 0.1, 0.1, mats.accent),
    thigh: seg(0.09, mats.secondary),
    knee: ball(0.078, 0.078, 0.078, mats.secondary),
    shin: seg(0.07, mats.secondary),
    foot: ball(0.15, 0.075, 0.09, mats.accent),
  });
  const near = limb(1);
  const far = limb(-1);
  const pelvis = ball(0.17, 0.14, 0.2, mats.secondary);
  const torso = seg(0.155, mats.primary, 0.205);
  const belt = seg(0.172, mats.accent, 0.222);
  const chest = ball(0.18, 0.15, 0.245, mats.primary);
  const neck = seg(0.055, mats.skin);

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
  const ring = new THREE.Mesh(g.ring, new THREE.MeshStandardMaterial({ color: lin(col.accent), roughness: 0.35, metalness: 0.5, emissive: lin(col.accent), emissiveIntensity: 0.35 }));
  head.add(ring);
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
    update(f, now, camera) {
      const p = currentPose(f, now);

      // Stand at the fighter's spot, turned to face the opponent and opened a
      // little towards the camera. Turning round is eased so it reads as a turn.
      turn.position.set((f.x - ARENA.W / 2) * S, (ARENA.FLOOR - f.y) * S, 0);
      const targetYaw = f.facing === 1 ? -TURN : Math.PI + TURN;
      yaw = yaw === null ? targetYaw : yaw + (targetYaw - yaw) * 0.3;
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

      for (const [l, handX, handY, footX, footY] of [
        [near, p.hfx, p.hfy, p.ffx, p.ffy],
        [far, p.hbx, p.hby, p.fbx, p.fby],
      ]) {
        const zs = 0.2 * l.z;
        const arm = joint(sx, sy + 6, sx + handX, sy + handY, LEN.upper, LEN.fore, 1);
        put(l.shoulder, sx, sy + 6, zs);
        stretch(l.upper, sx, sy + 6, zs, arm.jx, arm.jy, zs * 1.1);
        put(l.elbow, arm.jx, arm.jy, zs * 1.1);
        stretch(l.fore, arm.jx, arm.jy, zs * 1.1, arm.ex, arm.ey, zs * 0.7);
        put(l.fist, arm.ex, arm.ey, zs * 0.7);

        const zh = 0.1 * l.z;
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
      const wxPos = turn.position.x;
      want.setFromAxisAngle(UP, Math.atan2(camera.position.x - wxPos, camera.position.z));
      roll.setFromAxisAngle(AXIS_Z, -p.rot * f.facing * 0.75 + (p.lean + p.tilt) * -0.3 * f.facing);
      head.quaternion.copy(q).multiply(want).multiply(roll);

      // Flash white when struck, glow in the fighter's colour during specials.
      let tint = black;
      let amount = 0;
      if (f.state === 'hit' && f.t < 5) {
        tint = white;
        amount = 0.75;
      } else if (f.state === 'attack' && (f.move === 'dash' || f.move === 'super' || f.move === 'rise' || f.move === 'bolt')) {
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
    },

    dispose() {
      scene.remove(turn);
      for (const m of bodyMats) m.dispose();
      headMat.dispose();
      ring.material.dispose();
      hull.dispose();
      tex.dispose();
    },
  };
}
