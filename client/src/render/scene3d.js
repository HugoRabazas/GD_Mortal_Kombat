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
import { getFighter, dressLineUp, dressColors } from '../../../shared/fighters.js';
import { MOVES, BLOCK_ARC } from '../../../shared/sim.js';
import { takeFlashes, takeCheers } from './fx.js';
import { createRig } from './rig3d.js';
import { play } from '../audio.js';
import { THEMES } from './themes.js';

const S = 0.01;



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
  // Count every draw of a frame, the shadow pass included (three.js resets
  // its counter after drawing shadows otherwise, which hid them).
  renderer.info.autoReset = false;
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
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 300); // (FOV below)

  // ---------- sky, moon and mountains (far away, so they barely move) ----------
  const paintSky = (th) => {
    const c = makeCanvas(2048, 1024);
    const g = c.getContext('2d');
    const rand = seeded(11);
    const sky = g.createLinearGradient(0, 0, 0, 1024);
    [0, 0.4, 0.68, 0.85, 1].forEach((at, i) => sky.addColorStop(at, th.sky[i]));
    g.fillStyle = sky;
    g.fillRect(0, 0, 2048, 1024);
    for (let i = 0; i < (th.stars ? 420 : 0); i++) {
      g.fillStyle = `rgba(${th.stars},${0.2 + rand() * 0.7})`;
      g.beginPath();
      g.arc(rand() * 2048, rand() * 600, rand() * 1.6 + 0.3, 0, Math.PI * 2);
      g.fill();
    }
    if (th.aurora) {
      // Northern lights: curtains of light, each a thin strip that fades upwards.
      g.globalCompositeOperation = 'lighter';
      for (const [base, tall, hue, wave] of [[560, 300, '70,255,170', 210], [500, 240, '90,200,255', 150], [610, 210, '190,110,255', 260]]) {
        for (let x = 0; x < 2048; x += 4) {
          const y = base + Math.sin(x / wave + base) * 70 + Math.sin(x / 47 + wave) * 16;
          const h = tall * (0.6 + 0.4 * Math.sin(x / 83 + base));
          const strip = g.createLinearGradient(0, y - h, 0, y);
          strip.addColorStop(0, `rgba(${hue},0)`);
          strip.addColorStop(0.75, `rgba(${hue},${0.1 + 0.07 * Math.sin(x / 29)})`);
          strip.addColorStop(1, `rgba(${hue},0)`);
          g.fillStyle = strip;
          g.fillRect(x, y - h, 4, h);
        }
      }
      g.globalCompositeOperation = 'source-over';
    }
    const mx = 1270;
    const my = th.aurora ? 560 : th.sun ? 520 : 700;
    const halo = g.createRadialGradient(mx, my, 30, mx, my, th.sun ? 420 : 260);
    halo.addColorStop(0, `rgba(${th.moon.halo[0]},0.6)`);
    halo.addColorStop(1, `rgba(${th.moon.halo[1]},0)`);
    g.fillStyle = halo;
    g.fillRect(mx - 430, my - 430, 860, 860);
    const moon = g.createRadialGradient(mx - 14, my - 14, 5, mx, my, 74);
    moon.addColorStop(0, th.moon.disc[0]);
    moon.addColorStop(1, th.moon.disc[1]);
    g.fillStyle = moon;
    g.beginPath();
    g.arc(mx, my, 72, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = `rgba(${th.moon.marks},0.22)`;
    for (const [dx, dy, r] of th.moon.marks ? [[-24, -15, 14], [20, 9, 19], [-7, 31, 9], [30, -29, 7]] : []) {
      g.beginPath();
      g.arc(mx + dx, my + dy, r, 0, Math.PI * 2);
      g.fill();
    }
    return texture(c);
  };
  const skyMat = new THREE.MeshBasicMaterial({ fog: false, depthWrite: false });
  {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(190, 60), skyMat);
    mesh.position.set(0, 22, -70);
    mesh.renderOrder = -10;
    scene.add(mesh);
  }

  // A mountain range: a jagged outline filled with rock. With `snow`, the
  // outline is painted twice, the rock a little lower, which leaves white peaks.
  const paintRidge = (seed, step, rock, snow) => {
    const c = makeCanvas(1024, 256);
    const g = c.getContext('2d');
    const rand = seeded(seed);
    const peaks = [];
    for (let x = 0; x <= 1024 + step; x += step) peaks.push([x, 40 + rand() * 170]);
    const fill = (color, drop) => {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, 256);
      for (const [x, y] of peaks) g.lineTo(x, y + drop);
      g.lineTo(1024, 256);
      g.closePath();
      g.fill();
    };
    if (snow) fill(snow, 0);
    fill(rock, snow ? 26 : 0);
    return texture(c);
  };
  const ridge = (seed, width, height, y, z, step) => {
    const mat = new THREE.MeshBasicMaterial({ transparent: true, fog: false, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    mesh.position.set(0, y, z);
    mesh.renderOrder = -9;
    scene.add(mesh);
    return { mat, seed, step };
  };
  const ridges = [ridge(3, 170, 16, 5, -58, 70), ridge(8, 130, 10, 3, -40, 48)];

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
  const stone = (base, seed, snow) => {
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
    if (snow) {
      // Snow blown into drifts across the slabs.
      for (let i = 0; i < 26; i++) {
        const x = rand() * 512;
        const y = rand() * 512;
        const r = 30 + rand() * 70;
        // Painted nine times, shifted by one tile, so the drifts cross the seams.
        for (const ox of [-512, 0, 512]) {
          for (const oy of [-512, 0, 512]) {
            const drift = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
            drift.addColorStop(0, 'rgba(236,246,255,0.3)');
            drift.addColorStop(1, 'rgba(236,246,255,0)');
            g.fillStyle = drift;
            g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
          }
        }
      }
    }
    const t = texture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };

  const groundMat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(96, 96), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.3;
  ground.receiveShadow = true;
  scene.add(ground);

  // The fighting dais: a raised stone disc.
  const daisSideMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  const daisMat = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0.05 });
  const dais = new THREE.Mesh(
    new THREE.CylinderGeometry(6.6, 6.9, 0.3, 64),
    [daisSideMat, daisMat, new THREE.MeshStandardMaterial({ color: lin(0x20131d) })],
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
  const wallMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const trimMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  // Snow lying on top of the wall and the pillars; only the frozen arena shows it.
  const snowMat = new THREE.MeshStandardMaterial({ color: lin(0xe6f0ff), roughness: 1 });
  const snowCaps = new THREE.Group();
  scene.add(snowCaps);
  // Every plain block of stone (wall, pillars, trims, stands, snow) is noted
  // here and drawn later as one batch per material: one draw call for all
  // the pillars instead of one each, which phones notice.
  const boxLists = new Map();
  const box = (w, h, d, x, y, z, mat) => {
    if (!boxLists.has(mat)) boxLists.set(mat, []);
    boxLists.get(mat).push([w, h, d, x, y, z]);
  };
  const WALL_Z = -8.2;
  box(44, 2.6, 0.7, 0, 1.0, WALL_Z, wallMat);
  box(44, 0.22, 0.95, 0, 2.4, WALL_Z, trimMat);
  box(44, 0.09, 1.0, 0, 2.55, WALL_Z, snowMat);
  for (let x = -19.2; x <= 19.2; x += 3.2) {
    box(0.7, 4.2, 0.7, x, 1.8, WALL_Z + 0.5, wallMat);
    box(0.95, 0.2, 0.95, x, 3.95, WALL_Z + 0.5, trimMat);
    box(1.0, 0.12, 1.0, x, 4.1, WALL_Z + 0.5, snowMat);
    box(0.95, 0.25, 0.95, x, -0.18, WALL_Z + 0.5, trimMat);
  }
  const paintBanner = ([cloth, border, letters]) => {
    const c = makeCanvas(256, 512);
    const g = c.getContext('2d');
    g.fillStyle = cloth;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(256, 0);
    g.lineTo(256, 512);
    g.lineTo(128, 440);
    g.lineTo(0, 512);
    g.closePath();
    g.fill();
    g.strokeStyle = border;
    g.lineWidth = 8;
    g.strokeRect(22, 22, 212, 360);
    g.fillStyle = letters;
    g.font = 'italic 700 170px Teko, Impact, "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('GD', 124, 215);
    return texture(c);
  };
  const bannerMat = new THREE.MeshLambertMaterial({ transparent: true, side: THREE.DoubleSide });
  // Each banner hangs from its top edge (the geometry is moved down by half
  // its height) so it can sway in the wind - gently at first, hard in the
  // storm, the blizzard or the sandstorm (see applyMood).
  const bannerCloth = new THREE.PlaneGeometry(1.15, 2.3);
  bannerCloth.translate(0, -1.15, 0);
  const banners = [-8, -4.8, -1.6, 1.6, 4.8, 8].map((x, i) => {
    const b = new THREE.Mesh(bannerCloth, bannerMat);
    b.position.set(x, 2.3, WALL_Z + 0.4);
    scene.add(b);
    return { b, phase: i * 1.7 };
  });

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
  // Stands down both sides too, where the camera actually looks.
  {
    const rand = seeded(57);
    for (const side of [-1, 1]) {
      for (let row = 0; row < 3; row++) {
        const x = side * (11.6 + row * 0.95);
        box(1.0, 0.5, 13, x, 0.05 + row * 0.5, -1.2, wallMat);
        for (let z = -7.2; z <= 4.6; z += 0.95 + rand() * 0.3) {
          fans.push({ x, y: 0.6 + row * 0.5, z: z + (rand() - 0.5) * 0.3, phase: rand() * 6.28, keen: 0.6 + rand() * 0.8 });
        }
      }
    }
  }
  {
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const place = new THREE.Object3D();
    for (const [mat, list] of boxLists) {
      const blocks = new THREE.InstancedMesh(unit, mat, list.length);
      list.forEach(([w, h, d, x, y, z], i) => {
        place.position.set(x, y, z);
        place.scale.set(w, h, d);
        place.updateMatrix();
        blocks.setMatrixAt(i, place.matrix);
      });
      blocks.instanceMatrix.needsUpdate = true;
      blocks.frustumCulled = false; // the batch spans the whole arena
      (mat === snowMat ? snowCaps : scene).add(blocks);
    }
  }

  const fanBodies = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.21, 0.62, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }), fans.length);
  const fanHeads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 10, 8), new THREE.MeshLambertMaterial({ color: lin(0xd9a98a) }), fans.length);
  // Some of the crowd came for one fighter: each stretch of the stands (left
  // to right, one per fighter in the line-up) has supporters wearing that
  // fighter's colours, and they are the ones on their feet when that fighter
  // lands something big. The rest wear the arena's own cloaks.
  // Stretches of equal size: each fan's place counted round the U of the
  // stands from the left (by the angle seen from the front of the arena), so
  // a side stand's rows all belong to the same stretch.
  const round = (fan) => Math.atan2(fan.x, 6 - fan.z);
  [...fans].sort((p, q) => round(p) - round(q)).forEach((fan, i) => (fan.rank = i));
  let crowdCloaks = ['#555555'];
  let lastWave = -9; // where the crowd wave is round the stands (0-1), -9 when none
  let crowdTeams = [];
  const teamCheer = [0, 0, 0, 0];
  const dressCrowd = (cloaks = crowdCloaks, teams = crowdTeams) => {
    crowdCloaks = cloaks;
    crowdTeams = teams;
    const rand = seeded(33);
    fans.forEach((fan, i) => {
      const cloak = cloaks[Math.floor(rand() * cloaks.length)];
      const team = teams.length ? Math.floor((fan.rank / fans.length) * teams.length) : -1;
      fan.team = team >= 0 && fan.rank % 7 < 3 ? team : -1; // three in seven, evenly spread
      fanBodies.setColorAt(i, lin(fan.team >= 0 ? teams[fan.team] : cloak));
    });
    fanBodies.instanceColor.needsUpdate = true;
  };
  scene.add(fanBodies, fanHeads);
  const fanDummy = new THREE.Object3D();
  let excite = 0; // 0 calm ... 1 on their feet
  let crowdTurn = false;

  // ---------- torches ----------
  const paintFlame = ([core, body, edge, out]) => {
    const c = makeCanvas(128, 128);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 76, 2, 64, 64, 62);
    grad.addColorStop(0, `rgba(${core},1)`);
    grad.addColorStop(0.25, `rgba(${body},0.95)`);
    grad.addColorStop(0.6, `rgba(${edge},0.45)`);
    grad.addColorStop(1, `rgba(${out},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return texture(c);
  };
  // Real fire: the ring that closes in, the dash trails and the glows. The
  // torches have a flame of their own, which each arena colours.
  const flameTex = paintFlame(THEMES.courtyard.flame);
  const torchFlameMat = new THREE.SpriteMaterial({ blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
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
    const flame = new THREE.Sprite(torchFlameMat);
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
  const emberMat = new THREE.PointsMaterial({ size: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  const embers = new THREE.Points(emberGeo, emberMat);
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
  let worn = []; // the colours each slot wears this fight (costumes included)
  const glowOf = (slot) => worn[slot]?.glow ?? '#ffffff';
  const ensureRigs = (view) => {
    const s = view.state;
    worn = dressColors(s.f.map((f) => f.char), view.looks);
    const looks = dressLineUp(s.f.map((f) => f.char), view.looks);
    const opts = s.f.map((f, i) => ({ look: looks[i], boss: !!view.boss?.[i] }));
    const key = (view.demo ? 'demo|' : '') + s.f.map((f, i) => `${f.char}:${opts[i].look}:${opts[i].boss}`).join('|');
    if (key === rigKey) return;
    rigKey = key;
    for (const r of rigs) r.dispose();
    rigs = s.f.map((f, i) => createRig(THREE, scene, getFighter(f.char), opts[i]));
    dressCrowd(undefined, view.demo ? [] : worn.map((c) => c.primary));
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

  // ---------- guard arcs ----------
  // A guard covers only the front (BLOCK_ARC either side of where the fighter
  // faces). While a fighter blocks, an arc on the floor shows what it covers,
  // and it flares during the last moments in which a block would be a
  // perfect guard - the timing made visible.
  const guards = Array.from({ length: 4 }, () => {
    const turn = new THREE.Group();
    const arc = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.8, 28, 1, -BLOCK_ARC, BLOCK_ARC * 2),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }),
    );
    arc.rotation.x = -Math.PI / 2;
    turn.add(arc);
    turn.visible = false;
    scene.add(turn);
    return { turn, arc };
  });

  // ---------- special-move flair ----------
  // The spinning leap: two flames orbit the fighter as they rise, leaving a
  // spiral of glows behind them. One pair per fighter slot.
  const twins = Array.from({ length: 4 }, () =>
    [0, 1].map(() => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      sp.visible = false;
      scene.add(sp);
      return sp;
    }),
  );
  // The ground stomp: a shockwave ring racing out to the edge of its reach,
  // so everyone can see how far it floors people.
  const waveMat = () => new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, fog: false });
  const waves = Array.from({ length: 4 }, () => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 56), waveMat());
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    scene.add(m);
    return { m, life: 0, r: 1 };
  });
  let nextWave = 0;
  const stomped = []; // per slot: the current stomp already sent its wave

  // The stomp also splits the floor: a pattern of cracks painted once,
  // laid where the foot came down and fading, and shards of rock thrown up.
  const crackTex = (() => {
    const c = makeCanvas(256, 256);
    const g = c.getContext('2d');
    g.translate(128, 128);
    g.strokeStyle = '#fff';
    g.lineCap = 'round';
    for (let i = 0; i < 11; i++) {
      let a = (i / 11) * Math.PI * 2 + Math.sin(i * 7) * 0.2;
      let x = 0;
      let y = 0;
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(0, 0);
      for (let j = 0; j < 7; j++) {
        a += Math.sin(i * 3 + j * 5) * 0.45;
        x += Math.cos(a) * 17;
        y += Math.sin(a) * 17;
        g.lineTo(x, y);
        g.lineWidth = Math.max(1, 5 - j * 0.6);
      }
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    return t;
  })();
  const cracks = Array.from({ length: 3 }, () => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    scene.add(m);
    return { m, life: 0 };
  });
  let nextCrack = 0;
  const shardGeo = new THREE.TetrahedronGeometry(0.09);
  const shards = Array.from({ length: 16 }, () => {
    const m = new THREE.Mesh(shardGeo, new THREE.MeshLambertMaterial({ color: 0x7a6a5e }));
    m.visible = false;
    scene.add(m);
    return { m, life: 0, vx: 0, vy: 0, vz: 0 };
  });
  let nextShard = 0;

  // The storm bolt: lightning crackling round each orb, and a ball of it
  // gathering in the hands while the bolt is charged.
  const ARC_SEGS = 10;
  const arcs = Array.from({ length: 6 }, () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_SEGS * 6), 3));
    const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    l.frustumCulled = false;
    l.visible = false;
    scene.add(l);
    return l;
  });
  const jag = (l, cx, cy, cz, r) => {
    const a = l.geometry.attributes.position.array;
    for (let i = 0; i < ARC_SEGS; i++) {
      // Each segment: a short zig-zag stroke from near the core outwards.
      const th = Math.random() * Math.PI * 2;
      const ph = (Math.random() - 0.5) * Math.PI;
      const r0 = r * (0.3 + Math.random() * 0.3);
      const r1 = r * (0.8 + Math.random() * 0.7);
      a[i * 6] = cx + Math.cos(th) * Math.cos(ph) * r0;
      a[i * 6 + 1] = cy + Math.sin(ph) * r0;
      a[i * 6 + 2] = cz + Math.sin(th) * Math.cos(ph) * r0;
      const th2 = th + (Math.random() - 0.5) * 0.9;
      a[i * 6 + 3] = cx + Math.cos(th2) * Math.cos(ph) * r1;
      a[i * 6 + 4] = cy + Math.sin(ph) * r1 + (Math.random() - 0.5) * 0.1;
      a[i * 6 + 5] = cz + Math.sin(th2) * Math.cos(ph) * r1;
    }
    l.geometry.attributes.position.needsUpdate = true;
  };
  const charges = Array.from({ length: 4 }, () => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    sp.visible = false;
    scene.add(sp);
    return sp;
  });

  // Rushes, leaps and dives: speed lines streaming off the body.
  const SPEED_LINES = 8;
  const streaks = Array.from({ length: 4 }, () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPEED_LINES * 6), 3));
    const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    l.frustumCulled = false;
    l.visible = false;
    scene.add(l);
    return l;
  });
  const takeoff = []; // per slot: the rising special already lit its ring of fire
  const cracked = []; // per slot: the current stomp already split the floor

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

  // ---------- snow ----------
  // Flakes drift down slowly and sway; in the blizzard the wind takes them.
  const FLAKES = 1300;
  const snowPos = new Float32Array(FLAKES * 3);
  const snowSeed = [];
  for (let i = 0; i < FLAKES; i++) snowSeed.push({ x: (Math.random() - 0.5) * 30, z: (Math.random() - 0.5) * 22 + 2, y: Math.random() * 12, v: 0.9 + Math.random() * 1.1, sway: Math.random() * 6.28 });
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const flakeTex = (() => {
    const c = makeCanvas(32, 32);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 15);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    return texture(c);
  })();
  const snowFallMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.2, map: flakeTex, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const snowFall = new THREE.Points(snowGeo, snowFallMat);
  snowFall.frustumCulled = false;
  snowFall.visible = false;
  scene.add(snowFall);

  // ---------- time of day and weather ----------
  let mood = 0; // 0 dusk, 1 night, 2 storm; eases between them
  let lightning = 0; // brightness of the current flash, fading out
  let nextStrike = 4000;

  // ---------- which arena ----------
  // Everything an arena paints is made the first time it is shown and kept,
  // so going back and forth between arenas costs nothing.
  const painted = {};
  let theme = null; // the arena on show
  let moods = null;
  function setTheme(id) {
    const name = THEMES[id] ? id : 'courtyard';
    if (theme && theme.name === name) return;
    const th = THEMES[name];
    if (!painted[name]) {
      const groundTex = stone(th.ground, 5, th.snow);
      groundTex.repeat.set(24, 24);
      const daisTex = stone(th.dais, 9, th.snow);
      daisTex.repeat.set(5, 5);
      painted[name] = {
        name,
        th,
        sky: paintSky(th),
        ridges: ridges.map((r, i) => paintRidge(r.seed, r.step, th.ridges[i][0], th.ridges[i][1])),
        ground: groundTex,
        dais: daisTex,
        banner: paintBanner(th.banner),
        flame: name === 'courtyard' ? flameTex : paintFlame(th.flame),
        // The moods' colours, converted once so nothing is allocated per frame.
        moods: th.moods.map((m) => ({ ...m, sky0: lin(m.hemi[0]), ground: lin(m.hemi[1]), keyC: lin(m.key[0]), moonC: lin(m.moon[0]), fogC: lin(m.fog[0]) })),
      };
    }
    theme = painted[name];
    moods = theme.moods;
    skyMat.map = theme.sky;
    ridges.forEach((r, i) => {
      r.mat.map = theme.ridges[i];
      r.mat.needsUpdate = true;
    });
    groundMat.map = theme.ground;
    daisMat.map = theme.dais;
    daisSideMat.color.copy(lin(th.daisSide));
    wallMat.color.copy(lin(th.wall));
    trimMat.color.copy(lin(th.trim));
    bannerMat.map = theme.banner;
    torchFlameMat.map = theme.flame;
    emberMat.map = theme.flame;
    emberMat.color.set(th.ember);
    for (const t of torches) t.light.color.copy(lin(th.torch));
    for (const m of [skyMat, groundMat, daisMat, bannerMat, torchFlameMat, emberMat]) m.needsUpdate = true;
    snowCaps.visible = th.snow;
    dressCrowd(th.cloaks);
    lightning = 0;
  }
  setTheme('courtyard');
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
    if (theme.th.lightning && rainNow > 0.5 && now > nextStrike) {
      lightning = 1;
      nextStrike = now + 3500 + Math.random() * 6000;
      if (!view.demo) play('thunder');
    }
    // Where it snows instead, the blizzard howls in gusts.
    if (theme.th.weather !== 'rain' && rainNow > 0.5 && now > nextStrike) {
      nextStrike = now + 3000 + Math.random() * 4500;
      if (!view.demo) play('wind');
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
    // Under the northern lights the rim light on the fighters wanders between
    // green and violet; the blizzard hides it.
    if (theme.th.aurora) moonLight.color.offsetHSL(Math.sin(now / 5200) * 0.1 * (1 - rainNow), 0, 0);
    scene.fog.color.copy(blend(a.fogC, b.fogC, k));
    scene.fog.density = mix(a.fog[1], b.fog[1]);

    // Torches burn harder at night, and flare as the ring closes.
    const torchBase = mix(a.torch, b.torch) + closing * 1.6;
    for (const t of torches) {
      const flick = Math.sin(now / 83 + t.phase) * 0.5 + Math.sin(now / 37 + t.phase * 2) * 0.5;
      t.light.intensity = torchBase * (1 + flick * 0.22);
      t.flame.scale.set(1.25 + flick * 0.12 + closing * 0.4, 1.75 + flick * 0.28 + closing * 0.7, 1);
    }

    // Banners in the wind.
    for (const { b, phase } of banners) {
      const gust = 0.04 + rainNow * 0.22;
      b.rotation.x = -Math.abs(Math.sin(now / (900 - rainNow * 500) + phase)) * gust - rainNow * 0.08;
      b.rotation.z = Math.sin(now / 1300 + phase * 2) * gust * 0.35;
    }

    // Snow, where it snows: it falls at walking pace and the wind grows with
    // it. Sand uses the same grains, smaller and warm, driven almost sideways.
    // Petals are the same grains again: pink, larger, drifting down slowly and
    // swaying more on the evening wind.
    const sand = theme.th.weather === 'sand';
    const petals = theme.th.weather === 'petals';
    const snowing = theme.th.weather === 'snow' || sand || petals;
    snowFall.visible = snowing && rainNow > 0.02;
    if (snowFall.visible) {
      snowFallMat.opacity = Math.min(0.95, 0.45 + rainNow * 0.5);
      snowFallMat.color.set(sand ? 0xd8b078 : petals ? 0xff7eac : 0xffffff);
      snowFallMat.size = sand ? 0.16 : petals ? 0.24 : 0.2;
      const wind = rainNow * rainNow * (sand ? 11 : petals ? 4 : 5.5);
      const count = Math.round(FLAKES * (0.25 + 0.75 * rainNow) * share);
      for (let d = 0; d < count; d++) {
        const r = snowSeed[d];
        r.y -= r.v * (1 + rainNow) * dt * (sand ? 0.0003 : petals ? 0.0006 : 0.001);
        r.x += (wind + Math.sin(now / 900 + r.sway) * (petals ? 1.2 : 0.5)) * dt * 0.001;
        if (r.y < 0) r.y += 12;
        if (r.x > 15) r.x -= 30;
        const o = d * 3;
        snowPos[o] = r.x;
        snowPos[o + 1] = r.y;
        snowPos[o + 2] = r.z;
      }
      snowGeo.setDrawRange(0, count);
      snowGeo.attributes.position.needsUpdate = true;
    }

    // Rain.
    rainMat.opacity = snowing ? 0 : rainNow * 0.42;
    rain.visible = !snowing && rainNow > 0.02;
    if (rain.visible) {
      const drops = Math.round(DROPS * share);
      rainGeo.setDrawRange(0, drops * 2);
      for (let d = 0; d < drops; d++) {
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
      rise: 0.46, // how high the camera sits, as a share of its distance
      look: 0, // how far above the fighters it aims
      ease: 0.08,
    };
    if (view.demo) {
      shot.yaw = Math.sin(now / 6000) * 0.5;
      shot.dist += 1.5;
    } else if (view.replay && s.phase === 'fight' && !(s.freeze > 0) && s.f[view.replay.on]) {
      // The knockout's replay, before the blow: in close and low on the one
      // about to go down and the rival nearest them, from the side and turning
      // slowly - another angle than the fight was seen from.
      const d = s.f[view.replay.on];
      const o = s.f.filter((x) => x !== d && x.hp > 0).sort((a, b) => Math.hypot(a.x - d.x, a.z - d.z) - Math.hypot(b.x - d.x, b.z - d.z))[0] || d;
      const gap = Math.hypot(o.x - d.x, o.z - d.z) * S;
      shot.x = ((d.x + o.x) / 2) * S;
      shot.z = ((d.z + o.z) / 2) * S;
      shot.y = 0.9 + Math.max(d.h, o.h) * S * 0.5;
      shot.dist = Math.min(8, 5.6 + gap * 0.7);
      shot.yaw = 0.85 + Math.sin(now / 2600) * 0.25;
      shot.rise = 0.3;
      shot.ease = 0.1;
    } else if (s.freeze > 0 && s.freezeBy >= 0) {
      // Finisher: push in on the attacker.
      const f = s.f[s.freezeBy];
      shot.x = f.x * S;
      shot.z = f.z * S;
      shot.y = 1.2;
      shot.dist = 6;
      shot.yaw = -Math.cos(f.dir) * 0.45;
      shot.ease = 0.16;
    } else if (s.finale > 0 && s.finaleOn >= 0) {
      // A finisher's last blow: in tight on the one it lands on, swinging
      // slowly round them while the world holds still.
      const d = s.f[s.finaleOn];
      const k = 1 - s.finale / 48;
      shot.x = d.x * S;
      shot.z = d.z * S;
      shot.y = 0.8 + d.h * S;
      shot.dist = 4.4 + k * 1.6;
      shot.yaw = 0.55 - k * 0.5;
      shot.rise = 0.3;
      shot.ease = 0.2;
    } else if (s.f.some((f) => f.state === 'attack' && MOVES[f.move]?.ult)) {
      // A finisher playing out: close in on it, framing the attacker and the
      // rival it is after, a little to the side.
      const f = s.f.find((o) => o.state === 'attack' && MOVES[o.move]?.ult);
      const o = s.f.filter((x) => x !== f && x.hp > 0).sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z))[0] || f;
      shot.x = ((f.x + o.x) / 2) * S;
      shot.z = ((f.z + o.z) / 2) * S;
      shot.y = 1.1 + f.h * S * 0.6;
      shot.dist = Math.min(shot.dist, 6.6 + Math.hypot(f.x - o.x, f.z - o.z) * S * 0.6);
      shot.yaw = -Math.cos(f.dir) * 0.35;
      shot.ease = 0.12;
    } else if (s.phase === 'intro') {
      // Every round opens low and wide, looking up at the sky over the wall,
      // and cranes down to the fighters before the call to fight.
      const k = Math.min(1, s.pt / TIMING.INTRO);
      const far = Math.max(0, 1 - k / 0.7);
      const open = far * far * (3 - 2 * far);
      shot.yaw = (1 - k) * (1 - k) * 0.75;
      shot.dist += (1 - k) * 2.5 + open * 4;
      shot.rise = 0.46 - open * 0.36;
      shot.look = open * 3.2;
      shot.ease = 0.08 + open * 0.1;
    } else if (s.phase === 'ko' && s.koKind === 'ko' && s.pt < 54 && s.f.some((f) => f.state === 'ko')) {
      // The knockout in slow motion: the camera swings round the one going
      // down, close in, before turning to the winner.
      const down = s.f.filter((f) => f.state === 'ko').sort((a, b) => (b.outAt ?? 0) - (a.outAt ?? 0))[0];
      const k = s.pt / 54;
      shot.x = down.x * S;
      shot.z = down.z * S;
      shot.y = 0.5 + down.h * S * 0.8;
      shot.dist = 3.4 + k * 2;
      shot.yaw = 1.1 - k * 1.6;
      shot.rise = 0.22 + k * 0.14;
      shot.ease = 0.18;
    } else if (s.phase === 'ko' && s.winner >= 0) {
      const w = s.f[s.winner];
      const k = Math.min(1, s.pt / 120);
      shot.x += (w.x * S - shot.x) * k * 0.6;
      shot.z += (w.z * S - shot.z) * k * 0.6;
      shot.dist = Math.max(7, shot.dist - 3 * k);
      shot.yaw = 0.3 * k;
      shot.ease = 0.05;
    } else if (s.phase === 'over' && s.matchWinner >= 0) {
      // The match won: the winner in their victory pose, framed to the left
      // of the picture (the result sits to the right on wide screens).
      const w = s.f[s.matchWinner];
      shot.yaw = Math.sin(now / 1800) * 0.3;
      // The camera's right, on the floor: aim that far to the winner's right.
      shot.x = w.x * S + Math.cos(shot.yaw) * 1.5;
      shot.z = w.z * S - Math.sin(shot.yaw) * 1.5;
      shot.dist = 6.8;
      shot.y = 1.3;
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
  // The canvas can reach past the 16:9 stage (to fill a wide phone): `kx`
  // and `ky` are how many times wider and taller it is than the stage.
  const bleed = { kx: 1, ky: 1 };
  const FOV = 38;
  let quality = 0; // 0 = full, 1 = no cast shadows, 2 = reduced resolution
  // The player's choice in Settings: 'auto' adapts as above; 'sharp' keeps
  // full quality whatever happens; 'fast' starts at the lightest level and
  // also thins the weather and the crowd's movement, for slower phones.
  let graphics = 'auto';
  let share = 1; // the share of rain, snow and sand drawn
  let sampleMs = 0;
  let sampleFrames = 0;
  const applyQuality = () => {
    if (graphics === 'sharp') quality = 0;
    if (graphics === 'fast') quality = 2;
    share = graphics === 'fast' ? 0.3 : 1;
    const ratio = quality === 0 ? Math.min(size.dpr, 2) : quality === 1 ? Math.min(size.dpr, 1.25) : 0.75;
    renderer.setPixelRatio(ratio);
    renderer.setSize(size.w, size.h, false);
    key.castShadow = quality === 0;
  };
  const watchFrameRate = (rawDt) => {
    if (graphics !== 'auto' || quality >= 2 || rawDt > 250) return; // ignore pauses and tab switches
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
    // w x h: the stage; fullW x fullH: the canvas, centred on it. The
    // camera keeps the stage's view the same and only adds to the sides.
    resize(w, h, dpr, fullW = w, fullH = h) {
      Object.assign(size, { w: fullW, h: fullH, dpr });
      bleed.kx = fullW / w;
      bleed.ky = fullH / h;
      applyQuality();
      camera.aspect = fullW / fullH;
      camera.fov = (2 * Math.atan(Math.tan((FOV * Math.PI) / 360) * bleed.ky) * 180) / Math.PI;
      camera.updateProjectionMatrix();
    },

    snapCamera() {
      cam.ready = false;
    },

    setGraphics(mode) {
      graphics = ['auto', 'sharp', 'fast'].includes(mode) ? mode : 'auto';
      quality = 0;
      sampleMs = sampleFrames = 0;
      applyQuality();
    },

    // What the last frame cost the graphics card (for ?debug and the checks).
    stats() {
      const r = renderer.info.render;
      // What is on show, by kind (a rough guide to where the draws go).
      const seen = {};
      scene.traverseVisible((o) => {
        if (!o.isMesh && !o.isSprite && !o.isPoints && !o.isLine) return;
        const kind = o.isInstancedMesh ? 'batch' : o.isSprite ? 'sprite' : o.isPoints ? 'points' : o.isLine ? 'line' : o.material?.side === THREE.BackSide ? 'outline' : 'mesh';
        seen[kind] = (seen[kind] || 0) + 1;
        if (o.castShadow) seen.casters = (seen.casters || 0) + 1;
      });
      return { calls: r.calls, triangles: r.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, quality, graphics, pixelRatio: renderer.getPixelRatio(), seen, cheer: teamCheer.map((c) => +c.toFixed(2)), supporters: crowdTeams.map((_, t) => fans.filter((f) => f.team === t).length), wave: lastWave > -9 ? { at: +lastWave.toFixed(2), standing: fans.filter((f) => Math.abs(f.rank / fans.length - lastWave) < 0.06).length } : null };
    },

    // Where a point of the arena (in arena pixels) lands on the flat HUD
    // layer, and how big things there should be drawn (k = 1 at mid distance).
    project(x, h, z) {
      probe.set(x * S, h * S, z * S);
      const dist = probe.distanceTo(camera.position);
      probe.project(camera);
      return { x: (probe.x * 0.5 * bleed.kx + 0.5) * ARENA.W, y: (-probe.y * 0.5 * bleed.ky + 0.5) * ARENA.H, k: 12 / dist };
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
        Object.assign(cam, { x: shot.x, z: shot.z, y: shot.y, dist: shot.dist, yaw: shot.yaw, rise: shot.rise, look: shot.look, ready: true });
      } else {
        const k = 1 - Math.pow(1 - shot.ease, dt / 16.7);
        cam.x += (shot.x - cam.x) * k;
        cam.z += (shot.z - cam.z) * k;
        cam.y += (shot.y - cam.y) * k;
        cam.dist += (shot.dist - cam.dist) * k;
        cam.yaw += (shot.yaw - cam.yaw) * k;
        cam.rise += (shot.rise - cam.rise) * k;
        cam.look += (shot.look - cam.look) * k;
      }
      const reach = cam.dist - kick * 0.7;
      camera.position.set(
        cam.x + Math.sin(cam.yaw) * reach + shake.x * S * 1.5,
        cam.y + 0.8 + reach * cam.rise + shake.y * S * 1.5,
        cam.z + Math.cos(cam.yaw) * reach,
      );
      camera.lookAt(cam.x, cam.y + cam.look, cam.z);
      camera.updateMatrixWorld();

      setTheme(view.theme);
      applyMood(view, now, dt);

      // Embers.
      for (let i = 0; i < EMBERS; i++) {
        const v = emberVel[i];
        emberPos[i * 3] += (v.x * 0.06 + Math.sin(now / 500 + i) * 0.00009) * dt;
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
        rigs[i].setOutline(quality < 2);
        rigs[i].update(f, now, camera);
        const guard = guards[i];
        if (guard) {
          guard.turn.visible = f.state === 'block' && f.hp > 0;
          if (guard.turn.visible) {
            guard.turn.position.set(f.x * S, 0.04 + f.h * S, f.z * S);
            guard.turn.rotation.y = -f.dir;
            guard.arc.material.color.set(glowOf(i));
            guard.arc.material.opacity = f.guard > 0 ? 0.95 : 0.35;
            const swell = f.guard > 0 ? 1.12 : 1;
            guard.arc.scale.setScalar((getFighter(f.char).build === 'sumo' ? 1.3 : 1) * swell);
          }
        }
        const height = f.h * S;
        const spread = 1 - Math.min(0.5, height * 0.25);
        const big = getFighter(f.char).build === 'sumo' ? 1.5 : 1;
        contacts[i].position.set(f.x * S, 0.02, f.z * S);
        // Without real shadows (Graphics: Fast, or a slow device) the contact
        // patch grows to stand in for the shadow the body would cast.
        const stand = key.castShadow ? 1 : 1.45;
        contacts[i].scale.set(1.0 * spread * big * stand, 1.0 * spread * big * stand, 1);
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
        const m = f.state === 'attack' && MOVES[f.move];
        if (!m || !(m.rush || m.dive || m.leap) || (!f.vx && !f.vz)) continue;
        const t = trail[nextTrail++ % trail.length];
        t.life = 1;
        t.big = m.ult || f.move === 'super' ? 1.5 : 1;
        t.sp.material.color.set(glowOf(f.slot));
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

      // Special-move flair.
      for (const f of s.f) {
        const glow = glowOf(f.slot);
        const pair = twins[f.slot];
        const pillar = f.state === 'attack' && ((f.move === 'phoenix' && f.t >= MOVES.phoenix.startup) || f.move === 'phoenix2');
        const rising = pillar || (f.state === 'attack' && f.move === 'rise' && (f.h > 0 || f.t >= MOVES.rise.startup));
        if (pair) {
          pair.forEach((sp, k) => {
            sp.visible = rising;
            if (!rising) return;
            const a = now / 70 + k * Math.PI;
            const y = 0.55 + f.h * S + Math.sin(now / 55 + k) * 0.3;
            sp.position.set(f.x * S + Math.cos(a) * 0.62, y, f.z * S + Math.sin(a) * 0.62);
            sp.material.color.set(glow);
            if (pillar) sp.scale.set(1.15, 1.7, 1); // the finisher's pillar of flame
            else sp.scale.set(0.75, 1.1, 1);
            // A glow left behind every other frame draws the spiral.
            if ((nextTrail & 1) === k) {
              const t = trail[nextTrail % trail.length];
              t.life = 0.7;
              t.big = 0.55;
              t.sp.material.color.set(glow);
              t.sp.position.copy(sp.position);
              t.sp.visible = true;
            }
          });
          if (rising) nextTrail++;
        }
        const stomping = f.state === 'attack' && f.move === 'quake' && f.t >= MOVES.quake.startup;
        if (stomping && !stomped[f.slot]) {
          const w = waves[nextWave++ % waves.length];
          w.life = 1;
          w.r = (MOVES.quake.reach + 30) * S;
          w.m.position.set(f.x * S, 0.03, f.z * S);
          w.m.material.color.set(glow);
          w.m.visible = true;
        }
        stomped[f.slot] = stomping;
      }
      for (const f of s.f) {
        const glow = glowOf(f.slot);
        const m = f.state === 'attack' && MOVES[f.move];
        // The stomp's cracks and shards, once per stomp.
        const quaking = f.move === 'quake' && f.state === 'attack' && f.t >= MOVES.quake.startup;
        if (quaking && !cracked[f.slot]) {
          const c = cracks[nextCrack++ % cracks.length];
          c.life = 1;
          const r = (MOVES.quake.reach + 40) * S * 2;
          c.m.scale.set(r, r, 1);
          c.m.position.set(f.x * S, 0.025, f.z * S);
          c.m.material.color.set(glow);
          c.m.visible = true;
          for (let i = 0; i < 10; i++) {
            const sh = shards[nextShard++ % shards.length];
            const a = (i / 10) * Math.PI * 2 + Math.random() * 0.5;
            const d = 0.4 + Math.random() * 0.9;
            sh.m.position.set(f.x * S + Math.cos(a) * d, 0.05, f.z * S + Math.sin(a) * d);
            sh.vx = Math.cos(a) * (0.02 + Math.random() * 0.03);
            sh.vz = Math.sin(a) * (0.02 + Math.random() * 0.03);
            sh.vy = 0.07 + Math.random() * 0.06;
            sh.life = 1;
            sh.m.visible = true;
          }
        }
        // The rising special lights a ring of fire on the floor at take-off.
        const lifting = f.state === 'attack' && (f.move === 'rise' || f.move === 'phoenix') && f.t >= MOVES[f.move].startup;
        if (lifting && !takeoff[f.slot]) {
          const w = waves[nextWave++ % waves.length];
          w.life = 1;
          w.r = 1.4;
          w.m.position.set(f.x * S, 0.03, f.z * S);
          w.m.material.color.set('#ff9a2a');
          w.m.visible = true;
        }
        takeoff[f.slot] = lifting;
        cracked[f.slot] = quaking;
        // The storm bolt gathering between the hands.
        const ch = charges[f.slot];
        if (ch) {
          const charging = f.state === 'attack' && f.move === 'bolt' && f.t < MOVES.bolt.startup;
          const coiled = f.state === 'attack' && f.move === 'charge'; // the kick being charged
          ch.visible = charging || coiled;
          if (coiled) {
            const sz = 0.3 + Math.min(1, f.t / 30) * 0.7 + Math.sin(now / 25) * 0.06;
            ch.position.set(f.x * S + Math.cos(f.dir) * 0.15, 0.75, f.z * S + Math.sin(f.dir) * 0.15);
            ch.material.color.set(glow);
            ch.scale.set(sz, sz, 1);
          } else if (charging) {
            const k = f.t / MOVES.bolt.startup;
            const sz = 0.35 + k * 0.9 + Math.sin(now / 30) * 0.08;
            ch.position.set(f.x * S + Math.cos(f.dir) * 0.42, 1.2, f.z * S + Math.sin(f.dir) * 0.42);
            ch.material.color.set(glow);
            ch.scale.set(sz, sz, 1);
          }
        }
        // Speed lines off anything rushing, leaping or diving.
        const sl = streaks[f.slot];
        if (sl) {
          const speed = Math.hypot(f.vx, f.vz);
          const fast = m && (m.rush || m.leap || m.dive || m.go) && speed > 4;
          sl.visible = !!fast;
          if (fast) {
            const a = sl.geometry.attributes.position.array;
            const ux = -f.vx / speed;
            const uz = -f.vz / speed;
            for (let i = 0; i < SPEED_LINES; i++) {
              const side = (Math.random() - 0.5) * 0.9;
              const y = 0.3 + Math.random() * 1.5 + f.h * S;
              const x0 = f.x * S - uz * side + ux * 0.3;
              const z0 = f.z * S + ux * side + uz * 0.3;
              const len = 0.6 + Math.random() * speed * 0.09;
              a.set([x0, y, z0, x0 + ux * len, y, z0 + uz * len], i * 6);
            }
            sl.geometry.attributes.position.needsUpdate = true;
            sl.material.color.set(glow);
            sl.material.opacity = 0.7;
          }
        }
      }
      for (const c of cracks) {
        if (c.life <= 0) continue;
        c.life -= dt / 1300;
        c.m.visible = c.life > 0;
        c.m.material.opacity = Math.min(1, Math.max(0, c.life) * 1.6);
      }
      for (const sh of shards) {
        if (sh.life <= 0) continue;
        const k = dt / 16.7;
        sh.life -= dt / 900;
        sh.vy -= 0.006 * k;
        sh.m.position.x += sh.vx * k;
        sh.m.position.y = Math.max(0.03, sh.m.position.y + sh.vy * k);
        sh.m.position.z += sh.vz * k;
        sh.m.rotation.x += 0.2 * k;
        sh.m.rotation.y += 0.13 * k;
        sh.m.visible = sh.life > 0;
      }
      for (const w of waves) {
        if (w.life <= 0) continue;
        w.life -= dt / 420;
        w.m.visible = w.life > 0;
        const k = 1 - Math.max(0, w.life);
        const r = w.r * (0.25 + 0.75 * Math.sqrt(k));
        w.m.scale.set(r, r, r);
        w.m.material.opacity = Math.max(0, w.life) * 0.9;
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
        const col = glowOf(p.owner);
        const pulse = 1 + Math.sin(now / 45 + i) * 0.15;
        o.group.position.set(p.x * S, p.h * S, p.z * S);
        o.halo.material.color.set(col);
        o.halo.scale.set(1.3 * pulse, 1.3 * pulse, 1);
        o.light.color.set(col);
        o.light.intensity = 7 * pulse;
      }
      // Lightning crackling round each orb.
      for (let i = 0; i < arcs.length; i++) {
        const p = s.proj[i];
        arcs[i].visible = !!p;
        if (!p) continue;
        jag(arcs[i], p.x * S, p.h * S, p.z * S, 0.7);
        arcs[i].material.color.set(glowOf(p.owner));
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
      for (const c of takeCheers()) if (c.slot < teamCheer.length) teamCheer[c.slot] = Math.min(1, teamCheer[c.slot] + c.k);
      kick *= Math.pow(0.86, dt / 16.7);
      for (const light of flashes) light.intensity *= Math.pow(0.78, dt / 16.7);

      // The crowd: a slow sway, and jumping when excited. Moving a couple of
      // hundred figures every other frame is plenty for a background.
      excite *= Math.pow(0.985, dt / 16.7);
      for (let t = 0; t < teamCheer.length; t++) teamCheer[t] *= Math.pow(0.98, dt / 16.7);
      crowdTurn = !crowdTurn && (graphics !== 'fast' || Math.floor(now / 100) % 3 === 0);
      // While a round is announced a wave runs once round the stands, left to
      // right: each fan stands up as it reaches them and sits back down.
      const waveAt = s.phase === 'intro' && !view.demo ? (s.pt / TIMING.INTRO) * 1.3 - 0.15 : -9;
      lastWave = waveAt;
      for (let i = 0; crowdTurn && i < fans.length; i++) {
        const fan = fans[i];
        const keen = fan.team >= 0 ? Math.min(1.4, excite * 0.7 + teamCheer[fan.team]) : excite;
        const off = fan.rank / fans.length - waveAt;
        const wave = waveAt > -9 ? Math.exp(-(off * off) / 0.004) * 0.55 : 0;
        const hop = Math.abs(Math.sin(now / 130 + fan.phase)) * 0.28 * keen * fan.keen + wave;
        const y = fan.y + Math.sin(now / 700 + fan.phase) * 0.03 + hop;
        fanDummy.position.set(fan.x + Math.sin(now / 900 + fan.phase) * 0.04, y, fan.z);
        fanDummy.updateMatrix();
        fanBodies.setMatrixAt(i, fanDummy.matrix);
        fanDummy.position.y = y + 0.46;
        fanDummy.updateMatrix();
        fanHeads.setMatrixAt(i, fanDummy.matrix);
      }
      if (crowdTurn) {
        fanBodies.instanceMatrix.needsUpdate = true;
        fanHeads.instanceMatrix.needsUpdate = true;
      }

      renderer.info.reset();
      renderer.render(scene, camera);
    },

    // Height of a fighter's head top, for name tags.
    headTop: (slot) => (rigs[slot] ? rigs[slot].top() : 2),
  };
}
