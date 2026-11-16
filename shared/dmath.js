// Trigonometry that gives the same bits on every device.
//
// The rules must come out exactly alike in every browser for online play to
// run the fight on every player's device (rollback, see README). JavaScript
// fixes the result of + - * / and Math.sqrt to the last bit (IEEE 754, round
// to nearest), but leaves Math.sin, cos, atan2 and hypot to each engine's own
// library - Chrome, Safari and Firefox may differ in the last digit, and in a
// fight run for thousands of ticks a last digit grows into a different
// result. These are built from the exact operations only (series summed in a
// fixed order), and agree with Math's to about 1e-15.

const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;
// 2*PI split in two parts, so reducing a big angle loses nothing that matters.
const TWO_PI_HI = 6.283185307179586;
const TWO_PI_LO = 2.4492935982947064e-16;

// sin on [-PI/2, PI/2]: Taylor series to x^25, summed from the small end.
function sinCore(x) {
  const x2 = x * x;
  let t = 1;
  // coefficients 1/(2k+1)! for k = 12..1, nested (Horner)
  t = 1 - (x2 / (24 * 25)) * t;
  t = 1 - (x2 / (22 * 23)) * t;
  t = 1 - (x2 / (20 * 21)) * t;
  t = 1 - (x2 / (18 * 19)) * t;
  t = 1 - (x2 / (16 * 17)) * t;
  t = 1 - (x2 / (14 * 15)) * t;
  t = 1 - (x2 / (12 * 13)) * t;
  t = 1 - (x2 / (10 * 11)) * t;
  t = 1 - (x2 / (8 * 9)) * t;
  t = 1 - (x2 / (6 * 7)) * t;
  t = 1 - (x2 / (4 * 5)) * t;
  t = 1 - (x2 / (2 * 3)) * t;
  return x * t;
}

// Bring an angle into [-PI, PI].
function reduce(x) {
  if (x >= -PI && x <= PI) return x;
  const k = Math.round(x / TWO_PI_HI);
  return x - k * TWO_PI_HI - k * TWO_PI_LO;
}

export function sin(x) {
  if (!Number.isFinite(x)) return NaN;
  let r = reduce(x);
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  return sinCore(r);
}

export function cos(x) {
  if (!Number.isFinite(x)) return NaN;
  // cos x = sin(PI/2 - |x|), with |x| reduced first
  const r = Math.abs(reduce(x));
  const s = HALF_PI - r; // in [-PI/2, PI/2]
  return sinCore(s);
}

// atan on [0, 1]: halve the argument twice (atan z = 2 atan(z / (1 + sqrt(1 + z^2)))),
// then the series - small terms, quickly done.
function atanCore(z) {
  const a = z / (1 + Math.sqrt(1 + z * z));
  const b = a / (1 + Math.sqrt(1 + a * a)); // b <= tan(PI/16) ~ 0.199
  const b2 = b * b;
  let t = 0;
  for (let k = 21; k >= 1; k -= 2) t = 1 / k - b2 * t;
  return 4 * b * t;
}

export function atan2(y, x) {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  let a = ay <= ax ? atanCore(ay / ax) : HALF_PI - atanCore(ax / ay);
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}

// sqrt is exact in IEEE 754 (correctly rounded), unlike Math.hypot.
export function hypot(x, y) {
  return Math.sqrt(x * x + y * y);
}
