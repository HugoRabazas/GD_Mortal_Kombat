// The online buttons and picture count (client/src/net/inputs.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputSender, createInputReceiver, createSnapshotMeter } from '../client/src/net/inputs.js';

test('a quick tap survives the loss of its own message', () => {
  const send = createInputSender();
  const host = createInputReceiver();
  const PUNCH = 16;
  // Press (message lost), release (message lost), then an idle message gets through.
  send.note(PUNCH);
  send.message(); // lost
  send.note(0);
  send.message(); // lost
  send.note(0);
  host.take(send.message());
  const ticks = [host.next(), host.next(), host.next()];
  assert.deepEqual(ticks, [PUNCH, 0, 0], 'the punch shows for one tick, then the release');
});

test('changes already seen are not applied twice, and the latest buttons stay held', () => {
  const send = createInputSender();
  const host = createInputReceiver();
  send.note(1);
  host.take(send.message());
  host.take(send.message()); // the same message twice (a resend)
  assert.equal(host.next(), 1);
  assert.equal(host.next(), 1, 'held');
  send.note(3);
  host.take(send.message());
  assert.deepEqual([host.next(), host.next()], [3, 3]);
});

test('an older build sending only { i } still works', () => {
  const host = createInputReceiver();
  host.take({ i: 32 });
  assert.equal(host.next(), 32);
});

test('the picture meter counts the pictures lost on the way', () => {
  const m = createSnapshotMeter(3);
  for (const t of [3, 6, 9, 15, 18, 21, 30]) m.got(t, t * 16);
  // 12, 24 and 27 never came: 3 lost of 10.
  assert.equal(m.report().lost, 3);
  assert.equal(m.lossPct(), 30);
  m.ping(100);
  m.ping(200);
  assert.deepEqual([m.report().pingAvg, m.report().pingMax], [150, 200]);
});
