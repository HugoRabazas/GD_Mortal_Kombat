// The 3D arena.
//
// Everything here is real 3D geometry seen through a perspective camera that
// follows the fight: a round stone dais the fighters roam freely, a courtyard
// wall with pillars and banners, torches that light the scene, mountains and
// a moon far behind - and the fighters themselves, articulated 3D bodies (see
// rig3d.js) that cast shadows on the floor.
//
// The arena also lives in time: round one is fought at dusk, round two under
// a cold night sky, round three in a storm with rain and lightning; and as the
// clock runs down a ring of fire closes in on the fighters.
//
// Units: 1 world unit = 100 arena pixels. The floor is y = 0 and its centre
// is the origin; the camera looks from +z towards -z.

import { ARENA, TIMING } from '../../../shared/constants.js';
import { getFighter } from '../../../shared/fighters.js';
import { takeFlashes } from './fx.js';
import { createRig } from './rig3d.js';
import { play } from '../audio.js';

const S = 0.01;

// How the light and weather look at each time of the fight.
//   sky: tint of the far backdrop; hemi: [sky colour, ground colour, strength];
//   key / moon: [colour, strength]; fog: [colour, density].
const MOODS = [
  { sky: [1, 1, 1], hemi: [0xb890c8, 0x3a2030, 0.42], key: [0xffe2cf, 1.5], moon: [0xffb58a, 0.6], fog: [0x2a1030, 0.018], torch: 1.5, rain: 0 }, // dusk
  { sky: [0.34, 0.42, 0.78], hemi: [0x7f9ad8, 0x141828, 0.5], key: [0xcfe0ff, 1.2], moon: [0x9fc0ff, 0.95], fog: [0x0e1630, 0.02], torch: 2.4, rain: 0 }, // night
  { sky: [0.3, 0.3, 0.38], hemi: [0x8a8fa8, 0x15121c, 0.42], key: [0xe6ecff, 1.0], moon: [0x8892b8, 0.35], fog: [0x181824, 0.028], torch: 3.0, rain: 1 }, // storm
];

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
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Colours are written as sRGB (what you see in a colour picker); lighting is
  // calculated in linear light, so every colour is converted on the way in.
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

  const texture = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  };

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(lin(0x2a1030), 0.02);
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 300);

  // ---------- sky, moon and mountains (far away, so they barely move) ----------
  let skyMat;
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
    skyMat = new THREE.MeshBasicMaterial({ map: texture(c), fog: false, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(190, 60), skyMat);
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
  const hemi = new THREE.HemisphereLight(lin(0xb890c8), lin(0x3a2030), 0.42);
  scene.add(hemi);
  // Moonlight from behind: gives the fighters a warm rim.
  const moonLight = new THREE.DirectionalLight(lin(0xffb58a), 0.6);
  moonLight.position.set(6, 9, -8);
  scene.add(moonLight);
  // Key light from the front. It is the one light that casts shadows.
  const key = new THREE.DirectionalLight(lin(0xffe2cf), 1.5);
  key.position.set(-2.5, 10, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -10;
  key.shadow.camera.right = 10;
  key.shadow.camera.top = 10;
  key.shadow.camera.bottom = -10;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 30;
  key.shadow.bias = -0.0015;
  key.shadow.radius = 3;
  key.shadow.camera.updateProjectionMatrix();
  scene.add(key);
  scene.add(key.target);

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

  const groundTex = stone([48, 30, 44], 5);
  groundTex.repeat.set(24, 24);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(96, 96),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.92, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.3;
  ground.receiveShadow = true;
  scene.add(ground);

  // The fighting dais: a raised stone disc.
  const daisTex = stone([84, 52, 70], 9);
  daisTex.repeat.set(5, 5);
  const dais = new THREE.Mesh(
    new THREE.CylinderGeometry(6.6, 6.9, 0.3, 64),
    [
      new THREE.MeshStandardMaterial({ color: lin(0x4a2c40), roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ map: daisTex, roughness: 0.78, metalness: 0.05 }),
      new THREE.MeshStandardMaterial({ color: lin(0x20131d) }),
    ],
  );
  dais.position.y = -0.15;
  dais.receiveShadow = true;
  scene.add(dais);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(6.6, 0.06, 8, 96),
    new THREE.MeshStandardMaterial({ color: lin(0xd9a441), roughness: 0.4, metalness: 0.6, emissive: lin(0x7a4a10) }),
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
  const wallMat = new THREE.MeshStandardMaterial({ color: lin(0x4c3352), roughness: 0.9 });
  const trimMat = new THREE.MeshStandardMaterial({ color: lin(0x634568), roughness: 0.8 });
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

  // ---------- the crowd ----------
  // Spectators on stands behind the wall. They sway while they watch and
  // jump when a heavy blow lands. All of them are drawn in two batches (bodies
  // and heads), so a full stand costs almost nothing.
  for (let row = 0; row < 3; row++) box(44, 0.5, 1.0, 0, 1.4 + row * 0.55, WALL_Z - 1.0 - row * 0.95, wallMat);
  const fans = [];
  {
    const rand = seeded(21);
    for (let row = 0; row < 3; row++) {
      for (let x = -17; x <= 17; x += 0.95 + rand() * 0.3) {
        fans.push({ x: x + (rand() - 0.5) * 0.3, y: 1.95 + row * 0.55, z: WALL_Z - 1.0 - row * 0.95, phase: rand() * 6.28, keen: 0.6 + rand() * 0.8 });
      }
    }
  }
  const fanBodies = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.21, 0.62, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }), fans.length);
  const fanHeads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 10, 8), new THREE.MeshLambertMaterial({ color: lin(0xd9a98a) }), fans.length);
  {
    const rand = seeded(33);
    const cloaks = [0x5a1626, 0x2a1a3a, 0x3a2a1a, 0x1f2f3f, 0x6a4a1a, 0x3a1a2a];
    fans.forEach((_, i) => fanBodies.setColorAt(i, lin(cloaks[Math.floor(rand() * cloaks.length)])));
  }
  scene.add(fanBodies, fanHeads);
  const fanDummy = new THREE.Object3D();
  let excite = 0; // 0 calm ... 1 on their feet

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
  const postMat = new THREE.MeshStandardMaterial({ color: lin(0x2a1a22), roughness: 0.6, metalness: 0.4 });
  const torches = [];
  for (const [x, z] of [[-7.6, -4.6], [7.6, -4.6], [-10.5, 0.8], [10.5, 0.8]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 2.5, 10), postMat);
    post.position.set(x, 0.95, z);
    scene.add(post);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.14, 0.26, 14), postMat);
    bowl.position.set(x, 2.3, z);
    scene.add(bowl);
    const light = new THREE.PointLight(lin(0xffa050), 1.5, 16, 2);
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

  // ---------- fighters ----------
  // A soft dark patch under each fighter anchors them to the floor even where
  // the cast shadow is faint.
  const contactTex = (() => {
    const c = makeCanvas(128, 128);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(0,0,0,0.75)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return texture(c);
  })();
  const contacts = [0, 1, 2, 3].map(() => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.02;
    scene.add(m);
    return m;
  });

  // Rigs are rebuilt whenever the line-up changes (new fight, new fighters).
  let rigs = [];
  let rigKey = '';
  const ensureRigs = (view) => {
    const s = view.state;
    const seen = new Set();
    const opts = s.f.map((f, i) => {
      const boss = !!view.boss?.[i];
      const alt = !boss && seen.has(f.char); // a second copy of a fighter wears other colours
      seen.add(f.char);
      return { alt, boss };
    });
    const key = s.f.map((f, i) => `${f.char}:${opts[i].alt}:${opts[i].boss}`).join('|');
    if (key === rigKey) return;
    rigKey = key;
    for (const r of rigs) r.dispose();
    rigs = s.f.map((f, i) => createRig(THREE, scene, getFighter(f.char), opts[i]));
  };

  // ---------- projectiles and hit flashes ----------
  const orbs = [0, 1, 2, 3, 4, 5].map(() => {
    const group = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    const light = new THREE.PointLight(0xffffff, 0, 6, 2);
    group.add(core, halo, light);
    group.visible = false;
    scene.add(group);
    return { group, halo, light };
  });
  const flashes = [0, 1, 2].map(() => {
    const light = new THREE.PointLight(0xffffff, 0, 7, 2);
    scene.add(light);
    return light;
  });
  let nextFlash = 0;

  // ---------- the ring of fire ----------
  const fireMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0, fog: false, blending: THREE.AdditiveBlending, depthWrite: false });
  const fireRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 8, 96), fireMat);
  fireRing.rotation.x = Math.PI / 2;
  fireRing.position.y = 0.06;
  scene.add(fireRing);
  const FLAMES = 40;
  const ringFlames = [];
  for (let i = 0; i < FLAMES; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0 }));
    scene.add(sp);
    ringFlames.push(sp);
  }

  // ---------- crystals and floor markers ----------
  const ITEM_COLORS = { energy: 0xffd34d, heal: 0x5dff8f };
  const gems = [0, 1, 2].map(() => {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.17), mat);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    halo.scale.set(1.1, 1.1, 1);
    const light = new THREE.PointLight(0xffffff, 0, 4, 2);
    group.add(gem, halo, light);
    group.visible = false;
    scene.add(group);
    return { group, gem, mat, halo, light };
  });
  // A coloured ring on the floor under each fighter, so you can always find
  // yours in the middle of a brawl.
  const SLOT_COLORS = [0xffd34d, 0x59c7ff, 0xff6ad5, 0x8be04e];
  const marks = SLOT_COLORS.map((color) => {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.5, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, fog: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.035;
    // A pointer on the ring shows which way the fighter faces (the head always
    // looks at the camera, so it cannot tell you).
    const tip = new THREE.Shape();
    tip.moveTo(0.56, 0.15);
    tip.lineTo(0.56, -0.15);
    tip.lineTo(0.82, 0);
    m.add(new THREE.Mesh(new THREE.ShapeGeometry(tip), m.material));
    scene.add(m);
    return m;
  });

  // ---------- dash trails ----------
  // A fighter lunging across the arena leaves a string of fading glows behind.
  const trail = Array.from({ length: 28 }, () => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0 }));
    sp.visible = false;
    scene.add(sp);
    return { sp, life: 0 };
  });
  let nextTrail = 0;

  // ---------- rain ----------
  const DROPS = 900;
  const rainPos = new Float32Array(DROPS * 6);
  const rainSeed = [];
  for (let i = 0; i < DROPS; i++) rainSeed.push({ x: (Math.random() - 0.5) * 30, z: (Math.random() - 0.5) * 22 + 2, y: Math.random() * 12, v: 0.25 + Math.random() * 0.12 });
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: 0xaebfe8, transparent: true, opacity: 0, fog: false });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  scene.add(rain);

  // ---------- time of day and weather ----------
  let mood = 0; // 0 dusk, 1 night, 2 storm; eases between them
  let lightning = 0; // brightness of the current flash, fading out
  let nextStrike = 4000;
  // The moods' colours, converted once so nothing is allocated per frame.
  const moods = MOODS.map((m) => ({ ...m, sky0: lin(m.hemi[0]), ground: lin(m.hemi[1]), keyC: lin(m.key[0]), moonC: lin(m.moon[0]), fogC: lin(m.fog[0]) }));
  const c1 = new THREE.Color();
  const blend = (a, b, k) => c1.copy(a).lerp(b, k);

  function applyMood(view, now, dt) {
    const s = view.state;
    // The fight moves through the evening one round at a time; the demo
    // behind the menus drifts through all of it.
    const want = view.demo ? 1 + Math.sin(now / 15000) : Math.min(2, s.round - 1);
    mood += (want - mood) * Math.min(1, dt / 1400);
    const i = Math.min(1, Math.floor(mood));
    const k = Math.min(1, Math.max(0, mood - i));
    const a = moods[i];
    const b = moods[i + 1];
    const mix = (x, y) => x + (y - x) * k;

    // How far the ring of fire has closed in (0 = wide open, 1 = fully closed).
    const closing = 1 - (s.ringR - ARENA.R_MIN) / (ARENA.R - ARENA.R_MIN);

    // Lightning: a sudden flash that decays, with thunder.
    const rainNow = mix(a.rain, b.rain);
    if (rainNow > 0.5 && now > nextStrike) {
      lightning = 1;
      nextStrike = now + 3500 + Math.random() * 6000;
      if (!view.demo) play('thunder');
    }
    lightning *= Math.pow(0.9, dt / 16.7);
    if (lightning < 0.01) lightning = 0;
    const flash = lightning * (0.6 + 0.4 * Math.sin(now / 23));

    skyMat.color.setRGB(mix(a.sky[0], b.sky[0]) + flash * 0.7, mix(a.sky[1], b.sky[1]) + flash * 0.7, mix(a.sky[2], b.sky[2]) + flash * 0.8);
    hemi.color.copy(blend(a.sky0, b.sky0, k));
    hemi.groundColor.copy(blend(a.ground, b.ground, k));
    hemi.intensity = mix(a.hemi[2], b.hemi[2]) + flash * 1.6;
    key.color.copy(blend(a.keyC, b.keyC, k));
    key.intensity = mix(a.key[1], b.key[1]) + flash * 0.8;
    moonLight.color.copy(blend(a.moonC, b.moonC, k));
    moonLight.intensity = mix(a.moon[1], b.moon[1]);
    scene.fog.color.copy(blend(a.fogC, b.fogC, k));
    scene.fog.density = mix(a.fog[1], b.fog[1]);

    // Torches burn harder at night, and flare as the ring closes.
    const torchBase = mix(a.torch, b.torch) + closing * 1.6;
    for (const t of torches) {
      const flick = Math.sin(now / 83 + t.phase) * 0.5 + Math.sin(now / 37 + t.phase * 2) * 0.5;
      t.light.intensity = torchBase * (1 + flick * 0.22);
      t.flame.scale.set(1.25 + flick * 0.12 + closing * 0.4, 1.75 + flick * 0.28 + closing * 0.7, 1);
    }

    // Rain.
    rainMat.opacity = rainNow * 0.42;
    rain.visible = rainNow > 0.02;
    if (rain.visible) {
      for (let d = 0; d < DROPS; d++) {
        const r = rainSeed[d];
        r.y -= r.v * dt * 0.06;
        if (r.y < 0) r.y += 12;
        const o = d * 6;
        rainPos[o] = r.x;
        rainPos[o + 1] = r.y;
        rainPos[o + 2] = r.z;
        rainPos[o + 3] = r.x + 0.03;
        rainPos[o + 4] = r.y + 0.34;
        rainPos[o + 5] = r.z;
      }
      rainGeo.attributes.position.needsUpdate = true;
    }

    // Ring of fire.
    const R = s.ringR * S;
    fireRing.scale.set(R, R, 1);
    fireMat.opacity = 0.25 + closing * 0.75;
    for (let f = 0; f < FLAMES; f++) {
      const ang = (f / FLAMES) * Math.PI * 2 + now / 9000;
      const flick = 0.75 + 0.25 * Math.sin(now / 70 + f * 1.7);
      const sp = ringFlames[f];
      sp.position.set(Math.cos(ang) * R, 0.2 + closing * 0.25 * flick, Math.sin(ang) * R);
      sp.scale.set(0.5 + closing * 0.5, (0.55 + closing * 1.1) * flick, 1);
      sp.material.opacity = closing * 0.9;
      sp.visible = closing > 0.01;
    }
  }

  // ---------- camera ----------
  // The camera is described by the spot on the floor it looks at, how far away
  // it is and the angle it has swung round the fight. Each frame it eases
  // towards the shot the action calls for.
  const cam = { x: 0, z: 0, y: 1, dist: 14, yaw: 0.5, ready: false };

  function wantedShot(view, now) {
    const s = view.state;
    const standing = s.f.filter((f) => f.hp > 0);
    const group = standing.length ? standing : s.f;
    let cx = 0;
    let cz = 0;
    let lift = 0;
    for (const f of group) {
      cx += f.x * S;
      cz += f.z * S;
      lift = Math.max(lift, f.h * S);
    }
    cx /= group.length;
    cz /= group.length;
    let spread = 0;
    for (const f of group) spread = Math.max(spread, Math.hypot(f.x * S - cx, (f.z * S - cz) * 1.5));
    const shot = {
      x: cx * 0.9,
      z: cz * 0.7,
      y: 0.9 + lift * 0.3,
      dist: Math.min(17, Math.max(8.2, 6.8 + spread * 1.75)),
      yaw: Math.sin(now / 5200) * 0.05,
      ease: 0.08,
    };
    if (view.demo) {
      shot.yaw = Math.sin(now / 6000) * 0.5;
      shot.dist += 1.5;
    } else if (s.freeze > 0 && s.freezeBy >= 0) {
      // Finisher: push in on the attacker.
      const f = s.f[s.freezeBy];
      shot.x = f.x * S;
      shot.z = f.z * S;
      shot.y = 1.2;
      shot.dist = 6;
      shot.yaw = -Math.cos(f.dir) * 0.45;
      shot.ease = 0.16;
    } else if (s.phase === 'intro') {
      const k = Math.min(1, s.pt / TIMING.INTRO);
      shot.yaw = (1 - k) * (1 - k) * 0.75;
      shot.dist += (1 - k) * 2.5;
    } else if (s.phase === 'ko' && s.winner >= 0) {
      const w = s.f[s.winner];
      const k = Math.min(1, s.pt / 120);
      shot.x += (w.x * S - shot.x) * k * 0.6;
      shot.z += (w.z * S - shot.z) * k * 0.6;
      shot.dist = Math.max(7, shot.dist - 3 * k);
      shot.yaw = 0.3 * k;
      shot.ease = 0.05;
    } else if (s.phase === 'over' && s.matchWinner >= 0) {
      const w = s.f[s.matchWinner];
      shot.x = w.x * S;
      shot.z = w.z * S;
      shot.dist = 6.8;
      shot.y = 1.3;
      shot.yaw = Math.sin(now / 1800) * 0.3;
      shot.ease = 0.04;
    }
    return shot;
  }

  let lastNow = 0;
  let kick = 0;
  const probe = new THREE.Vector3();

  // Adaptive quality. If the device cannot hold a smooth frame rate, first
  // drop the cast shadows and the extra-sharp resolution, then render at a
  // lower resolution still. Slower devices keep a playable game.
  const size = { w: 960, h: 540, dpr: 1 };
  let quality = 0; // 0 = full, 1 = no cast shadows, 2 = reduced resolution
  let sampleMs = 0;
  let sampleFrames = 0;
  const applyQuality = () => {
    const ratio = quality === 0 ? Math.min(size.dpr, 2) : quality === 1 ? Math.min(size.dpr, 1.25) : 0.75;
    renderer.setPixelRatio(ratio);
    renderer.setSize(size.w, size.h, false);
    key.castShadow = quality === 0;
  };
  const watchFrameRate = (rawDt) => {
    if (quality >= 2 || rawDt > 250) return; // ignore pauses and tab switches
    sampleMs += rawDt;
    sampleFrames++;
    if (sampleFrames < 100) return;
    const average = sampleMs / sampleFrames;
    sampleMs = sampleFrames = 0;
    if (average > 27) {
      quality++;
      applyQuality();
    }
  };

  return {
    resize(w, h, dpr) {
      Object.assign(size, { w, h, dpr });
      applyQuality();
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },

    snapCamera() {
      cam.ready = false;
    },

    // Where a point of the arena (in arena pixels) lands on the flat HUD
    // layer, and how big things there should be drawn (k = 1 at mid distance).
    project(x, h, z) {
      probe.set(x * S, h * S, z * S);
      const dist = probe.distanceTo(camera.position);
      probe.project(camera);
      return { x: (probe.x * 0.5 + 0.5) * ARENA.W, y: (-probe.y * 0.5 + 0.5) * ARENA.H, k: 12 / dist };
    },

    render(view, now, shake) {
      const rawDt = lastNow ? now - lastNow : 16;
      const dt = Math.min(50, rawDt);
      lastNow = now;
      watchFrameRate(rawDt);
      const s = view.state;

      // Camera.
      const shot = wantedShot(view, now);
      if (!cam.ready) {
        Object.assign(cam, { x: shot.x, z: shot.z, y: shot.y, dist: shot.dist, yaw: shot.yaw, ready: true });
      } else {
        const k = 1 - Math.pow(1 - shot.ease, dt / 16.7);
        cam.x += (shot.x - cam.x) * k;
        cam.z += (shot.z - cam.z) * k;
        cam.y += (shot.y - cam.y) * k;
        cam.dist += (shot.dist - cam.dist) * k;
        cam.yaw += (shot.yaw - cam.yaw) * k;
      }
      const reach = cam.dist - kick * 0.7;
      camera.position.set(
        cam.x + Math.sin(cam.yaw) * reach + shake.x * S * 1.5,
        cam.y + 0.8 + reach * 0.46 + shake.y * S * 1.5,
        cam.z + Math.cos(cam.yaw) * reach,
      );
      camera.lookAt(cam.x, cam.y, cam.z);
      camera.updateMatrixWorld();

      applyMood(view, now, dt);

      // Embers.
      for (let i = 0; i < EMBERS; i++) {
        const v = emberVel[i];
        emberPos[i * 3] += v.x * dt * 0.06 + Math.sin(now / 500 + i) * 0.0015;
        emberPos[i * 3 + 1] += v.y * dt * 0.06;
        v.life -= dt / 1000;
        if (v.life <= 0) spawnEmber(i, false);
      }
      emberGeo.attributes.position.needsUpdate = true;

      // Fighters.
      ensureRigs(view);
      for (let i = 0; i < contacts.length; i++) {
        const f = s.f[i];
        contacts[i].visible = !!f;
        if (!f) continue;
        rigs[i].update(f, now, camera);
        const height = f.h * S;
        const spread = 1 - Math.min(0.5, height * 0.25);
        const big = getFighter(f.char).build === 'sumo' ? 1.5 : 1;
        contacts[i].position.set(f.x * S, 0.02, f.z * S);
        contacts[i].scale.set(1.0 * spread * big, 1.0 * spread * big, 1);
        contacts[i].material.opacity = 0.7 - Math.min(0.45, height * 0.3);
      }

      // Floor rings: bright for human players, faint for the CPU.
      for (let i = 0; i < marks.length; i++) {
        const f = s.f[i];
        const show = !!f && f.hp > 0 && !view.demo;
        marks[i].visible = show;
        if (!show) continue;
        const human = !!view.humans?.[i];
        const big = getFighter(f.char).build === 'sumo' ? 1.35 : 1;
        const pulse = human ? 1 + Math.sin(now / 260) * 0.06 : 1;
        marks[i].position.x = f.x * S;
        marks[i].position.z = f.z * S;
        marks[i].scale.set(big * pulse, big * pulse, 1);
        marks[i].rotation.z = -f.dir;
        marks[i].material.opacity = human ? 0.9 : 0.35;
      }

      // Crystals: spinning, bobbing, glowing.
      for (let i = 0; i < gems.length; i++) {
        const g = gems[i];
        const it = s.items[i];
        g.group.visible = !!it;
        if (!it) {
          g.light.intensity = 0;
          continue;
        }
        const color = ITEM_COLORS[it.kind];
        const fade = Math.min(1, it.life / 90); // blink out at the end
        g.group.position.set(it.x * S, 0.55 + Math.sin(now / 300 + it.id) * 0.1, it.z * S);
        g.gem.rotation.y = now / 400;
        g.mat.color.set(color);
        g.halo.material.color.set(color);
        g.halo.material.opacity = fade;
        g.light.color.set(color);
        g.light.intensity = 3 * fade;
        g.group.visible = fade > 0.5 || Math.floor(now / 90) % 2 === 0;
      }

      // Dash trails.
      for (const f of s.f) {
        if (f.state !== 'attack' || (f.move !== 'dash' && f.move !== 'super') || (!f.vx && !f.vz)) continue;
        const t = trail[nextTrail++ % trail.length];
        t.life = 1;
        t.big = f.move === 'super' ? 1.5 : 1;
        t.sp.material.color.set(getFighter(f.char).colors.glow);
        t.sp.position.set(f.x * S, 1.0 + f.h * S, f.z * S);
        t.sp.visible = true;
      }
      for (const t of trail) {
        if (t.life <= 0) continue;
        t.life -= dt / 320;
        t.sp.visible = t.life > 0;
        t.sp.material.opacity = Math.max(0, t.life) * 0.8;
        const size = (0.9 + t.life * 1.3) * t.big;
        t.sp.scale.set(size, size * 1.5, 1);
      }

      // Projectiles: a white-hot core, a coloured halo and a light that
      // sweeps across the floor and the fighters as it flies.
      for (let i = 0; i < orbs.length; i++) {
        const o = orbs[i];
        const p = s.proj[i];
        o.group.visible = !!p;
        if (!p) {
          o.light.intensity = 0;
          continue;
        }
        const col = getFighter(p.char).colors.glow;
        const pulse = 1 + Math.sin(now / 45 + i) * 0.15;
        o.group.position.set(p.x * S, p.h * S, p.z * S);
        o.halo.material.color.set(col);
        o.halo.scale.set(1.3 * pulse, 1.3 * pulse, 1);
        o.light.color.set(col);
        o.light.intensity = 7 * pulse;
      }

      // Hit flashes: a short burst of light where a blow lands.
      for (const fl of takeFlashes()) {
        const light = flashes[nextFlash++ % flashes.length];
        light.position.set(fl.x * S, fl.h * S, fl.z * S + 0.6);
        light.color.set(fl.color);
        light.intensity = fl.heavy ? 14 : 8;
        if (fl.heavy) kick = 1; // the camera lunges in on a heavy blow
        excite = Math.min(1, excite + (fl.heavy ? 0.6 : 0.2));
      }
      kick *= Math.pow(0.86, dt / 16.7);
      for (const light of flashes) light.intensity *= 0.78;

      // The crowd: a slow sway, and jumping when excited.
      excite *= Math.pow(0.985, dt / 16.7);
      for (let i = 0; i < fans.length; i++) {
        const fan = fans[i];
        const hop = Math.abs(Math.sin(now / 130 + fan.phase)) * 0.28 * excite * fan.keen;
        const y = fan.y + Math.sin(now / 700 + fan.phase) * 0.03 + hop;
        fanDummy.position.set(fan.x + Math.sin(now / 900 + fan.phase) * 0.04, y, fan.z);
        fanDummy.updateMatrix();
        fanBodies.setMatrixAt(i, fanDummy.matrix);
        fanDummy.position.y = y + 0.46;
        fanDummy.updateMatrix();
        fanHeads.setMatrixAt(i, fanDummy.matrix);
      }
      fanBodies.instanceMatrix.needsUpdate = true;
      fanHeads.instanceMatrix.needsUpdate = true;

      renderer.render(scene, camera);
    },

    // Height of a fighter's head top, for name tags.
    headTop: (slot) => (rigs[slot] ? rigs[slot].top() : 2),
  };
}
