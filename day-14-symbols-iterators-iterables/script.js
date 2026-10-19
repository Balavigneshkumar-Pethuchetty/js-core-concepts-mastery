// ============================================================
// DAY 14 — SYMBOLS, WELL-KNOWN SYMBOLS, AND THE ITERATOR PROTOCOL
// ============================================================
// Run in a browser console, via index.html, or with `node script.js`.

console.log('=== SECTION 1: SYMBOL BASICS — UNIQUE, COLLISION-PROOF KEYS ===');

// ------------------------------------------------------------
// 1. HAPPY PATH — every Symbol() call mints a unique value
// ------------------------------------------------------------
const sym1 = Symbol('id');
const sym2 = Symbol('id'); // same description string, but a DIFFERENT symbol
console.log('typeof sym1:', typeof sym1); // 'symbol' -- a genuine distinct primitive type
console.log('sym1 === sym2:', sym1 === sym2); // false -- description is just a debug label, not identity
console.log('sym1.description:', sym1.description); // 'id'

// Symbols as object keys never collide with string keys or each other.
const user = { name: 'Alice' };
const libraryAMeta = Symbol('meta');
const libraryBMeta = Symbol('meta'); // same name, totally independent slot
user[libraryAMeta] = 'library A data';
user[libraryBMeta] = 'library B data';
console.log('user[libraryAMeta]:', user[libraryAMeta]); // 'library A data'
console.log('user[libraryBMeta]:', user[libraryBMeta]); // 'library B data' -- no collision despite identical label

// Symbol-keyed properties are skipped by the "normal" enumeration mechanisms.
console.log('Object.keys(user):', Object.keys(user)); // ['name'] -- symbols excluded
console.log('JSON.stringify(user):', JSON.stringify(user)); // '{"name":"Alice"}' -- symbols excluded
console.log('Object.getOwnPropertySymbols(user).length:', Object.getOwnPropertySymbols(user).length); // 2 -- they ARE there, just hidden from normal views


console.log('\n=== SECTION 2: Symbol.for — THE GLOBAL REGISTRY EXCEPTION ===');

// ------------------------------------------------------------
// 2. EDGE CASE — Symbol.for shares a registry; plain Symbol() never does
// ------------------------------------------------------------
const regA = Symbol.for('shared-key');
const regB = Symbol.for('shared-key'); // looks up the SAME registry entry
console.log('Symbol.for("shared-key") === Symbol.for("shared-key"):', regA === regB); // true
console.log('Symbol("x") === Symbol("x"):', Symbol('x') === Symbol('x')); // false -- contrast with plain Symbol()
console.log('Symbol.keyFor(regA):', Symbol.keyFor(regA)); // 'shared-key' -- reverse lookup, only works for registry symbols


console.log('\n=== SECTION 3: THE ITERATOR PROTOCOL, BUILT BY HAND ===');

// ------------------------------------------------------------
// 3. HAPPY PATH — implementing Symbol.iterator manually on a custom class
// ------------------------------------------------------------
class Range {
  constructor(start, end) {
    this.start = start; // plain enumerable instance properties --
    this.end = end;      // for...in will see THESE, not the iteration values
  }

  // This is the "USB-C port": any consumer that wants to iterate this
  // object calls this method to get back an ITERATOR object.
  [Symbol.iterator]() {
    let current = this.start; // manually tracked "where am I" state
    const last = this.end;
    return {
      // The iterator contract: next() returns { value, done }.
      next() {
        if (current <= last) {
          const value = current;
          current += 1; // advance state for the NEXT call
          return { value, done: false };
        }
        // Once exhausted, correctly keep returning done: true forever --
        // do NOT throw, do NOT reset. This is the contract.
        return { value: undefined, done: true };
      },
    };
  }
}

const range1to5 = new Range(1, 5);

console.log('for...of over Range(1, 5):');
for (const n of range1to5) {
  console.log(' value:', n); // 1, 2, 3, 4, 5
}

// ------------------------------------------------------------
// 3b. CONTRAST — for...in walks ENUMERABLE KEYS, unrelated to the protocol
// ------------------------------------------------------------
console.log('for...in over the same Range instance:');
for (const key in range1to5) {
  console.log(' key:', key); // 'start', 'end' -- NOT the iterated numbers 1-5
}

// ------------------------------------------------------------
// 3c. EDGE CASE — manually calling .next() past exhaustion
// ------------------------------------------------------------
const manualIter = new Range(1, 2)[Symbol.iterator]();
console.log('manual .next() calls:');
console.log(' call 1:', manualIter.next()); // { value: 1, done: false }
console.log(' call 2:', manualIter.next()); // { value: 2, done: false }
console.log(' call 3:', manualIter.next()); // { value: undefined, done: true } -- exhausted
console.log(' call 4 (past exhaustion):', manualIter.next()); // { value: undefined, done: true } -- stays done, never throws

// Spread and destructuring both consume the SAME protocol.
console.log('[...new Range(1, 4)]:', [...new Range(1, 4)]); // [1, 2, 3, 4]
const [first, second] = new Range(10, 20);
console.log('destructured first, second:', first, second); // 10, 11


console.log('\n=== SECTION 4: THE SAME THING, REWRITTEN WITH A GENERATOR ===');

// ------------------------------------------------------------
// 4. HAPPY PATH — a generator-based iterable needs no manual state tracking
// ------------------------------------------------------------
class RangeGenerator {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }

  // A generator function assigned to Symbol.iterator automatically returns
  // something that satisfies the iterator shape -- no manual { value, done }
  // bookkeeping required. `yield` pauses/resumes the function itself.
  *[Symbol.iterator]() {
    for (let i = this.start; i <= this.end; i++) {
      yield i; // each yield corresponds to one { value: i, done: false }
    }
    // when the for-loop above finishes, the generator automatically
    // produces the final { value: undefined, done: true } -- no extra code needed
  }
}

console.log('[...new RangeGenerator(1, 5)]:', [...new RangeGenerator(1, 5)]); // [1, 2, 3, 4, 5]
console.log('for...of over RangeGenerator(100, 103):');
for (const n of new RangeGenerator(100, 103)) {
  console.log(' value:', n); // 100, 101, 102, 103
}


console.log('\n=== SECTION 5: COMMON PITFALL — SPREADING AN INFINITE ITERATOR ===');

// ------------------------------------------------------------
// 5. COMMON PITFALL (demonstrated safely with break, NOT a real infinite spread)
// ------------------------------------------------------------
function* infiniteCounter() {
  let n = 0;
  while (true) {
    yield n++; // never sets done: true on its own -- intentionally infinite
  }
}

console.log('for...of over an infinite generator, stopped early with break:');
let count = 0;
for (const n of infiniteCounter()) {
  console.log(' value:', n);
  count++;
  if (count >= 4) {
    // CRITICAL: for...of lets you break out safely. If you instead wrote
    // `[...infiniteCounter()]`, there is no way to stop -- spread MUST
    // fully drain the iterator before producing an array, so it would
    // hang/crash. This is exactly the real-world bug called out in the
    // README: never spread something you haven't confirmed is finite.
    console.log(' (breaking out manually -- spreading this instead would hang forever)');
    break;
  }
}


console.log('\n=== SECTION 6: Symbol.toPrimitive AND Symbol.toStringTag ===');

// ------------------------------------------------------------
// 6. EDGE CASE — other well-known symbols controlling coercion/introspection
// ------------------------------------------------------------
class Money {
  constructor(cents) {
    this.cents = cents;
  }
  // Controls what happens when this object is coerced to a primitive --
  // e.g. in arithmetic (+money), string concatenation, or template literals.
  [Symbol.toPrimitive](hint) {
    if (hint === 'number') return this.cents / 100;
    if (hint === 'string') return `$${(this.cents / 100).toFixed(2)}`;
    return this.cents / 100; // 'default' hint
  }
  // Controls what Object.prototype.toString.call(x) reports.
  get [Symbol.toStringTag]() {
    return 'Money';
  }
}

const price = new Money(1999);
console.log('+price (number hint):', +price); // 19.99
console.log('`Price: ${price}` (string hint):', `Price: ${price}`); // 'Price: $19.99'
console.log('Object.prototype.toString.call(price):', Object.prototype.toString.call(price)); // '[object Money]'
