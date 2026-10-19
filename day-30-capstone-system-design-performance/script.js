// ============================================================
// DAY 30: CAPSTONE — SYSTEM DESIGN, PERFORMANCE, AND THE FULL
// MENTAL MODEL (MEMORY -> OBJECT/TYPE -> EXECUTION -> CONCURRENCY)
// ============================================================
// Run this in a browser console, via index.html, or with Node.
// This file is a SYNTHESIS exercise: it deliberately reproduces one
// bug per layer of the mental model from the README, then fixes each
// one, with console output proving both the problem and the fix.

// ============================================================
// 1. THE BUGGY "PRODUCTION" CODE — handleDashboardLoad (buggy version)
// ============================================================

console.log('=== PART 1: THE BUGGY DASHBOARD LOAD (as found in "production") ===');

// --- BUG A (MEMORY LAYER, Day 27): an unbounded Map cache keyed by objects ---
// This cache is meant to avoid recomputing a per-user summary twice, but it
// is a plain Map holding STRONG references to every user object it has ever
// seen. In a long-running dashboard (SPA that never reloads), this grows
// forever — exactly the leak pattern demonstrated in Day 27, section 7.
const buggyUserSummaryCache = new Map();

function computeUserSummaryBuggy(user) {
  if (buggyUserSummaryCache.has(user)) {
    return buggyUserSummaryCache.get(user);
  }
  const summary = `${user.name} (${user.role})`;
  buggyUserSummaryCache.set(user, summary); // never evicted, ever
  return summary;
}

// --- BUG B (OBJECT/TYPE LAYER, Days 7-9): inconsistent object shapes ---
// Depending on a branch, rows get DIFFERENT sets of properties, added in
// different orders. Each distinct shape forces V8 to allocate/track a
// different hidden class, and a hot function reading `row.discount` across
// many differently-shaped rows degrades from a fast monomorphic inline
// cache to a slow megamorphic one.
function buildRowsBuggy(users) {
  const rows = [];
  for (const user of users) {
    if (user.role === 'admin') {
      // Admin rows: no `discount` field at all, and `permissions` added.
      const row = {};
      row.name = user.name;
      row.permissions = 'all';
      rows.push(row);
    } else {
      // Regular rows: DIFFERENT property set and DIFFERENT insertion order
      // than the admin branch above — this is the shape inconsistency.
      const row = {};
      row.discount = 0.1;
      row.name = user.name;
      rows.push(row);
    }
  }
  return rows;
}

// --- BUG C (EXECUTION LAYER, Days 1 & 6): one giant unbroken synchronous loop ---
// This simulates a heavy per-row computation running inline, in one call
// stack frame, for the ENTIRE dataset before returning. For a large enough
// dataset this single frame can block the main thread for the full
// duration — nothing else (rendering, input, other callbacks) can run
// until this function returns, because JS runs on one thread per realm.
function computeTotalsBuggy(rows) {
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    // Simulated "heavy work per row" — a tight busy-loop standing in for
    // something like a synchronous parse/format/validate step.
    let acc = 0;
    for (let j = 0; j < 2000; j++) {
      acc += Math.sqrt(j);
    }
    total += acc + (rows[i].discount || 0);
  }
  return total;
}

// --- BUG D (CONCURRENCY LAYER, Days 16 & 21): unbounded microtask self-scheduling ---
// This function processes a work queue by recursively scheduling itself
// via `.then()` — a MICROTASK. The event loop must fully drain the
// microtask queue before it's allowed to move to the next macrotask or a
// render step. If `remainingWork` is large and this keeps rescheduling
// itself as a microtask instead of yielding to a macrotask periodically,
// the page can appear completely frozen even though "technically" the
// event loop never stopped running.
function drainQueueViaMicrotasksBuggy(remainingWork, onDone) {
  if (remainingWork <= 0) {
    onDone();
    return;
  }
  Promise.resolve().then(() => {
    // Each call here is scheduled as a NEW microtask, chained onto the
    // current microtask drain — rendering never gets a turn until this
    // entire chain (all `remainingWork` steps) has fully unwound.
    drainQueueViaMicrotasksBuggy(remainingWork - 1, onDone);
  });
}

// --- Wiring it all together, the way "handleDashboardLoad" actually looked ---
function handleDashboardLoadBuggy(users) {
  console.log('[buggy] Building rows with inconsistent shapes...');
  const rows = buildRowsBuggy(users);

  console.log('[buggy] Computing totals in one giant synchronous loop...');
  const start = performance.now ? performance.now() : Date.now();
  const total = computeTotalsBuggy(rows);
  const elapsed = (performance.now ? performance.now() : Date.now()) - start;
  console.log(`[buggy] Total computed: ${total.toFixed(2)} (took ${elapsed.toFixed(2)}ms, blocking)`);

  console.log('[buggy] Warming the leaky user summary cache...');
  for (const user of users) {
    computeUserSummaryBuggy(user);
  }
  console.log(`[buggy] Cache now strongly holds ${buggyUserSummaryCache.size} user object(s) forever.`);
}

const demoUsers = [
  { name: 'Ada', role: 'admin' },
  { name: 'Grace', role: 'member' },
  { name: 'Linus', role: 'member' },
];

handleDashboardLoadBuggy(demoUsers);

console.log('[buggy] Running a BOUNDED demo of the microtask-starvation bug (10 steps, not unbounded):');
drainQueueViaMicrotasksBuggy(10, () => {
  console.log('[buggy] Microtask chain finally finished — in production with a LARGE queue, ' +
    'rendering/input would have been starved for the ENTIRE duration of this chain.');
});

// ============================================================
// 2. THE FIXED VERSION — handleDashboardLoad (corrected, layer by layer)
// ============================================================

console.log('=== PART 2: THE FIXED DASHBOARD LOAD ===');

// --- FIX A (MEMORY LAYER): WeakMap instead of Map ---
// Swapping Map for WeakMap means the cache no longer keeps a user object
// alive just because it was once summarized. When a user object becomes
// unreachable elsewhere in the app, its cache entry can be collected too —
// exactly the mechanism from Day 27.
const fixedUserSummaryCache = new WeakMap();

function computeUserSummaryFixed(user) {
  if (fixedUserSummaryCache.has(user)) {
    return fixedUserSummaryCache.get(user);
  }
  const summary = `${user.name} (${user.role})`;
  fixedUserSummaryCache.set(user, summary);
  return summary;
}

// --- FIX B (OBJECT/TYPE LAYER): normalize every row to the SAME shape ---
// Every row now gets the exact same set of keys, assigned in the exact
// same order, regardless of branch — admins just get a default/empty
// value for fields that don't apply to them. This keeps every row object
// on one stable hidden class, which is what lets V8's inline caches stay
// monomorphic (fast) instead of megamorphic (slow) when a hot function
// later reads `row.discount` or `row.permissions` across the whole array.
function buildRowsFixed(users) {
  const rows = [];
  for (const user of users) {
    // Always create the row with the SAME property order, every branch.
    const row = {
      name: user.name,
      discount: user.role === 'admin' ? 0 : 0.1,
      permissions: user.role === 'admin' ? 'all' : 'none',
    };
    rows.push(row);
  }
  return rows;
}

// --- FIX C (EXECUTION LAYER): chunk the heavy work across macrotasks ---
// Instead of one unbroken synchronous loop over the entire dataset, this
// processes a bounded slice per call, then yields back to the event loop
// via setTimeout(..., 0) before continuing — giving rendering/input a turn
// between chunks. The TOTAL work done is identical; what changes is that
// no single call stack frame monopolizes the main thread for long.
function computeTotalsChunked(rows, chunkSize, onComplete) {
  let total = 0;
  let index = 0;

  function processNextChunk() {
    const end = Math.min(index + chunkSize, rows.length);
    for (; index < end; index++) {
      let acc = 0;
      for (let j = 0; j < 2000; j++) {
        acc += Math.sqrt(j);
      }
      total += acc + (rows[index].discount || 0);
    }

    if (index < rows.length) {
      // Yield to the event loop as a MACROTASK, not a microtask — this
      // lets pending renders/input events run before the next chunk,
      // which is exactly the fix for Bug C's main-thread monopolization.
      setTimeout(processNextChunk, 0);
    } else {
      onComplete(total);
    }
  }

  processNextChunk();
}

// --- FIX D (CONCURRENCY LAYER): yield to a macrotask instead of chaining microtasks ---
// Same recursive "drain a queue" shape as the buggy version, but each step
// is scheduled with setTimeout (a macrotask) instead of Promise.then (a
// microtask). This guarantees the event loop gets to process rendering and
// other pending macrotasks BETWEEN steps, no matter how large the queue is.
function drainQueueViaMacrotasksFixed(remainingWork, onDone) {
  if (remainingWork <= 0) {
    onDone();
    return;
  }
  setTimeout(() => {
    drainQueueViaMacrotasksFixed(remainingWork - 1, onDone);
  }, 0);
}

// --- Wiring the fixed version together ---
function handleDashboardLoadFixed(users, onFullyDone) {
  console.log('[fixed] Building rows with a consistent, normalized shape...');
  const rows = buildRowsFixed(users);

  console.log('[fixed] Computing totals in chunks, yielding between them...');
  computeTotalsChunked(rows, 1, (total) => {
    console.log(`[fixed] Total computed: ${total.toFixed(2)} (main thread was yielded between chunks)`);

    console.log('[fixed] Warming the WeakMap-backed user summary cache (self-cleaning)...');
    for (const user of users) {
      computeUserSummaryFixed(user);
    }
    console.log('[fixed] Cache entries will be collectible automatically once their user objects are unreachable.');

    console.log('[fixed] Draining the work queue via macrotasks (bounded demo, 10 steps):');
    drainQueueViaMacrotasksFixed(10, () => {
      console.log('[fixed] Macrotask-based drain finished — rendering/input had a turn between every single step.');
      if (onFullyDone) onFullyDone();
    });
  });
}

handleDashboardLoadFixed(demoUsers, () => {
  console.log('=== CAPSTONE DEMO COMPLETE ===');
  console.log(
    'Summary: the same four-layer trace from the README (memory -> object/type -> ' +
    'execution -> concurrency) found one concrete, fixable bug per layer in this ' +
    '"production" function — exactly the ordered hypothesis list a principal engineer ' +
    'runs when asked "why is this slow," and exactly the synthesis Day 30 exists to prove you can do.'
  );
});

// ============================================================
// 3. SELF-CHECK — verifying the shape-consistency fix is real
// ============================================================

console.log('=== PART 3: Self-check for the Bug B / Fix B shape claim ===');

// This doesn't measure actual engine-internal hidden classes directly
// (that requires engine-specific tooling like `%HaveSameMap` in a debug
// V8 build, which isn't available in a normal script), but we CAN prove
// the structural claim that matters: every fixed row has identical keys
// in identical order, while the buggy rows do not.
const buggyRows = buildRowsBuggy(demoUsers);
const fixedRows = buildRowsFixed(demoUsers);

const buggyShapes = new Set(buggyRows.map((row) => Object.keys(row).join(',')));
const fixedShapes = new Set(fixedRows.map((row) => Object.keys(row).join(',')));

console.log('Distinct shapes among buggy rows:', [...buggyShapes]); // more than one distinct key-order signature
console.log('Distinct shapes among fixed rows:', [...fixedShapes]); // exactly one — every row shares one shape
console.log('Buggy version has multiple shapes:', buggyShapes.size > 1); // true
console.log('Fixed version has exactly one shape:', fixedShapes.size === 1); // true
