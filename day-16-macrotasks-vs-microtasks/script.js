// ============================================================
// DAY 16: MACROTASKS vs MICROTASKS
// ============================================================
// Core rule under test in every example below:
//   The engine runs ONE macrotask, then drains the ENTIRE
//   microtask queue (including microtasks scheduled DURING that
//   drain) before it ever picks up the next macrotask.
// ============================================================


// ============================================================
// 1. HAPPY PATH — the mechanism working as expected
// ============================================================
// A minimal demonstration: one macrotask (setTimeout) registered
// before one microtask (Promise.then), yet the microtask wins.

console.log('[1] sync: before scheduling anything');

setTimeout(() => {
  // This callback is a MACROTASK. Even though it was registered
  // FIRST in source order, it goes to the back of the macrotask
  // queue and must wait for the current synchronous run AND the
  // full microtask queue to drain first.
  console.log('[1] macrotask: setTimeout fired');
}, 0);

Promise.resolve().then(() => {
  // This callback is a MICROTASK. It was registered SECOND in
  // source order but runs FIRST, because all microtasks drain
  // before the next macrotask is even considered.
  console.log('[1] microtask: promise.then fired');
});

console.log('[1] sync: after scheduling, still in same macrotask');

// Expected order for this block alone (interleaved with blocks
// below since they all run in the same script):
//   sync: before -> sync: after -> microtask: promise.then -> macrotask: setTimeout


// ============================================================
// 2. COMMON PITFALL(S)
// ============================================================

// PITFALL A: assuming setTimeout(fn, 0) means "run immediately."
// It means "run as soon as possible, but strictly after the
// current synchronous code AND after the microtask queue drains."
function pitfallZeroDelayMyth() {
  console.log('[2A] start');
  setTimeout(() => console.log('[2A] timeout(0) callback'), 0);
  console.log('[2A] end');
  // Output will ALWAYS be: start, end, timeout(0) callback
  // never: start, timeout(0) callback, end
}
pitfallZeroDelayMyth();

// PITFALL B: a long/looping microtask chain can starve the
// macrotask queue, blocking timers (and in a browser, blocking
// rendering/input) indefinitely. This is a REAL production bug
// class, not a toy example.
function starvationDemo() {
  console.log('[2B] starvation demo: start');

  // Register a macrotask we EXPECT to run "soon".
  setTimeout(() => {
    console.log('[2B] starved macrotask finally ran');
  }, 0);

  let count = 0;
  function recursiveMicrotask() {
    count++;
    if (count <= 5) {
      // Each call enqueues ANOTHER microtask before yielding.
      // With a small bound (5) here so the demo actually finishes
      // and prints output — in the real bug I debugged, this was
      // an unbounded retry-via-microtask loop that starved a
      // setTimeout-driven UI heartbeat for multiple seconds.
      queueMicrotask(recursiveMicrotask);
    } else {
      console.log('[2B] microtask chain finally yielding, count =', count);
    }
  }
  queueMicrotask(recursiveMicrotask);

  console.log('[2B] starvation demo: end of sync code');
  // Expected: ALL 5 recursive microtask turns complete (and the
  // "finally yielding" log) BEFORE "starved macrotask finally ran"
  // ever prints, proving the starvation mechanism.
}
starvationDemo();

// PITFALL C: forgetting that the Promise CONSTRUCTOR body runs
// SYNCHRONOUSLY, immediately, on the calling thread. Only the
// .then() callback is deferred to the microtask queue.
function constructorIsSyncDemo() {
  console.log('[2C] before new Promise');
  new Promise((resolve) => {
    console.log('[2C] INSIDE constructor — this runs synchronously, right now');
    resolve('done');
  }).then((val) => {
    console.log('[2C] .then callback — this is the deferred microtask:', val);
  });
  console.log('[2C] after new Promise');
  // Expected: before -> INSIDE constructor -> after -> .then callback
}
constructorIsSyncDemo();


// ============================================================
// 3. EDGE CASE(S)
// ============================================================

// EDGE CASE A: queueMicrotask vs Promise.then — both are
// microtasks and drain in the SAME queue, in registration order,
// regardless of which API scheduled them.
function mixedMicrotaskApisDemo() {
  console.log('[3A] start');
  queueMicrotask(() => console.log('[3A] queueMicrotask #1'));
  Promise.resolve().then(() => console.log('[3A] promise.then #1'));
  queueMicrotask(() => console.log('[3A] queueMicrotask #2'));
  console.log('[3A] end');
  // Expected: start, end, queueMicrotask #1, promise.then #1,
  // queueMicrotask #2 — strict FIFO across BOTH APIs because
  // they share one underlying microtask queue.
}
mixedMicrotaskApisDemo();

// EDGE CASE B: setInterval is ALSO a macrotask, scheduled
// repeatedly. Each firing still waits for the microtask queue to
// drain. We clear it after 2 fires so this script terminates
// cleanly instead of running forever.
function intervalIsMacrotaskDemo() {
  let fires = 0;
  const intervalId = setInterval(() => {
    fires++;
    console.log('[3B] setInterval fire #', fires);
    // Even inside this macrotask, if we schedule a microtask here,
    // it will drain before the NEXT setInterval fire — proving
    // setInterval callbacks are macrotasks, not microtasks.
    Promise.resolve().then(() =>
      console.log('[3B] microtask queued from inside interval fire #', fires)
    );
    if (fires >= 2) {
      clearInterval(intervalId);
      console.log('[3B] interval cleared after 2 fires');
    }
  }, 0);
}
intervalIsMacrotaskDemo();


// ============================================================
// 4. ASYNC ORDERING TRACE — the exact puzzle from README.md
// ============================================================
// This is the single most important block in this file. Every
// line is annotated with WHY it fires when it does, per the
// spec rule: drain ALL microtasks between each macrotask.

function theOrderingPuzzle() {
  console.log('1: script start');
  // ^ SYNCHRONOUS. Runs immediately as part of the initial
  //   macrotask (the top-level script execution itself counts
  //   as a macrotask for ordering purposes).

  setTimeout(() => console.log('2: setTimeout 1'), 0);
  // ^ Registers a MACROTASK. Goes to the back of the macrotask
  //   queue. Cannot run until the current synchronous run AND
  //   the entire microtask queue (including anything enqueued
  //   later in this same script) have fully drained.

  Promise.resolve()
    .then(() => console.log('3: promise 1'))
    // ^ Promise.resolve() is already fulfilled, so this .then
    //   callback is enqueued as a MICROTASK immediately, during
    //   the synchronous run. It is the FIRST microtask enqueued
    //   so far.
    .then(() => console.log('4: promise 1 chained'));
    // ^ This second .then is NOT enqueued yet! It can only be
    //   enqueued once the FIRST .then's callback (which logs '3')
    //   actually executes and its return value settles. So right
    //   now, at synchronous-run time, only ONE microtask job
    //   exists for this chain (the one that logs '3').

  setTimeout(() => console.log('5: setTimeout 2'), 0);
  // ^ Second MACROTASK registered. Goes to the back of the
  //   macrotask queue, behind '2'.

  Promise.resolve().then(() => console.log('6: promise 2'));
  // ^ Another already-resolved promise — its .then callback is
  //   enqueued as a MICROTASK right now, during the synchronous
  //   run. This is the SECOND microtask job in the queue,
  //   enqueued AFTER the job that logs '3' but BEFORE anything
  //   from that chain's continuation (because '4' hasn't been
  //   enqueued yet — see above).

  console.log('7: script end');
  // ^ SYNCHRONOUS. Finishes the initial macrotask. At this exact
  //   moment the microtask queue holds, in order: [logs '3', logs '6'].
  //   The macrotask queue holds, in order: [logs '2', logs '5'].

  // --- Initial macrotask (the script) is now complete. ---
  // --- Event loop now drains the microtask queue FULLY: ---

  // MICROTASK TURN 1: runs the job that logs '3'.
  //   WHY NOW: it was the first job enqueued, FIFO within the
  //   microtask queue.
  //   SIDE EFFECT: its completion enqueues the chain's NEXT
  //   .then (the one that logs '4') as a NEW microtask job,
  //   appended to the END of the (still-draining) microtask
  //   queue — behind the job that logs '6', which was already
  //   sitting there.

  // MICROTASK TURN 2: runs the job that logs '6'.
  //   WHY NOW: it was enqueued before '4' (since '4' only got
  //   enqueued during turn 1, AFTER '6' was already queued).

  // MICROTASK TURN 3: runs the job that logs '4'.
  //   WHY NOW: it's the only remaining microtask job, enqueued
  //   during turn 1 but ordered after '6' in the FIFO queue.

  // --- Microtask queue is now EMPTY. Event loop may finally
  //     advance to the next MACROTASK. ---

  // MACROTASK TURN 1: runs the setTimeout callback that logs '2'.
  //   WHY NOW: it's the first macrotask registered via setTimeout,
  //   and the microtask queue had to be fully empty first.

  // (The event loop drains the microtask queue again here —
  //  it's empty, so nothing happens, and it proceeds straight to
  //  the next macrotask.)

  // MACROTASK TURN 2: runs the setTimeout callback that logs '5'.
  //   WHY NOW: FIFO order among macrotasks registered via
  //   setTimeout with the same delay — '5' was registered after
  //   '2'.

  // FINAL EXPECTED CONSOLE ORDER: 1, 7, 3, 6, 4, 2, 5
}
theOrderingPuzzle();


// ============================================================
// 5. NODE.JS NOTE (how this differs, previewed — full detail Day 20)
// ============================================================
// In Node.js, `process.nextTick()` callbacks drain in their OWN
// queue, which is processed to completion BEFORE the regular
// microtask (Promise) queue on every transition point. This file
// intentionally does NOT call process.nextTick (browser sandbox
// has no such API) — Day 20's script.js covers it with real,
// runnable Node-only code plus a browser-equivalent fallback.
console.log(
  '[5] Node note: process.nextTick would jump ahead of Promise ' +
  'microtasks in Node — see Day 20 for a runnable demo.'
);
