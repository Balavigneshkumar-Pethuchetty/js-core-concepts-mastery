// ============================================================
// DAY 27: WEAKMAP, WEAKSET, AND MEMORY-SAFE CACHING
// ============================================================
// Run this in a browser console, via index.html, or with Node.
// Note: JS does NOT give you a way to force or observe garbage collection
// deterministically from normal code. Every example below is written so
// its CORRECTNESS does not depend on exactly when GC runs — the comments
// explain the conceptual guarantee, not a timing guarantee.

// ============================================================
// 1. HAPPY PATH — basic WeakMap get/set/has/delete
// ============================================================

console.log('--- 1. WeakMap basics ---');

const weakCache = new WeakMap();

const keyObjectA = { id: 'a' };
const keyObjectB = { id: 'b' };

weakCache.set(keyObjectA, { note: 'metadata for A' });
weakCache.set(keyObjectB, { note: 'metadata for B' });

console.log(weakCache.has(keyObjectA)); // true
console.log(weakCache.get(keyObjectA)); // { note: 'metadata for A' }
weakCache.delete(keyObjectB);
console.log(weakCache.has(keyObjectB)); // false — explicit delete works exactly like Map

// WeakMap keys MUST be objects (or registered symbols) — primitives throw.
try {
  weakCache.set('not-an-object', 'oops');
} catch (err) {
  console.log('Setting a primitive key throws:', err.constructor.name); // 'TypeError'
}

// WeakMap has NO iteration, NO .size, NO .forEach, NO .keys() — by design (see README).
console.log('WeakMap.prototype has no size:', weakCache.size); // undefined
console.log('WeakMap.prototype has no forEach:', typeof weakCache.forEach); // 'undefined'

// ============================================================
// 2. HAPPY PATH — basic WeakSet basics
// ============================================================

console.log('--- 2. WeakSet basics ---');

const weakSet = new WeakSet();
const trackedObject = { tag: 'tracked' };

weakSet.add(trackedObject);
console.log(weakSet.has(trackedObject)); // true
weakSet.delete(trackedObject);
console.log(weakSet.has(trackedObject)); // false

// ============================================================
// 3. REAL-WORLD PATTERN — DOM-node metadata cache (simulated)
// ============================================================

console.log('--- 3. Simulated DOM-node metadata cache ---');

// In a real browser app, `nodeMetadata` would be keyed by actual DOM elements.
// We simulate with plain objects standing in for DOM nodes, since the
// underlying mechanism (weak reference to an externally-owned object) is identical.
const nodeMetadata = new WeakMap();

function attachTooltipState(fakeDomNode, state) {
  nodeMetadata.set(fakeDomNode, state);
}

function getTooltipState(fakeDomNode) {
  return nodeMetadata.get(fakeDomNode);
}

let simulatedButtonNode = { tagName: 'BUTTON', id: 'save-btn' };
attachTooltipState(simulatedButtonNode, { visible: false, text: 'Save your work' });
console.log('Tooltip state attached:', getTooltipState(simulatedButtonNode));

// When the "DOM node" is removed from the page in a real app (e.g. React unmounts
// it, or it's replaced), the ONLY thing keeping it alive was the app's own
// reference. Once that's dropped, nothing else (certainly not our WeakMap)
// keeps it alive, and its tooltip-state entry becomes eligible for collection
// along with it. We simulate "the app dropping its reference" here:
simulatedButtonNode = null;
// At this point, no code anywhere holds a reference to the original node object,
// so there is no way to leak memory by "forgetting" to clean up nodeMetadata —
// contrast this with section 6 below, which shows the Map-based leak this avoids.
console.log('Reference dropped — WeakMap cannot leak this entry, by construction.');

// ============================================================
// 4. REAL-WORLD PATTERN — private instance data via module-level WeakMap
// ============================================================

console.log('--- 4. Private state pattern (pre-#privateFields technique) ---');

// This WeakMap lives in this module's closure scope — code outside this
// file/module has no reference to it and therefore no way to read or
// tamper with the "private" data, even though `BankAccount` instances
// themselves are fully public objects.
const privateBalances = new WeakMap();

class BankAccount {
  constructor(owner, initialBalance) {
    this.owner = owner; // public
    privateBalances.set(this, initialBalance); // private, keyed by `this`
  }

  deposit(amount) {
    const current = privateBalances.get(this);
    privateBalances.set(this, current + amount);
  }

  getBalance() {
    return privateBalances.get(this);
  }
}

const account = new BankAccount('Grace Hopper', 100);
account.deposit(50);
console.log('Public owner field:', account.owner); // 'Grace Hopper'
console.log('Balance via method:', account.getBalance()); // 150
console.log('Direct property access finds nothing:', account.balance); // undefined — not stored on the instance at all

// Bonus: when `account` itself becomes unreachable, its entry in
// `privateBalances` becomes collectible too — private state never
// outlives the instance it belongs to, with zero manual cleanup code.

// ============================================================
// 5. REAL-WORLD PATTERN — memoization keyed by object identity
// ============================================================

console.log('--- 5. WeakMap-backed memoization ---');

function expensiveComputation(configObject) {
  // Pretend this does real work — we simulate cost with a visible log line.
  console.log('  (expensive computation actually ran)');
  return configObject.width * configObject.height;
}

function memoizeByObjectIdentity(fn) {
  const resultsCache = new WeakMap();
  return function memoized(objArg) {
    if (resultsCache.has(objArg)) {
      return resultsCache.get(objArg);
    }
    const result = fn(objArg);
    resultsCache.set(objArg, result);
    return result;
  };
}

const memoizedArea = memoizeByObjectIdentity(expensiveComputation);

const config = { width: 10, height: 5 };
console.log('First call (runs the real work):', memoizedArea(config)); // logs "ran", then 50
console.log('Second call (same object, cache hit):', memoizedArea(config)); // no "ran" log, just 50

// A DIFFERENT object with identical values is a cache MISS — the cache
// key is object identity, not deep equality. This is intentional and worth
// calling out explicitly, since it surprises people expecting value-based caching.
const configLookalike = { width: 10, height: 5 };
console.log('Third call (different object, cache miss):', memoizedArea(configLookalike)); // logs "ran" again, then 50

// ============================================================
// 6. EDGE CASE — WeakSet for cycle-safe recursive traversal
// ============================================================

console.log('--- 6. WeakSet as a "visited" marker during traversal ---');

function countNodesInGraph(node, visited = new WeakSet()) {
  if (visited.has(node)) {
    return 0; // already counted this node on this traversal — avoid infinite loop
  }
  visited.add(node);

  let count = 1; // count this node itself
  for (const neighbor of node.neighbors || []) {
    count += countNodesInGraph(neighbor, visited);
  }
  return count;
}

const nodeA = { name: 'A', neighbors: [] };
const nodeB = { name: 'B', neighbors: [] };
const nodeC = { name: 'C', neighbors: [] };
nodeA.neighbors = [nodeB];
nodeB.neighbors = [nodeC];
nodeC.neighbors = [nodeA]; // cycle back to A — would infinite-loop without `visited`

console.log('Total nodes in cyclic graph:', countNodesInGraph(nodeA)); // 3

// The `visited` WeakSet is local to this call and becomes garbage the moment
// the traversal finishes — unlike a module-level Set, it can never accumulate
// stale entries across unrelated calls or leak memory long-term.

// ============================================================
// 7. CONTRAST — why a regular Map here would be a textbook leak
// ============================================================

console.log('--- 7. Map vs WeakMap: the leak this pattern avoids ---');

// This Map-based cache looks identical to section 3's WeakMap version,
// but it holds a STRONG reference to every key it has ever seen.
const leakyMapCache = new Map();

function attachMetadataLeaky(obj, data) {
  leakyMapCache.set(obj, data); // strong reference — `obj` can NEVER be collected
  // while this Map exists and still holds it, no matter what else happens
  // to other references pointing at `obj`.
}

let temporaryNode = { id: 'temp-node' };
attachMetadataLeaky(temporaryNode, { someFlag: true });
temporaryNode = null; // the app "thinks" it dropped its reference...

// ...but it didn't, really. `leakyMapCache` still holds the original object
// alive via its own strong reference, and nothing automatically removes it.
console.log('Entries still strongly held by the leaky Map cache:', leakyMapCache.size); // 1

// In a long-running app (SPA that never reloads, a Node server process),
// repeating this pattern thousands of times across the page's lifetime,
// with every "temporary" node ever attached to this Map staying resident
// in memory forever unless someone remembers to call `.delete()` for each
// one, is EXACTLY the shape of real production memory leaks caused by
// caches outliving the data they describe. Swapping `Map` for `WeakMap`
// (as in section 3) removes this entire failure class by construction.
