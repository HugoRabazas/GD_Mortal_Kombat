// Turns the simulation's events ("a heavy hit landed here", "round 2 began")
// into what the player sees and hears. Keeping this separate means the rules
// never need to know about sparks or sounds.
//
// Events carry positions on the arena floor; `project` converts them to
// points on the flat effects layer for whichever view is showing the fight.

import { getFighter } from '../../shared/fighters.js';
import { play } from './audio.js';
import { hitSpark, blockSpark, dust, floatText, showBanner, addShake, addFlash, lightFlash } from './render/fx.js';

// At the end of a brawl round, show over each fighter the points it earned.
function showRoundPoints(state, project) {
  for (const f of state.f) {
    const p = project(f.x, f.hp > 0 ? 230 : 90, f.z);
    floatText(p.x, p.y, `+${state.roundPts[f.slot]} PTS`, state.roundPts[f.slot] ? '#ffd34d' : '#bfaec0', 26);
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
export function handleEvents(events, state, { quiet, project, me = -1 }) {
  const arena = state.mode === 'arena';
  const nameOf = (slot) => getFighter(state.f[slot].char).name;
  for (const e of events) {
    const by = e.by !== undefined ? state.f[e.by] : null;
    const char = by ? getFighter(by.char) : null;
    switch (e.type) {
      case 'round':
        if (quiet) break;
        if (arena) showBanner(`ROUND ${e.round}`, 'OF 3 · EVERYONE FOR THEMSELVES', '#e8b454', 1100);
        else showBanner(state.pts[0] === 1 && state.pts[1] === 1 ? 'FINAL ROUND' : `ROUND ${e.round}`, null, '#e8b454', 1100);
        play('round');
        break;
      case 'fight':
        if (quiet) break;
        showBanner('FIGHT!', null, '#ff5a36', 850);
        play('fight');
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
      case 'pickup': {
        const energy = e.kind === 'energy';
        const p = project(e.x, 120, e.z);
        floatText(p.x, p.y, energy ? '+ENERGY' : '+HEALTH', energy ? '#ffd34d' : '#5dff8f', 24);
        lightFlash(e.x, 60, e.z, energy ? '#ffd34d' : '#5dff8f', true);
        if (!quiet) play('pickup');
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
        addShake(7);
        if (!quiet) play('burn');
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
        lightFlash(e.x, 30, e.z, char.colors.glow, true);
        if (!quiet) play('quakeBoom');
        break;
      }
      case 'hit': {
        const p = project(e.x, e.h, e.z);
        hitSpark(p.x, p.y, char.colors.glow, e.heavy);
        lightFlash(e.x, e.h, e.z, char.colors.glow, e.heavy);
        floatText(p.x, p.y - 30, String(e.dmg), e.heavy ? '#ffd34d' : '#ffffff', e.heavy ? 28 : 22);
        if (e.combo >= 2) floatText(p.x, p.y - 58, `${e.combo} HITS`, '#ff8a5c', 20);
        if (e.kind === 'grab') floatText(p.x, p.y - 58, 'GRAB!', '#59c7ff', 24);
        if (e.counter) floatText(p.x, p.y - 86, 'COUNTER', '#ff9a3c', 22);
        addShake((e.kind === 'super' ? 16 : e.heavy ? 8 : 4) + (e.counter ? 3 : 0));
        if (!quiet && e.counter) play('counter');
        if (e.kind === 'super') addFlash(0.6);
        if (!quiet) play(e.heavy ? 'heavy' : 'hit');
        if (!quiet && e.on === me) buzz(e.kind === 'super' ? 120 : e.heavy ? 45 : 20);
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
        floatText(p.x, p.y, char.special.name.toUpperCase(), char.colors.accent, 22);
        if (!quiet) play({ dash: 'rush', rise: 'flare', quake: 'heave' }[e.move] || 'special');
        break;
      }
      case 'bolt':
        if (!quiet) play('bolt');
        break;
      case 'super':
        if (!quiet) play('super');
        break;
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
      case 'ko':
        addShake(16);
        addFlash(0.75);
        if (arena) showRoundPoints(state, project);
        if (quiet) break;
        if (arena) showBanner(e.winner < 0 ? 'ROUND SHARED' : `${nameOf(e.winner)} TAKES IT`, e.finisher ? 'FINISHER!' : e.perfect ? 'PERFECT!' : null, '#ff5a36', 2300);
        else showBanner(e.winner < 0 ? 'DOUBLE K.O.' : 'K.O.', e.finisher ? 'FINISHER!' : e.perfect ? 'PERFECT!' : null, '#ff5a36', 2300);
        if (!arena) play('ko');
        play('cheer');
        break;
      case 'timeup':
        if (arena) showRoundPoints(state, project);
        if (quiet) break;
        showBanner('TIME UP', e.winner < 0 ? 'ROUND SHARED' : `${nameOf(e.winner)} TAKES IT`, '#e8b454', 2000);
        play('round');
        break;
      case 'matchEnd':
        if (quiet) break;
        if (e.winner < 0) showBanner('DRAW', arena ? 'THE TOP SPOT IS SHARED' : null, '#e8b454', 2600);
        else showBanner(`${nameOf(e.winner)} WINS`, arena ? 'ARENA CHAMPION' : getFighter(state.f[e.winner].char).title.toUpperCase(), '#e8b454', 2600);
        play('win');
        break;
      default:
        break;
    }
  }
}
