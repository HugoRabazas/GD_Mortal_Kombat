// Turns the simulation's events ("a heavy hit landed here", "round 2 began")
// into what the player sees and hears. Keeping this separate means the rules
// never need to know about sparks or sounds.

import { getFighter } from '../../shared/fighters.js';
import { ARENA } from '../../shared/constants.js';
import { play } from './audio.js';
import { hitSpark, blockSpark, dust, floatText, showBanner, addShake, addFlash } from './render/fx.js';

// `quiet` is used for the demo fight behind the menu: sparks yes, banners and
// sound no.
export function handleEvents(events, state, quiet) {
  for (const e of events) {
    const by = e.by !== undefined ? state.f[e.by] : null;
    const char = by ? getFighter(by.char) : null;
    switch (e.type) {
      case 'round':
        if (quiet) break;
        showBanner(state.wins[0] === 1 && state.wins[1] === 1 ? 'FINAL ROUND' : `ROUND ${e.round}`, null, '#e8b454', 1100);
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
      case 'land':
        dust(e.x, ARENA.FLOOR, 5);
        if (!quiet) play('land');
        break;
      case 'thud':
        dust(e.x, ARENA.FLOOR, 12);
        addShake(5);
        if (!quiet) play('thud');
        break;
      case 'hit':
        hitSpark(e.x, e.y, char.colors.glow, e.heavy);
        floatText(e.x, e.y - 34, String(e.dmg), e.heavy ? '#ffd34d' : '#ffffff', e.heavy ? 30 : 23);
        if (e.combo >= 2) floatText(e.x, e.y - 66, `${e.combo} HITS`, '#ff8a5c', 22);
        addShake(e.kind === 'super' ? 16 : e.heavy ? 8 : 4);
        if (e.kind === 'super') addFlash(0.6);
        if (!quiet) play(e.heavy ? 'heavy' : 'hit');
        break;
      case 'block':
        blockSpark(e.x, e.y);
        addShake(2);
        if (!quiet) play('block');
        break;
      case 'special':
        floatText(by.x, by.y - 200, char.special.name.toUpperCase(), char.colors.accent, 24);
        if (!quiet) play('special');
        break;
      case 'bolt':
        if (!quiet) play('bolt');
        break;
      case 'super':
        if (!quiet) play('super');
        break;
      case 'clash':
        hitSpark(e.x, e.y, '#ffffff', true);
        if (!quiet) play('block');
        break;
      case 'ko':
        addShake(16);
        addFlash(0.75);
        if (quiet) break;
        showBanner(e.winner < 0 ? 'DOUBLE K.O.' : 'K.O.', e.finisher ? 'FINISHER!' : e.perfect ? 'PERFECT!' : null, '#ff5a36', 2300);
        play('ko');
        break;
      case 'timeup':
        if (quiet) break;
        showBanner('TIME UP', e.winner < 0 ? 'DRAW' : null, '#e8b454', 2000);
        play('round');
        break;
      case 'matchEnd':
        if (quiet) break;
        if (e.winner < 0) showBanner('DRAW', null, '#e8b454', 2600);
        else showBanner(`${getFighter(state.f[e.winner].char).name} WINS`, getFighter(state.f[e.winner].char).title.toUpperCase(), '#e8b454', 2600);
        play('win');
        break;
      default:
        break;
    }
  }
}
