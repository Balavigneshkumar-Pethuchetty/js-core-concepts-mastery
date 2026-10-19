// ============================================================
// DAY 07 — PROTOTYPES & PROTOTYPAL INHERITANCE
// ============================================================
// Run this in a browser console, via index.html, or with `node script.js`.

// ============================================================
// 1. HAPPY PATH — constructor function + .prototype + __proto__
// ============================================================

function Dog(name) {
  // `this` here is the brand-new object `new` already created and linked to
  // Dog.prototype BEFORE this function body runs (see the step trace below).
  this.name = name;
}

// Any method we want shared across ALL Dog instances goes on the prototype,
// not inside the constructor — this way every instance SHARES one function
// object in memory instead of each instance getting its own copy.
Dog.prototype.bark = function () {
  return `${this.name} says woof`;
};

const rex = new Dog('Rex');

// What `new Dog('Rex')` did, step by step, under the hood:
// 1. Created a brand-new plain object {}.
// 2. Set that object's internal [[Prototype]] to Dog.prototype.
//    (rex.__proto__ === Dog.prototype is true because of this step)
// 3. Called Dog with `this` bound to the new object -> this.name = 'Rex' ran.
// 4. Dog didn't explicitly return an object, so the new object became `rex`.
console.log('[1] rex.__proto__ === Dog.prototype ->', rex.__proto__ === Dog.prototype);
console.log('[1b] rex.bark() ->', rex.bark());

// ============================================================
// 2. HAPPY PATH — walking the prototype chain, traced explicitly
// ============================================================

// rex.bark lookup trace:
//   Step A: is `bark` an OWN property of rex? No (rex only owns `name`).
//   Step B: walk rex.[[Prototype]] -> that's Dog.prototype. Does IT own `bark`? Yes. Stop here.
console.log('[2] rex has own "bark"? ->', Object.hasOwn(rex, 'bark'));
console.log('[2b] Dog.prototype has own "bark"? ->', Object.hasOwn(Dog.prototype, 'bark'));

// rex.toString lookup trace (a longer walk):
//   Step A: own property of rex? No.
//   Step B: own property of Dog.prototype? No (we never defined toString there).
//   Step C: walk Dog.prototype.[[Prototype]] -> that's Object.prototype by default.
//           Does Object.prototype own toString? Yes. Stop here.
console.log('[2c] rex.toString() ->', rex.toString());
console.log(
  '[2d] Dog.prototype.__proto__ === Object.prototype ->',
  Dog.prototype.__proto__ === Object.prototype
);
// The chain terminates at null -- Object.prototype.__proto__ is the end of the line.
console.log('[2e] Object.prototype.__proto__ ->', Object.prototype.__proto__);

// ============================================================
// 3. EDGE CASE — the prototype link is LIVE, not a snapshot
// ============================================================

// We add `fetch` to Dog.prototype AFTER rex already exists. If the chain were
// a copy taken at creation time, rex would never see this. It isn't a copy —
// it's a live pointer walked at ACCESS time, so rex sees it immediately.
Dog.prototype.fetch = function () {
  return `${this.name} fetches the ball`;
};
console.log('[3] method added after instantiation, still visible ->', rex.fetch());

// ============================================================
// 4. HAPPY PATH — Object.create: pure prototypal inheritance, no constructor at all
// ============================================================

const animal = {
  describe() {
    return `I am a ${this.kind}`;
  },
};

// `dog2` is built with its [[Prototype]] set DIRECTLY to `animal` -- no `new`,
// no constructor function, no Dog.prototype indirection. This is the rawest
// form of prototypal inheritance the language offers.
const dog2 = Object.create(animal);
dog2.kind = 'dog';
console.log('[4] dog2.describe() via Object.create ->', dog2.describe());
console.log('[4b] dog2.__proto__ === animal ->', dog2.__proto__ === animal);

// ============================================================
// 5. EDGE CASE — Object.create(null): an object with NO inherited prototype
// ============================================================

const bareDictionary = Object.create(null);
bareDictionary.key = 'value';

// Because bareDictionary's [[Prototype]] is null, there is NOTHING to walk up
// to -- it doesn't even inherit the most basic Object.prototype methods.
console.log('[5] bareDictionary.toString ->', bareDictionary.toString);
console.log('[5b] bareDictionary.key ->', bareDictionary.key);
// This makes Object.create(null) the safest choice for a dictionary keyed by
// untrusted strings -- there's no `constructor`, `toString`, or `__proto__`
// accessor to collide with or be confused by attacker-controlled keys.

// ============================================================
// 6. COMMON PITFALL — prototype pollution via an unguarded deep merge
// ============================================================

// This is the VULNERABLE version: a naive recursive merge with no key checks.
function unsafeMerge(target, source) {
  for (const key in source) {
    // WHY this is dangerous: if `key` is the literal string "__proto__",
    // `target[key]` does NOT create an own property named "__proto__" --
    // it resolves through the __proto__ ACCESSOR and actually reassigns
    // target's internal [[Prototype]]. If `source.__proto__` is itself an
    // object (e.g. parsed from attacker-controlled JSON), this can walk all
    // the way up to mutating Object.prototype, the shared ancestor of
    // EVERY plain object in the entire process.
    if (typeof source[key] === 'object' && source[key] !== null) {
      target[key] = target[key] || {};
      unsafeMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// Simulate an attacker-controlled payload (e.g. parsed from untrusted JSON).
const maliciousPayload = JSON.parse('{"__proto__": {"polluted": "yes"} }');
const innocentTarget = {};
unsafeMerge(innocentTarget, maliciousPayload);

// Prove the pollution happened: a COMPLETELY UNRELATED fresh object now has
// `polluted` on it, because Object.prototype itself got mutated.
const freshObject = {};
console.log('[6] prototype pollution leaked to unrelated object ->', freshObject.polluted);

// Clean up the mess so later blocks in this file aren't affected by it.
delete Object.prototype.polluted;

// Now the SAFE version: explicitly guard against dangerous keys and only ever
// touch OWN properties, never let bracket access fall through to accessors.
function safeMerge(target, source) {
  for (const key of Object.keys(source)) {
    // Explicitly deny the known-dangerous prototype-chain key names.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    if (typeof source[key] === 'object' && source[key] !== null) {
      target[key] = target[key] || {};
      safeMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

const safeTarget = Object.create(null); // belt-and-suspenders: no prototype to pollute anyway
safeMerge(safeTarget, maliciousPayload);
const freshObject2 = {};
console.log(
  '[6b] safe merge leaves unrelated object clean ->',
  freshObject2.polluted === undefined
);

// ============================================================
// 7. EDGE CASE — for...in walks the chain, Object.keys does not
// ============================================================

function Base() {
  this.ownProp = 'own';
}
Base.prototype.inheritedProp = 'inherited';

const instance = new Base();

const forInKeys = [];
// for...in enumerates ALL enumerable properties, including ones found by
// walking up the prototype chain -- that's why `inheritedProp` shows up here.
for (const key in instance) {
  forInKeys.push(key);
}
console.log('[7] for...in sees ->', forInKeys);

// Object.keys only returns OWN enumerable properties -- it never walks the chain.
console.log('[7b] Object.keys sees ->', Object.keys(instance));

// ============================================================
// 8. EDGE CASE — deep prototype chains and the walk cost (conceptual demo)
// ============================================================

// Build a deliberately deep chain: Level0 <- Level1 <- ... <- Level9
let chainRoot = { depth: 0, describe() { return `depth ${this.depth}`; } };
let currentLevel = chainRoot;
for (let i = 1; i <= 9; i++) {
  currentLevel = Object.create(currentLevel);
  currentLevel.depth = i;
}
// `currentLevel.describe()` has to walk NINE prototype links before finding
// `describe`, since only chainRoot (depth 0) actually owns it. In a hot path
// called millions of times, this walk cost (and the inline-cache instability
// it can cause when chains vary in shape) is a real, measurable difference
// versus a 1-2 level chain -- not just a style preference.
console.log('[8] deep chain walk result ->', currentLevel.describe());
console.log('[8b] own depth at the bottom of the chain ->', currentLevel.depth);
