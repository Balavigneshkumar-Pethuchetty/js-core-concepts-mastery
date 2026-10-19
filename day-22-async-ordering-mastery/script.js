// ============================================================
// DAY 22 — ASYNC ORDERING MASTERY (capstone of the Day 15-22 async arc)
// Four increasingly hard "predict the output" puzzles, each annotated
// line-by-line with WHY it fires when it does.
//
// Run with: node script.js   (or open index.html and check the console)
//
// Core rule used in every trace below:
//   1. Run the current synchronous call stack to completion.
//   2. Drain the microtask queue COMPLETELY, FIFO, including microtasks
//      that get enqueued WHILE draining.
//   3. Dequeue exactly ONE macrotask, run it to completion.
//   4. Go back to step 2.
//
// Each puzzle runs inside its own IIFE so the puzzles don't interleave
// with each other's timers/microtasks when run back-to-back in one file.
// We stagger them slightly with setTimeout so console output stays in
// clean, readable blocks per puzzle (this staggering does not change the
// internal ordering logic being demonstrated inside each puzzle).
// ============================================================

function printHeader(title) {
  console.log(`\n--- ${title} ---`);
}

// ============================================================
// PUZZLE 1 — WARM-UP: one macrotask, one microtask, two sync lines
// ============================================================
function puzzle1() {
  printHeader('PUZZLE 1: warm-up');

  console.log('P1.A'); // sync — runs the instant this line is reached

  setTimeout(() => console.log('P1.B'), 0);
  // ^ macrotask. Scheduled FIRST in source order, but macrotasks are only
  // considered AFTER the full synchronous run AND the full microtask
  // drain, so it prints LAST despite being scheduled earliest here.

  Promise.resolve().then(() => console.log('P1.C'));
  // ^ microtask. Scheduled after the setTimeout call above, but microtasks
  // always drain before the next macrotask, so this prints BEFORE P1.B.

  console.log('P1.D'); // sync — still part of the same unbroken call stack as P1.A

  // Expected output: P1.A, P1.D, P1.C, P1.B
  //   P1.A -> first synchronous line
  //   P1.D -> second synchronous line; the engine never pauses mid-script
  //           to check queues, so both sync lines print before any queue
  //   P1.C -> the only pending microtask; drains once the stack is empty
  //   P1.B -> the only pending macrotask; only dequeued after the
  //           microtask queue is confirmed empty
}

// ============================================================
// PUZZLE 2 — ASYNC FUNCTION CALL BOUNDARY
// ============================================================
function puzzle2() {
  printHeader('PUZZLE 2: async function call boundary');

  async function f() {
    console.log('P2.1');
    // ^ This runs SYNCHRONOUSLY the instant f() is invoked below — code
    // before the first `await` in an async function is not deferred at all.

    await null;
    // ^ SUSPENDS f() right here. `await null` is equivalent to
    // `await Promise.resolve(null)` — even a non-promise value forces one
    // microtask-queue hop. Execution returns to f()'s CALLER immediately.

    console.log('P2.2');
    // ^ This is the "continuation" — it only runs once the microtask queue
    // reaches it, strictly after the synchronous code that follows f()'s
    // call site has already finished.
  }

  console.log('P2.3'); // sync, runs before f() is even called

  f();
  // ^ Calling f() immediately runs P2.1 synchronously, hits `await null`,
  // suspends, and returns a pending promise to this call site. Execution
  // here continues immediately to the next line — f() does NOT block us.

  console.log('P2.4'); // sync, runs right after f() returns control to us

  // Expected output: P2.3, P2.1, P2.4, P2.2
  //   P2.3 -> logged before f() is even invoked
  //   P2.1 -> logged synchronously DURING the f() call, before f() suspends
  //   P2.4 -> logged synchronously AFTER f() hands control back (at the
  //           await), proving the caller is never blocked by await
  //   P2.2 -> logged only once the call stack empties and the microtask
  //           queue drains to f()'s suspended continuation
}

// ============================================================
// PUZZLE 3 — MICROTASK CHAIN NESTED INSIDE A MACROTASK, RACING A SECOND MACROTASK
// ============================================================
function puzzle3() {
  printHeader('PUZZLE 3: nested microtask vs a second macrotask');

  setTimeout(() => {
    console.log('P3.timeout-1');
    // ^ First macrotask to run (registered first, same 0ms delay).
    Promise.resolve().then(() => console.log('P3.nested-microtask'));
    // ^ Enqueues a NEW microtask from INSIDE a macrotask callback. The
    // engine's rule doesn't care where a microtask came from — before it
    // is allowed to dequeue the NEXT macrotask (timeout-2 below), it must
    // fully drain the queue again, so this nested microtask jumps ahead
    // of timeout-2 even though timeout-2 was already waiting.
  }, 0);

  setTimeout(() => console.log('P3.timeout-2'), 0);
  // ^ Second macrotask, same delay, registered second — would run right
  // after timeout-1 IF nothing else were queued, but it isn't, because
  // the nested microtask above cuts in line first.

  Promise.resolve().then(() => console.log('P3.top-level-microtask'));
  // ^ This microtask is already queued before either timeout fires, so it
  // is guaranteed to drain before ANY macrotask, including timeout-1.

  // Expected output:
  //   P3.top-level-microtask   <- drains before the first macrotask even starts
  //   P3.timeout-1             <- first macrotask dequeued
  //   P3.nested-microtask      <- queued DURING timeout-1's execution; the
  //                               microtask queue is re-drained before the
  //                               engine is allowed to move to the next macrotask
  //   P3.timeout-2             <- second macrotask, only now dequeued
}

// ============================================================
// PUZZLE 4 — THE HARD ONE: async/await with two awaits, interleaved
// with a top-level promise and a macrotask
// ============================================================
function puzzle4() {
  printHeader('PUZZLE 4: the hard one — multi-hop await interleaving');

  console.log('P4.start'); // sync

  setTimeout(() => console.log('P4.timeout'), 0);
  // ^ Macrotask. Registered early, but will not run until BOTH the
  // synchronous code below AND every microtask (including ones created
  // across multiple await hops) have fully drained.

  async function asyncFn() {
    console.log('P4.async-fn-start');
    // ^ Runs synchronously the instant asyncFn() is called, same as Puzzle 2.

    await Promise.resolve();
    // ^ HOP 1: suspends here. Modern engines (V8 7.2+ / Node 12+) resolve
    // `await <native promise>` in exactly ONE microtask tick (an earlier
    // spec quirk needed 3 ticks; this was optimized and is the current,
    // correct behavior to reason about). The continuation below is
    // scheduled as a single microtask.

    console.log('P4.async-fn-after-await-1');
    // ^ Runs on microtask HOP 1's turn in the queue.

    await Promise.resolve();
    // ^ HOP 2: suspends AGAIN. This schedules a BRAND NEW microtask for
    // the remaining continuation. Critically, this new microtask is
    // enqueued AFTER whatever is already waiting in the queue at this
    // moment (see the promise-then microtask below), because the queue is
    // FIFO and this is a fresh entry added partway through the drain.

    console.log('P4.async-fn-after-await-2');
    // ^ Runs on microtask HOP 2's turn — the very last microtask in this trace.
  }

  asyncFn();
  // ^ Runs synchronously up to its first await (logging async-fn-start),
  // then returns a pending promise here immediately. We are NOT blocked.

  Promise.resolve().then(() => console.log('P4.promise-then'));
  // ^ This microtask is enqueued AFTER asyncFn's HOP 1 continuation
  // (because asyncFn's first await suspended, and thus queued its
  // continuation, before this line even runs) but BEFORE asyncFn's HOP 2
  // continuation (which doesn't get created until HOP 1's continuation
  // actually executes, later, during the drain).

  console.log('P4.end'); // sync — last synchronous line in this puzzle

  // Expected output, in order, with the queue state explained at each step:
  //   P4.start                      <- sync
  //   P4.async-fn-start              <- sync, inside the asyncFn() call
  //   P4.end                        <- sync, after asyncFn() hands back control
  //   --- call stack now empty; microtask queue at this point: [HOP1-cont, promise-then] ---
  //   P4.async-fn-after-await-1     <- HOP1-cont runs; this SCHEDULES HOP2-cont,
  //                                     which goes to the BACK of the queue,
  //                                     behind promise-then which was already there
  //   P4.promise-then               <- was queued before HOP2-cont existed, so it
  //                                     runs next
  //   P4.async-fn-after-await-2     <- HOP2-cont runs last, queue now empty
  //   P4.timeout                    <- only now does the engine dequeue the
  //                                     one pending macrotask
}

// ============================================================
// RUN ALL PUZZLES, staggered so console output groups cleanly.
// The staggering uses setTimeout purely for readability in this combined
// file — it does not change any of the ordering rules demonstrated above,
// since each puzzle's internal race is fully resolved before the next
// puzzle's setTimeout(..., N) macrotask is even eligible to run.
// ============================================================
puzzle1();
setTimeout(puzzle2, 50);
setTimeout(puzzle3, 100);
setTimeout(puzzle4, 150);
