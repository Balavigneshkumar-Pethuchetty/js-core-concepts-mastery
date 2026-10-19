'use strict'; // relevant: writable:false violations throw here instead of failing silently

// ============================================================
// DAY 09 — OBJECT PROPERTY DESCRIPTORS
// ============================================================
// Run this in a browser console, via index.html, or with `node script.js`.

// ============================================================
// 1. HAPPY PATH — the default descriptor behind plain assignment
// ============================================================

const basicObj = {};
basicObj.x = 1;

// Plain assignment always produces a descriptor with ALL THREE flags true.
console.log('[1] default descriptor for plain assignment ->', Object.getOwnPropertyDescriptor(basicObj, 'x'));

// ============================================================
// 2. HAPPY PATH — Object.defineProperty with writable:false
// ============================================================

const config = {};
Object.defineProperty(config, 'apiVersion', {
  value: 'v2',
  writable: false,   // reassignment will be blocked
  enumerable: true,  // still shows up in Object.keys / JSON.stringify
  configurable: true, // we can still redefine or delete this later
});

console.log('[2] config.apiVersion (read works fine) ->', config.apiVersion);

try {
  // WHY this throws: we're in strict mode ('use strict' at the top of the
  // file), and writable:false makes assignment an explicit TypeError here
  // instead of a silent no-op (which is what would happen in sloppy mode).
  config.apiVersion = 'v3';
} catch (err) {
  console.log('[2b] reassigning a non-writable property -> threw:', err.constructor.name, '-', err.message);
}

// ============================================================
// 3. COMMON PITFALL — Object.freeze is SHALLOW, not deep
// ============================================================

const appState = Object.freeze({
  topLevel: 'original',
  nested: {
    value: 'original-nested',
  },
});

// Attempting to change the top-level, frozen property is blocked.
try {
  appState.topLevel = 'changed';
} catch (err) {
  console.log('[3] mutating frozen top-level prop -> threw:', err.constructor.name);
}
console.log('[3b] topLevel after attempted mutation ->', appState.topLevel);

// WHY this succeeds: Object.freeze(appState) only locked appState's OWN
// direct properties. `appState.nested` is a reference to a SEPARATE object
// that was never itself passed to Object.freeze -- it remains fully mutable.
appState.nested.value = 'changed-nested';
console.log('[3c] nested.value AFTER mutation (freeze did NOT protect this) ->', appState.nested.value);

// A correct deep-freeze helper: recursively freeze every nested object
// BEFORE freezing the object that references it.
function deepFreeze(obj) {
  // Freeze children first, so there's no window where a child is frozen
  // but still reachable and mutable from a not-yet-frozen parent reference.
  for (const key of Object.getOwnPropertyNames(obj)) {
    const value = obj[key];
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return Object.freeze(obj);
}

const deeplyFrozenState = deepFreeze({
  topLevel: 'original',
  nested: { value: 'original-nested' },
});

try {
  deeplyFrozenState.nested.value = 'attempted-change';
} catch (err) {
  console.log('[3d] mutating nested prop AFTER deepFreeze -> threw:', err.constructor.name);
}
console.log('[3e] nested.value after deepFreeze protection ->', deeplyFrozenState.nested.value);

// ============================================================
// 4. EDGE CASE — enumerable:false hides a property from enumeration, not from access
// ============================================================

const userRecord = { username: 'ada' };
Object.defineProperty(userRecord, 'internalCacheRef', {
  value: { computedAt: Date.now() },
  writable: true,
  enumerable: false, // THE key flag being demonstrated here
  configurable: true,
});

// Direct access still works perfectly -- enumerable only affects LISTING, not reading.
console.log('[4] direct access to non-enumerable prop ->', userRecord.internalCacheRef.computedAt > 0);

// But it is invisible to every enumeration-based API:
console.log('[4b] Object.keys(userRecord) ->', Object.keys(userRecord));
console.log('[4c] JSON.stringify(userRecord) ->', JSON.stringify(userRecord));
const forInKeys = [];
for (const key in userRecord) forInKeys.push(key);
console.log('[4d] for...in over userRecord ->', forInKeys);

// ============================================================
// 5. EDGE CASE — configurable:false is a ONE-WAY LOCK
// ============================================================

const lockedConfig = {};
Object.defineProperty(lockedConfig, 'region', {
  value: 'us-east-1',
  writable: true,     // we CAN still flip writable true->false later (one-way ratchet)
  enumerable: true,
  configurable: false, // but once this is false, there is NO API to make it true again
});

try {
  // WHY this throws: configurable:false blocks ANY redefinition of the
  // property's other attributes -- there is no way to "unlock" this, ever,
  // for the lifetime of this object.
  Object.defineProperty(lockedConfig, 'region', { enumerable: false });
} catch (err) {
  console.log('[5] redefining a non-configurable prop -> threw:', err.constructor.name, '-', err.message);
}

try {
  delete lockedConfig.region;
} catch (err) {
  console.log('[5b] deleting a non-configurable prop -> threw:', err.constructor.name);
}
console.log('[5c] region survives the delete attempt ->', lockedConfig.region);

// The ONE allowed exception: writable can still go true -> false even when
// configurable is false (a "ratchet," never reversible back to true).
Object.defineProperty(lockedConfig, 'region', { writable: false });
console.log('[5d] writable:true -> false succeeded even with configurable:false');
try {
  Object.defineProperty(lockedConfig, 'region', { writable: true }); // going back is NOT allowed
} catch (err) {
  console.log('[5e] trying to flip writable back to true -> threw:', err.constructor.name);
}

// ============================================================
// 6. HAPPY PATH — getters/setters for computed, validated properties
// ============================================================

const temperature = {
  celsius: 0,

  // Reading `.fahrenheit` runs this function EVERY time -- it is never
  // stored, always computed live from the current `.celsius` value.
  get fahrenheit() {
    return this.celsius * 9 / 5 + 32;
  },

  // Writing `.fahrenheit` runs this conversion and stores the result into
  // the REAL backing field, `.celsius`.
  set fahrenheit(value) {
    this.celsius = (value - 32) * 5 / 9;
  },
};

console.log('[6] temperature.fahrenheit at celsius=0 ->', temperature.fahrenheit);
temperature.celsius = 100;
console.log('[6b] fahrenheit recomputed live after celsius changes ->', temperature.fahrenheit);

temperature.fahrenheit = 32; // use the setter
console.log('[6c] celsius updated via the fahrenheit setter ->', temperature.celsius);

// ============================================================
// 7. EDGE CASE — preventExtensions vs seal vs freeze, side by side
// ============================================================

const extensible = { a: 1 };
const sealed = Object.seal({ a: 1 });
const frozen = Object.freeze({ a: 1 });
Object.preventExtensions(extensible);

// preventExtensions: can't ADD new props, but EXISTING ones are untouched --
// still writable AND still configurable. We're in strict mode ('use strict'
// at the top of this file), so the blocked ADD throws instead of failing
// silently -- that's exactly the behavior we're demonstrating here.
try {
  extensible.b = 'blocked-add';
} catch (err) {
  console.log('[7] adding a prop to a non-extensible object -> threw:', err.constructor.name);
}
extensible.a = 'allowed-change'; // this one succeeds -- existing props are untouched by preventExtensions
console.log('[7b] preventExtensions still allows changing EXISTING values ->', extensible);

// seal: preventExtensions + every existing prop becomes configurable:false,
// but writable STAYS true -- so values can still change. Adding a new prop
// is still blocked (seal implies preventExtensions), so it still throws.
try {
  sealed.b = 'blocked-add';
} catch (err) {
  console.log('[7c] adding a prop to a sealed object -> threw:', err.constructor.name);
}
sealed.a = 'allowed-change-because-seal-keeps-writable-true';
console.log('[7d] seal blocks add, STILL allows value change ->', sealed);
try {
  delete sealed.a;
} catch (err) {
  console.log('[7e] delete on sealed object -> threw:', err.constructor.name);
}

// freeze: seal + every existing data prop ALSO becomes writable:false --
// the strictest of the three, nothing about existing props can change.
try {
  frozen.a = 'blocked-value-change';
} catch (err) {
  console.log('[7f] value change on frozen object -> threw:', err.constructor.name);
}
console.log('[7g] frozen.a unchanged ->', frozen.a);

console.log('[7h] isExtensible/isSealed/isFrozen summary ->', {
  extensible: { isExtensible: Object.isExtensible(extensible) },
  sealed: { isSealed: Object.isSealed(sealed), isFrozen: Object.isFrozen(sealed) },
  frozen: { isSealed: Object.isSealed(frozen), isFrozen: Object.isFrozen(frozen) },
});
