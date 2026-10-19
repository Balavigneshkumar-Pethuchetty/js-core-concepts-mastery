// ============================================================
// DAY 18: ASYNC/AWAIT INTERNALS
// ============================================================
// async/await is sugar over the Promise microtask machinery from
// Day 17 (conceptually: generator + a promise-driven runner, see
// Day 19). Core facts under test below:
//   - code before the first `await` runs synchronously
//   - EVERY `await` yields at least one microtask tick, even
//     `await null` / `await 5`
//   - try/catch around await is real exception propagation
// ============================================================


// ============================================================
// 1. HAPPY PATH — desugaring demonstrated side by side
// ============================================================

// The async/await version:
async function getDataAsyncAwait() {
  console.log('[1] async/await: step 1');
  const a = await Promise.resolve('A');
  console.log('[1] async/await: step 2, a =', a);
  const b = await Promise.resolve(a + 'B');
  console.log('[1] async/await: step 3, b =', b);
  return b;
}

// The hand-rolled generator + runner version — functionally
// IDENTICAL control flow, written out explicitly so you can see
// exactly what the engine is doing for you under the async/await
// syntax.
function getDataGeneratorRunner() {
  function* generatorBody() {
    console.log('[1] generator+runner: step 1');
    const a = yield Promise.resolve('A');
    console.log('[1] generator+runner: step 2, a =', a);
    const b = yield Promise.resolve(a + 'B');
    console.log('[1] generator+runner: step 3, b =', b);
    return b;
  }

  return new Promise((resolve, reject) => {
    const gen = generatorBody();

    function step(input) {
      let result;
      try {
        result = gen.next(input); // resume the generator with the last yielded value
      } catch (err) {
        return reject(err); // a throw inside the generator rejects our promise
      }
      if (result.done) {
        return resolve(result.value); // generator finished -> settle outer promise
      }
      // result.value is whatever was yielded (here, a Promise).
      // Wrap it in Promise.resolve() in case it's a plain value,
      // then drive the next step once it settles — this IS the
      // "promise runner" that async/await gives you natively.
      Promise.resolve(result.value).then(step, (err) => {
        try {
          gen.throw(err); // inject the rejection as an exception at the yield point
        } catch (e) {
          reject(e);
        }
      });
    }
    step(); // kick off the first step synchronously, just like calling an async fn
  });
}

getDataAsyncAwait().then((result) =>
  console.log('[1] async/await final result:', result)
);
getDataGeneratorRunner().then((result) =>
  console.log('[1] generator+runner final result:', result)
);
// Both produce IDENTICAL interleaving and IDENTICAL final results
// — proving the desugaring model is accurate, not just a metaphor.


// ============================================================
// 2. COMMON PITFALL(S)
// ============================================================

// PITFALL A: sequential await in a loop for INDEPENDENT work.
function delay(ms, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

async function sequentialLoopBad() {
  console.log('[2A] --- sequential await in loop (SLOW) ---');
  const start = Date.now();
  const results = [];
  for (const id of [1, 2, 3]) {
    // Each iteration waits for the FULL previous delay before even
    // STARTING the next one. 3 x 30ms delays run back-to-back =
    // ~90ms total, even though nothing here actually depends on
    // the previous iteration's result.
    const r = await delay(30, 'item-' + id);
    results.push(r);
  }
  console.log(
    '[2A] sequential results:', results,
    'elapsed ~', Date.now() - start, 'ms (expect ~90ms)'
  );
}

async function parallelLoopGood() {
  console.log('[2B] --- Promise.all for independent work (FAST) ---');
  const start = Date.now();
  // All three delays are KICKED OFF immediately (synchronously, in
  // the same tick), then we await all of them together. Total time
  // is bounded by the SLOWEST one (30ms), not the sum.
  const results = await Promise.all(
    [1, 2, 3].map((id) => delay(30, 'item-' + id))
  );
  console.log(
    '[2B] parallel results:', results,
    'elapsed ~', Date.now() - start, 'ms (expect ~30ms)'
  );
}

async function runLoopComparison() {
  await sequentialLoopBad();
  await parallelLoopGood();
}
runLoopComparison();

// PITFALL B: the counter-case — sequential IS correct when each
// step depends on the previous one's result (e.g. pagination).
async function sequentialWhenDependentIsCorrect() {
  console.log('[2C] --- sequential await when steps DEPEND on each other (CORRECT) ---');
  async function fetchPage(pageToken) {
    // Simulates an API where you can't know page 2's token until
    // you've fetched page 1 — genuinely cannot be parallelized.
    await delay(10);
    if (pageToken === null) return { items: ['a', 'b'], nextToken: 'page2' };
    if (pageToken === 'page2') return { items: ['c'], nextToken: null };
  }

  let token = null;
  let allItems = [];
  do {
    const page = await fetchPage(token); // MUST wait — next call needs this result
    allItems = allItems.concat(page.items);
    token = page.nextToken;
  } while (token !== null);

  console.log('[2C] paginated result (correctly sequential):', allItems);
}
sequentialWhenDependentIsCorrect();

// PITFALL C: try/catch scoping — wrapping the WHOLE function vs
// scoping tightly around the one await you can actually recover from.
async function tryCatchScopingDemo() {
  function mightFail(label, shouldFail) {
    return shouldFail
      ? Promise.reject(new Error(label + ' failed'))
      : Promise.resolve(label + ' ok');
  }

  console.log('[2D] --- broad try/catch (loses per-step recovery) ---');
  try {
    const step1 = await mightFail('step1', false);
    console.log('[2D] broad:', step1);
    const step2 = await mightFail('step2', true); // throws here
    console.log('[2D] broad: this never runs:', step2);
  } catch (err) {
    // We know SOMETHING failed, but not which step, without
    // inspecting err.message — can't apply step-specific recovery.
    console.log('[2D] broad catch (ambiguous which step failed):', err.message);
  }

  console.log('[2D] --- tight try/catch (precise recovery per step) ---');
  let step1Result;
  try {
    step1Result = await mightFail('step1', false);
    console.log('[2D] tight: step1 ok:', step1Result);
  } catch (err) {
    console.log('[2D] tight: step1 failed, cannot proceed:', err.message);
    return;
  }

  let step2Result;
  try {
    step2Result = await mightFail('step2', true);
    console.log('[2D] tight: this never runs:', step2Result);
  } catch (err) {
    // We KNOW it's step 2 that failed, and can apply a targeted
    // fallback (e.g. retry just step 2, or use a default value).
    console.log('[2D] tight: step2 failed specifically, using fallback:', err.message);
    step2Result = 'fallback-value';
  }
  console.log('[2D] tight: continuing with', step2Result);
}
tryCatchScopingDemo();

// PITFALL D: fire-and-forget promises are NOT protected by an
// outer try/catch, because the catch block has already finished
// executing by the time the un-awaited promise rejects.
//
// NOTE: the un-awaited call below genuinely produces an
// unhandled rejection (that's the whole point of the demo). In
// modern Node (v15+) an unhandled rejection crashes the process
// by default, and in a browser it fires a scary console error —
// so we attach an informational listener first, purely so this
// educational demo can print what's happening instead of
// crashing the script. This is NOT the "fix" (the real fix is
// the .catch() a few lines down) — it's just demo plumbing.
if (typeof process !== 'undefined' && typeof process.on === 'function') {
  process.on('unhandledRejection', (reason) => {
    console.log('[2E] (demo plumbing) process unhandledRejection fired for:', reason.message);
  });
} else if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    console.log('[2E] (demo plumbing) unhandledrejection event fired for:', event.reason.message);
    event.preventDefault();
  });
}

async function fireAndForgetDemo() {
  console.log('[2E] --- fire-and-forget escapes try/catch ---');
  function laterFailure() {
    return delay(15).then(() => {
      throw new Error('[2E] rejected later, after try/catch already exited');
    });
  }

  try {
    laterFailure(); // NOT awaited! try/catch cannot see this rejection.
    console.log('[2E] try block finished without waiting for laterFailure');
  } catch (err) {
    // This will NEVER run for laterFailure's rejection — by the
    // time it rejects, we're long past this synchronous try block.
    console.log('[2E] this never catches the fire-and-forget failure:', err.message);
  }

  // The correct fix: either await it, or attach .catch() directly.
  laterFailure().catch((err) =>
    console.log('[2E] correctly handled via direct .catch():', err.message)
  );
}
fireAndForgetDemo();


// ============================================================
// 3. EDGE CASE(S)
// ============================================================

// EDGE CASE A: an async function with no explicit return still
// returns a Promise that resolves to undefined.
async function implicitUndefinedReturn() {
  console.log('[3A] async function with no return statement');
}
implicitUndefinedReturn().then((val) =>
  console.log('[3A] resolved value (expect undefined):', val)
);

// EDGE CASE B: returning a plain value from an async function
// still gets wrapped in a Promise via the same [[Resolve]] logic
// from Day 17 — even if you return ANOTHER promise, it's adopted,
// not double-wrapped.
async function returnsAnotherPromise() {
  return Promise.resolve('[3B] inner promise value');
  // The outer async function's returned promise ADOPTS this one's
  // eventual state — you never get a "promise of a promise."
}
returnsAnotherPromise().then((val) => console.log('[3B] adopted value:', val));

// EDGE CASE C: await on a non-promise value still yields a
// microtask tick — this is the core of the ordering puzzle below.
async function awaitNonPromiseStillYields() {
  console.log('[3C] before await 5');
  await 5; // NOT a promise, but STILL schedules a microtask resume
  console.log('[3C] after await 5 — this is a NEW microtask turn');
}
awaitNonPromiseStillYields();


// ============================================================
// 4. ASYNC ORDERING TRACE — the exact puzzle from README.md
// ============================================================

function theOrderingPuzzle() {
  console.log('A: start');
  // ^ SYNCHRONOUS, runs immediately.

  async function asyncFn() {
    console.log('B: inside asyncFn, before await');
    // ^ SYNCHRONOUS. Code before the first `await` in an async
    //   function runs in the SAME tick as the caller — the
    //   function does not "go async" until it actually hits an
    //   `await` expression.

    await null;
    // ^ THIS is the yield point. Conceptually:
    //     Promise.resolve(null).then(resumeRestOfFunction)
    //   Control returns to the caller of asyncFn() RIGHT NOW,
    //   synchronously, and the rest of this function body is
    //   scheduled as a MICROTASK to run once the implicit
    //   Promise.resolve(null) settles (which it already has, but
    //   the resume is STILL deferred to the microtask queue — never
    //   synchronous, same "always async" .then guarantee from
    //   Day 17).

    console.log('C: inside asyncFn, after await');
    // ^ Runs later, as a microtask — specifically the FIRST
    //   microtask enqueued in this whole trace, since the await's
    //   resume job was scheduled before any other microtask below.
  }

  asyncFn();
  // ^ Calling asyncFn starts it executing SYNCHRONOUSLY up to its
  //   first `await` (logs 'B'), then returns a pending Promise
  //   immediately back here. We don't await or .then() it, so we
  //   just move on.

  console.log('D: after calling asyncFn (sync)');
  // ^ SYNCHRONOUS. We're still unwinding the ORIGINAL call stack
  //   from the top of the script — asyncFn's internal await hasn't
  //   resumed yet, it's just sitting in the microtask queue.

  Promise.resolve().then(() => console.log('E: a plain promise microtask'));
  // ^ Registers ANOTHER microtask. Enqueued AFTER asyncFn's resume
  //   job (which was enqueued back at the `await null` line, before
  //   this line even ran) — so in the microtask queue, order is:
  //   [resume-asyncFn (logs C), this-then (logs E)].

  console.log('F: end of script');
  // ^ SYNCHRONOUS. Finishes the initial macrotask (the script).

  // --- Microtask queue now drains, in FIFO order: ---
  // MICROTASK TURN 1: resumes asyncFn right after `await null`,
  //   logging 'C'. WHY NOW: it was the first microtask enqueued,
  //   back when execution hit the `await` line.
  // MICROTASK TURN 2: runs the Promise.resolve().then callback,
  //   logging 'E'. WHY NOW: it was enqueued second, after asyncFn's
  //   resume job.

  // FINAL EXPECTED CONSOLE ORDER: A, B, D, F, C, E
}
theOrderingPuzzle();
