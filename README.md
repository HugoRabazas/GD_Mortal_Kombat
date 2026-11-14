# GD Arena

A 1v1 fighting game for the alliance. The arena is 3D; the fighters are 2D
character models whose heads are the members' own pictures. The whole game
builds into **one self-contained web page**, so it can be published as a Claude
Artifact and shared with a link.

It is an original game in the classic versus-fighter genre: health bars, best
of three rounds, a 60 second timer, punches, kicks, blocking, specials and a
finisher. It deliberately does not reuse the name, characters, art or signature
moves of any existing fighting game.

## Play

| | 1 Player | 2 Players · P1 | 2 Players · P2 |
| --- | --- | --- | --- |
| Move | `A` `D` or `←` `→` | `A` `D` | `←` `→` |
| Jump | `W` or `↑` | `W` | `↑` |
| Crouch | `S` or `↓` | `S` | `↓` |
| Punch | `J` or `F` | `F` | `J` |
| Kick | `K` or `G` | `G` | `K` |
| Block | `L` or `H` | `H` | `L` |
| Special | `I` or `T` | `T` | `I` |
| Finisher | `O` or `Y` | `Y` | `O` |

`P` or `Esc` pauses. On a phone a thumb stick and five buttons appear on screen.

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
- **2D fighters** (`fighter.js`): each fighter is drawn every frame on a flat
  canvas from simple limbs. For each state there is a *pose* (where hips, hands
  and feet should be); knees and elbows are solved automatically (inverse
  kinematics) and the body glides from pose to pose. The member's picture is
  cropped to a circle and used as the head. That canvas is then stuck on an
  upright card in the 3D world that always turns to face the camera.
- **HUD and effects** (`hud.js`, `fx.js`): health bars, timer, energy, sparks,
  damage numbers, banners. Drawn on a second flat canvas laid over the 3D one.
- If a device has no WebGL, `arena.js` paints a flat 2D backdrop instead and
  the game still runs.

### 3. The shell (`client/src/`)

`main.js` builds the menus and runs the frame loop, `game.js` owns one running
fight, `input.js` reads keyboard and touch, `audio.js` synthesises all sound
effects in the browser (no audio files), `effects.js` maps rule events to
sparks and sounds.

## Add an alliance member

1. Save their picture as `client/src/fighters/<id>.png`.
2. Add an entry to `shared/fighters.js` (copy an existing one):
   - `head`: the circle cut from the picture for the fighter's head. `x`, `y`
     are the centre of the face in picture pixels, `r` the radius.
   - `colors`: outfit and glow colours.
   - `stats`: keep `power` and `speed` near 1.0.
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

- Two players means two people at **one keyboard**. A published page has no
  game server behind it, so playing against someone on another device is not
  possible in this form.
- Fighters share one body shape and one move set, plus one of three specials.
  What makes each member unique is the head, colours, stats and move names.
