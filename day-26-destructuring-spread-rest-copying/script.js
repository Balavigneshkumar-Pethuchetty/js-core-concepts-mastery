// ============================================================
// DAY 26: DESTRUCTURING, SPREAD/REST, AND SHALLOW VS DEEP COPY
// ============================================================
// Run this in a browser console, via index.html, or with Node.
// Every section is self-contained and complete — no placeholders.

// ============================================================
// 1. HAPPY PATH — destructuring is just sugar over property reads
// ============================================================

console.log('--- 1. Destructuring basics ---');

const user = {
  id: 7,
  name: 'Ada Lovelace',
  address: { city: 'London', zip: 'SW1' },
};

// Object destructuring: equivalent to `const name = user.name` etc.
const { id, name, address } = user;
console.log(id, name, address); // 7 'Ada Lovelace' { city: 'London', zip: 'SW1' }

// Renaming + default value: `role` doesn't exist on `user`, so default kicks in.
const { name: displayName, role = 'guest' } = user;
console.log(displayName, role); // 'Ada Lovelace' 'guest'

// Nested destructuring reaches into `address` in one statement.
const { address: { city } } = user;
console.log(city); // 'London'

// Array destructuring relies on the iterator protocol, not indexes directly.
const scores = [95, 88, 76];
const [first, second, , fourth = 0] = scores; // skip index 2, default for missing index 3
console.log(first, second, fourth); // 95 88 0

// Swapping two variables without a temp — a classic destructuring party trick.
let a = 1;
let b = 2;
[a, b] = [b, a];
console.log(a, b); // 2 1

// ============================================================
// 2. HAPPY PATH — spread for shallow copies and merging
// ============================================================

console.log('--- 2. Spread basics ---');

const base = { theme: 'dark', fontSize: 14 };
const overrides = { fontSize: 16 };
// Later keys win: `fontSize` from `overrides` overwrites the one from `base`.
const merged = { ...base, ...overrides };
console.log(merged); // { theme: 'dark', fontSize: 16 }

const arr1 = [1, 2];
const arr2 = [3, 4];
const combined = [...arr1, ...arr2]; // drains both iterators into a new array
console.log(combined); // [1, 2, 3, 4]

// Spread in a function call expands an array into individual arguments.
function sum3(x, y, z) {
  return x + y + z;
}
console.log(sum3(...[10, 20, 30])); // 60

// ============================================================
// 3. HAPPY PATH — rest for collecting leftovers
// ============================================================

console.log('--- 3. Rest basics ---');

const { id: userId, ...restOfUser } = user;
console.log(userId, restOfUser); // 7 { name: 'Ada Lovelace', address: {...} }

function logAll(first, ...rest) {
  // `rest` is a REAL array (unlike the old `arguments` object) — .map works directly.
  console.log('first:', first, 'rest:', rest.map((x) => x * 2));
}
logAll(1, 2, 3, 4); // first: 1 rest: [4, 6, 8]

// ============================================================
// 4. COMMON PITFALL — spread only copies ONE level deep
// ============================================================

console.log('--- 4. Shallow copy pitfall ---');

const original = {
  id: 1,
  tags: ['a', 'b'],
  meta: { created: 2024 },
};

const shallowCopy = { ...original };
shallowCopy.id = 999; // primitive slot -> fully independent, no effect on `original`
shallowCopy.tags.push('c'); // SAME array reference as original.tags -> mutates both
shallowCopy.meta.created = 2099; // SAME object reference as original.meta -> mutates both

console.log('original.id:', original.id); // 1 — untouched, numbers copy by value
console.log('original.tags:', original.tags); // ['a', 'b', 'c'] — mutated via shared reference
console.log('original.meta.created:', original.meta.created); // 2099 — mutated via shared reference

// ============================================================
// 5. COMMON PITFALL — spread does NOT copy the prototype chain
// ============================================================

console.log('--- 5. Spread drops class identity ---');

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  distanceFromOrigin() {
    return Math.sqrt(this.x ** 2 + this.y ** 2);
  }
}

const p = new Point(3, 4);
const pCopy = { ...p }; // only own enumerable DATA properties are copied

console.log(p instanceof Point); // true
console.log(pCopy instanceof Point); // false — pCopy's prototype is plain Object.prototype
console.log(typeof pCopy.distanceFromOrigin); // 'undefined' — method lived on Point.prototype, not on the instance

// Correct way to clone while preserving the prototype, when you truly need it:
const pCloneWithPrototype = Object.create(
  Object.getPrototypeOf(p),
  Object.getOwnPropertyDescriptors(p)
);
console.log(pCloneWithPrototype instanceof Point); // true
console.log(pCloneWithPrototype.distanceFromOrigin()); // 5

// ============================================================
// 6. COMMON PITFALL — JSON.parse(JSON.stringify(x)) is a leaky "deep clone"
// ============================================================

console.log('--- 6. JSON round-trip pitfalls ---');

const trickyData = {
  when: new Date('2024-01-01T00:00:00.000Z'),
  missing: undefined,
  fn: () => 'I will vanish',
  // Note: BigInt values are deliberately NOT included here — JSON.stringify()
  // throws a TypeError on BigInt ("Do not know how to serialize a BigInt"),
  // which would abort this example before it could show the other pitfalls.
  notANumber: NaN,
  infinite: Infinity,
  set: new Set([1, 2, 3]),
  map: new Map([['k', 'v']]),
};

const roundTripped = JSON.parse(JSON.stringify(trickyData));
console.log('when is now typeof:', typeof roundTripped.when); // 'string' — Date became an ISO string, lost its type
console.log("'missing' key present?", 'missing' in roundTripped); // false — undefined keys are dropped entirely
console.log("'fn' key present?", 'fn' in roundTripped); // false — functions are dropped entirely
console.log('notANumber became:', roundTripped.notANumber); // null — NaN is not valid JSON, coerced to null
console.log('infinite became:', roundTripped.infinite); // null — same story for Infinity
console.log('set became:', roundTripped.set); // {} — Set has no JSON representation, serializes to an empty object
console.log('map became:', roundTripped.map); // {} — same problem for Map

// Circular references: JSON.stringify THROWS. This is intentionally demonstrated
// with a try/catch so the script keeps running and the failure mode is visible.
const circular = { name: 'node-a' };
circular.self = circular; // object now references itself
try {
  JSON.stringify(circular);
} catch (err) {
  console.log('JSON.stringify on circular data threw:', err.constructor.name); // 'TypeError'
}

// ============================================================
// 7. THE FIX — structuredClone() is a real deep clone, natively
// ============================================================

console.log('--- 7. structuredClone fixes most of the above ---');

const forClone = {
  id: 1,
  tags: ['a', 'b'],
  meta: { created: new Date('2024-06-01T00:00:00.000Z') },
  set: new Set([1, 2, 3]),
  map: new Map([['k', 'v']]),
};

const deepClone = structuredClone(forClone);
deepClone.tags.push('c');
deepClone.meta.created.setFullYear(2099);

console.log('original tags untouched:', forClone.tags); // ['a', 'b'] — real independent array now
console.log('original date untouched:', forClone.meta.created.getFullYear()); // 2024
console.log('clone is a real Date:', deepClone.meta.created instanceof Date); // true
console.log('clone is a real Set:', deepClone.set instanceof Set); // true

// structuredClone correctly handles circular references too — no throw.
const circularOk = { name: 'node-a' };
circularOk.self = circularOk;
const clonedCircular = structuredClone(circularOk);
console.log('cloned circular ref points to itself:', clonedCircular.self === clonedCircular); // true
console.log('but it is NOT the same object as the original:', clonedCircular !== circularOk); // true

// What structuredClone CANNOT clone: functions and DOM nodes throw a DataCloneError.
try {
  structuredClone({ fn: () => {} });
} catch (err) {
  console.log('structuredClone on a function throws:', err.constructor.name); // 'DOMException' in browsers
}

// ============================================================
// 8. EDGE CASE — a hand-rolled recursive deep clone (classic interview ask)
// ============================================================

console.log('--- 8. Manual recursive deepClone with circular-ref safety ---');

/**
 * Recursively clones plain objects, arrays, Map, Set, and Date.
 * Uses a WeakMap as a "visited" set so circular references don't
 * cause infinite recursion — WeakMap keys don't prevent garbage
 * collection of the objects being tracked (preview of Day 27).
 */
function deepCloneManual(value, seen = new WeakMap()) {
  // Primitives (including null) are returned as-is — nothing to clone.
  if (value === null || typeof value !== 'object') {
    return value;
  }

  // If we've already started cloning this exact object, return the clone
  // we already created for it — this is what breaks the infinite loop on cycles.
  if (seen.has(value)) {
    return seen.get(value);
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (value instanceof Map) {
    const clonedMap = new Map();
    seen.set(value, clonedMap); // register BEFORE recursing, so cycles resolve correctly
    for (const [k, v] of value.entries()) {
      clonedMap.set(deepCloneManual(k, seen), deepCloneManual(v, seen));
    }
    return clonedMap;
  }

  if (value instanceof Set) {
    const clonedSet = new Set();
    seen.set(value, clonedSet);
    for (const item of value.values()) {
      clonedSet.add(deepCloneManual(item, seen));
    }
    return clonedSet;
  }

  if (Array.isArray(value)) {
    const clonedArr = [];
    seen.set(value, clonedArr);
    for (let i = 0; i < value.length; i++) {
      clonedArr[i] = deepCloneManual(value[i], seen);
    }
    return clonedArr;
  }

  // Plain object: clone own enumerable properties, preserving the prototype.
  const clonedObj = Object.create(Object.getPrototypeOf(value));
  seen.set(value, clonedObj);
  for (const key of Object.keys(value)) {
    clonedObj[key] = deepCloneManual(value[key], seen);
  }
  return clonedObj;
}

const sourceForManualClone = { id: 1, nested: { list: [1, 2, { deep: true }] } };
sourceForManualClone.cyclic = sourceForManualClone; // introduce a cycle on purpose

const manualClone = deepCloneManual(sourceForManualClone);
manualClone.nested.list[2].deep = false;

console.log('source untouched by manual clone mutation:', sourceForManualClone.nested.list[2].deep); // true
console.log('manual clone handled the cycle:', manualClone.cyclic === manualClone); // true
console.log('manual clone is a different object than source:', manualClone !== sourceForManualClone); // true

// ============================================================
// 9. EDGE CASE — Object.assign behaves exactly like object spread (shallow)
// ============================================================

console.log('--- 9. Object.assign is shallow too ---');

const assignSource = { nested: { count: 1 } };
const assignTarget = Object.assign({}, assignSource);
assignTarget.nested.count = 100;
console.log('Object.assign also only shallow-copies:', assignSource.nested.count); // 100 — same shared-reference trap as spread

// Array.prototype.slice() is the array equivalent — also shallow.
const sliceSource = [{ n: 1 }];
const sliced = sliceSource.slice();
sliced[0].n = 999;
console.log('Array.slice is also shallow:', sliceSource[0].n); // 999
