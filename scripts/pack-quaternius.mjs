// Packs the Quaternius source assets (assets-src/quaternius, CC0) into the
// small files the game ships: client/public/q/ (copied next to the page
// by the build and loaded only when the Quaternius body is on)
//
//   body-male.json, body-female.json  the two base characters, textures shrunk
//                                   to JPEG (colour 512 px, relief 256 px)
//   moves.json                      only the animation clips the fighters
//                                   use, with no mesh, resampled
//
// Run by hand when the sources change: node scripts/pack-quaternius.mjs
// (it uses the pre-installed Chromium to resize the pictures).

import { NodeIO } from '@gltf-transform/core';
import { prune, resample, dedup } from '@gltf-transform/functions';
import { unzipSync } from 'fflate';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'assets-src', 'quaternius');
const out = path.join(root, 'client', 'public', 'q');
mkdirSync(out, { recursive: true });

// The clips the fighters use (the rest of the library is for other games).
export const CLIPS = [
  'Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land',
  'Punch_Jab', 'Punch_Cross', 'Hit_Chest', 'Hit_Head', 'Death01', 'Roll',
  'Crouch_Idle_Loop', 'Spell_Simple_Shoot', 'Sword_Attack', 'Dance_Loop',
];

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage();

// Shrinks a picture to `size` px on its long side and re-encodes it as JPEG.
async function shrink(bytes, mime, size, quality = 0.82) {
  const url = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  const b64 = await page.evaluate(
    async ({ url, size, quality }) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const k = Math.min(1, size / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', quality).split(',')[1];
    },
    { url, size, quality },
  );
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

const io = new NodeIO();

// Written as plain glTF JSON with the data inside (base64): one file each,
// of a type every host serves - an Artifact serves .json but not .glb.
function save({ json, resources }, name) {
  const embed = (uri, mime) => `data:${mime};base64,${Buffer.from(resources[uri]).toString('base64')}`;
  for (const b of json.buffers || []) b.uri = embed(b.uri, 'application/octet-stream');
  for (const i of json.images || []) i.uri = embed(i.uri, i.mimeType || 'image/jpeg');
  const text = JSON.stringify(json);
  writeFileSync(path.join(out, name), text);
  console.log(`${name}  ${(text.length / 1024).toFixed(0)} KB`);
}

async function packBody(file, name) {
  // Some pictures are named "X_png.png" in the .gltf but "X.png" on disk (or
  // the other way round): point each one at the file that exists.
  const dir = path.join(src, 'universal-base-characters', 'Base Characters', 'Godot - UE');
  const json = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
  const resources = {};
  const load = (uri) => {
    for (const name of [uri, uri.replace(/_png\.png$/i, '.png'), uri.replace(/\.png$/i, '_png.png')]) {
      try {
        return new Uint8Array(readFileSync(path.join(dir, decodeURIComponent(name))));
      } catch {
        // try the next spelling
      }
    }
    throw new Error(`${file}: no file for ${uri}`);
  };
  for (const b of json.buffers || []) resources[b.uri] = load(b.uri);
  for (const i of json.images || []) resources[i.uri] = load(i.uri);
  const doc = await io.readJSON({ json, resources });
  const relief = new Set();
  for (const m of doc.getRoot().listMaterials()) {
    if (m.getNormalTexture()) relief.add(m.getNormalTexture());
    if (m.getMetallicRoughnessTexture()) relief.add(m.getMetallicRoughnessTexture());
  }
  for (const t of doc.getRoot().listTextures()) {
    t.setImage(await shrink(t.getImage(), t.getMimeType(), relief.has(t) ? 256 : 512));
    t.setMimeType('image/jpeg');
    t.setURI(t.getURI().replace(/\.png$/i, '.jpg'));
  }
  await doc.transform(dedup(), prune());
  save(await io.writeJSON(doc), name);
}

async function packMoves() {
  const zip = unzipSync(readFileSync(path.join(src, 'Universal Animation Library[Standard].zip')));
  const key = Object.keys(zip).find((k) => k.endsWith('Unreal-Godot/UAL1_Standard.glb'));
  const doc = await io.readBinary(zip[key]);
  const r = doc.getRoot();
  for (const a of r.listAnimations())
    if (!CLIPS.includes(a.getName())) {
      for (const s of a.listSamplers()) s.dispose();
      a.dispose();
    }
  // No mesh: the clips drive the character's own skeleton, matched by bone name.
  for (const n of r.listNodes()) n.setMesh(null).setSkin(null);
  for (const m of r.listMeshes()) m.dispose();
  for (const s of r.listSkins()) s.dispose();
  // Scale never changes in these clips; drop those tracks.
  for (const a of r.listAnimations())
    for (const ch of a.listChannels())
      if (ch.getTargetPath() === 'scale') {
        ch.getSampler().dispose();
        ch.dispose();
      }
  await doc.transform(resample({ tolerance: 0.0005 }), prune({ keepLeaves: true }));
  const missing = CLIPS.filter((c) => !r.listAnimations().some((a) => a.getName() === c));
  if (missing.length) throw new Error(`missing clips: ${missing.join(', ')}`);
  save(await io.writeJSON(doc), 'moves.json');
}

await packBody('Superhero_Male_FullBody.gltf', 'body-male.json');
await packBody('Superhero_Female_FullBody.gltf', 'body-female.json');
await packMoves();
await browser.close();
