// ============================================================
// DAY 21 — MICROTASK & MACROTASK SCHEDULING APIS
// Scheduling primitives covered: queueMicrotask, requestAnimationFrame,
// requestIdleCallback, process.nextTick (Node only), setImmediate (Node only).
//
// Run in a browser via index.html (open DevTools console), OR in Node via:
//   node script.js
// Sections that are Node-only are guarded so this file does not crash in
// the browser, and vice versa.
// ============================================================

// Detect which environment we're in so we can branch Node-only sections.
const isNode =
  typeof process !== 'undefined' &&
  process.versions != null &&
  process.versions.node != null;

// ============================================================
// 1. HAPPY PATH — queueMicrotask vs Promise.then, basic ordering
// ============================================================
// queueMicrotask and .then() both push onto THE SAME microtask queue.
// This proves it: they interleave in strict FIFO scheduling order, not by
// "promises are special" — queueMicrotask is just a direct enqueue API.

console.log('--- SECTION 1: happy path ---');

console.log('1.sync-start');

queueMicrotask(() => console.log('1.microtask-A (queueMicrotask)'));

Promise.resolve().then(() => console.log('1.microtask-B (promise.then)'));

queueMicrotask(() => console.log('1.microtask-C (queueMicrotask)'));

console.log('1.sync-end');

// Expected order:
//   1.sync-start           <- synchronous, runs first, no queue involved
//   1.sync-end             <- synchronous code always finishes before any queue drains
//   1.microtask-A           <- first microtask enqueued, FIFO drain order
//   1.microtask-B           <- second microtask enqueued (promise.then is ALSO a microtask)
//   1.microtask-C           <- third microtask enqueued, drains last of the three

// ============================================================
// 2. COMMON PITFALL — assuming setTimeout(fn, 0) means "run now"
// ============================================================
// setTimeout's minimum delay is CLAMPED by the spec/engine (browsers clamp
// nested timeouts to 4ms after a few calls; Node clamps to ~1ms). It also
// always goes through the macrotask queue, so it NEVER beats a microtask,
// no matter how small the delay.

console.log('--- SECTION 2: setTimeout(0) pitfall ---');

console.log('2.sync-before-timeout');

setTimeout(() => {
  // This fires as a MACROTASK. Even with delay 0, it waits for:
  //   (a) the rest of the current synchronous script to finish, AND
  //   (b) the ENTIRE microtask queue to drain first.
  console.log('2.macrotask (setTimeout 0)');
}, 0);

Promise.resolve().then(() =>
  console.log('2.microtask (beats setTimeout(0) every single time)')
);

console.log('2.sync-after-timeout');

// Expected order:
//   2.sync-before-timeout
//   2.sync-after-timeout
//   2.microtask (beats setTimeout(0) every single time)
//   2.macrotask (setTimeout 0)

// ============================================================
// 3. EDGE CASE — a microtask that schedules ANOTHER microtask
// ============================================================
// The spec rule is "drain the microtask queue until it's empty," not
// "run the microtasks that existed when draining started." If a microtask
// enqueues another microtask DURING the drain, that new one still runs
// before the engine moves on to the next macrotask. This is how you can
// accidentally starve macrotasks (an infinite .then() chain never yields
// to setTimeout/rendering/I-O).

console.log('--- SECTION 3: microtask chain (self-replenishing queue) ---');

let chainCount = 0;

function chainedMicrotask() {
  chainCount++;
  console.log(`3.microtask-chain depth=${chainCount}`);
  if (chainCount < 3) {
    // Scheduling a NEW microtask from inside a microtask callback still
    // runs before any pending macrotask, because the queue isn't
    // "snapshotted" — it drains until truly empty.
    queueMicrotask(chainedMicrotask);
  }
}

setTimeout(() => console.log('3.macrotask (only runs after ALL chained microtasks finish)'), 0);
queueMicrotask(chainedMicrotask);

// Expected order:
//   3.microtask-chain depth=1
//   3.microtask-chain depth=2
//   3.microtask-chain depth=3
//   3.macrotask (only runs after ALL chained microtasks finish)
// WHY: each chained call enqueues the next BEFORE the queue is considered
// drained, so all three depths resolve before the engine is ever allowed
// to dequeue the setTimeout macrotask.

// ============================================================
// 4. NODE-ONLY APIS — process.nextTick and setImmediate
// ============================================================
// process.nextTick: Node's own, HIGHEST-priority queue. It drains fully
//   before the Promise microtask queue, and this happens after EVERY
//   single callback Node runs (not just once per event-loop "tick").
// setImmediate: scheduled to run in the "check" phase of the libuv loop,
//   which comes right after the "poll" (I/O) phase.
// Closest browser-equivalent demonstrated in section 4b below.

if (isNode) {
  console.log('--- SECTION 4: Node-only — process.nextTick vs setImmediate vs Promise ---');

  setTimeout(() => console.log('4.setTimeout (timers phase)'), 0);

  setImmediate(() => console.log('4.setImmediate (check phase)'));

  Promise.resolve().then(() => console.log('4.promise-microtask'));

  process.nextTick(() => console.log('4.process.nextTick (drains BEFORE promise microtasks)'));

  console.log('4.sync');

  // Expected order:
  //   4.sync                         <- synchronous code first, always
  //   4.process.nextTick (...)       <- Node's nextTick queue drains before
  //                                     the Promise microtask queue, every time
  //   4.promise-microtask            <- standard microtask queue, drains next
  //   4.setTimeout (timers phase) OR 4.setImmediate (check phase)
  //                                  <- order between these two, from the TOP
  //                                     LEVEL of a script, is NOT guaranteed by
  //                                     spec — it depends on process startup
  //                                     overhead (how long it took to enter the
  //                                     timers phase vs reach check). This is
  //                                     intentionally non-deterministic here —
  //                                     see section 4b for the deterministic case.

  // ============================================================
  // 4b. The DETERMINISTIC case: setImmediate vs setTimeout inside I/O
  // ============================================================
  // Once you're already inside an I/O callback (poll phase), setImmediate
  // is GUARANTEED to run before a 0ms setTimeout, because "check" is the
  // very next phase after "poll," while timers have to wait for the loop
  // to cycle all the way back around.
  const fs = require('fs');
  fs.readFile(__filename, () => {
    setTimeout(() => console.log('4b.setTimeout inside I/O callback (loses the race)'), 0);
    setImmediate(() => console.log('4b.setImmediate inside I/O callback (wins — check phase is next)'));
  });
} else {
  console.log('--- SECTION 4: skipped (process.nextTick / setImmediate are Node-only) ---');
  console.log('Browser equivalent of "highest priority microtask-like queue" is just queueMicrotask —');
  console.log('there is no browser API with nextTick\'s "drain before every other queue" guarantee.');
}

// ============================================================
// 5. THE COMBINED TRACE PUZZLE (browser-safe; this is the README exercise)
// ============================================================
// Predict the full print order BEFORE running this. Full reasoning is in
// README.md's "Hands-On Exercise" section.

console.log('--- SECTION 5: combined trace puzzle ---');

console.log('A');
setTimeout(() => console.log('B'), 0);
queueMicrotask(() => console.log('C'));
Promise.resolve().then(() => console.log('D'));
console.log('E');

// Expected: A, E, C, D, B
//   A -> synchronous, first line to execute
//   E -> synchronous, second synchronous line; sync code always finishes
//        before any queued callback runs, regardless of what's queued
//        in between
//   C -> first microtask in FIFO order (queueMicrotask was called before
//        the Promise .then())
//   D -> second microtask in FIFO order (Promise.resolve().then())
//   B -> macrotask; only dequeued after the ENTIRE microtask queue (C, D)
//        has fully drained, even though setTimeout was the FIRST async
//        call made in source order

// ============================================================
// 6. BROWSER-ONLY APIS — requestAnimationFrame & requestIdleCallback
// ============================================================
// These do not exist in Node. Guarded so this file still runs cleanly
// under `node script.js`.

if (!isNode && typeof window !== 'undefined') {
  console.log('--- SECTION 6: browser-only — requestAnimationFrame & requestIdleCallback ---');

  console.log('6.sync');

  Promise.resolve().then(() => console.log('6.microtask (always before rAF)'));

  // requestAnimationFrame: fires right before the browser's next repaint,
  // synced to the display refresh rate (~16.6ms at 60Hz). It is NOT a
  // "task queue" item in the setTimeout sense — it's tied to the rendering
  // pipeline itself and is skipped/throttled on hidden/background tabs.
  requestAnimationFrame(() => {
    console.log('6.requestAnimationFrame (runs right before the next paint)');
  });

  // requestIdleCallback: lowest priority of everything on this page. Only
  // fires if the browser has genuinely spare time before the next frame
  // is due. Not implemented in Safari, so we guard for that too.
  if ('requestIdleCallback' in window) {
    requestIdleCallback((deadline) => {
      console.log(
        `6.requestIdleCallback (idle time remaining: ${deadline.timeRemaining().toFixed(2)}ms)`
      );
    });
  } else {
    console.log('6.requestIdleCallback is not supported in this browser (e.g. Safari) — skipped.');
  }

  // setTimeout as the macrotask baseline for comparison against rAF/idle.
  setTimeout(() => console.log('6.setTimeout macrotask (for comparison against rAF/idle)'), 0);

  // Expected relative order (exact rAF/idle timing varies by frame budget,
  // but the RELATIVE priority is deterministic):
  //   6.sync                        <- synchronous
  //   6.microtask (...)             <- microtask queue drains before rendering
  //   6.requestAnimationFrame (...) <- runs just before the browser paints
  //                                    the next frame
  //   6.setTimeout macrotask (...)  <- ordinary macrotask; may interleave
  //                                    with rAF depending on frame timing,
  //                                    but always after the microtask queue
  //   6.requestIdleCallback (...)   <- lowest priority; fires only once the
  //                                    browser has genuinely idle time,
  //                                    typically AFTER the frame's paint work
} else if (isNode) {
  console.log('--- SECTION 6: skipped (requestAnimationFrame / requestIdleCallback are browser-only) ---');
}
