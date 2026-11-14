# GD Arena

A 1v1 fighting game for the alliance, in full 3D: a torch-lit arena and
articulated 3D fighters whose heads carry the members' own pictures. The whole
game builds into **one self-contained web page**, so it can be published as a
Claude Artifact and shared with a link.

It is an original game in the classic versus-fighter genre: health bars, best
of three rounds, a 60 second timer, punches, kicks, blocking, specials and a
finisher. It deliberately does not reuse the name, characters, art or signature
moves of any existing fighting game.

## Modes

- **Arcade** (single player): pick a fighter and climb a ladder of five fights
  that get harder, ending in a powered-up boss. Each win scores points for the
  stage, health left, time left and not dropping a round. Trying a stage again
  costs 20% of the score. The best score is remembered on the device.
- **Quick Fight** (single player): one match against the CPU on Easy, Normal
  or Hard.
- **2 Players**: two people on one keyboard, or with two gamepads.

## Play

| | Single player | 2P · Player 1 | 2P · Player 2 | Gamepad |
| --- | --- | --- | --- | --- |
| Move | `A` `D` or `←` `→` | `A` `D` | `←` `→` | Stick / D-pad |
| Jump | `W` or `↑` | `W` | `↑` | Up |
| Crouch | `S` or `↓` | `S` | `↓` | Down |
| Punch | `J` or `F` | `F` | `J` | X / Square |
| Kick | `K` or `G` | `G` | `K` | A / Cross |
| Block | `L` or `H` | `H` | `L` | B / Circle |
| Special | `I` or `T` | `T` | `I` | Y / Triangle |
| Finisher | `O` or `Y` | `Y` | `O` | RB / RT |

`P`, `Esc` or Start pauses.

On a phone or tablet a thumb stick (move, jump, crouch) and five buttons appear
on screen in single-player modes: `P` punch, `K` kick, `BLK` block, `SP`
special, `ULT` finisher. `SP` and `ULT` light up when there is enough energy to
use them. Held sideways the game fills the screen; held upright the controls
sit under it.

**Arrange buttons** (in the menu and in the pause screen) lets you drag every
control to wherever your thumbs rest and make them bigger or smaller. Upright
and sideways layouts are saved separately, on the device.

- Landing and taking hits fills the **energy** bar. A special costs 35 of 100;
  the finisher needs a full bar and spends all of it.
- **Block** cuts damage to a fraction and a blocked hit can never knock you out.
- **Crouch** ducks punches and projectiles. Crouch + Kick is a sweep (knockdown).
- Punch or kick while in the air for a jumping attack.

## How it is built, from the ground up

The game is three layers, each knowing nothing about the one above it.

### 1. The rules (`shared/`)

A fighting game is, underneath, a function: *given the state of the match and
the buttons both players are holding, what is the state 1/60 of a second
later?* `shared/sim.js` is exactly that function (`step`). It has no idea about
screens or sound. Everything else in the project either feeds it buttons or
draws what it returns.

- **Time is cut into ticks.** The match advances 60 times a second in equal
  steps. This keeps the fight identical on a fast PC and a slow phone, and it
  makes the rules *deterministic*: the same buttons always produce the same
  fight, which is what lets the tests replay whole matches.
- **Every attack is three numbers**: `startup` ticks before it can hit,
  `active` ticks during which it hits, `recovery` ticks afterwards when the
  attacker is open. A punch is fast and weak (4 / 3 / 8), a kick slower and
  stronger (8 / 4 / 13). All balance lives in the `MOVES` table.
- **Hits are rectangles.** An attack has a hit box in front of the fighter, a
  fighter has a hurt box around the body. If they overlap during the active
  ticks, the hit lands. Crouching makes the hurt box shorter, which is why it
  ducks punches.
- **State machine.** A fighter is always in exactly one state (`idle`, `walk`,
  `jump`, `attack`, `block`, `hit`, `down`, `ko`…). The state decides which
  buttons mean anything, e.g. you cannot punch while knocked down.
- **Events.** Instead of playing a sound, the rules *report* "a heavy hit
  landed at this point". The screen layer decides what that looks and sounds
  like.

`shared/ai.js` is the CPU opponent. It reads the same state and answers with
buttons, exactly like a human, so it can never cheat. `shared/fighters.js` is
the roster.

### 2. The picture (`client/src/render/`)

- **3D arena** (`scene3d.js`, using three.js): real geometry for the stone
  dais, the courtyard wall, pillars, banners and torches whose lights flicker
  on the stone; a moon and mountains far behind. A perspective camera follows
  the fighters, pulls back when they separate, swings round for the round
  intro, pushes in on a finisher and circles the winner.
- **3D fighters** (`rig3d.js`): each body is built from rounded limbs
  (cylinders and spheres) with a dark cartoon outline, lit by the arena and
  casting a real shadow. The animation is driven by *poses*: for each state
  there is a description of where hips, hands and feet should be
  (`fighter.js`); knees and elbows are solved automatically (inverse
  kinematics) and the body glides from pose to pose. Those points are given
  depth, with one arm and leg nearer the camera and the other further, to make
  a full 3D body. The head is a ball with the member's picture wrapped over
  the front, and it always turns to look at the camera.
- **3D effects**: projectiles are glowing orbs that carry their own light
  across the floor, and every landed hit throws a brief flash of light on the
  fighters. Sparks, dust and damage numbers are painted on a clear sheet
  standing just in front of them.
- **HUD** (`hud.js`, `fx.js`): health bars, timer, energy, announcer banners,
  drawn on a flat canvas laid over the 3D one.
- **Adaptive quality**: if a device cannot keep a smooth frame rate, the game
  first drops cast shadows and extra resolution, then lowers the resolution
  further, so slower phones stay playable.
- If a device has no WebGL at all, `arena.js` and `fighter.js` draw the same
  fight flat in 2D instead.

### 3. The shell (`client/src/`)

`main.js` builds the menus, the arcade ladder and runs the frame loop,
`game.js` owns one running fight, `input.js` reads keyboard, touch and
gamepads, `touchLayout.js` is the drag-to-arrange editor for the on-screen
controls, `audio.js` synthesises every sound effect and the music in the
browser (no audio files), `effects.js` maps rule events to sparks and sounds.

## Add an alliance member

1. Save their picture as `client/src/fighters/<id>.png`.
2. Add an entry to `shared/fighters.js` (copy an existing one):
   - `head`: the circle cut from the picture for the fighter's head. `x`, `y`
     are the centre of the face in picture pixels, `r` the radius.
   - `colors`: outfit and glow colours.
   - `stats`: keep `power` and `speed` near 1.0. The current roster was
     balanced by simulating hundreds of CPU-vs-CPU matches until each fighter
     won about half; a new fighter may need the same treatment.
   - `special.type`: `'dash'` (lunging strike), `'bolt'` (projectile) or
     `'rise'` (rising anti-air strike).
3. `npm run build` and publish `dist/gd-arena.html` again.

Larger, cleaner source pictures (ideally 300 px or more across the face, with
no interface buttons on top) give sharper heads.

## Develop

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

- `npm run dev` serves the game at `http://localhost:5173` with live reload.
- `npm test` runs the rule tests (hits, blocking, specials, rounds, timer,
  determinism, full CPU-vs-CPU matches).
- `npm run build` writes `dist/gd-arena.html` (the page to publish) and
  `dist/index.html` (the same page wrapped so any browser can open it).

## Limits worth knowing

- Two players means two people at **one device** (shared keyboard or two
  gamepads). A published page has no game server behind it, so playing against
  someone on another device is not possible in this form.
- The fight itself still runs on a line, as in most 3D fighting games: the
  fighters, arena, lights and camera are 3D, but you cannot sidestep into the
  depth of the arena.
- Fighters share one body shape and one move set, plus one of three specials.
  What makes each member unique is the head, colours, stats and move names.
