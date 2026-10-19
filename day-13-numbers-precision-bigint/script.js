// ============================================================
// DAY 13 — NUMBER PRECISION, IEEE-754, AND BIGINT
// ============================================================
// Run in a browser console, via index.html, or with `node script.js`.

console.log('=== SECTION 1: THE CLASSIC FLOATING-POINT SURPRISE ===');

// ------------------------------------------------------------
// 1. HAPPY PATH / FAMOUS PITFALL — 0.1 + 0.2 !== 0.3
// ------------------------------------------------------------
console.log('0.1 + 0.2 === 0.3:', 0.1 + 0.2 === 0.3); // false

// Ask for more decimal digits than the default console formatting shows,
// and the IEEE-754 rounding error becomes visible.
console.log('(0.1 + 0.2).toFixed(20):', (0.1 + 0.2).toFixed(20)); // '0.30000000000000004441'
console.log('(0.3).toFixed(20):      ', (0.3).toFixed(20));       // '0.29999999999999998890'
// Both are APPROXIMATIONS of their decimal literals, and they happen to be
// DIFFERENT approximations -- hence the inequality.

// The correct way to compare floats: tolerance-based equality, not ===.
function approximatelyEqual(a, b, epsilon = Number.EPSILON * 8) {
  // Number.EPSILON is the smallest difference representable between 1 and
  // the next representable double. Multiplying it gives headroom for
  // accumulated rounding error across a few operations -- the exact
  // multiplier is domain-specific, this is a reasonable general default.
  return Math.abs(a - b) < epsilon;
}
console.log('approximatelyEqual(0.1 + 0.2, 0.3):', approximatelyEqual(0.1 + 0.2, 0.3)); // true


console.log('\n=== SECTION 2: SAFE INTEGER BOUNDARY ===');

// ------------------------------------------------------------
// 2. HAPPY PATH — integers are exact UP TO 2^53 - 1
// ------------------------------------------------------------
console.log('Number.MAX_SAFE_INTEGER:', Number.MAX_SAFE_INTEGER); // 9007199254740991
console.log('That equals 2^53 - 1:', Number.MAX_SAFE_INTEGER === 2 ** 53 - 1); // true

// Within the safe range, integer math is exact.
console.log('MAX_SAFE_INTEGER - 1 is distinct:', Number.MAX_SAFE_INTEGER - 1 !== Number.MAX_SAFE_INTEGER); // true

// ------------------------------------------------------------
// 2b. COMMON PITFALL — one step past the boundary, +1 silently breaks
// ------------------------------------------------------------
const past1 = Number.MAX_SAFE_INTEGER + 1;
const past2 = Number.MAX_SAFE_INTEGER + 2;
console.log('MAX_SAFE_INTEGER + 1:', past1); // 9007199254740992
console.log('MAX_SAFE_INTEGER + 2:', past2); // 9007199254740992 -- SAME double!
console.log('past1 === past2:', past1 === past2); // true -- two different arithmetic results collapsed to one value

// A literal in source code can ALSO silently round at parse time.
console.log('9007199254740993 === 9007199254740992:', 9007199254740993 === 9007199254740992); // true
// The literal 9007199254740993 is not representable as a double, so the
// parser rounds it to the nearest representable value before your code
// ever runs -- this is not a runtime computation error, it happens at parse time.

// Number.isSafeInteger is the correct guard -- isInteger is NOT enough.
console.log('Number.isInteger(9007199254740993):', Number.isInteger(9007199254740993)); // true -- misleading!
console.log('Number.isSafeInteger(9007199254740993):', Number.isSafeInteger(9007199254740993)); // false -- correct signal


console.log('\n=== SECTION 3: BIGINT — ARBITRARY PRECISION INTEGERS ===');

// ------------------------------------------------------------
// 3. HAPPY PATH — BigInt has no upper bound and no precision loss
// ------------------------------------------------------------
const bigLiteral = 9007199254740993n; // the `n` suffix makes this a BigInt literal
console.log('typeof bigLiteral:', typeof bigLiteral); // 'bigint' -- a genuinely distinct primitive type
console.log('bigLiteral:', bigLiteral.toString()); // '9007199254740993' -- EXACT, unlike the Number version above

// Converting the safe-integer boundary into BigInt and going past it stays exact.
const exactPastBoundary = BigInt(Number.MAX_SAFE_INTEGER) + 10n;
console.log('BigInt(MAX_SAFE_INTEGER) + 10n:', exactPastBoundary.toString()); // '9007199254741001' -- exact

// BigInt can represent numbers far larger than any Number can represent exactly.
const huge = 2n ** 200n;
console.log('2n ** 200n:', huge.toString());
// '1606938044258990275541962092341162602522202993782792835301376' -- exact, arbitrary precision

// ------------------------------------------------------------
// 3b. COMMON PITFALL — BigInt and Number cannot be mixed in arithmetic
// ------------------------------------------------------------
try {
  const result = 10n + 5; // throws -- no implicit coercion allowed between the two numeric types
  console.log('unreachable:', result);
} catch (err) {
  console.log('10n + 5 threw:', err.constructor.name, '-', err.message);
  // TypeError: Cannot mix BigInt and other types, use explicit conversions
}

// The fix: explicit conversion, chosen deliberately based on which direction is safe.
console.log('10n + BigInt(5):', (10n + BigInt(5)).toString()); // '15' -- safe, both sides are BigInt now
console.log('Number(10n) + 5:', Number(10n) + 5); // 15 -- safe ONLY because 10n is small enough to convert losslessly

// ------------------------------------------------------------
// 3c. EDGE CASE — BigInt division truncates; it has no fractional concept at all
// ------------------------------------------------------------
console.log('3n / 2n:', (3n / 2n).toString()); // '1' -- INTEGER division, truncated toward zero, NOT 1.5
console.log('(-3n) / 2n:', ((-3n) / 2n).toString()); // '-1' -- truncation, not floor: Math.floor(-1.5) would be -2

// ------------------------------------------------------------
// 3d. EDGE CASE — comparison operators DO work across BigInt and Number
//     (only ARITHMETIC mixing is forbidden; relational comparison is allowed)
// ------------------------------------------------------------
console.log('10n === 10:', 10n === 10); // false -- strict equality also checks TYPE, bigint !== number
console.log('10n == 10:', 10n == 10); // true -- loose equality coerces and compares VALUE
console.log('10n < 11:', 10n < 11); // true -- relational operators are allowed to mix types
console.log('10n > 9:', 10n > 9); // true


console.log('\n=== SECTION 4: PRACTICAL PATTERN — MONEY AS INTEGER CENTS ===');

// ------------------------------------------------------------
// 4. HAPPY PATH — avoiding float math for currency entirely
// ------------------------------------------------------------
function addPricesAsFloats(a, b) {
  return a + b; // naive version -- subject to float rounding error
}
function addPricesAsCents(centsA, centsB) {
  return centsA + centsB; // integer math -- exact, as long as total stays under 2^53
}

console.log('0.10 + 0.20 (dollars, float):', addPricesAsFloats(0.1, 0.2)); // 0.30000000000000004 -- wrong-looking
console.log('10 + 20 (cents, integer):', addPricesAsCents(10, 20)); // 30 -- exact

function centsToDisplayString(cents) {
  // Convert back to a display string ONLY at the formatting boundary --
  // never feed this back into further arithmetic.
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = String(abs % 100).padStart(2, '0');
  return `${sign}$${dollars}.${remainder}`;
}
console.log('centsToDisplayString(30):', centsToDisplayString(30)); // '$0.30' -- correct, no float error ever entered the math
