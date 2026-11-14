// The 3D arena.
//
// The world is real 3D geometry (a stone dais, a courtyard wall, pillars,
// torches that actually light the scene, mountains and a moon far behind),
// viewed by a perspective camera that follows the fight. The fighters are 2D
// character models: each one is painted every frame onto its own canvas, and
// that canvas is used as the texture of an upright card standing in the world,
// always turned towards the camera.
//
// Units: 1 world unit = 100 arena pixels. The floor is y = 0, the fighters
// move along the x axis at z = 0, and the camera looks down the -z axis.

import { ARENA, TIMING } from '../../../shared/constants.js';
import { getFighter } from '../../../shared/fighters.js';
import { drawFighter, drawProjectile } from './fighter.js';
import { drawFx, fxActive } from './fx.js';

const S = 0.01;
const wx = (px) => (px - ARENA.W / 2) * S;
const wy = (py) => (ARENA.FLOOR - py) * S;

// Each fighter is painted on a card this big (in arena pixels) with the feet
// at (CARD.ox, CARD.oy), leaving room for jumps, kicks and dash trails.
const CARD = { w: 560, h: 420, ox: 280, oy: 340, scale: 2 };
const FX_SCALE = 1.5;

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function create3D(canvas) {
  const THREE = window.THREE;
  if (!THREE) return null;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch {
    return null; // no WebGL here: the caller falls back to the flat arena
  }
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setClearColor(0x0b0714);

  const texture = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  };

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x2a1030, 0.02);
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 300);

  // ---------- sky, moon and mountains (far away, so they barely move) ----------
  {
    const c = makeCanvas(2048, 1024);
    const g = c.getContext('2d');
    const rand = seeded(11);
    const sky = g.createLinearGradient(0, 0, 0, 1024);
    sky.addColorStop(0, '#07050f');
    sky.addColorStop(0.4, '#2a0f2e');
    sky.addColorStop(0.68, '#7a1c2c');
    sky.addColorStop(0.85, '#d1542b');
    sky.addColorStop(1, '#e9823a');
    g.fillStyle = sky;
    g.fillRect(0, 0, 2048, 1024);
    for (let i = 0; i < 420; i++) {
      g.fillStyle = `rgba(255,236,224,${0.2 + rand() * 0.7})`;
      g.beginPath();
      g.arc(rand() * 2048, rand() * 600, rand() * 1.6 + 0.3, 0, Math.PI * 2);
      g.fill();
    }
    const mx = 1270;
    const my = 700;
    const halo = g.createRadialGradient(mx, my, 30, mx, my, 260);
    halo.addColorStop(0, 'rgba(255,176,124,0.6)');
    halo.addColorStop(1, 'rgba(255,120,80,0)');
    g.fillStyle = halo;
    g.fillRect(mx - 270, my - 270, 540, 540);
    const moon = g.createRadialGradient(mx - 14, my - 14, 5, mx, my, 74);
    moon.addColorStop(0, '#fff4de');
    moon.addColorStop(1, '#f2a56b');
    g.fillStyle = moon;
    g.beginPath();
    g.arc(mx, my, 72, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(190,100,70,0.22)';
    for (const [dx, dy, r] of [[-24, -15, 14], [20, 9, 19], [-7, 31, 9], [30, -29, 7]]) {
      g.beginPath();
      g.arc(mx + dx, my + dy, r, 0, Math.PI * 2);
      g.fill();
    }
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(190, 60),
      new THREE.MeshBasicMaterial({ map: texture(c), fog: false, depthWrite: false }),
    );
    mesh.position.set(0, 22, -70);
    mesh.renderOrder = -10;
    scene.add(mesh);
  }

  const ridge = (seed, color, width, height, y, z, step) => {
    const c = makeCanvas(1024, 256);
    const g = c.getContext('2d');
    const rand = seeded(seed);
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, 256);
    for (let x = 0; x <= 1024 + step; x += step) g.lineTo(x, 40 + rand() * 170);
    g.lineTo(1024, 256);
    g.closePath();
    g.fill();
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: texture(c), transparent: true, fog: false, depthWrite: false }),
    );
    mesh.position.set(0, y, z);
    mesh.renderOrder = -9;
    scene.add(mesh);
  };
  ridge(3, '#3d1532', 170, 16, 5, -58, 70);
  ridge(8, '#260d22', 130, 10, 3, -40, 48);

  // ---------- lights ----------
  scene.add(new THREE.HemisphereLight(0x8a5a9a, 0x1a0c14, 0.58));
  const moonLight = new THREE.DirectionalLight(0xffb58a, 0.55);
  moonLight.position.set(6, 9, -8);
  scene.add(moonLight);
  const frontFill = new THREE.DirectionalLight(0xff9c7a, 0.28);
  frontFill.position.set(-3, 5, 9);
  scene.add(frontFill);

  // ---------- floor ----------
  const stone = (base, seed) => {
    const c = makeCanvas(512, 512);
    const g = c.getContext('2d');
    const rand = seeded(seed);
    g.fillStyle = '#120b14';
    g.fillRect(0, 0, 512, 512);
    for (let row = 0; row < 4; row++) {
      for (let col = -1; col < 4; col++) {
        const v = 0.82 + rand() * 0.36;
        g.fillStyle = `rgb(${Math.round(base[0] * v)},${Math.round(base[1] * v)},${Math.round(base[2] * v)})`;
        g.fillRect(col * 128 + (row % 2 ? 64 : 0) + 3, row * 128 + 3, 122, 122);
      }
    }
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `rgba(${rand() < 0.5 ? '0,0,0' : '255,220,200'},${rand() * 0.07})`;
      g.fillRect(rand() * 512, rand() * 512, 2 + rand() * 3, 2 + rand() * 3);
    }
    const t = texture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };

  const groundTex = stone([70, 44, 62], 5);
  groundTex.repeat.set(24, 24);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(96, 96),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.92, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.3;
  scene.add(ground);

  // The fighting dais: a raised stone disc.
  const daisTex = stone([104, 66, 86], 9);
  daisTex.repeat.set(5, 5);
  const dais = new THREE.Mesh(
    new THREE.CylinderGeometry(6.6, 6.9, 0.3, 64),
    [
      new THREE.MeshStandardMaterial({ color: 0x3a2233, roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ map: daisTex, roughness: 0.78, metalness: 0.05 }),
      new THREE.MeshStandardMaterial({ color: 0x20131d }),
    ],
  );
  dais.position.y = -0.15;
  scene.add(dais);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(6.6, 0.06, 8, 96),
    new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.4, metalness: 0.7, emissive: 0x3a2206 }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.01;
  scene.add(rim);

  // Alliance emblem inlaid in the dais.
  {
    const c = makeCanvas(1024, 1024);
    const g = c.getContext('2d');
    g.translate(512, 512);
    g.strokeStyle = 'rgba(232,180,84,0.85)';
    g.lineWidth = 14;
    g.beginPath();
    g.arc(0, 0, 470, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 5;
    g.beginPath();
    g.arc(0, 0, 430, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 24; i++) {
      g.rotate(Math.PI / 12);
      g.fillStyle = 'rgba(232,180,84,0.7)';
      g.beginPath();
      g.moveTo(0, -425);
      g.lineTo(14, -385);
      g.lineTo(-14, -385);
      g.closePath();
      g.fill();
    }
    g.fillStyle = 'rgba(232,180,84,0.32)';
    g.font = 'italic 700 420px Teko, Impact, "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('GD', -10, 30);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(9.2, 9.2),
      new THREE.MeshBasicMaterial({ map: texture(c), transparent: true, depthWrite: false, opacity: 0.8 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.012;
    scene.add(mesh);
  }

  // ---------- courtyard wall, pillars, banners ----------
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x33203a, roughness: 0.9 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x4a2f50, roughness: 0.8 });
  const box = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  };
  const WALL_Z = -8.2;
  box(44, 2.6, 0.7, 0, 1.0, WALL_Z, wallMat);
  box(44, 0.22, 0.95, 0, 2.4, WALL_Z, trimMat);
  for (let x = -19.2; x <= 19.2; x += 3.2) {
    box(0.7, 4.2, 0.7, x, 1.8, WALL_Z + 0.5, wallMat);
    box(0.95, 0.2, 0.95, x, 3.95, WALL_Z + 0.5, trimMat);
    box(0.95, 0.25, 0.95, x, -0.18, WALL_Z + 0.5, trimMat);
  }
  {
    const c = makeCanvas(256, 512);
    const g = c.getContext('2d');
    g.fillStyle = '#8c1226';
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(256, 0);
    g.lineTo(256, 512);
    g.lineTo(128, 440);
    g.lineTo(0, 512);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(255,214,130,0.85)';
    g.lineWidth = 8;
    g.strokeRect(22, 22, 212, 360);
    g.fillStyle = 'rgba(255,226,165,0.95)';
    g.font = 'italic 700 170px Teko, Impact, "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('GD', 124, 215);
    const mat = new THREE.MeshLambertMaterial({ map: texture(c), transparent: true, side: THREE.DoubleSide });
    for (const x of [-8, -4.8, -1.6, 1.6, 4.8, 8]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 2.3), mat);
      b.position.set(x, 1.15, WALL_Z + 0.4);
      scene.add(b);
    }
  }

  // ---------- torches ----------
  const flameTex = (() => {
    const c = makeCanvas(128, 128);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 76, 2, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,250,220,1)');
    grad.addColorStop(0.25, 'rgba(255,190,80,0.95)');
    grad.addColorStop(0.6, 'rgba(255,90,30,0.45)');
    grad.addColorStop(1, 'rgba(255,60,20,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return texture(c);
  })();
  const postMat = new THREE.MeshStandardMaterial({ color: 0x1a1016, roughness: 0.6, metalness: 0.5 });
  const torches = [];
  for (const [x, z] of [[-7.6, -4.6], [7.6, -4.6], [-10.5, 0.8], [10.5, 0.8]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 2.5, 10), postMat);
    post.position.set(x, 0.95, z);
    scene.add(post);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.14, 0.26, 14), postMat);
    bowl.position.set(x, 2.3, z);
    scene.add(bowl);
    const light = new THREE.PointLight(0xff8a3c, 1.9, 18, 2);
    light.position.set(x, 2.9, z);
    scene.add(light);
    const flame = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
    );
    flame.position.set(x, 2.85, z);
    scene.add(flame);
    torches.push({ light, flame, phase: x * 3 + z });
  }

  // Embers rising from the torches.
  const EMBERS = 110;
  const emberPos = new Float32Array(EMBERS * 3);
  const emberVel = [];
  const spawnEmber = (i, anywhere) => {
    const t = torches[i % torches.length].flame.position;
    emberPos[i * 3] = t.x + (Math.random() - 0.5) * 0.4;
    emberPos[i * 3 + 1] = t.y + (anywhere ? Math.random() * 4 : 0);
    emberPos[i * 3 + 2] = t.z + (Math.random() - 0.5) * 0.4;
    emberVel[i] = { x: (Math.random() - 0.5) * 0.004, y: 0.006 + Math.random() * 0.012, life: 4 + Math.random() * 4 };
  };
  for (let i = 0; i < EMBERS; i++) spawnEmber(i, true);
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
  const embers = new THREE.Points(
    emberGeo,
    new THREE.PointsMaterial({ color: 0xffa040, size: 0.07, map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
  );
  scene.add(embers);

  // ---------- fighters: 2D models on upright cards ----------
  const shadowTex = (() => {
    const c = makeCanvas(128, 128);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(0,0,0,0.7)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return texture(c);
  })();

  const cards = [0, 1].map(() => {
    const c = makeCanvas(CARD.w * CARD.scale, CARD.h * CARD.scale);
    const tex = texture(c);
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(CARD.w * S, CARD.h * S),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }),
    );
    scene.add(mesh);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    scene.add(shadow);
    return { canvas: c, g: c.getContext('2d'), tex, mesh, shadow };
  });

  // One more card across the whole stage for sparks, dust and projectiles.
  const fxCanvas = makeCanvas(ARENA.W * FX_SCALE, ARENA.H * FX_SCALE);
  const fxG = fxCanvas.getContext('2d');
  const fxTex = texture(fxCanvas);
  fxTex.minFilter = THREE.LinearFilter;
  fxTex.generateMipmaps = false;
  const fxMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA.W * S, ARENA.H * S),
    new THREE.MeshBasicMaterial({ map: fxTex, transparent: true, depthWrite: false, fog: false }),
  );
  fxMesh.position.set(0, wy(ARENA.H / 2), 0.12);
  fxMesh.renderOrder = 20;
  scene.add(fxMesh);

  // ---------- camera ----------
  // The camera is described by what it looks at, how far away it is and the
  // angle it has swung round the fight. Each frame it eases towards the shot
  // the action calls for.
  const cam = { x: 0, y: 1.3, dist: 12, yaw: 0.5, ready: false };

  function wantedShot(view, now) {
    const s = view.state;
    const [a, b] = s.f;
    const ax = wx(a.x);
    const bx = wx(b.x);
    const mid = (ax + bx) / 2;
    const gap = Math.abs(ax - bx);
    const lift = Math.max(wy(a.y), wy(b.y));
    const shot = {
      x: mid * 0.9,
      y: 1.25 + lift * 0.35,
      dist: Math.min(12.5, Math.max(7.4, (gap + 4.2) / 1.2)),
      yaw: Math.sin(now / 5200) * 0.05,
      ease: 0.09,
    };
    if (view.demo) {
      shot.yaw = Math.sin(now / 6000) * 0.42;
      shot.dist += 1.2;
      shot.y += 0.25;
    } else if (s.freeze > 0 && s.freezeBy >= 0) {
      // Finisher: push in on the attacker from their side.
      const f = s.f[s.freezeBy];
      shot.x = wx(f.x) + f.facing * 0.5;
      shot.y = 1.3;
      shot.dist = 5.6;
      shot.yaw = -f.facing * 0.42;
      shot.ease = 0.16;
    } else if (s.phase === 'intro') {
      const k = Math.min(1, s.pt / TIMING.INTRO);
      shot.yaw = (1 - k) * (1 - k) * 0.75;
      shot.dist += (1 - k) * 2;
    } else if (s.phase === 'ko' && s.koKind === 'ko' && s.winner >= 0) {
      const loser = s.f[1 - s.winner];
      const k = Math.min(1, s.pt / 120);
      shot.x = mid * (1 - k * 0.5) + wx(loser.x) * k * 0.5;
      shot.dist = Math.max(6.4, shot.dist - 2.2 * k);
      shot.yaw = (loser.x < s.f[s.winner].x ? 1 : -1) * 0.3 * k;
      shot.ease = 0.05;
    } else if (s.phase === 'over' && s.matchWinner >= 0) {
      const w = s.f[s.matchWinner];
      shot.x = wx(w.x);
      shot.dist = 6.2;
      shot.y = 1.45;
      shot.yaw = Math.sin(now / 1800) * 0.3;
      shot.ease = 0.04;
    }
    return shot;
  }

  let lastNow = 0;

  return {
    resize(w, h, dpr) {
      renderer.setPixelRatio(Math.min(dpr, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },

    snapCamera() {
      cam.ready = false;
    },

    render(view, now, shake) {
      const dt = Math.min(50, now - lastNow || 16);
      lastNow = now;
      const s = view.state;

      // Camera.
      const shot = wantedShot(view, now);
      if (!cam.ready) {
        Object.assign(cam, { x: shot.x, y: shot.y, dist: shot.dist, yaw: shot.yaw, ready: true });
      } else {
        const k = 1 - Math.pow(1 - shot.ease, dt / 16.7);
        cam.x += (shot.x - cam.x) * k;
        cam.y += (shot.y - cam.y) * k;
        cam.dist += (shot.dist - cam.dist) * k;
        cam.yaw += (shot.yaw - cam.yaw) * k;
      }
      camera.position.set(
        cam.x + Math.sin(cam.yaw) * cam.dist + shake.x * S * 1.5,
        cam.y + 0.55 + cam.dist * 0.07 + shake.y * S * 1.5,
        Math.cos(cam.yaw) * cam.dist,
      );
      camera.lookAt(cam.x, cam.y, 0);

      // Torches and embers.
      for (const t of torches) {
        const flick = Math.sin(now / 83 + t.phase) * 0.5 + Math.sin(now / 37 + t.phase * 2) * 0.5;
        t.light.intensity = 1.9 + flick * 0.4;
        t.flame.scale.set(1.25 + flick * 0.12, 1.75 + flick * 0.28, 1);
      }
      for (let i = 0; i < EMBERS; i++) {
        const v = emberVel[i];
        emberPos[i * 3] += v.x * dt * 0.06 + Math.sin(now / 500 + i) * 0.0015;
        emberPos[i * 3 + 1] += v.y * dt * 0.06;
        v.life -= dt / 1000;
        if (v.life <= 0) spawnEmber(i, false);
      }
      emberGeo.attributes.position.needsUpdate = true;

      // Fighters. The mirror-match recolour applies to player 2 only.
      const mirror = s.f[0].char === s.f[1].char;
      const attackerOnTop = s.f[1].state === 'attack' || s.f[1].state === 'airAttack' ? 1 : 0;
      for (let i = 0; i < 2; i++) {
        const f = s.f[i];
        const card = cards[i];
        const g = card.g;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, card.canvas.width, card.canvas.height);
        g.setTransform(CARD.scale, 0, 0, CARD.scale, (CARD.ox - f.x) * CARD.scale, (CARD.oy - f.y) * CARD.scale);
        drawFighter(g, f, getFighter(f.char), now, mirror && i === 1, false);
        card.tex.needsUpdate = true;

        const x = wx(f.x);
        const y = wy(f.y);
        card.mesh.position.set(x, y + (CARD.oy - CARD.h / 2) * S, i === attackerOnTop ? 0.04 : 0);
        card.mesh.rotation.y = Math.atan2(camera.position.x - x, camera.position.z);
        card.mesh.renderOrder = i === attackerOnTop ? 11 : 10;

        const spread = 1 - Math.min(0.5, y * 0.25);
        card.shadow.position.x = x;
        card.shadow.scale.set(1.25 * spread, 0.62 * spread, 1);
        card.shadow.material.opacity = 0.85 - Math.min(0.5, y * 0.3);
      }

      // Sparks and projectiles.
      const busy = s.proj.length > 0 || fxActive();
      fxMesh.visible = busy;
      if (busy) {
        fxG.setTransform(1, 0, 0, 1, 0, 0);
        fxG.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
        fxG.setTransform(FX_SCALE, 0, 0, FX_SCALE, 0, 0);
        for (const p of s.proj) drawProjectile(fxG, p, getFighter(p.char), now);
        drawFx(fxG);
        fxTex.needsUpdate = true;
      }

      renderer.render(scene, camera);
    },
  };
}
