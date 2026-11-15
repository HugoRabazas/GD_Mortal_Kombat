// The website's home-screen install: the manifest must parse, open full
// screen and sideways, and every icon it names must exist at the size it
// claims (a phone silently ignores an icon that is wrong).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const dir = new URL('../client/web/', import.meta.url);

// Width and height of a PNG, read from its header.
function pngSize(file) {
  const b = readFileSync(file);
  assert.equal(b.toString('ascii', 1, 4), 'PNG', `${file} is a PNG`);
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

test('the web app manifest is complete and its icons are the sizes it says', () => {
  const m = JSON.parse(readFileSync(new URL('manifest.webmanifest', dir), 'utf8'));
  assert.equal(m.name, 'GD Arena');
  assert.equal(m.display, 'fullscreen');
  assert.equal(m.orientation, 'landscape');
  assert.equal(m.start_url, './');
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'), 'icons at 192 and 512, as Android asks');
  for (const icon of m.icons) {
    const file = new URL(icon.src, dir);
    assert.ok(existsSync(file), `${icon.src} exists`);
    assert.equal(pngSize(file), icon.sizes, `${icon.src} is ${icon.sizes}`);
  }
  // The iPhone's home-screen icon, linked from the page.
  assert.equal(pngSize(new URL('icon-180.png', dir)), '180x180');
});
