// ============================================================
// DAY 10 — EQUALITY & TYPE COERCION
// ============================================================
// Run this in a browser console, via index.html, or with `node script.js`.

// ============================================================
// 1. HAPPY PATH — === vs == with matching and mismatched types
// ============================================================

console.log('[1] 1 === 1 ->', 1 === 1); // same type, same value -> true, no coercion needed
console.log('[1b] 1 === "1" ->', 1 === '1'); // different types -> strict equality stops immediately, false
console.log('[1c] 1 == "1" ->', 1 == '1'); // WHY true: "1" is coerced to Number via ToNumber("1") = 1, then 1 == 1

// ============================================================
// 2. EDGE CASE — null and undefined: the ONE special-cased pair
// ============================================================

console.log('[2] null == undefined ->', null == undefined); // true: this exact pair is special-cased in the spec
console.log('[2b] null === undefined ->', null === undefined); // false: different types, strict equality never coerces

// WHY this surprises people: null does NOT loosely equal anything else, not
// even 0 or '' or false, despite "feeling" like a generic empty value.
console.log('[2c] null == 0 ->', null == 0); // false -- null is ONLY == to undefined and itself
console.log('[2d] null == "" ->', null == ''); // false, same reason
console.log('[2e] null == false ->', null == false); // false, same reason
console.log('[2f] undefined == 0 ->', undefined == 0); // false, same reason

// This is exactly why `value == null` is the ONE legitimate, common use of ==:
// it cleanly catches BOTH null and undefined in a single check.
function describeNullish(value) {
  return value == null ? 'nullish' : 'has a value';
}
console.log('[2g] describeNullish(null) ->', describeNullish(null));
console.log('[2h] describeNullish(undefined) ->', describeNullish(undefined));
console.log('[2i] describeNullish(0) ->', describeNullish(0)); // 0 is NOT nullish

// ============================================================
// 3. COMMON PITFALL — NaN, Object.is, and the two isNaN functions
// ============================================================

// WHY this is false: === uses IEEE-754 numeric comparison, and that spec
// deliberately defines NaN as unequal to itself -- not a JS-specific quirk.
console.log('[3] NaN === NaN ->', NaN === NaN);

// Object.is uses the SameValue algorithm, which treats NaN as identical to
// itself -- this is the "is this literally the same value" semantic, correct
// for change-detection use cases (this is what React-style libs rely on).
console.log('[3b] Object.is(NaN, NaN) ->', Object.is(NaN, NaN));

// The modern, correct way to test for NaN -- no coercion, exact check.
console.log('[3c] Number.isNaN(NaN) ->', Number.isNaN(NaN));
console.log('[3d] Number.isNaN("hello") ->', Number.isNaN('hello')); // false: it's a string, not NaN, and Number.isNaN does NOT coerce

// The legacy global isNaN COERCES its argument via ToNumber FIRST, which is
// why it gives a false positive here: ToNumber('hello') is NaN, so isNaN says true,
// even though the string 'hello' itself was never the NaN value.
console.log('[3e] isNaN("hello") ->', isNaN('hello')); // true -- surprising false positive due to coercion

// ============================================================
// 4. EDGE CASE — 0 vs -0: equal by === , distinct by Object.is
// ============================================================

console.log('[4] 0 === -0 ->', 0 === -0); // true -- IEEE-754 numeric comparison treats them as mathematically equal
console.log('[4b] Object.is(0, -0) ->', Object.is(0, -0)); // false -- SameValue distinguishes the actual sign bit

// Proof the two zeros really are bit-level distinct, even though most
// operators treat them identically: dividing by them gives opposite infinities.
console.log('[4c] 1 / 0 ->', 1 / 0);
console.log('[4d] 1 / -0 ->', 1 / -0);

// ============================================================
// 5. CLASSIC GOTCHA — [] == ![]  traced step by step
// ============================================================

// Step 1: ![] -- the ! operator applies ToBoolean first. ToBoolean of ANY
// object (including an empty array) is always true, so ![] = !true = false.
const step1 = ![];
console.log('[5] step 1: ![] ->', step1);

// Step 2: now comparing [] == false. Types differ (object vs boolean).
// Step 3: Boolean false converts to Number via ToNumber(false) = 0.
// Step 4: now comparing [] == 0. Types differ (object vs number), so the
// object goes through ToPrimitive. For an array, valueOf() returns the array
// itself (not a primitive, so it's skipped), then toString() runs, joining
// elements with commas: [].toString() = '' (empty string, zero elements).
const primitiveOfEmptyArray = [].toString();
console.log('[5b] [].toString() (the ToPrimitive result) ->', JSON.stringify(primitiveOfEmptyArray));

// Step 5: now comparing '' == 0. Types differ (string vs number), so
// ToNumber('') runs. An empty/whitespace string converts to 0.
console.log('[5c] Number("") ->', Number(''));

// Step 6: 0 == 0 -> true. Final result:
console.log('[5d] [] == ![] (full chain result) ->', [] == ![]);

// Contrast: two DIFFERENT array objects are never == or === to each other,
// because once BOTH sides are objects, no ToPrimitive coercion happens at
// all -- it falls straight to reference identity comparison.
console.log('[5e] [] == [] (two distinct array objects) ->', [] == []);
console.log('[5f] [] === [] ->', [] === []);

// ============================================================
// 6. EDGE CASE — the + operator's dual personality (string vs numeric ToPrimitive)
// ============================================================

// '+' prefers string concatenation the moment EITHER operand is (or coerces
// to) a string -- this is a special rule specific to the + operator.
console.log('[6] "5" + 3 ->', '5' + 3); // '53' -- string concatenation wins

// '-' has no string-concatenation meaning at all, so BOTH operands are
// forced through ToNumber instead, regardless of their original type.
console.log('[6b] "5" - 3 ->', '5' - 3); // 2 -- both sides coerced to Number

// Number("12px") vs parseInt("12px") -- two DIFFERENT algorithms, a classic trap.
console.log('[6c] Number("12px") ->', Number('12px')); // NaN -- ToNumber requires the ENTIRE string to be a valid numeric literal
console.log('[6d] parseInt("12px") ->', parseInt('12px', 10)); // 12 -- parseInt stops at the first non-numeric character instead of failing outright

// ============================================================
// 7. EDGE CASE — Symbol.toPrimitive lets you control coercion explicitly
// ============================================================

class Money {
  constructor(amountInCents) {
    this.amountInCents = amountInCents;
  }

  // This is the actual override point ToPrimitive checks FIRST, before
  // falling back to the ambiguous valueOf/toString chain that produces
  // results like the [] == ![] trace above. Implementing this directly
  // removes the ambiguity entirely for objects where coercion matters.
  [Symbol.toPrimitive](hint) {
    if (hint === 'number') {
      return this.amountInCents / 100;
    }
    if (hint === 'string') {
      return `$${(this.amountInCents / 100).toFixed(2)}`;
    }
    // hint === 'default' (used by == and + with a non-string operand)
    return this.amountInCents / 100;
  }
}

const price = new Money(1999);
console.log('[7] Number(price) -- hint "number" ->', Number(price));
console.log('[7b] `${price}` -- hint "string" ->', `${price}`);
console.log('[7c] price + 1 -- hint "default" ->', price + 1);
console.log('[7d] price == 19.99 -- hint "default" ->', price == 19.99);

// ============================================================
// 8. EDGE CASE — the complete, exact list of falsy values
// ============================================================

const falsyCandidates = [false, 0, -0, 0n, '', null, undefined, NaN];
const truthyTraps = [[], {}, '0', 'false', ' ']; // all commonly mis-assumed to be falsy

console.log('[8] every falsy value confirmed falsy ->', falsyCandidates.every((v) => !v));
console.log(
  '[8b] every "looks empty/zero-ish" value is actually TRUTHY ->',
  truthyTraps.every((v) => Boolean(v))
);
