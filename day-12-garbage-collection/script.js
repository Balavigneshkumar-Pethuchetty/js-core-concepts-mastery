// ============================================================
// DAY 12 — GARBAGE COLLECTION: REACHABILITY, GENERATIONS, REAL LEAKS
// ============================================================
// Run via index.html (DOM examples need a document) or `node script.js`
// (DOM sections are guarded so this also runs standalone in Node).

const isBrowser = typeof document !== 'undefined';

console.log('=== SECTION 1: REACHABILITY -- THE CORE GC RULE ===');

// ------------------------------------------------------------
// 1. HAPPY PATH — an object becomes unreachable and is eligible for GC
// ------------------------------------------------------------
let rootRef = { payload: 'I am reachable from a root (the variable rootRef)' };
console.log('rootRef:', rootRef.payload);

rootRef = null; // the ONLY reference to that object is gone now.
// The object `{ payload: ... }` is now unreachable from any root.
// It is eligible for collection. WHEN the engine actually reclaims it is
// up to V8's scheduler -- setting to null does not force immediate GC.
console.log('rootRef after null:', rootRef); // null

// Circular references do NOT defeat reachability-based GC (unlike naive
// reference-counting), because V8 traces from roots, not ref-counts.
function makeCircularPair() {
  const a = {};
  const b = {};
  a.friend = b;
  b.friend = a; // circular: a -> b -> a
  return 'created a circular pair, both local to this function';
}
console.log(makeCircularPair());
// Once makeCircularPair() returns, NEITHER a nor b is reachable from any
// root anymore (the function's local scope is gone), even though they
// reference each other. Mark-and-sweep correctly collects both. A naive
// reference-counting GC would leak this pair forever (each other's count
// never hits zero) -- this is precisely why V8 does not rely on ref-counting.


console.log('\n=== SECTION 2: STRONG REFERENCE LEAK (Map as an unbounded cache) ===');

// ------------------------------------------------------------
// 2. COMMON PITFALL — a Map holds STRONG references to its keys forever
// ------------------------------------------------------------
const strongCache = new Map(); // simulates e.g. a "DOM element cache" or memoization cache

function cacheAndMaybeDiscard(id) {
  // Simulate an object that would normally be a DOM node, API response, etc.
  const bigObject = { id, data: new Array(1000).fill(id) };
  strongCache.set(id, bigObject); // Map now holds a STRONG ref -- keeps bigObject alive
  return bigObject;
}

function removeAndDiscard(id) {
  // This LOOKS like cleanup, but it only clears a LOCAL reference if one
  // existed -- it does NOT touch the Map's internal reference.
  // THE BUG: we forgot to call strongCache.delete(id).
  console.log(`removeAndDiscard(${id}) called, but strongCache still holds a reference!`);
}

cacheAndMaybeDiscard('item-1');
cacheAndMaybeDiscard('item-2');
removeAndDiscard('item-1'); // "looks" like cleanup...
console.log('strongCache.size after "removal":', strongCache.size); // 2 -- STILL THERE. This is the leak.
console.log('strongCache still has item-1:', strongCache.has('item-1')); // true -- never actually freed

// THE FIX, demonstrated explicitly: you must explicitly evict from a strong Map.
function properRemoveAndDiscard(id) {
  strongCache.delete(id); // THIS is what actually breaks the reference chain
  console.log(`properRemoveAndDiscard(${id}) -- entry actually evicted`);
}
properRemoveAndDiscard('item-1');
console.log('strongCache.size after proper removal:', strongCache.size); // 1 -- correctly freed


console.log('\n=== SECTION 3: WeakMap -- THE CORRECT TOOL FOR THIS PROBLEM ===');

// ------------------------------------------------------------
// 3. HAPPY PATH — WeakMap keys do not keep their referents alive
// ------------------------------------------------------------
const weakCache = new WeakMap(); // keys MUST be objects (not primitives), by spec

let tempObjectKey = { name: 'temp-session-object' };
weakCache.set(tempObjectKey, { cachedMetadata: 'some derived value' });
console.log('weakCache has tempObjectKey:', weakCache.has(tempObjectKey)); // true

tempObjectKey = null; // this was the ONLY strong reference to that object.
// weakCache's internal reference to it is WEAK -- it does not count toward
// reachability. The object is now eligible for GC, and once collected,
// its WeakMap entry disappears automatically. We cannot observe or force
// the exact timing (WeakMap/WeakSet deliberately offer no iteration or
// size inspection -- by design, so code can never depend on GC timing).
console.log('tempObjectKey after null:', tempObjectKey); // null
console.log('(entry for the original object will be auto-removed once GC runs -- not observable or forceable from script)');


console.log('\n=== SECTION 4: LISTENER/CLOSURE LEAK CHAIN ===');

// ------------------------------------------------------------
// 4. EDGE CASE — a listener keeps an entire closure scope (incl. large data) alive
// ------------------------------------------------------------
let activeHandler = null; // module-level so we can clean it up later

function createListenerLeak() {
  // Simulate a large retained buffer that SHOULD be short-lived.
  const hugeBuffer = new Array(100000).fill('x'); // ~ a sizable heap allocation

  function handler() {
    // Only .length is used, but because `handler` is a closure defined in
    // the same scope as hugeBuffer, the engine must keep hugeBuffer
    // reachable for as long as `handler` itself is reachable (V8 does
    // optimize away TRULY unused bindings in many cases, but you should
    // never rely on that -- treat the whole enclosing scope as retained).
    console.log('handler invoked, buffer length still:', hugeBuffer.length);
  }

  activeHandler = handler; // simulate addEventListener('scroll', handler) on `window`
  console.log('listener registered -- hugeBuffer is now kept alive by the reference chain:');
  console.log('  window/root -> activeHandler -> handler closure -> hugeBuffer');
  return handler;
}

function cleanupListener() {
  // This is the ACTUAL fix: breaking the root -> listener link.
  // Equivalent in a real app to window.removeEventListener('scroll', handler).
  activeHandler = null;
  console.log('cleanupListener() called -- chain broken, hugeBuffer now unreachable and GC-eligible');
}

const registeredHandler = createListenerLeak();
registeredHandler(); // simulate the event firing once
cleanupListener(); // simulate component unmount / page teardown doing the right thing


console.log('\n=== SECTION 5: DETACHED DOM NODE (browser-only; guarded for Node) ===');

// ------------------------------------------------------------
// 5. EDGE CASE — detached DOM nodes, the classic SPA leak
// ------------------------------------------------------------
if (isBrowser) {
  const detachedCache = new Map();

  function createAndCacheNode(id) {
    const el = document.createElement('div');
    el.textContent = `node-${id}`;
    document.body.appendChild(el);
    detachedCache.set(id, el); // cached for "reuse" -- a common real pattern
    return el;
  }

  function removeFromDomOnly(id) {
    const el = detachedCache.get(id);
    el.remove(); // removed from the visible DOM tree...
    // ...but detachedCache still holds a strong reference to `el`.
    // DevTools Memory tab would flag this exact node as "Detached" --
    // present in a heap snapshot but not attached to document.body.
    console.log(`node ${id} removed from DOM but still retained by detachedCache (this is the leak)`);
  }

  function removeFromDomAndCache(id) {
    const el = detachedCache.get(id);
    el.remove();
    detachedCache.delete(id); // THIS line is what actually fixes it
    console.log(`node ${id} removed from DOM AND evicted from cache -- fully collectible now`);
  }

  createAndCacheNode('a');
  removeFromDomOnly('a'); // leak: node is detached but still referenced
  removeFromDomAndCache('a'); // no-op here since 'a' already removed from DOM; shown for API completeness

  createAndCacheNode('b');
  removeFromDomAndCache('b'); // correct pattern end to end
  console.log('detachedCache.size at end:', detachedCache.size); // 0 -- clean
} else {
  console.log('(Node.js environment detected -- DOM example skipped; run in index.html to see it execute)');
  console.log('Conceptually: document.createElement + appendChild + a Map cache that never calls .delete()');
  console.log('is the #1 real-world detached-node leak pattern in long-lived single-page apps.');
}

console.log('\n=== DONE: open Chrome DevTools > Memory tab and take heap snapshots to see this live. ===');
