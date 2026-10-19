// ============================================================
// DAY 20: RUNTIME APIs — BROWSER vs NODE.JS
// ============================================================
// Key fact: ECMA-262 only specifies the microtask/Job queue.
// Everything about macrotasks, task sources, and "the event
// loop" structure itself is defined by the HOST (browser spec /
// libuv in Node), not the JS language spec.
//
// This file runs in BOTH environments. Node-only sections are
// guarded with runtime checks so the browser sandbox (index.html)
// doesn't throw — and each Node-only section has a browser-
// equivalent example right next to it, per the assignment spec.
// ============================================================

// Detect which runtime we're in, since this script is shared
// between index.html (browser) and `node script.js` (Node).
const isNode =
  typeof process !== 'undefined' &&
  process.versions != null &&
  process.versions.node != null;

console.log('[0] runtime detected:', isNode ? 'Node.js' : 'Browser');


// ============================================================
// 1. HAPPY PATH — the one thing BOTH runtimes agree on: the
//    microtask queue (ECMA-262 spec'd), drained fully between
//    callback boundaries, regardless of host.
// ============================================================

console.log('[1] start');
Promise.resolve().then(() => console.log('[1] microtask A'));
Promise.resolve().then(() => console.log('[1] microtask B'));
console.log('[1] end');
// Expected in BOTH Node and browser, identically: start, end,
// microtask A, microtask B — this part of the spec has no
// runtime variance at all, because it's not a host concern.


// ============================================================
// 2. COMMON PITFALL(S)
// ============================================================

// PITFALL A: assuming "the event loop" means the same scheduling
// structure everywhere. Demonstrated by comparing setTimeout(fn,0)
// ordering relative to a microtask in each runtime (same outcome
// here, but for DIFFERENT structural reasons under the hood —
// browser: one task queue + microtask drain; Node: timers PHASE
// vs microtask queue drain between phases).
function pitfallAssumingUniversalLoop() {
  console.log('[2A] start');
  setTimeout(() => console.log('[2A] setTimeout (macrotask / timers phase)'), 0);
  Promise.resolve().then(() => console.log('[2A] promise (microtask queue)'));
  console.log('[2A] end');
  // Expected (same observable order in both runtimes, different
  // mechanism underneath): start, end, promise, setTimeout
}
pitfallAssumingUniversalLoop();

// PITFALL B (Node.js only): assuming process.nextTick is "just
// Node's queueMicrotask." It's actually a SEPARATE, HIGHER
// priority queue that drains completely before the Promise
// microtask queue at every callback boundary in Node.
if (isNode) {
  console.log('[2B] Node.js only: process.nextTick vs Promise microtask priority');
  console.log('[2B] start');
  Promise.resolve().then(() => console.log('[2B] promise microtask'));
  process.nextTick(() => console.log('[2B] process.nextTick (Node-only, higher priority queue)'));
  console.log('[2B] end');
  // Expected in Node: start, end, process.nextTick, promise microtask
  // process.nextTick's queue is drained BEFORE the Promise microtask
  // queue, even though the promise .then was registered FIRST.
} else {
  // Browser-equivalent: there is no process.nextTick concept in the
  // browser at all — queueMicrotask is the closest API, but it
  // shares the SAME queue as Promise.then (no separate priority
  // tier), which is itself the point worth demonstrating: the
  // browser has only ONE microtask queue, Node effectively has two
  // priority tiers (nextTick queue, then Promise microtask queue).
  console.log('[2B] Browser equivalent: queueMicrotask shares the SAME queue as Promise.then');
  console.log('[2B] start');
  Promise.resolve().then(() => console.log('[2B] promise microtask'));
  queueMicrotask(() => console.log('[2B] queueMicrotask (SAME queue, just FIFO order)'));
  console.log('[2B] end');
  // Expected in browser: start, end, promise microtask, queueMicrotask
  // — strict FIFO because both share ONE queue, unlike Node's two tiers.
}

// PITFALL C (Node.js only): recursive process.nextTick calls can
// starve I/O entirely — Node's own documentation warns about this.
// We bound the recursion so this demo actually terminates.
if (isNode) {
  function demoNextTickStarvationRisk() {
    console.log('[2C] Node.js only: bounded recursive nextTick (unbounded would starve I/O)');
    let count = 0;
    function recurse() {
      count++;
      if (count <= 3) {
        process.nextTick(recurse);
      } else {
        console.log('[2C] nextTick recursion stopped at count =', count);
      }
    }
    process.nextTick(recurse);
  }
  demoNextTickStarvationRisk();
} else {
  // Browser-equivalent cautionary tale: recursive queueMicrotask
  // calls can likewise starve rendering/macrotasks if unbounded —
  // same CLASS of bug, different queue.
  function demoMicrotaskStarvationRisk() {
    console.log('[2C] Browser equivalent: bounded recursive queueMicrotask (unbounded would starve rendering)');
    let count = 0;
    function recurse() {
      count++;
      if (count <= 3) {
        queueMicrotask(recurse);
      } else {
        console.log('[2C] queueMicrotask recursion stopped at count =', count);
      }
    }
    queueMicrotask(recurse);
  }
  demoMicrotaskStarvationRisk();
}


// ============================================================
// 3. EDGE CASE(S)
// ============================================================

// EDGE CASE A (Node.js only): setTimeout(fn, 0) vs setImmediate()
// ordering is deterministic INSIDE an I/O callback (setImmediate
// always wins there), but NOT guaranteed at the top level.
if (isNode) {
  const fs = require('fs');
  console.log('[3A] Node.js only: setImmediate vs setTimeout(0) — top-level (order NOT guaranteed)');
  setTimeout(() => console.log('[3A] top-level: setTimeout(0) fired'), 0);
  setImmediate(() => console.log('[3A] top-level: setImmediate fired'));

  // Now the deterministic case: schedule both from INSIDE an I/O
  // callback (poll phase). setImmediate (check phase) is
  // guaranteed to run before a NEW setTimeout(0) here, because
  // check comes right after poll in the SAME loop iteration,
  // while the timer needs a whole NEW iteration to reach timers.
  fs.readFile(__filename, () => {
    console.log('[3A] inside I/O callback: scheduling setTimeout(0) and setImmediate');
    setTimeout(() => console.log('[3A] inside I/O callback: setTimeout(0) fired (LOSES the race here)'), 0);
    setImmediate(() => console.log('[3A] inside I/O callback: setImmediate fired (ALWAYS WINS here)'));
  });
} else {
  // Browser-equivalent: there's no setImmediate/phase model, but
  // we CAN demonstrate the analogous "closest macrotask API wins
  // predictably when scheduled from the same context" idea using
  // setTimeout vs a MessageChannel-based "immediate" polyfill,
  // which many libraries (e.g. older React) have historically used
  // to approximate setImmediate in browsers.
  console.log('[3A] Browser equivalent: MessageChannel-based pseudo-"setImmediate"');
  function browserSetImmediate(callback) {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => callback();
    channel.port2.postMessage(null);
    // MessageChannel callbacks run as a macrotask, generally
    // scheduled sooner than a setTimeout(fn, 0) in most browsers,
    // which is exactly why libraries used this trick before
    // native scheduler APIs existed.
  }
  setTimeout(() => console.log('[3A] setTimeout(0) fired'), 0);
  browserSetImmediate(() => console.log('[3A] MessageChannel pseudo-immediate fired'));
}

// EDGE CASE B (Browser only): requestAnimationFrame is its own
// task source, timed to run right before the next repaint — NOT
// FIFO-equivalent to setTimeout.
if (!isNode && typeof requestAnimationFrame === 'function') {
  console.log('[3B] Browser only: requestAnimationFrame vs setTimeout(0)');
  setTimeout(() => console.log('[3B] setTimeout(0) fired'), 0);
  requestAnimationFrame(() => console.log('[3B] requestAnimationFrame fired (timed to pre-repaint)'));
  Promise.resolve().then(() => console.log('[3B] microtask fired (always before either macrotask-ish callback above)'));
} else if (isNode) {
  // Node-equivalent note: Node has no rendering pipeline at all,
  // so there is no rAF analog — this is a genuinely browser-only
  // concept, which is itself worth saying out loud in an interview.
  console.log('[3B] Node.js note: no requestAnimationFrame equivalent exists — Node has no rendering pipeline.');
}


// ============================================================
// 4. ASYNC ORDERING TRACE — the exact puzzles from README.md
// ============================================================

function nodeOrderingPuzzle() {
  console.log('--- [4] Node.js ordering puzzle ---');
  console.log('start');
  // ^ SYNCHRONOUS.

  setTimeout(() => console.log('timeout'), 0);
  // ^ Registers a callback for the TIMERS phase. Whether its
  //   delay has technically "elapsed" by the time the loop
  //   reaches the timers phase is a function of real wall-clock
  //   time and process startup overhead — hence non-determinism
  //   at the top level vs setImmediate.

  setImmediate(() => console.log('immediate'));
  // ^ Registers a callback for the CHECK phase, which runs AFTER
  //   poll (and after timers, in loop order) in the same
  //   iteration.

  process.nextTick(() => console.log('nextTick'));
  // ^ Registers on Node's OWN highest-priority queue — drained
  //   FULLY before the Promise microtask queue, and before ANY
  //   libuv phase, at the very next callback boundary (which here
  //   is "right after this synchronous script finishes").

  Promise.resolve().then(() => console.log('promise'));
  // ^ Registers on the ECMA-262 Promise microtask queue — drained
  //   fully AFTER process.nextTick's queue, but still before any
  //   libuv phase (timers/poll/check).

  console.log('end');
  // ^ SYNCHRONOUS. Finishes the initial script.

  // --- Callback boundary reached. Node's priority order kicks in: ---
  // STEP 1: drain process.nextTick queue fully -> logs 'nextTick'.
  //   WHY FIRST: Node's documented highest-priority queue, checked
  //   before anything else at every callback boundary.
  // STEP 2: drain Promise microtask queue fully -> logs 'promise'.
  //   WHY SECOND: ECMA-262 microtask queue, lower priority than
  //   process.nextTick in Node specifically, but still ahead of
  //   any libuv phase.
  // STEP 3: loop proceeds through phases: timers phase runs
  //   'timeout' IF its delay has elapsed by now (overwhelmingly
  //   likely for a 0ms delay checked this soon) -> logs 'timeout'.
  // STEP 4: loop reaches the check phase later in the SAME
  //   iteration -> logs 'immediate'.
  // EXPECTED NODE ORDER: start, end, nextTick, promise, timeout, immediate
  // (timeout vs immediate order can swap at the top level in rare
  // cases depending on process timing — this is explicitly
  // non-guaranteed per the Node docs, unlike the deterministic
  // in-I/O-callback case demonstrated in section 3A above).
}

function browserOrderingPuzzle() {
  console.log('--- [4] Browser ordering puzzle ---');
  console.log('start');
  // ^ SYNCHRONOUS.

  setTimeout(() => console.log('timeout'), 0);
  // ^ Registers a macrotask (timer task source). Goes to the back
  //   of the browser's task queue.

  Promise.resolve().then(() => console.log('promise'));
  // ^ Registers a microtask (ECMA-262 Job queue) — the ONLY queue
  //   that exists at this granularity in the browser; no
  //   nextTick-style extra tier.

  console.log('end');
  // ^ SYNCHRONOUS. Finishes the initial task (the script itself).

  // --- Microtask queue drains fully -> logs 'promise'. ---
  // --- Next macrotask runs -> logs 'timeout'. ---
  // EXPECTED BROWSER ORDER: start, end, promise, timeout
}

if (isNode) {
  nodeOrderingPuzzle();
} else {
  browserOrderingPuzzle();
}
