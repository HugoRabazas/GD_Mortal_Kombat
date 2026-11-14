# GD Arena

A 3D arena fighting game for the alliance. Fighters roam freely over a round
stone arena, alone against the CPU, two on one device, or four at once in a
free-for-all. Every fighter's head carries an alliance member's own picture.
The whole game builds into **one self-contained web page**, so it can be
published as a Claude Artifact and shared with a link.

It is an original game: it does not reuse the name, characters, art or
signature moves of any existing fighting game.

## Fighters

| Fighter | Build | Special | Plays like |
| --- | --- | --- | --- |
| RUKO | standard | Crimson Rush: a lunging strike | all-rounder who closes distance |
| SHADOW | standard | Storm Bolt: a projectile | fast, fights from range |
| JACKIE | sumo | Mountain Stomp: floors everyone nearby who is not jumping | slow, heavy, hard to knock out |
| PIXIE | slim | Twin Flame Spiral: a spinning leap that hits all around | quick and fragile |

## Modes

- **Arena**: four fighters at once (you and three CPU). Exactly three rounds.
  A round scores 3, 2, 1 or 0 points by how long you last; when the clock
  stops, the healthier fighter ranks higher. Fighters who cannot be separated
  share a place, and a shared place is worth the lower position, so a tie
  never crowns a winner. The final ranking adds the three rounds; fighters
  level on points share a rank.
- **Arcade**: a ladder of five duels that get harder, ending in a powered-up
  boss, with a score and a best score remembered on the device.
- **Quick Fight**: one duel against the CPU on Easy, Normal or Hard.
- **2 Players**: a duel on one device, or a brawl with two CPU fighters added.
- **Training**: a duel with no clock where health and energy refill, against a
  partner who stands still, blocks or fights back.

A duel is first to two round wins.

## Play

| | Single player | 2P · Player 1 | 2P · Player 2 | Gamepad |
| --- | --- | --- | --- | --- |
| Walk | `W` `A` `S` `D` or arrows | `W` `A` `S` `D` | arrows | Stick / D-pad |
| Jump | `Space` or `U` | `Space` | `U` | A / Cross |
| Punch | `J` or `F` | `F` | `J` | X / Square |
| Kick | `K` or `G` | `G` | `K` | B / Circle |
| Block | `L` or `H` | `H` | `L` | LB / LT |
| Special | `I` or `T` | `T` | `I` | Y / Triangle |
| Finisher | `O` or `Y` | `Y` | `O` | RB / RT |

`P`, `Esc` or Start pauses. On a phone or tablet a thumb stick and six buttons
appear on screen; **Arrange buttons** (menu and pause screen) lets you drag
each one where you like and resize them, saved per orientation on the device.

- You walk in any direction. Attacks turn you towards the nearest rival, so
  aim does not have to be exact.
- **Punch three times** for a combo that ends in a knockdown; each punch has
  to land for the next to come out.
- **Block + a direction** is a dodge roll: attacks pass through you for most
  of it.
- Hits fill the **energy** bar: a special costs 35 of 100, the finisher needs
  it full.
- **Block** only stops what comes from the front, and a blocked hit can never
  knock you out.
- **Jump** over a ground stomp; attack in the air for a diving kick.
- **Crystals** appear on the floor: gold gives energy, green gives health.
- As the clock runs down a **ring of fire** closes in. A fighter knocked into
  it is scorched and bounced back.

## Online play

The website build adds an **Online** mode for the whole alliance:

- You pick a name and enter the **alliance lobby**, which shows who is online
  and which rooms are open.
- A **room** holds up to four fighters (more can watch). Everyone picks a
  fighter and presses Ready; the host starts the fight, optionally filling the
  empty places with CPU fighters. Two fighters play a duel, three or four an
  arena brawl.
- **Copy invite link** in a room gives an address ending in `#room-ABCD`;
  whoever opens it only has to type a name to land in that room.
- Everyone in a room must be on the same version of the game. If someone has
  an old page open, the room says so and the fight cannot start until they
  reload. During a fight a small line under the timer shows whether the data
  is travelling directly or relayed, and the round-trip time to the host.
- How a match travels: the host's browser runs the real fight with the same
  rules code as offline; the others send only their buttons and receive a
  snapshot of the fight twenty times a second, which they draw gliding from
  one to the next. One copy of the truth, so nobody drifts out of sync.
- Players find each other through Supabase Realtime (`client/src/net/bus.js`).
  The game data then goes over a direct browser-to-browser link
  (`link.js`, WebRTC) when the networks allow it, and is relayed through
  Supabase at a lower rate when they do not.

The Artifact page cannot reach the network, so it has the offline modes only.

### Hosting

- `npm run build:web` writes `dist-web/index.html`. It needs two environment
  variables: `GD_SUPABASE_URL` and `GD_SUPABASE_KEY` (the project's
  *publishable* key, which is meant to be public).
- Any other static host works too: serve the `dist-web` folder.
- **The site is hosted on GitHub Pages**, which is free for public
  repositories and needs no payment details.
  `.github/workflows/pages.yml` tests, builds and publishes it on every push.
  The site lives at https://hugorabazas.github.io/GD_Mortal_Kombat/ (Pages is
  switched on in the repository's Settings -> Pages, Source: "GitHub
  Actions").
- The Supabase project needs no tables. On the free plan Realtime allows 200
  people connected and 100 messages a second, which is plenty while matches
  run over direct links, and about one four-player match at a time if every
  player has to be relayed.

## The arena lives in time

Round one is fought at dusk, round two under a cold night sky, round three in
a storm with rain and lightning. Inside every round, the ring of fire shrinks
the fighting ground as time runs out.

## How it is built, from the ground up

Three layers, each knowing nothing about the one above it.

### 1. The rules (`shared/`)

A fighting game is, underneath, a function: *given the state of the match and
the buttons every fighter holds, what is the state 1/60 of a second later?*
`shared/sim.js` is that function (`step`). It knows nothing about screens or
sound.

- **Time is cut into ticks**, 60 a second, so the fight is identical on any
  device and *deterministic*: the same buttons always give the same match.
  That is what lets the tests replay whole matches.
- **Space is a circle seen from above.** A fighter has a position on the floor
  (x, z), a height (h) and a direction it faces. Walking moves it on the
  floor; jumping changes its height.
- **Every attack is a few numbers**: `startup`, `active` and `recovery` ticks,
  how far it reaches, how wide a wedge it covers in front of the attacker and
  which band of height it covers. If a rival stands inside that wedge during
  the active ticks, the hit lands. A ground stomp covers a full circle but
  only ankle height, which is why a jump avoids it.
- **State machine.** A fighter is always in exactly one state (`idle`, `walk`,
  `jump`, `attack`, `block`, `hit`, `down`, `ko` ...) and the state decides
  which buttons mean anything.
- **Events.** The rules do not play sounds; they report "a heavy hit landed
  here". The screen layer decides how that looks and sounds.

`shared/ai.js` is the CPU. It reads the same state and answers with buttons,
exactly like a human, so it cannot cheat. `shared/fighters.js` is the roster.

### 2. The picture (`client/src/render/`)

- **Arena** (`scene3d.js`, three.js): stone dais, wall, pillars, banners,
  torches, moon and mountains; time of day, rain, lightning and the ring of
  fire; a camera that keeps every standing fighter in frame.
- **Fighters** (`rig3d.js`): bodies built from rounded limbs with a cartoon
  outline, lit by the arena and casting real shadows. For each state there is
  a *pose* (`fighter.js`): where hips, hands and feet should be. Knees and
  elbows are solved automatically (inverse kinematics) and the body glides
  from pose to pose. Three builds share one skeleton: standard, sumo and
  slim. The head is a ball with the member's picture on the front, and it
  always turns to the camera.
- **HUD and effects** (`hud.js`, `fx.js`): health, energy, points, timer,
  floating name tags, sparks, damage numbers and banners on a flat layer over
  the 3D view.
- **Adaptive quality**: on a slow device the game drops cast shadows, then
  resolution. With no WebGL at all it draws the same fight flat in 2D.

### 3. The shell (`client/src/`)

`main.js` (menus, modes, frame loop), `game.js` (one running fight),
`input.js` (keyboard, touch, gamepads), `touchLayout.js` (drag-to-arrange
editor), `audio.js` (every sound and the music are generated in the browser),
`effects.js` (maps rule events to sparks and sounds).

## Add an alliance member

1. Save their picture as `client/src/fighters/<id>.png`.
2. Add an entry to `shared/fighters.js` (copy an existing one): `head` is the
   circle cut from the picture (centre `x`, `y` and radius `r` in picture
   pixels); `build` is `standard`, `sumo` or `slim`; `special.type` is `dash`,
   `bolt`, `rise` or `quake`; keep `stats` near 1.0.
3. `npm run build` and publish `dist/gd-arena.html` again.

The roster is balanced by simulating hundreds of CPU matches; a new fighter
may need the same treatment. Larger, cleaner pictures give sharper heads.

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

`npm run build` writes `dist/gd-arena.html` (the page to publish) and
`dist/index.html` (the same page wrapped so any browser can open it).

## Limits worth knowing

- The Artifact page is offline only; online play needs the website build.
- Online, your own fighter answers after a short delay (the trip to the host
  and back) unless you are the host. If the host leaves, the fight ends.
- Fighters share one skeleton and the basic moves; what sets them apart is the
  build, the special, the stats, the colours and the head.
