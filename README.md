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
| RUKO | standard | Crimson Rush: a lunging strike that leaves a trail of glows and speed lines streaming off the body | all-rounder who closes distance |
| SHADOW | standard | Storm Bolt: a projectile, gathered as a glowing ball between cupped hands, fired with both palms, lightning crackling round it in flight | fast, fights from range |
| JACKIE | sumo | Mountain Stomp: floors everyone nearby who is not jumping; a shockwave ring on the floor shows how far it reaches, the floor splits in glowing cracks and shards of rock fly up | slow, heavy, hard to knock out |
| PIXIE | slim | Twin Flame Spiral: a spinning leap that hits all around, two flames orbiting and leaving a spiral, lit by a ring of fire on the floor at take-off | quick and fragile |
| MERU | standard | Iron Charge: a lunging shoulder charge | heavy and steady; Last Oath: a charge, three hammer blows, a slam that floors everyone near; Shield Ram |
| GLEH | slim | Moon Arrow: a projectile | quick, fights from range; Crescent Rain: a leap high and a rain of five moonlit arrows; Moon Vault (lands behind the rival) |
| KICHTA | standard | Rising Edge: a spinning leap that hits all around | quick blade; Thousand Cuts: a dash, a storm of cuts, a rising slash; Blade Dash |
| ZELRITH | slim | Storm Clap: floors everyone nearby who is not jumping | quick and tough; Sunburst: climbs in a ball of light and falls like the sun; Spin Top |

**How to play** ends with the fighters: each one's face, title, a few words
on their build drawn from their stats ("the quickest, lighter blows"; "slow
on the feet, hits hard, hard to knock out"), and what their special does.

Can't choose? The **?** after the faces on every select screen (and in an
online room) picks another fighter at random, in a random costume.

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
  It is free practice: nothing on screen but the fight (the list of moves to
  learn lives in the Tutorial).
- **Tutorial**: nine short lessons (Basics, Defence, Getting up, Throws, On
  the run, In the air, Combos, Counters, Specials), each against a partner
  scripted for it: one stands still, one kicks on the beat (to block, perfect
  guard, roll through and counter), one keeps a guard up (to see a punch
  stopped and a throw go through it), and one walks up and **throws you down
  again and again** so the quick rise and the rising sweep can actually be
  practised. The steps of the lesson sit in the corner, named in the
  controls being used, and tick off from what really happens in the fight;
  when they are all done the lesson ends with Next lesson / Again / All
  lessons. Progress is kept per lesson on the device, and the menu shows how
  many lessons are done. The lessons and their partners are shared code
  (`shared/tutorial.js`), tested against the real rules: the throwing
  partner floors a player at least three times in 25 seconds, and holding
  guard on the floor and punching while getting up tick both steps. Every
  step of every lesson is played through in the tests by a scripted player
  against that lesson's own partner, so none of them is impossible. (That
  play-through found two things: a follow-up pressed during a blow's impact
  pause was forgotten before the string could use it - a pressed button is
  now remembered for eight ticks of the fighter's own time, not counting the
  pause - and walking up to the partner then jumping is a running jump, so
  the flying-kick step now says to jump from a standstill.)

A duel is first to two round wins.

Each body type also stands its own way between blows: the sumo low and
wide, breathing slowly; the slim fighter light on the toes, bouncing
quicker. The main menu shows a different tip each time, written for the
controls in use.

Each round opens with a ritual of the fighter's own while it is announced:
Ruko rises from a low prowl, Shadow bows and presses a fist into an open
hand, Jackie claps twice and opens the arms wide, Pixie circles both hands
as if stirring a flame - heard as well as seen: the two claps, the fist
meeting the palm and the flame each make their sound. The four newer
fighters have rituals of their own too: Meru rises from one knee and beats a
fist on the chest (a thud), Gleh draws a bow at the sky and looses an arrow,
Kichta makes two cuts of the blade hand and holds it level, Zelrith turns
twice on the spot and bows with the arms spread. Name tags fade once a match is decided, so the
winner and the result screen are not written over.

When a match ends, every fighter who won celebrates in their own way - Ruko
raises a fist to the sky, Shadow stands with arms folded, Jackie stamps like a sumo
wrestler, Pixie hops and waves, Meru beats a fist on the chest and raises it,
Gleh looses arrow after arrow at the sky, Kichta turns once with the blade
out and puts it away, Zelrith bends back laughing and points at the loser -
turned three-quarters to the camera so it
reads. Confetti in the winner's colours then drifts down over the arena for
about five seconds (fewer pieces, falling slower, for anyone whose device
asks for reduced motion). Sparks, dust, numbers, confetti, the fighters'
easing between poses and the arena's lights and embers all move by the
clock, not by the frame, so they keep the same timing on a phone that
draws fewer frames a second. Behind the menus and the pause and result
screens the arena is drawn thirty times a second instead of sixty (it still
runs on the clock), so a phone stays cooler and its battery lasts longer
while someone reads; a fight is always drawn at full rate. Each build walks its own way too: the heavy fighter waddles, wide and low,
rocking from side to side; the slim one goes on quick, springy steps.
From the third blow of a combo a big counter stands at the attacker's side
of the screen - the number swelling with each blow, HITS under it and a word
for how good it is (NICE from 3, GREAT 5, AWESOME 7, AMAZING 9,
UNSTOPPABLE 12) - and fades a moment after the combo ends. On a phone held sideways no menu needs scrolling: the online lobby and a
room lay themselves out in two columns under a small title (who is there and
the chat on the left; the rooms, or your fighter and the host's options, on
the right; the buttons along the bottom), and the menu, the select screen
and the settings tighten up under 400 px of height. Measured for every
screen from 568 x 320 to 915 x 412 (the old layout overflowed a room by 55 to
219 px there). In the Tutorial a phone's lesson panel keeps to the step in
hand, clear of the stick; held upright it sits under the arena.

The on-screen buttons never overlap: their size is capped by the gap
between two of them in the default layout (they overlapped by up to 13 px on
phones under about 750 px wide held sideways). The pause screen puts its
buttons in a narrow column beside the move list sideways, and two by two
above it upright. Every screen is measured at seven phone sizes, both ways
up, by a scripted walk through the game: no screen scrolls.

**Full screen** is on offer wherever a player may be - the menu, the online
lobby, a room and the pause screen - since someone who comes in through an
invite link never sees the menu; on a phone, pressing Ready or Start fight in
a room also goes full screen (the tap is the gesture the browser needs).
Browsers that cannot do it (Safari on an iPhone) are not offered the button.
When a match is won the camera frames the winner to the left of the picture
in their victory pose, and on a wide screen the result sits to the right so
the pose is seen beside it. The pause screen lists every move in six tabs - Basics, Strings, On the
run, Air, Defence and the fighter's own (special, finisher) - each short
enough to fit a phone held either way, named in the controls being used. The spark of a blow takes the shape of what struck: a punch is a small
star, a kick a white crescent swept the way the kick travelled with its
sparks thrown onward, a heavy blow adds a shock ring, Ruko's finisher flurry
leaves three claw marks, Shadow's blows implode in purple and Pixie's flames
throw embers up. A blow knocks a fighter away from where it came from: struck from the
front the body is thrown back, struck from behind it is thrown forward. How
hard shows as well: a light blow is a flinch, a heavy one a stagger with the
arms flung and a foot off the floor, the head snapping to alternate sides as
blows keep landing, easing off as the stun runs out (and the first ticks of
a hit snap harder so the impact reads). Every ordinary blow has anticipation
and follow-through: the wind-up builds over the whole startup, the strike
overshoots its mark for a tick or two, and the recovery settles back towards
the guard. A jump pushes off with the legs straight and the arms thrown up,
tucks at the top and reaches for the floor on the way down; landing squashes
low and rises out of it. Each build guards in its own way (the sumo low and
wide, the slim fighter high and bobbing). A blow taken on the guard shoves it back while the
block stun lasts. Setting off walking leans into the first steps and
stopping settles back a touch; standing still for a while, each build does
something now and then (shoulders rolled and hands shaken out, thighs
slapped by the sumo, a hop to switch feet by the slim fighter). A body that
hits the floor bounces and rocks before lying still, and gets up in its own
way: the sumo heaves up pushing on the floor, the slim fighter springs up
with a hop. The beaten go down in their own way too: the heavy fighter sits down
hard with legs out, the slim one drops to a knee, the others stand slumped.
The result screen opens with the winner's own line (Ruko: "The moon
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
| Throw | `M` or `V` | `V` | `M` | R3 (press the right stick) |
| Special | `I` or `T` | `T` | `I` | Y / Triangle |
| Finisher | `O` or `Y` | `Y` | `O` | RB / RT |

`P`, `Esc` or Start pauses, and the pause screen shows the **move list** of
the fighter you are playing, written with the controls you are actually
using: the game notices whether you last touched the keyboard, the screen or
a gamepad, and the move list, the hint at the start of a fight and the
Tutorial's lesson panel all name the controls to match (`J` / `P` / `X` for a
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
fight never stalls because a thumb missed the circle by a finger. Each
button gives a faint tick under the thumb when pressed, where the phone
allows it (most Android phones; iPhones do not let web pages vibrate).
When your fighter is nearly out (under a quarter of their health), a quiet
heartbeat plays, so the danger reaches you even with your eyes off the bar.
The match's last moment sounds like its result: a rising fanfare when your
fighter wins (or when nobody at the screen is playing one side, as in
2 Players), a falling minor phrase when your fighter loses.
Being hit makes a phone buzz and a gamepad with motors rumble (your own heavy
blows give a light rumble too), where the browser allows it. Hints and the
moves card name a controller's own buttons: Xbox letters, PlayStation
symbols (✕ ○ □ △, L1, R1) or Nintendo letters (whose A and B, X and Y sit
the other way round), read from the name the browser reports; with a
controller connected, the help's controls table names its buttons too. A controller
that arrives is greeted with a short notice (how to use it in the menus,
and that Start pauses); one that is unplugged in the middle of a fight
pauses it, so nobody is beaten while reaching for a cable (an online fight
cannot pause and only says so). On the pause screen the music steps back
and the heartbeat, the crowd and the weather go quiet.

- You walk in any direction. Attacks turn you towards the nearest rival, so
  aim does not have to be exact.
- **Punch three times** for a combo that ends in a knockdown; each punch has
  to land for the next to come out.
- **Punch, punch, kick** ends the string in a **launcher**: a rising kick
  that throws the rival up into the air instead of down (12.5 upward speed,
  kept close). A launcher that lands can be cancelled straight into a jump
  by holding jump, and the launched rival can be struck **twice more** in
  the air before landing (a **juggle**; each juggle hit pops them up a
  little). Punch, punch, kick, jump, air punch works with taps alone.
- **Punch, kick**: a punch that lands flows into a **hook kick** swung round
  at the head that spins the rival round, back to you (7 damage).
- **Air string**: an air punch that lands can be followed in the same jump by
  kick, an **axe kick** chopped straight down that knocks over (7).
- **Flying knee**: jump out of a run (about eight ticks of walking, the stick
  still held at take-off) and kick: the knee drives on along the run, fast
  and far, and knocks down (9). From a standing jump kick is still the
  flying kick. The CPU uses all three (hook from its strings, the axe kick
  as often as it punishes, the knee when closing in); measured with them in:
  duels 47-53 %, brawl firsts 16-20 %, ladder 100 / 81 / 61 %. The Tutorial
  teaches them (Combos: hook kick and air string; On the run: flying knee).
- **Four new fighters** (the alliance's Meru, Gleh, Kichta and Zelrith),
  each with an original design: build, colours and costumes, a special
  (sharing a kind with an older fighter, under its own name), a finisher of
  their own with its own cut-in scene (an iron shield cracking with light, a
  crescent moon in a rain of light, gold slashes across the screen, a rising
  sun), a signature move, a celebration, a taunt line and a winning quote.
  Each has poses of their own for the finisher and the signature move
  (Meru's shoulder charge, hammer blows and two-fisted slam; Gleh's bow drawn
  in the air and a somersault over the rival; Kichta's cuts on a new line
  every other tick and a rising slash; Zelrith's spread-eagle climb and a
  spin across the floor).
  Their specials share a kind with an older fighter's but are drawn their
  own way (`special.style`): Meru charges behind a raised forearm, Gleh
  draws and looses an arrow, Kichta's leap is a rising slash, Zelrith flings
  the arms wide and claps.
  Their portraits are the members' avatars, cut to the face inside each
  avatar's frame (art/fighters, heads by scripts/crop-heads.py). With eight fighters the Arena and the
  Arcade draw rivals in a new random order each time. Balanced across all
  eight by CPU duels: 47-55 %.
- **Signature moves**: grab with no rival within throw reach (100) is the
  fighter's own move for crossing the gap - Ruko's **Wolf Leap** (a leap
  that rakes down with the claws, 7), Shadow's **Shade Step** (sinks into
  the shadows and rises at the rival's back, no blow of its own), Jackie's
  **Belly Bump** (a barge that shoves the rival far, 6), Pixie's
  **Cartwheel Kick** (untouchable as it starts, 7). Up close grab is the
  throw as before. The CPU uses them to close in; taught in the Tutorial
  (Guards). Pixie 101 -> 99 health (duels 48-54 %, brawl firsts
  15-24 %).
- **Air specials**: special pressed in the air (same cost) is each
  fighter's own air version: Ruko **rushes** diagonally down at the rival
  (11), Shadow throws the **bolt angled down** (10, it flies until it meets
  the floor), Jackie drops in a **body press** whose landing floors everyone
  close (12), Pixie **twirls** in a spiral of flame that strikes all round
  (11). Landing after one takes 12 ticks. The CPU uses them as often as it
  punishes; taught in the Tutorial (Specials). Health: Shadow 101, Jackie
  114, Pixie 101 (duels 48-52 %, brawl firsts 14-23 %).
- **More combo routes**: the lunging straight now opens the hook kick too
  (run, punch, kick); a **stomp** that lands bounces its victim off the
  floor, open to one more blow in the air; and a blow that lands can be
  **cancelled into the special** at once (punch or kick, then special while
  it lands, energy allowing). A cancelled special hits at 60 % and staggers
  instead of flooring - the first version, with full damage and the
  knockdown, let Ruko's rush land every time (67 % of duels), and the CPU
  cancels only now and then. Taught in the Tutorial (Specials). Duels
  46-53 % with all of this.
- **Throw escape**: grab pressed by the one seized within nine ticks of
  the throw (about a fifth of a second after the seize, its pause included)
  breaks it: both are pushed apart and stagger for 12 ticks, the thrower six
  more. Pressed later the throw lands as ever. The CPU escapes as often as
  it manages a perfect guard (never on Easy); taught in the Tutorial
  (Getting up, against the partner who throws you).
- **Taunt**: block held and grab pressed, standing still: each fighter's
  own gesture (Ruko's howl at the sky, Shadow's folded arms, Jackie's sumo
  stamp, Pixie's wave) and line ("Awoo!", "Too slow.", "Hmph!", "Catch
  me!") for 40 ticks, earning 14 energy at the end - but any blow landing
  during it is a counter hit. The CPU taunts now and then over a floored
  rival; taught in the Tutorial (Specials). Shadow 105 -> 103 health
  (duels 49-52 %, brawl firsts 14-22 %).
- **Ring bounce**: a fighter knocked down into the ring of fire (scorched
  for 5 as before) now bounces back off it towards the middle, popped up
  into the air and open to **one more blow** before landing (BOUNCE!); one
  still on their feet is held in the stun 10 ticks longer. Cornering a
  rival pays. Duels 46-53 %, brawl firsts 14-22 % with it.
- **Back-step**: block with the stick pointing straight away from the
  nearest rival is a quick hop back instead of a roll - over sooner (10
  ticks and 3 to settle, against the roll's 15 and 7), safe for fewer
  ticks (7 against 11), still facing the rival, and far enough to leave a
  kick's reach. Sideways or forwards it is the roll as before. The CPU hops
  back now and then instead of guarding; taught in the Tutorial (Defence).
  Duels 46-53 %, brawl firsts 17-22 % with it.
- **Hold kick** to charge it: after eight ticks the kick coils (the knee
  drawn up, glowing, open to any blow) and, let go (no sooner than eight
  ticks, on its own at forty), it becomes the **guard-breaker**, a driving
  side kick. On an open rival it lands for 12 and knocks down; on a guard it
  does no damage but **smashes the guard open** (GUARD BREAK!), leaving the
  rival reeling for half a second. A perfect guard still turns it away. A
  tapped kick is the kick as ever. The CPU charges it now and then against a
  guard; taught in the Tutorial (Guards). Duels 48-52 % with it.
- **Kick, kick**: a kick that lands flows into a spinning **roundhouse**
  that steps in after the rival and knocks down. The lunge also opens the
  punch string, so running punch, punch, kick launches too.
- The CPU finishes strings as reliably as it punishes (easy rarely, boss
  nearly always) and chases its launchers into the air. Measured with all
  of this: duels 47-53 % after Jackie went 117 -> 112 health and Ruko
  102 -> 105 (combos favoured the heaviest hitter: Jackie had reached 60 %).
- **Moving attacks**: after about eight ticks of walking, punching with the
  stick still held gives a **lunging straight** (leaps about 50 units in from
  outside jab range, 7 damage, chains into the second punch) and kicking gives
  a **slide** (feet-first along the floor, 6 damage, sweeps the rival down,
  but low enough to be jumped and slow to recover). A single step still gives
  a plain jab or kick, so close-range play is unchanged.
- **Out of a dodge roll**: punch or kick from the eighth tick of a roll
  (once it has done most of its travelling) comes out of it as an attack:
  punch springs up into a **rising uppercut** that knocks down (8 damage),
  kick whips round into a **spinning heel kick** with a wide arc (7 damage,
  a full turn on the spot). Both are slow to recover, so a roll that strikes
  at nothing is punished.
- **Getting up**: punch or kick from the fourth tick of the getup is a
  **rising sweep**, a low turning kick with a hand on the floor (7 damage,
  pushes the rival away). Nothing can hit it while it starts, so it breaks a
  rival waiting over you, but it recovers slowly if guarded. Measured: the
  CPU tries these about once a knockdown or a roll at most, and they shift
  no fighter's duel rate outside 47-55 %.
- **Throw** has its own button (GRAB on a phone, `M` / `V`, the right stick
  on a pad), so it can be done while moving with one thumb on the stick; punch
  and kick pressed together (within 3 ticks) still work on a keyboard. It is a
  real throw: the rival is seized, lifted, swung head-first over the thrower's
  head and slammed down behind (about half a second), then slides away on the
  floor. Short reach and open if it misses, but it goes straight through a
  guard. In a brawl a blow on either fighter breaks it: the thrower lets go
  and the rival drops unhurt. Measured: duels 45-53 %, brawl firsts 14-24 %
  (Jackie at the top), the CPU ladder 100 / 77 / 68 %; a wider punch-then-kick
  window was tried and cut to 3 ticks, because it turned deliberate punch-kick
  into misses and cost the fastest CPU a sixth of its wins.
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
  leaves its owner reeling long enough to punish (three stars circle the
  reeling fighter's head until it is over). The guard must have been
  down for a third of a second first, so hammering the button earns nothing,
  and a guard that is simply held is an ordinary block. The CPU manages it
  rarely on Normal, more often on Hard, and the arcade boss most of all.
- **Each fighter has a finisher of their own**, a chain of stages in the
  rules (a stage that lands flows into the next; a guarded one stops it),
  worth about 30 when it all lands, with its own poses, effects and a
  camera that closes in while it plays out:
  - Ruko, **Red Moon Howl**: a rush; then a flurry of claws (four quick
    hits) and an uppercut that throws the rival up to the moon.
  - Shadow, **Total Eclipse**: vanishes (cannot be hit, not drawn), reappears
    behind the rival and strikes, a shadow flurry, a turning kick that sends
    them flying. A guard already raised turns to meet it.
  - Jackie, **Avalanche Charge**: a sumo charge that leaves the rival reeling,
    a leap aimed to come down on them and a belly-first crash that floors
    everyone close by.
  - Pixie, **Phoenix Dive**: soars up inside a pillar of flame (hitting
    whoever is close), then dives on the rival and bursts on the floor - a
    close-range finisher; the CPU waits until it is near to use it.
  Each one is staged as well: during the freeze before it, behind the name
  cut-in, Ruko's **red moon** rises, Shadow's **eclipse** darkens the sky
  in a purple corona, Jackie's **avalanche** of snow and rock pours down a
  shaking screen, and Pixie's **bird of flame** climbs, wings beating -
  each with its own synthesized sound (a wavering howl, a hollow drone, a
  long rumble, a roar of flame). The **last blow** of every finisher holds
  the world still a moment longer (22 ticks) while the camera swings in
  tight on the one it lands on, the edges darken and speed lines burst
  from the centre, with a crack and a deep boom (all cued by the rules, so
  online guests see the same moment).
  Measured: Pixie's first version won 77 % of duels (its climb homed in and
  its dive always landed), so the climb drifts less, the dive is slower and
  lighter; Ruko 105 -> 108 and Pixie 102 -> 99 health. Duels now 49-52 %,
  brawl firsts 13-22 % - the closest the four have been.
- **Finishers in a brawl** follow the same script as in a duel:
  - A bug made them far stronger with four in the ring: the pause of a blow
    holds only the two fighters involved there, and a flurry held on a tick
    struck again on that same tick for as long as the rival stayed in reach
    (up to 20 hits where 6 were meant; finishers made a third of some
    fighters' damage). A flurry now strikes once per tick of the move: a
    finisher is worth the same in both modes (a test compares them).
  - A finisher that has **landed stays on its victim** instead of turning to
    whoever has come nearest, and **is not broken by the others**: their
    blows hurt (UNSTOPPABLE the first time) but the chain goes on, and a
    throw finds no hold. Its victim, another finisher or a knockout blow
    still stop it; before it lands any blow does.
  - A finisher's **flurry never knocks out** (in a duel either): the rival is
    left on 1 health for the last blow, so a finisher that wins the round
    always ends on its closing shot.
  - Gleh's **Crescent Rain shares its five arrows** among the rivals in
    range, nearest first (all five on the one rival of a duel; 5 each).
  - Balance re-measured over every line-up of four (560 brawls, 70 line-ups)
    as well as the duels: the fighters who lived off the bug (Pixie, Kichta)
    fell to 11 % of brawl wins and Jackie rose to 26 %, so: the flurries and
    last blows of Shadow, Meru and Kichta reach wider (several rivals at
    once), Avalanche and Sunburst crash on a smaller circle (120 and 115),
    Last Oath on a wider one (150), and stats moved - Ruko 0.97 power / 110
    health, Jackie 1.1 power, Pixie 0.93 / 104, Meru 0.97 / 112, Kichta
    0.95 / 97, Zelrith 1.09 / 105. Now: duels 48-53 % for all eight, brawl
    wins 15-23 % each (they were 13-29 %), ladder 100 / 74 / 61 %, boss
    beats Hard 90 %.
- **Riposte**: punch within 16 ticks of a perfect guard is a riposte, a palm
  strike driven in while the rival is still open (9 damage, quick, RIPOSTE!
  on screen). It leaves them reeling long enough to follow with a string,
  and can be cancelled into a special. A shot turned aside gives no riposte
  (there is nobody in front to strike). The CPU answers with it as often as
  it punishes.
- **Rolling rise**: block held with a direction while getting up rolls that
  way out of the rise (the same roll, nothing can hit it for most of it).
  The CPU does it now and then with a rival close, never towards the fire.
  Both are taught in the Tutorial (Defence: Riposte; Getting up: Rolling
  rise), listed in the pause screen's Defence tab and the help, and each
  step is played by a scripted player in the tests. Measured with them in
  (Gleh 1.05 power / 105 health, Jackie 1.08 / 112, Crescent Rain's arrows
  back to 6): duels 47-54 %, brawl wins 15-24 % (1120 brawls), ladder
  100 / 73 / 58 %, boss beats Hard 88 %. 91 tests.
- **Kick, punch**: a kick that lands flows into a stepping **elbow** (6)
  that closes the gap the kick opened and keeps the rival reeling; from it
  punch floors them (the third punch of the string) and kick launches. Kick,
  punch, kick, jump, air punch is a juggle off a kick. And **kick right after
  a perfect guard is the launcher at once**. The CPU uses both; the Tutorial
  teaches the elbow (Combos) and names the launcher beside the riposte.
  Measured over larger samples (the elbow cost slow Jackie eight points of
  duels at first): Jackie back to 1.1 power / 114 health, Ruko 108 health;
  duels 46-53 %, brawl wins 15-25 %, ladder 100 / 70 / 55 %, boss beats
  Hard 88 %. 92 tests.
- **Zelrith is a boy**: the skirt and the ponytail were part of the slim
  build; they are now `gear` (Pixie and Gleh wear them) and Zelrith fights in
  trousers with a scarf. The result screen no longer draws the energy bars
  under its card.
- **Online rooms no longer lose a player who changes fighter or costume a
  few times**. Every change was published as a presence update, and the
  realtime service silently closes the channel of a member who sends more
  than about five of those in a few seconds (measured: the sixth within ten
  seconds closes it, with no error; one every seven seconds is fine). From
  then on nothing that player chose reached the room, their own screen
  stopped following, and the host no longer listed them. Now presence only
  says who is here (published once, on joining) and each member's state -
  fighter, costume, ready, arena - travels as ordinary messages: sent on
  every change, again when someone new arrives, and every 20 seconds in
  case one was lost; a member whose messages are heard counts as here at
  once (presence can lag by seconds), a goodbye is sent on leaving, and
  your own panel follows your choice without waiting for the echo. Checked
  against the live service: eight changes, then twelve in six seconds, a
  latecomer who sees everyone's current choice, leaving (0.1 s) and closing
  the tab (3 s), and a full match.
- **The online lobby upright, and the room sideways, put right**: a fresh
  look at every screen at 568x320 and 360x640 found the lobby broken on a
  phone held upright - its two lists (who is online, the rooms) were
  squashed flat (a share of the height meant for side by side) and Quick
  match lay over the message box; they now take their own height. And in a
  room on a small phone held sideways, Send ran into the arena picker: the
  picker is narrower there and the message box keeps to its column. Neither
  showed as overflow, so the screen walk now also reports controls cut off
  at the sides (cut) and controls lying on top of each other (lap): it
  flags the old lobby (lap3) and the old room (lap1), and nothing now.
- **Names readable in a room held upright**: with four players in a room on
  a phone held upright, the fighters' list is a narrow column and the
  host / ready / choosing tag left one letter of each name ("B", "C"). The
  tag now sits under the name, so names keep the whole width. The online
  screens check (four players; name, lobby, room as host and as guest)
  now runs at ten sizes, upright too, with the cut and lap checks: all
  clean.
- **EX air special**: in the air, special and punch together (or a beat
  apart, either way round) with two thirds of the energy bar give the EX
  version of your air special - nearly half as much damage again, a
  golden burst, and it shrugs off one blow as it starts, as on the ground.
  The CPU on Hard and Boss uses it now and then; the Air combos lesson
  (energy bar full) teaches it. Names over a fighter in the air now float
  above where they are, not on their head.
- **Long names online**: names of up to 14 letters (the most allowed) used
  to wrap onto three lines in a room held upright, with the host / choosing
  tag drawn over them, and in the lobby on a small phone held sideways they
  pushed the fourth player out of sight. A long name is now cut short with
  an ellipsis (the whole name shows on hover), with "(you)" and the wins
  always beside it. And in an online fight of four, the players' names on
  the scoreboard ran into the points and the next player's panel: the
  fighter's name shrinks a little, then the nickname is cut short. Checked
  with four 14-letter names at every phone size, upright and sideways.
- **After an online fight, on a phone held upright**: a fresh check of the
  whole round trip (four long names: room, fight, result card, back to the
  room, a chat message from each) found three faults. The result card's
  numbers broke one word per line beside the nicknames: the nickname now
  sits over the points. Back in the room with some chat, "Exit full screen"
  and the "still ready" note, the room ran 40 to 140 px past the screen:
  its buttons now go two by two at any height, the fighter's bars are left
  to the fighter screens, and the chat keeps to a few lines. And a message
  sent stayed in the box: sending redraws the room at once and the redraw
  carried the box's text over - it is now emptied before it is sent.
- **Chat checked on the live service, and a room's buttons on a small phone
  held sideways**: two players in their own room each sent messages on the
  real online service: every box emptied, both saw every line, and half a
  message typed while the other spoke was kept. After a fight on a small
  phone held sideways (568x320 to 667x375) the room's four buttons (Leave
  room, Copy invite link, Exit full screen, Start fight) each broke onto
  two lines; they keep to one now, still big enough for a thumb.
- **Guard sweep**: with the guard up and standing still, kick drops into a
  low sweep - a hand on the floor, the leg swung at the ankles. It goes
  under an ordinary guard and floors whoever it catches: the answer to a
  rival who hides behind a guard (high or low now, as well as the throw and
  the guard-breaker). A jump or a perfect guard beats it, and it is slow to
  start and to recover. The CPU on Normal and up sweeps a guard now and
  then and jumps a sweep it sees coming; the Guards lesson teaches it (the
  taunt moved to Defence); help, pause list and a tip explain it.
- **The guard sweep on a phone, and texts in a crowd**: hold BLK and tap K
  with a second finger - checked with real multi-touch at three phone
  sizes, and the touch help now says so. The sweep checked in 3D too (low,
  the leg at the rival's feet). In a busy brawl the floating texts (damage,
  COUNTER, a special's name, the hits) landed on top of one another: each
  is now lifted clear of those already there, and stays put.
- **The arena fills a phone held sideways**: a phone is wider than 16:9, so
  the fight sat between two black bars with the touch controls on them.
  In 3D the arena now reaches to the screen's edges (the crowd and the
  torches at the sides): the canvas grows evenly round the 16:9 stage and
  the camera keeps the stage's view exactly as it was, only adding to the
  sides, so the scoreboard, the name tags and every hit mark stay where
  they were. Upright, and in the flat 2D view, nothing changes.
- **Names over a fighter clear their tag**: the special's name (and the
  signature move's, and the taunt's line) floated at the height of the
  YOU / CPU tag on top of the head and covered it (seen in 3D at 844x390);
  they now set off above it - higher over the sumo build - and drift up
  only a little (0.35 px a frame instead of 0.9), never above y 104, so
  they stay under the scoreboard too (floatText takes `rise` and `top`).
  Seen in 3D with Gleh, Kichta and Jackie.
- **An EX special looks the part**: as it sets off, two rings are thrown
  out round the fighter - gold, and the fighter's own glow - with a spray
  of sparks and a flare of sound (fx.js exBurst), besides EX before its
  name and the brighter glow. UNDER THE GUARD! seen on screen on a slide
  into a held guard. Gleh's duels on a larger sample: 47 % (weak against
  the quick fighters, the strongest in brawls at 23 %: a zoner's profile);
  the slide is not among the twelve moves that deal the most in a brawl.
- **High and low: the slide goes under a guard**: the slide is a low blow
  (`low`): an ordinary guard does not stop it (UNDER THE GUARD!), a
  perfect guard still does, and a jump or a roll gets out of its way. The
  CPU jumps a slide coming at it as often as it guards (no slide is guarded
  between CPUs any more; 0.46 still land a duel). Taught in the Tutorial
  (Guards: Under the guard, against the partner who keeps a guard up), in
  the pause list (On the run) and the help; a rules test (109). Duels
  45-53 %, brawl wins 16-23 %, boss beats Hard 93 %. The EX special was
  also seen on screen in 3D (EX IRON CHARGE, 19 against the plain 14).
- **EX special**: special and punch together (or a tick apart, either way
  round) with two thirds of the energy bar is the EX version of the
  fighter's special: it costs 70 instead of 35, hits 45 % harder (a shot
  from afar 20 %), burns brighter, shows EX before its name, and shrugs off
  the first blow that lands on it as it starts (EX ARMOUR; a throw, a
  finisher or a knockout blow still stop it). The CPU uses it now and then
  (Normal and up; never with the finisher's full bar): about 1.7 a duel
  against 10 ordinary specials. Taught in the Tutorial (Specials: EX
  special; the taunt moved to Guards so no lesson goes over six steps), in
  the pause list (your fighter) and the help; a rules test (108). Measured
  with and without the CPU using it: the duel spread barely moves; Jackie
  117 health, Gleh 1.02 power. Duels 46-53 %, brawl wins 15-21 %, boss
  beats Hard 93 %. Every screen and the pause tabs fit; online local OK.
- **Result cards with four fighters, measured with the longest names**: the
  Arena's result with Zelrith, Kichta, Jackie and Shadow as yours (random
  rivals) at 568x320, 640x360, 740x340 and 360x640, and the arcade played
  through at six sizes: the arcade's brawl standings overflowed 640x360 by
  30 px - rows are slimmer on any phone held sideways - and with the record
  line in a brawl card on a short screen, the rows' numbers (all zero by
  then for the rivals) give way to it.
- **The arcade on a phone, played through**: every stage won in turn at
  568x320, 360x640, 740x340 and 844x390, with each result card measured.
  Two fixes: the "New on your Record" notice sat over the result card's
  title (STAGE 3 CLEARED was hidden for five seconds) - it is now a gold
  line inside the result card itself (a corner was tried first, but in the
  Arena the Rematch button is there); and the brawl stage's
  standings overflowed a 568x320 screen by a few pixels (smaller faces, a
  smaller headline and tighter rows below 345 px of height).
- **Touch controls, two fingers at once, checked**: with real multi-touch
  events (two fingers down together) on the on-screen buttons at 844x390,
  568x320 and 390x844: block held and grab tapped is the taunt, the stick
  and block the roll, kick held the guard-breaker, punch then special the
  special cancel. Every button follows its own finger; the help now says
  so. And live: a player who changes fighter seven times in a room shows,
  to someone watching the lobby, the last one picked.
- **Two buttons pressed a moment apart, checked**: after the roll, every
  other two-button move was tried with the second button 0, 2, 4 and 8 ticks
  late: the taunt (block held, then grab) comes out however late the grab;
  punch and kick within two ticks are the throw, later the punch-kick string
  (as designed); the back-step has the roll's six ticks. Nothing else to
  fix. The roll's lift was raised a little (36 -> 42) so that in the flat
  view the head no longer goes through the floor at the top of the turn.
  Zelrith's new look checked on the result screen and in the ritual.
- **Rolling, fixed twice over**: block and a direction pressed a moment
  apart (the direction a few ticks after the guard, as a thumb or a finger
  does) now still rolls - within six ticks of raising the guard (a test);
  a guard held longer stays a guard. And the roll is drawn turning about
  the hips: it turned about the feet, so halfway round the body sank into
  the floor and only a foot showed (seen in 3D frames); its lift now
  follows the turn and is not smoothed away. The help checked at phone
  sizes: no sideways overflow, the newest lines readable. 107 tests.
- **Combos split in two**: the Combos lesson had grown to nine steps, so it
  keeps the ground strings (launcher, kick string, kick-elbow, hook kick,
  backfist) and a new **Air combos** lesson takes the juggle, the air
  throw, the hammer fist and the air string. Eleven lessons, none over six
  steps (a test). Progress already saved is kept: a step is found by its own
  id wherever it was saved (ids are unique across lessons, also tested), so
  a juggle done under the old Combos shows as done in Air combos. The list
  of eleven fits at the seven phone sizes.
- **Hammer fist**: a flying kick that lands flows, with punch, into a hammer
  fist - both hands brought down on the rival's head (6) - that bounces
  them off the floor for one blow more, as the stomp does. The second air
  string beside the air punch and axe kick. The CPU follows a flying kick
  with it as often as it punishes (a third of a duel's worth: 0.33 a duel).
  Tutorial step (Combos: Hammer fist) with a scripted player, the pause
  list (Air), the help, a pose, a rules test. Duels 47-53 %, brawl wins
  16-21 % (the closest yet), ladder 100 / 73 / 64 %, boss beats Hard 93 %.
- **On a phone held sideways, the combo counter sits up by the timer**:
  with the on-screen controls over the bottom corners it was drawn under
  the stick or the SP button and could hardly be read (seen at 568x320).
  It now goes up near the timer, on the attacker's side, clear of the
  lesson panel too. The Tutorial's fire lesson is called **Fire** (its
  button took three lines at 740x340) and was played through in a browser
  at 844x390 with the keyboard.
- **Fire toss**: a throw of a rival standing within 120 of the ring of fire,
  with the flames beyond them (the thrower facing the fire through them),
  flings them forward into it instead of over the head: the throw's 10 and
  the burn's 5, and they bounce back off the flames, open to one more blow
  (INTO THE FIRE!). Elsewhere, or with the fire behind the thrower, the
  throw is as before. The CPU tosses a rival it finds by the fire. A new
  Tutorial lesson, **Fire** (the ring was taught nowhere): a partner
  who waits by the flames, and two steps - drive them in with a kick, and
  the fire toss - each played by a scripted player in the tests. Pause list
  (Basics), help, a menu tip and a rules test (104). With ten lessons the
  Tutorial's list takes four columns on a wide phone held sideways and
  slimmer buttons on a short one: every screen, the pause tabs and all 18
  tips still fit at the seven phone sizes. Duels 48-54 %, brawl wins
  14-22 %, ladder 100 / 73 / 63 %, boss beats Hard 94 %.
- **Online, a dropped connection in the middle of a fight**: could not be
  reproduced here - two browsers on one machine keep their direct link
  when one goes offline - so the fight simply carried on; still to be seen
  on real phones.
- **The newer four's rituals sound their own**: Meru's fist rings on an
  iron breastplate, Gleh's bowstring twangs, Kichta's blade hand hisses
  through the air twice, Zelrith's spins whistle and the bow ends on two
  bright notes (they borrowed a thud, the bolt, the swing and the clap). A
  test checks that every sound a ritual asks for exists - an unknown name
  would only be silent.
- **Online rooms survive a dropped connection**: checked against the live
  service, a guest cut off for 15 s or for 65 s comes back into the room on
  their own, and what they pick afterwards reaches the host.
- **Ruko in brawls, looked into**: Ruko is no more crowded than anyone
  (about one rival within reach on average, as everyone), the dash and the
  Wolf Leap do not leave Ruko in the middle of the pack, Ruko goes out
  first in a round as often as the others (24 %) and scores as many points
  a brawl; the 13-16 % of brawl wins is about two standard errors from an
  even share. No change made.
- **Air throw**: grab in the air with a rival in the air close by (jumping,
  or launched) seizes them and drives them head first into the floor (11,
  unblockable, the thrower springs off them); with the rival on the ground
  grab is still the stomp. Punch, punch, kick, jump, grab is a juggle that
  ends in a throw. The CPU throws a rival who jumps alongside as often as it
  punishes, and ends some juggles with it (a rare sight: about one duel in
  twenty). Taught in the Tutorial (Combos: Air throw) with a scripted
  player, in the pause list (Air) and the help; a pose of its own, AIR
  THROW! on screen, a rules test (101). Duels 47-53 %, brawl wins 13-23 %,
  ladder 100 / 72 / 61 %, boss beats Hard 93 %.
- **A rush is stopped only by the rival it is after**: an aimed finisher (a
  rush or a leap: everyone's but Pixie's, Gleh's and Zelrith's, which rise
  first) sets out after the nearest rival, and from that moment, in a brawl,
  only that rival, another finisher or a knockout blow can stop it; the
  others' blows hurt but do not (UNSTOPPABLE), as once it has caught someone.
  The CPU leaves such a fighter alone. In a brawl the rushers were struck out
  of their finishers on the way in a third of the time and more (Meru 40 %)
  where the risers were 12-14 %: now Meru 35 %, Ruko 27 %. Duels do not
  change (no third party): 48-53 %. Brawl wins 15-21 % on one seed, 15-25 %
  on the other (Ruko still lowest, 15-16 %). 100 tests.
- **The hook kick has enders**: punch, kick, punch is a **spinning
  backfist** to the back of the turned rival's head that floors them (7);
  punch, kick, kick is the launcher. The CPU strings them like the others;
  the Tutorial teaches the backfist (Combos), with a scripted player in the
  tests, and the pause list and the help name both.
- **Dashers save for the finisher in a brawl**: the CPU spent Ruko's and
  Meru's energy on dash after dash and reached about two finishers a brawl
  where everyone else reached three or four. Past 64 energy in a brawl a
  dasher now holds on for the full bar: 3.6 finishers a brawl. (Their brawl
  wins hardly moved, 15-16 %: watch.) With the backfist in, Jackie rose to
  55 % of duels: Jackie 1.07 power, Ruko 0.99 power / 110 health. Duels
  48-53 %, brawl wins 15-23 %, ladder 99 / 74 / 61 %, boss beats Hard 93 %.
  99 tests.
- **The room's roster is tested on its own**: who is here and what each
  member last chose is now `client/src/net/roster.js`, with no network in it,
  and `tests/roster.test.js` runs it against a pretend service with the real
  one's two awkward habits (presence that must not be updated in a row, and
  presence news that arrives late): a burst of changes that never touches
  presence again, a latecomer who sees everyone's current choice, a member
  who counts as here from their first message, goodbyes, a tab that just
  closes, silence, lost messages made good by the repeat and the 20-second
  beat, and rubbish on the channel. A goodbye now holds until presence
  agrees (presence can go on listing a closed tab for most of a minute), and
  a page says goodbye on its way out: measured on the live service, the host
  sees a player leave in 0.1 s (button), 0.2 s (tab closed) or 2 s (another
  page), where a closed tab could take 55 s.
- **The boss stands clearer of Hard** (it guards perfectly and punishes more
  often): in mirror duels it wins 63 % (it had slipped to 55 %); the arcade
  boss beats Hard 93 %. In a brawl the pack goes for whoever has **the most
  health left**, not the fullest bar, so the big fighters draw it: over 2240
  brawls Jackie's wins fall from 25.5 % to 21 %, everyone within 14-22 %.
  98 tests.
- **Reading an unstoppable finisher**: a finisher that has caught its rival
  burns brighter from that moment, and the CPU (Normal and up) turns to
  someone it can stop instead of wasting blows on it. Avalanche's crash
  circle 120 -> 95 with that in (Jackie led the brawls): duels 48-53 %,
  brawl wins 15-24 %.
- **On a phone**: with the on-screen controls lying over the arena's bottom
  corners (held sideways), a duel's energy bars are drawn under the names at
  the top instead of under the stick and the buttons, where they could not
  be seen. Held upright, the Tutorial's lesson panel was cut off by the
  arena's box and never shown: it now hangs below the arena, with room of
  its own above the controls.
- Hits fill the **energy** bar: a special costs 35 of 100, the finisher needs
  it full. Under a quarter of their health a fighter is in their **last
  stand** (LAST STAND on screen with a deep drum, the body pulsing red, the heartbeat, and
  the music pushing harder when it is your fighter): the bar fills half as
  fast again. Measured over 600 CPU rounds, rounds won from 30 points of
  health behind went from 11.6 % to 14.8 %.
- **Block** only stops what comes from the front, and a blocked hit can never
  knock you out. Raising the guard turns it towards the rival who is already
  swinging, not just the nearest one, so in a brawl it faces the real threat
  (blows landing from behind on a guard fell from 21 % to 14 % in CPU brawls,
  with every fighter still winning 15-22 % of arena matches). While a fighter blocks, an arc on the floor shows what the
  guard covers; it flares during the last moments in which a block would be
  a perfect guard, so the timing can be seen as well as felt.
- **Jump** over a ground stomp. A fresh press of jump in the air is a
  **double jump** (once per jump, from the fourth tick, about 1.6 times as
  high in all, opened by a forward somersault); holding the button is not.
- **In the air each button is its own move**: punch is a quick **diving
  punch** angled down (7 damage, starts in 3 ticks), kick the heavier
  **flying kick** (9 damage), and grab - or punch and kick together - a
  **stomp**: a short hang, then a plunge feet first that knocks down whoever
  it lands on (10 damage) but roots the stomper for 14 ticks if it misses.
  The CPU double-jumps now and then and stomps a rival found right below.
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
  Rooms with a free place are listed first. Next to each name in the lobby
  are the fights that player has won, all time (from their device's Record).
- A **room** holds up to four fighters (more can watch). Everyone picks a
  fighter and presses Ready; the host starts the fight, optionally filling the
  empty places with CPU fighters. Two fighters play a duel, three or four an
  arena brawl. After a fight that finished, everyone who fought stays ready,
  so one more is a single press for the host; anyone who wants to sit the
  next one out presses Not ready. The room keeps score: each player's fights
  won there show next to their name, and the result screen says who leads
  ("In this room: Ana 2 · Beto 1"). Each screen counts from the results it
  sees, so the score starts from the fights you were there for.
- The lobby and every room have a **chat**. Messages reach whoever is there at
  that moment and are not stored anywhere. A soft two-note chime sounds for
  a message from someone else, and a rising one when someone joins your
  room (not during a fight), so neither goes unnoticed on a phone.
- If the **host** leaves or reloads, the room carries on: the next player in
  it becomes the host (a fight already under way ends for everyone).
- **Copy invite link** in a room gives an address ending in `#room-ABCD`;
  whoever opens it only has to type a name to land in that room. While you
  are in a room its code stays in your own address too, so a reload - easy
  to do by accident on a phone - brings you back with one press (your name
  is remembered), and the address bar is an invite as it stands. Leaving
  the room or going offline clears it.
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
- **On a phone the site can go on the home screen** (Android: the browser
  menu, Add to Home screen or Install app; iPhone: Share, Add to Home
  Screen). Its manifest and icons (`client/web`, copied into `dist-web` by
  the web build) open it full screen and sideways, like an app; Chrome
  reports it installable with no errors. On a touch screen the menu's tips
  suggest it, until the game is opened that way, and the menu then drops
  its Full screen link. On an Android phone, the menu's Full screen also
  holds the screen sideways while it lasts.
- The Supabase project needs no tables. On the free plan Realtime allows 200
  people connected and 100 messages a second, which is plenty while matches
  run over direct links, and about one four-player match at a time if every
  player has to be relayed.

A brawl's standings hand out up to three awards to whoever alone led
the way: **Heavy hitter** (most damage), **Combo master** (the longest combo,
3 hits or more) and **Iron guard** (most perfect guards) - so a fighter who
placed low but hit hardest still gets a word. Ties earn nothing.

## Your record

**Record** (at the foot of the menu) keeps a lifetime tally of your own
fights on the device: fights and wins, the best run of wins, the best
combo, perfect guards, damage dealt, online fights, your favourite fighter,
and fights and win rate with each fighter. Every finished fight counts
except Training and two players on one device. When a fight adds something
to it - a best run of wins, a best combo, or a round number of wins (10,
25, 50, 100...) - the result screen says so in a passing notice: "New on
your Record: 10 wins in all · best streak, 2 wins in a row".

## Settings

Around the arena there is life too, while the weather is calm: now and then
a bird's chirps in the daylight arenas (Dune Ruins and Blossom Terrace, first
two rounds) and a cricket's trill in the courtyard's night round - quiet,
under the fight.

An **announcer** calls the fight out loud - "Round one", "Fight!", "K. O.!",
"Ruko wins!" (in a brawl, "Shadow takes it") - using the browser's own
speech synthesis, so it is free and works offline; the voice is whatever
English voice the device has, pitched down. It follows the effects volume,
is silent when the sound is off, never speaks over the menu's demo fight,
and **Announcer: on/off** in Settings switches it off for good on that
device.

Every special move has its own sound, made in the browser like everything
else: Crimson Rush tears the air open with a rising whoosh, Twin Flame Spiral
crackles and climbs, Mountain Stomp heaves as the leg goes up and lands with
a deep boom, Storm Bolt charges and fires. A counter hit adds a dry crack.

Each arena has its own music, generated note by note in the browser: Ember
Courtyard plays a warm plucked tune in A minor at 116 beats a minute; Frost
Summit a colder one in D minor at 104, with a bell melody (a pure tone plus
the out-of-tune overtone that makes a bell sound like a bell), a hollow bass
and a high ice chime; Dune Ruins a desert tune at 98 that sways between E
and F - that half step is what gives it its colour - with a reedy lead;
Blossom Terrace the only one in a major key (G, E minor, C, D) at an
unhurried 92. Every tune is eight bars long: the second four answer the
first, with the lead on another rhythm, walking down the chord instead of
up, and closing on one long note before the loop comes round. All four speed up and fill out for deciding rounds and the last seconds of a
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

The knockout that ends a round plays in slow motion - a third of the speed
while the beaten fighter falls, then half, then full (cued by the rules, so
online guests see the same) - with a burst of light where they fall, and
the camera swinging round them, close in and low, before it turns to the
winner.

Music and effects have their own volume sliders (menu and pause screen),
remembered on the device, next to the sound switch, the touch-button switch
and the button arranger.

## Four arenas, and all live in time

Every select screen has a row that picks where the fight is held; the fight
playing behind the menus moves there at once, so the choice is a preview. The
device remembers it (on small screens the picker shows short names:
Courtyard, Summit, Ruins, Terrace). The places share the same floor, the same rules and
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
- **Blossom Terrace**: a red-lacquered terrace in a blossom garden below
  misty hills, plum banners. Round one on a clear morning, round two in a
  golden afternoon, round three in an evening wind that fills the air with
  pink petals, drifting slowly and swaying, over a soft wind.

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
knockouts, then settles back down. Part of the crowd came for one fighter:
each stretch of the stands, left to right, has supporters wearing the colours
of one fighter in the line-up, and they are the ones on their feet when that
fighter lands a heavy blow or wins a round (no extra draws: the crowd is one
batch either way). While each round is announced, a wave runs once round
the stands from left to right, about twenty fans on their feet at a time. Inside every round, the ring of fire shrinks the
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

1. Save their picture as `art/fighters/<id>.png` (the full picture is kept
   there, outside the page).
2. Add an entry to `shared/fighters.js` (copy an existing one): `head` is the
   circle cut from the picture (centre `x`, `y` and radius `r` in picture
   pixels); `build` is `standard`, `sumo` or `slim`; `gear` adds a `scarf`,
   shoulder `pads`, a `skirt` or a `ponytail`; `victory` is how they celebrate a won match (`howl`,
   `calm`, `stomp`, `cheer`, `salute`, `volley`, `sheathe` or `laugh`);
   `entrance` is their ritual while a round is announced (`prowl`, `bow`,
   `clap`, `swirl`, `oath`, `draw`, `flourish` or `twirl`); `quote` is their winning line (60 characters
   at most); `looks` are their costumes (the first is their
   own colours, the second names the colours it changes); `special.type` is `dash`,
   `bolt`, `rise` or `quake`; keep `stats` near 1.0.
3. Run `python3 scripts/crop-heads.py` (needs Pillow): it cuts each head
   square out of its picture into `client/src/fighters/<id>.png`, which is
   all the page carries - this halved the page, from 549 KB to 277 KB, with
   heads that look the same. A test fails if a picture and its head circle
   disagree.
4. `npm run build` and publish `dist/gd-arena.html` again.

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
as plain data in `client/src/render/themes.js` so Node can read them), the
CPU's difficulty ladder (`tests/ai.test.js`: in mirror duels Normal must beat
Easy, Hard beat Normal and the boss level beat Hard - over 160 duels each
step measured 100 %, 81 % and 67 %), the tunes' answering phrase (in
`tests/arenas.test.js`), what the announcer says (`tests/effects.test.js`,
with a fake speech engine), a brawl's awards (`tests/awards.test.js`), the website's home-screen manifest
(`tests/web.test.js`: it opens full screen and sideways, and every icon is
the size it claims) and online play
(`tests/online.test.js`). The
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
