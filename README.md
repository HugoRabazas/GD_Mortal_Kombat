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
| RUKO | standard | Crimson Rush: a lunging strike that leaves a trail of glows | all-rounder who closes distance |
| SHADOW | standard | Storm Bolt: a projectile | fast, fights from range |
| JACKIE | sumo | Mountain Stomp: floors everyone nearby who is not jumping; a shockwave ring on the floor shows how far it reaches | slow, heavy, hard to knock out |
| PIXIE | slim | Twin Flame Spiral: a spinning leap that hits all around, two flames orbiting and leaving a spiral | quick and fragile |

Every fighter has two costumes, picked with the two split discs under the
portraits on the select screen (and in an online room): Ruko wears Crimson or
Midnight, Shadow Storm or Thunder, Jackie Violet or Granite, Pixie Flame or
Frost. The device remembers the choice, and online it travels with you. Two
copies of the same fighter never dress alike: the second takes the other
costume, and a third copy wears plain alternate colours. A costume is worn
everywhere at once - body, scoreboard, sparks, trails, projectiles and the
finisher's cut-in all take their colour from one place (`dressColors` in
`shared/fighters.js`).

## Modes

- **Arena**: four fighters at once (you and three CPU). Exactly three rounds.
  A round scores 3, 2, 1 or 0 points by how long you last; when the clock
  stops, the healthier fighter ranks higher. Fighters who cannot be separated
  share a place, and a shared place is worth the lower position, so a tie
  never crowns a winner. The final ranking adds the three rounds; fighters
  level on points share a rank.
- **Arcade**: a ladder of five stages that get harder, ending in a
  powered-up boss, with a score and a best score remembered on the device.
  Stage three breaks the run of duels: a brawl against all three rivals at
  once, three rounds, where only a clear first place goes through (a tie at
  the top is not enough). The ladder moves between the arenas as you climb.
- **Quick Fight**: one duel against the CPU on Auto, Easy, Normal or Hard.
  Auto (also in Arena) follows you: each win moves the CPU one step up, each
  loss one step down, and the result screen says when it moves.
- **2 Players**: a duel on one device, or a brawl with two CPU fighters added.
- **Training**: a duel with no clock where health and energy refill, against a
  partner who stands still, blocks, fights back, or **kicks on a steady beat**
  (one kick every 100 ticks, about 1.7 s) - the way to learn the timing of
  the perfect guard. That partner always kicks from the outer side, so its
  kicks push you back towards the middle and never into the ring of fire.
  A checklist of thirteen moves sits in the corner and ticks each one off the
  first time you really do it (a combo has to land, a block has to stop a
  blow), with how to do the next ones; the device remembers it, and the menu
  shows how many you have learned.

A duel is first to two round wins.

Each body type also stands its own way between blows: the sumo low and
wide, breathing slowly; the slim fighter light on the toes, bouncing
quicker. The main menu shows a different tip each time, written for the
controls in use.

When a match ends, every fighter who won celebrates in their own way - Ruko
raises a fist to the sky, Shadow stands with arms folded, Jackie stamps like a sumo
wrestler, Pixie hops and waves - turned three-quarters to the camera so it
reads. The result screen opens with the winner's own line (Ruko: "The moon
saw that one coming. You did not."; Shadow: "Quiet. Quick. Finished.";
Jackie: "The mountain does not move. You did."; Pixie: "Two flames, one
winner!") and shows the numbers of the fight: damage really dealt
(a finishing blow counts only what was left), blows landed, the longest combo
and perfect guards, the better figure of each in gold. In a brawl they ride
along in the ranking, under each name.

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

`P`, `Esc` or Start pauses, and the pause screen shows the **move list** of
the fighter you are playing, written with the controls you are actually
using: the game notices whether you last touched the keyboard, the screen or
a gamepad, and the move list, the hint at the start of a fight and the
Training checklist all name the controls to match (`J` / `P` / `X` for a
punch). Every gamepad button was checked with a simulated standard pad:
D-pad and A/B in the menus, the stick to walk, X, B, A, Y, LB/LT and RB/RT
in a fight, Start to pause - and two pads at once in 2 Players, each driving
its own fighter. The help screen's controls table has a column for the
keyboard, two players, the gamepad and the touch buttons, and lights the one
you are using. A gamepad also works the menus: stick or D-pad
moves between buttons, A chooses, B goes back. On a phone or tablet a thumb stick and six buttons
appear on screen; **Arrange buttons** (menu and pause screen) lets you drag
each one where you like and resize them, saved per orientation on the device.
The stick also floats: a thumb that lands anywhere free on the stick's half
of the screen brings the stick under it, and letting go sends it home - so a
fight never stalls because a thumb missed the circle by a finger.
When your fighter is nearly out (under a quarter of their health), a quiet
heartbeat plays, so the danger reaches you even with your eyes off the bar.
Being hit makes a phone buzz and a gamepad with motors rumble (your own heavy
blows give a light rumble too), where the browser allows it.

- You walk in any direction. Attacks turn you towards the nearest rival, so
  aim does not have to be exact.
- **Punch three times** for a combo that ends in a knockdown; each punch has
  to land for the next to come out.
- **Punch + Kick together** is a grab: short reach, open if it misses, but it
  goes straight through a guard.
- **Block + a direction** is a dodge roll: attacks pass through you for most
  of it.
- **Block on the floor** after a knockdown is a **quick rise**: back up after
  8 ticks instead of 34, once per knockdown, still with the usual moment of
  invulnerability as you stand. The CPU uses it as often as it guards.
  Matches got a little brisker (70 -> 68 s); Jackie, whose stomp lives on
  knockdowns, went 115 -> 117 health to stay level (duels 47-53 %).
- A blow that lands while the rival is still **winding up** an attack of
  their own is a **counter hit**: a quarter more damage and a longer impact,
  marked COUNTER. Between CPUs about one hit in five is a counter.
- **Block at the last moment** - the button pressed in the last 5 ticks
  (about 80 ms) before a blow lands - is a **perfect guard**: no chip damage,
  extra energy, and a kick or any other heavy blow thrown from the ground
  leaves its owner reeling long enough to punish. The guard must have been
  down for a third of a second first, so hammering the button earns nothing,
  and a guard that is simply held is an ordinary block. The CPU manages it
  rarely on Normal, more often on Hard, and the arcade boss most of all.
- Hits fill the **energy** bar: a special costs 35 of 100, the finisher needs
  it full. Under a quarter of their health a fighter is in their **last
  stand** (LAST STAND on screen with a deep drum, the body pulsing red, the heartbeat, and
  the music pushing harder when it is your fighter): the bar fills half as
  fast again. Measured over 600 CPU rounds, rounds won from 30 points of
  health behind went from 11.6 % to 14.8 %.
- **Block** only stops what comes from the front, and a blocked hit can never
  knock you out.
- **Jump** over a ground stomp; attack in the air for a diving kick.
- **Crystals** appear on the floor: gold gives energy, green gives health.
- As the clock runs down a **ring of fire** closes in. A fighter knocked into
  it is scorched and bounced back.

## Online play

The website build adds an **Online** mode for the whole alliance:

- You pick a name and enter the **alliance lobby**. **Quick match** puts you
  in the open room with the most people (or opens one) in one press; the
  lobby also shows who is online,
  each with the portrait of the fighter they have picked, and which rooms are
  open: the faces of the fighters already inside, how full the room is (or
  whether a fight is on), the arena it fights in, and Join - or Watch, when
  it is full or fighting.
  Rooms with a free place are listed first.
- A **room** holds up to four fighters (more can watch). Everyone picks a
  fighter and presses Ready; the host starts the fight, optionally filling the
  empty places with CPU fighters. Two fighters play a duel, three or four an
  arena brawl. After a fight that finished, everyone who fought stays ready,
  so one more is a single press for the host; anyone who wants to sit the
  next one out presses Not ready.
- The lobby and every room have a **chat**. Messages reach whoever is there at
  that moment and are not stored anywhere.
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
- A guest's own fighter is drawn slightly ahead of the host's word while it
  is simply walking (where it will be once the host's answer arrives), so
  moving feels immediate; the host still decides every hit.
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

## Your record

**Record** (at the foot of the menu) keeps a lifetime tally of your own
fights on the device: fights and wins, the best run of wins, the best
combo, perfect guards, damage dealt, online fights, your favourite fighter,
and fights and win rate with each fighter. Every finished fight counts
except Training and two players on one device.

## Settings

Every special move has its own sound, made in the browser like everything
else: Crimson Rush tears the air open with a rising whoosh, Twin Flame Spiral
crackles and climbs, Mountain Stomp heaves as the leg goes up and lands with
a deep boom, Storm Bolt charges and fires. A counter hit adds a dry crack.

Each arena has its own music, generated note by note in the browser: Ember
Courtyard plays a warm plucked tune in A minor at 116 beats a minute; Frost
Summit a colder one in D minor at 104, with a bell melody (a pure tone plus
the out-of-tune overtone that makes a bell sound like a bell), a hollow bass
and a high ice chime; Dune Ruins a desert tune at 98 that sways between E
and F - that half step is what gives it its colour - with a reedy lead. All
three speed up and fill out for deciding rounds and the last seconds of a
round.

**Graphics** (Settings) is Auto, Sharp or Fast. Auto starts at full detail
and lowers it by itself if the device struggles; Sharp keeps full detail
always; Fast is for slower phones - no shadows, no cartoon outlines, lower
resolution, a third of the rain, snow or sand, and a calmer crowd (about 153
draws a frame against about 300). In software rendering, the
closest thing here to a weak phone graphics chip, Fast drew a frame 3.6
times quicker (234 ms against 847 ms).

The weather can be heard under every fight, as strong as the round makes
it: rain hissing on stone in the courtyard's storm, wind round the summit
(a little from the first round, a howl in the blizzard), sand driven over
the ruins in the sandstorm. Calm rounds are quiet.

The music holds its breath during a finisher's freeze and the slow motion
after a knockout, then comes back.

Music and effects have their own volume sliders (menu and pause screen),
remembered on the device, next to the sound switch, the touch-button switch
and the button arranger.

## Three arenas, and all live in time

Every select screen has a row that picks where the fight is held; the fight
playing behind the menus moves there at once, so the choice is a preview. The
device remembers it. The two places share the same floor, the same rules and
the same ring of fire - they differ in paint, light, weather and sound.

- **Ember Courtyard**: round one at dusk, round two under a cold night sky,
  round three in a storm with rain, lightning and thunder.
- **Frost Summit**: a shrine on a frozen peak, with snow on the walls, blue
  spirit flames in the torches and ice-blue banners. Round one under the
  northern lights (the rim light on the fighters wanders between green and
  violet), round two in deep night with light snow, round three in a blizzard
  with gusts of wind.
- **Dune Ruins**: sandstone ruins in the desert under a big sun, teal
  banners. Round one at midday, round two in a golden sunset, round three in
  a sandstorm - an ochre haze that swallows the far wall, grit driven almost
  sideways, and the wind howling.

The arcade ladder moves to the next arena after every fight. Online, the
host picks the arena in the room; everyone else sees the choice there before
the fight starts, and everyone fights in it.

Every round opens with the camera low and wide, looking up at the sky and
the mountains over the wall, and cranes down to the fighters before the call
to fight - so each change of light and weather is seen as it arrives.

The banners on the wall hang from their top edge and move in the wind -
barely at first, hard in the storm, the blizzard and the sandstorm.

A crowd on the stands sways while it watches and jumps and roars when heavy
blows and knockouts land - and it is heard: a low murmur under every fight
(not in Training) that swells with heavy blows, perfect guards, finishers and
knockouts, then settles back down. Inside every round, the ring of fire shrinks the
fighting ground as time runs out.

To add another arena: add its name to `client/src/arenas.js`, its look to
`THEMES` in `client/src/render/themes.js` (colours, weather and the three
moods), its tune to `MUSIC_THEMES` in `client/src/audio.js` and its tint to
`FLAT_TINTS` in `client/src/render/arena.js`. `npm test` says what is
missing.

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
exactly like a human, so it cannot cheat. It guards against blows that can
still land - not against a move already spent - and it punishes openings: a
rival reeling from a perfect guard, or stuck in the recovery of a move that
missed. How often it sees an opening grows with the level (about 1, 4, 8 and
11 punishing hits a match from Easy to Boss). `shared/fighters.js` is the roster.

### 2. The picture (`client/src/render/`)

- **Arena** (`scene3d.js`, three.js): stone dais, wall, pillars, banners,
  torches, moon and mountains; time of day, rain, snow, lightning and the ring
  of fire; a camera that keeps every standing fighter in frame. The shapes
  are built once; an arena is a *theme* laid over them (textures painted on
  first use, colours, weather), so changing arena costs nothing.
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
   pixels); `build` is `standard`, `sumo` or `slim`; `gear` adds a `scarf` or
   shoulder `pads`; `victory` is how they celebrate a won match (`howl`,
   `calm`, `stomp` or `cheer`); `quote` is their winning line (60 characters
   at most); `looks` are their costumes (the first is their
   own colours, the second names the colours it changes); `special.type` is `dash`,
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

Add `?debug` to the page address to reach the running game from the browser
console as `window.gd` (the match state is `gd.game.state`). The automated
checks use it to act at an exact moment of a fight - for example, to raise
the guard three ticks before a kick lands. Without `?debug` nothing changes.

`npm test` first runs a linter (`eslint.config.js`) and then the tests: the
rules (`tests/sim.test.js`), the roster's costumes (`tests/fighters.test.js`),
the arenas (`tests/arenas.test.js`: every arena in the picker has a 3D theme
with three moods, its own music and a look without WebGL - the themes live
as plain data in `client/src/render/themes.js` so Node can read them) and
online play (`tests/online.test.js`). The
online test runs two players in Node on the same-browser bus (Node has
BroadcastChannel too): they meet in the lobby, make a room, get ready, fight
in the host's arena, and come back for one more. Node has no WebRTC, so it
also proves that play falls back to the bus when a browser cannot open a
direct link. The linter is not a style guide: it only catches a name used
without being imported or declared, and things declared but never used.

## Limits worth knowing

- The Artifact page is offline only; online play needs the website build.
- Online, your own fighter answers after a short delay (the trip to the host
  and back) unless you are the host. If the host leaves, the fight ends.
- A browser with WebRTC switched off (some privacy settings do this) cannot
  open direct links; it still plays, through the server, a little slower,
  and the room says so.
- Fighters share one skeleton and the basic moves; what sets them apart is the
  build, the special, the stats, the colours, the head and the way they
  celebrate.
- Each fighter is about twenty separate rounded parts with a cartoon outline,
  which costs the graphics card two or three draws a part. A four-fighter
  brawl is about 300 draws a frame: some 240 for the scene and about 57 for
  the shadow pass (three.js counts draws after the shadow pass, so the
  first figures quoted here, 240, left the shadows out; the scene's own
  count went from 300 to 240 when the arena's stone was batched and the
  small parts stopped casting shadows). Graphics: Fast drops the shadow pass
  (about 244 draws) and the resolution; Auto does the same by itself when a
  device struggles.
