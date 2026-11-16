// Turns the simulation's events ("a heavy hit landed here", "round 2 began")
// into what the player sees and hears. Keeping this separate means the rules
// never need to know about sparks or sounds.
//
// Events carry positions on the arena floor; `project` converts them to
// points on the flat effects layer for whichever view is showing the fight.

import { ARENA } from '../../shared/constants.js';
import { getFighter } from '../../shared/fighters.js';
import { play, announce } from './audio.js';
import { hitSpark, blockSpark, dust, comboCount, floatText as showText, showBanner, addShake, addFlash, lightFlash, cheerFor, confetti } from './render/fx.js';

// At the end of a brawl round, show over each fighter the points it earned.
function showRoundPoints(state, project) {
  for (const f of state.f) {
    const p = project(f.x, f.hp > 0 ? 230 : 90, f.z);
    showText(p.x, p.y, `+${state.roundPts[f.slot]} PTS`, state.roundPts[f.slot] ? '#ffd34d' : '#bfaec0', 26);
  }
}

// `quiet` is used for the demo fight behind the menu: sparks yes, banners and
// sound no.
// A short buzz on phones that support it, and a rumble on the first gamepad
// if it has motors. Some browsers refuse either; that is fine.
function buzz(ms) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // not available here
  }
  try {
    const pad = navigator.getGamepads?.()[0];
    pad?.vibrationActuator
      ?.playEffect?.('dual-rumble', { duration: Math.max(60, ms * 2.5), strongMagnitude: Math.min(1, ms / 60), weakMagnitude: 0.5 })
      ?.catch?.(() => {});
  } catch {
    // no gamepad, or one without motors
  }
}

// `me` is the slot of the player at this screen (-1 when there is none), used
// to make the phone buzz when their own fighter takes a hit.
// `colors` (optional) is what each slot really wears (see dressColors).
// What each fighter says when taunting.
const TAUNTS = { ruko: 'Awoo!', shadow: 'Too slow.', jackie: 'Hmph!', pixie: 'Catch me!', meru: 'Is that all?', gleh: 'Over here!', kichta: 'Too easy.', zelrith: 'Hehe! Again!' };

// Which shape a blow's spark takes.
const KICKS = new Set(['kick', 'kick2', 'hook', 'slide', 'airKick', 'axeKick', 'flyKnee', 'launch', 'riseKick', 'rollSpin', 'breaker', 'stomp', 'quake']);
function sparkStyle(e) {
  if (e.stage) {
    if (e.stage === 'howl2') return 'slash';
    if (e.stage.startsWith('eclipse')) return 'dark';
    if (e.stage.startsWith('phoenix')) return 'fire';
    return e.light ? 'punch' : 'kick';
  }
  if (e.kind === 'rise') return 'fire';
  if (e.kind === 'bolt') return 'dark';
  return KICKS.has(e.kind) ? 'kick' : 'punch';
}

export function handleEvents(events, state, { quiet, project, me = -1, colors = null }) {
  // Behind the menus (quiet) the fight keeps its sparks and flashes but not
  // its words, which would sit on top of the menu's own text.
  const floatText = quiet ? () => {} : showText;
  const arena = state.mode === 'arena';
  const nameOf = (slot) => getFighter(state.f[slot].char).name;
  // Names as a voice should read them (RUKO would be spelled out).
  const spoken = (slot) => nameOf(slot).charAt(0) + nameOf(slot).slice(1).toLowerCase();
  for (const e of events) {
    const by = e.by !== undefined ? state.f[e.by] : null;
    const char = by ? getFighter(by.char) : null;
    const tint = by ? colors?.[e.by] ?? char.colors : null;
    switch (e.type) {
      case 'round':
        if (quiet) break;
        if (arena) showBanner(`ROUND ${e.round}`, 'OF 3 · EVERYONE FOR THEMSELVES', '#e8b454', 1100);
        else showBanner(state.pts[0] === 1 && state.pts[1] === 1 ? 'FINAL ROUND' : `ROUND ${e.round}`, null, '#e8b454', 1100);
        play('round');
        announce(!arena && state.pts[0] === 1 && state.pts[1] === 1 ? 'Final round' : `Round ${['one', 'two', 'three'][e.round - 1] || e.round}`);
        break;
      case 'fight':
        if (quiet) break;
        showBanner('FIGHT!', null, '#ff5a36', 850);
        play('fight');
        announce('Fight!');
        break;
      case 'swing':
        if (!quiet) play('swing');
        break;
      case 'jump':
        if (!quiet) play('jump');
        break;
      case 'spawn': {
        lightFlash(e.x, 60, e.z, e.kind === 'energy' ? '#ffd34d' : '#5dff8f', false);
        if (!quiet) play('spawn');
        break;
      }
      case 'lastStand': {
        // Under a quarter of their health: the energy bar now fills faster.
        const f = state.f[e.slot];
        const p = project(f.x, 260, f.z);
        floatText(p.x, p.y, 'LAST STAND', '#ff4a3c', 22);
        if (!quiet) play('lastStand');
        break;
      }
      case 'pickup': {
        const energy = e.kind === 'energy';
        const p = project(e.x, 120, e.z);
        floatText(p.x, p.y, energy ? '+ENERGY' : '+HEALTH', energy ? '#ffd34d' : '#5dff8f', 24);
        lightFlash(e.x, 60, e.z, energy ? '#ffd34d' : '#5dff8f', true);
        if (!quiet) play('pickup');
        break;
      }
      case 'tech': {
        // A quick rise off the floor.
        const p = project(by.x, 0, by.z);
        dust(p.x, p.y, 8);
        if (!quiet) play('jump');
        break;
      }
      case 'backstep': {
        const p = project(e.x, 0, e.z);
        dust(p.x, p.y, 3);
        if (!quiet) play('swing');
        break;
      }
      case 'roll': {
        const p = project(by.x, 0, by.z);
        dust(p.x, p.y, 4);
        if (!quiet) play('swing');
        break;
      }
      case 'burn': {
        // Thrown into the ring of fire.
        const p = project(e.x, 70, e.z);
        hitSpark(p.x, p.y, '#ff7a1a', true);
        lightFlash(e.x, 70, e.z, '#ff7a1a', true);
        floatText(p.x, p.y - 34, `BURN ${e.dmg}`, '#ff8a2a', 22);
        if (e.bounce) floatText(p.x, p.y - 62, 'BOUNCE!', '#ffd34d', 24);
        addShake(7);
        if (!quiet) play('burn');
        break;
      }
      case 'signature': {
        // The fighter's own move: its name above them.
        const p = project(by.x, 240, by.z);
        floatText(p.x, p.y, char.signature.name.toUpperCase(), tint.accent, 22);
        if (!quiet) play('swing');
        break;
      }
      case 'taunt': {
        // Each fighter's own line, and the energy it earned.
        const p = project(by.x, 240, by.z);
        floatText(p.x, p.y, TAUNTS[by.char] || 'Come on!', tint.accent, 22);
        if (!quiet) play('pickup');
        break;
      }
      case 'fireToss': {
        // A throw that flings the rival into the ring of fire.
        const p = project(e.x, 120, e.z);
        floatText(p.x, p.y - 30, 'INTO THE FIRE!', '#ff8a2a', 26);
        addShake(6);
        if (!quiet) play('heave');
        break;
      }
      case 'escape': {
        // A throw broken: both thrown apart in a ring of sparks.
        const p = project(e.x, e.h, e.z);
        blockSpark(p.x, p.y);
        blockSpark(p.x, p.y);
        floatText(p.x, p.y - 40, 'ESCAPE!', '#9fe8ff', 24);
        addShake(5);
        if (!quiet) play('parry');
        if (!quiet && (e.by === me || e.on === me)) buzz(30);
        break;
      }
      case 'armour': {
        // A finisher that has landed shrugs off the others' blows: they hurt,
        // but they do not stop it.
        const p = project(e.x, e.h, e.z);
        blockSpark(p.x, p.y);
        floatText(p.x, p.y - 30, String(e.dmg), '#c8ccd8', 20);
        if (e.first) floatText(p.x, p.y - 58, 'UNSTOPPABLE', tint.accent, 20);
        addShake(3);
        if (!quiet) play('block');
        break;
      }
      case 'guardBreak': {
        // A guard smashed open.
        const p = project(e.x, e.h, e.z);
        blockSpark(p.x, p.y);
        hitSpark(p.x, p.y, '#ffffff', true);
        lightFlash(e.x, e.h, e.z, '#ffe08a', true);
        floatText(p.x, p.y - 40, 'GUARD BREAK!', '#ffe08a', 26);
        addShake(9);
        if (!quiet) {
          play('parry');
          play('heavy');
        }
        if (!quiet && e.on === me) buzz(60);
        break;
      }
      case 'blink': {
        // Shadow vanishes in a puff of dark and reappears in another.
        for (const [x, z] of [[e.x0, e.z0], [e.x, e.z]]) {
          const p = project(x, 90, z);
          for (let i = 0; i < 3; i++) dust(p.x, p.y + i * 22, 4);
          lightFlash(x, 90, z, '#8a5cff', true);
        }
        addShake(4);
        if (!quiet) play('swing');
        break;
      }
      case 'crash': {
        // A finisher coming down: a wide ring of dust, a flash and a quake.
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2;
          const p = project(e.x + Math.cos(a) * e.r * 0.7, 0, e.z + Math.sin(a) * e.r * 0.7);
          dust(p.x, p.y, 4);
        }
        lightFlash(e.x, 40, e.z, e.move === 'phoenix2' ? '#ff8a2a' : tint.glow, true);
        addShake(16);
        addFlash(0.3);
        if (!quiet) play('quakeBoom');
        break;
      }
      case 'jump2': {
        // The air jump: a puff of air kicked off under the feet.
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const p = project(e.x + Math.cos(a) * 26, e.h, e.z + Math.sin(a) * 26);
          dust(p.x, p.y, 2);
        }
        if (!quiet) play('jump');
        break;
      }
      case 'stompLand': {
        // Feet first into the floor: a ring of dust and a jolt.
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          const p = project(e.x + Math.cos(a) * 34, 0, e.z + Math.sin(a) * 34);
          dust(p.x, p.y, 3);
        }
        addShake(8);
        if (!quiet) play('thud');
        break;
      }
      case 'land': {
        const p = project(e.x, 0, e.z);
        dust(p.x, p.y, 5);
        if (!quiet) play('land');
        break;
      }
      case 'thud': {
        const p = project(e.x, 0, e.z);
        dust(p.x, p.y, 12);
        addShake(5);
        if (!quiet) play('thud');
        break;
      }
      case 'quake': {
        // A ring of dust racing outwards from the stomp.
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          const p = project(e.x + Math.cos(a) * e.r * 0.8, 0, e.z + Math.sin(a) * e.r * 0.8);
          dust(p.x, p.y, 3);
        }
        addShake(12);
        lightFlash(e.x, 30, e.z, tint.glow, true);
        if (!quiet) play('quakeBoom');
        break;
      }
      case 'hit': {
        const p = project(e.x, e.h, e.z);
        // The spark takes the shape of what struck, swept the way it went.
        const from = by ? project(by.x, e.h, by.z) : p;
        hitSpark(p.x, p.y, tint.glow, e.heavy, sparkStyle(e), Math.atan2(p.y - from.y, p.x - from.x));
        lightFlash(e.x, e.h, e.z, tint.glow, e.heavy);
        cheerFor(e.by, e.heavy ? 0.8 : 0.25);
        floatText(p.x, p.y - 30, String(e.dmg), e.heavy ? '#ffd34d' : '#ffffff', e.heavy ? 28 : 22);
        // Two blows in a row: a small tag by the blow; three or more: the big
        // counter at the attacker's side of the screen.
        if (e.combo === 2) floatText(p.x, p.y - 58, '2 HITS', '#ff8a5c', 20);
        else if (e.combo >= 3) comboCount(by && by.x < state.f[e.on].x ? -1 : 1, e.combo, tint.glow);
        if (e.kind === 'grab') floatText(p.x, p.y - 58, 'SLAM!', '#ffb050', 26);
        if (e.kind === 'dash' || e.kind === 'bolt' || e.kind === 'rise' || e.kind === 'quake') {
          // A special landing: a second burst of sparks and a stronger light.
          hitSpark(p.x + 8, p.y - 6, tint.glow, true);
          lightFlash(e.x, e.h, e.z, tint.glow, true);
        }
        if (e.kind === 'riposte') floatText(p.x, p.y - 58, 'RIPOSTE!', '#9fe8ff', 26);
        if (e.kind === 'airThrow') floatText(p.x, p.y - 58, 'AIR THROW!', '#ffb050', 26);
        if (e.kind === 'launch') floatText(p.x, p.y - 58, 'LAUNCH!', '#ffb050', 26);
        else if (e.juggle) floatText(p.x, p.y - 86, 'JUGGLE!', '#7fe0ff', 24);
        if (e.counter) floatText(p.x, p.y - 86, 'COUNTER', '#ff9a3c', 22);
        const fin = e.kind === 'super' && !e.light; // a finisher's big blow (not its flurry)
        addShake((fin ? 16 : e.heavy ? 8 : e.light ? 5 : 4) + (e.counter ? 3 : 0));
        if (!quiet && e.counter) play('counter');
        if (fin) addFlash(0.6);
        if (e.final) {
          // The finisher's last blow.
          addFlash(0.9);
          addShake(10);
          if (!quiet) play('finale');
          if (!quiet && (e.on === me || e.by === me)) buzz(160);
        }
        if (!quiet) play(e.heavy ? 'heavy' : 'hit');
        if (!quiet && e.on === me) buzz(fin ? 120 : e.heavy ? 45 : 20);
        else if (!quiet && e.by === me && e.heavy) buzz(12); // your own heavy blows are felt too, lightly
        break;
      }
      case 'block': {
        const p = project(e.x, e.h, e.z);
        blockSpark(p.x, p.y);
        addShake(2);
        if (!quiet) play('block');
        break;
      }
      case 'parry': {
        // A perfect guard: a bright ring of sparks and a clear ring of steel.
        const p = project(e.x, e.h, e.z);
        blockSpark(p.x, p.y);
        blockSpark(p.x, p.y);
        lightFlash(e.x, e.h, e.z, '#9fe8ff', true);
        const top = project(e.x, 290, e.z); // above the name tags
        floatText(top.x, top.y, 'PERFECT GUARD', '#9fe8ff', 24);
        addShake(5);
        addFlash(0.18);
        if (!quiet) play('parry');
        if (!quiet && e.by === me) buzz(30);
        break;
      }
      case 'special': {
        const p = project(by.x, 210, by.z);
        floatText(p.x, p.y, char.special.name.toUpperCase(), tint.accent, 22);
        if (!quiet) play({ dash: 'rush', rise: 'flare', quake: 'heave', airDash: 'rush', airSpiral: 'flare', bodyPress: 'heave' }[e.move] || 'special');
        break;
      }
      case 'bolt':
        if (!quiet) play('bolt');
        break;
      case 'super':
        if (!quiet) play('super');
        if (!quiet && char.super.move) play(char.super.move); // the finisher's own voice
        break;
      case 'seize': {
        const p = project(e.x, e.h, e.z);
        floatText(p.x, p.y - 40, 'THROW!', '#59c7ff', 26);
        addShake(4);
        if (!quiet) play('block');
        break;
      }
      case 'slam': {
        // Driven into the floor: a ring of dust and a jolt through the arena.
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const p = project(e.x + Math.cos(a) * 40, 0, e.z + Math.sin(a) * 40);
          dust(p.x, p.y, 3);
        }
        addShake(13);
        addFlash(0.2);
        if (!quiet) play('quakeBoom');
        if (!quiet && (e.on === me || e.by === me)) buzz(e.on === me ? 90 : 25);
        break;
      }
      case 'clash': {
        const p = project(e.x, e.h, e.z);
        hitSpark(p.x, p.y, '#ffffff', true);
        if (!quiet) play('block');
        break;
      }
      case 'out': {
        // In the arena a knockout does not stop the round: call it out on the spot.
        if (!arena) break;
        const f = state.f[e.slot];
        const p = project(f.x, 190, f.z);
        floatText(p.x, p.y, `${nameOf(e.slot)} OUT!`, '#ff5a36', 30);
        addShake(10);
        addFlash(0.3);
        if (!quiet) play('ko');
        if (!quiet) play('cheer');
        break;
      }
      case 'ko': {
        cheerFor(e.winner, 1);
        addShake(16);
        addFlash(0.75);
        // A burst of light where the last one fell.
        const out = state.f.filter((f) => f.state === 'ko').sort((a, b) => (b.outAt ?? 0) - (a.outAt ?? 0))[0];
        if (out) {
          const p = project(out.x, out.h + 90, out.z);
          hitSpark(p.x, p.y, '#ffffff', true, 'kick', -Math.PI / 2);
          lightFlash(out.x, out.h + 90, out.z, '#ffffff', true);
        }
        if (arena) showRoundPoints(state, project);
        if (quiet) break;
        if (arena) showBanner(e.winner < 0 ? 'ROUND SHARED' : `${nameOf(e.winner)} TAKES IT`, e.finisher ? 'FINISHER!' : e.perfect ? 'PERFECT!' : null, '#ff5a36', 2300);
        else showBanner(e.winner < 0 ? 'DOUBLE K.O.' : 'K.O.', e.finisher ? 'FINISHER!' : e.perfect ? 'PERFECT!' : null, '#ff5a36', 2300);
        if (!arena) play('ko');
        play('cheer');
        if (arena) announce(e.winner < 0 ? 'Round shared' : `${spoken(e.winner)} takes it`);
        else announce(e.winner < 0 ? 'Double K. O.' : e.finisher ? 'Finisher!' : 'K. O.!');
        break;
      }
      case 'timeup':
        if (arena) showRoundPoints(state, project);
        if (quiet) break;
        showBanner('TIME UP', e.winner < 0 ? 'ROUND SHARED' : `${nameOf(e.winner)} TAKES IT`, '#e8b454', 2000);
        play('round');
        announce('Time!');
        break;
      case 'matchEnd':
        cheerFor(e.winner, 1);
        if (quiet) break;
        if (e.winner < 0) showBanner('DRAW', arena ? 'THE TOP SPOT IS SHARED' : null, '#e8b454', 2600);
        else showBanner(`${nameOf(e.winner)} WINS`, arena ? 'ARENA CHAMPION' : getFighter(state.f[e.winner].char).title.toUpperCase(), '#e8b454', 2600);
        if (e.winner >= 0) {
          const c = colors?.[e.winner] ?? getFighter(state.f[e.winner].char).colors;
          confetti(ARENA.W, [c.primary, c.accent, c.glow, '#f6ead8']);
        }
        // The fanfare is for winners: whoever lost at this screen hears the fall.
        play(me >= 0 && e.winner >= 0 && e.winner !== me ? 'defeat' : 'win');
        announce(e.winner < 0 ? 'Draw' : `${spoken(e.winner)} wins!`);
        break;
      default:
        break;
    }
  }
}
