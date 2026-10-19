// ============================================================
// DAY 17: PROMISES DEEP DIVE
// ============================================================
// States: pending -> fulfilled (terminal) | pending -> rejected (terminal).
// .then() ALWAYS returns a NEW promise and ALWAYS defers its
// callback to the microtask queue, even if already settled.
// ============================================================


// ============================================================
// 1. HAPPY PATH — states, settlement, and chaining
// ============================================================

// A promise starts pending, then settles exactly once.
const happyPromise = new Promise((resolve, reject) => {
  // This executor function runs SYNCHRONOUSLY, immediately.
  console.log('[1] executor running synchronously right now');
  resolve('fulfilled value');
  // Calling reject() here would be a no-op: once resolve() runs,
  // the promise is already settled and further calls are ignored.
  reject('this reject is ignored — promise already settled');
});

happyPromise.then((val) => {
  console.log('[1] .then received:', val);
});
console.log('[1] sync code after .then() — this logs BEFORE the .then callback');
// Expected: executor log -> sync code after -> .then received
// (proves .then is always deferred to a microtask, never sync)

// Chaining: each .then returns a NEW promise, built from the
// callback's return value.
Promise.resolve(10)
  .then((n) => {
    console.log('[1] chain step 1, n =', n);
    return n * 2; // plain value -> next promise fulfills with 20
  })
  .then((n) => {
    console.log('[1] chain step 2, n =', n);
    return new Promise((resolve) => {
      // returning a promise -> next .then "adopts" ITS eventual value
      setTimeout(() => resolve(n + 1), 10);
    });
  })
  .then((n) => {
    console.log('[1] chain step 3, adopted value n =', n);
  });


// ============================================================
// 2. COMMON PITFALL(S)
// ============================================================

// PITFALL A: the Promise Constructor Anti-Pattern.
// Wrapping something that is ALREADY a promise in `new Promise()`
// adds a useless layer and can swallow synchronous throws if done
// carelessly. BAD vs GOOD shown side by side.
function fakeFetch(shouldFail) {
  // Pretend this is `fetch(...)` — it already returns a promise.
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (shouldFail) reject(new Error('fakeFetch failed'));
      else resolve('fakeFetch data');
    }, 5);
  });
}

// BAD: redundant wrapping. No functional benefit, extra indirection,
// and a common source of double error-handling bugs in real code.
function badWrapperPattern(shouldFail) {
  return new Promise((resolve, reject) => {
    fakeFetch(shouldFail)
      .then((data) => resolve(data))
      .catch((err) => reject(err));
  });
}

// GOOD: fakeFetch already returns a promise — just return it.
function goodDirectPattern(shouldFail) {
  return fakeFetch(shouldFail);
}

badWrapperPattern(false).then((d) => console.log('[2A] bad pattern result:', d));
goodDirectPattern(false).then((d) => console.log('[2A] good pattern result:', d));

// PITFALL B: forgetting to `return` inside a .then().
function pitfallMissingReturn() {
  function slowOperation() {
    return new Promise((resolve) =>
      setTimeout(() => resolve('slow result'), 20)
    );
  }

  console.log('[2B] --- missing return (BROKEN) ---');
  Promise.resolve()
    .then(() => {
      slowOperation().then((res) =>
        console.log('[2B] BROKEN: orphaned slowOperation resolved with', res)
      );
      // NOTE: no `return` here! The outer chain does not wait.
    })
    .then(() => {
      // This runs almost immediately, WITHOUT waiting for slowOperation.
      console.log('[2B] BROKEN: outer chain continued WITHOUT waiting');
    });

  console.log('[2B] --- correct return (FIXED) ---');
  Promise.resolve()
    .then(() => {
      return slowOperation().then((res) => {
        console.log('[2B] FIXED: slowOperation resolved with', res);
        return res;
      });
      // `return` here makes the outer chain adopt slowOperation's
      // promise — the next .then genuinely waits for it.
    })
    .then(() => {
      console.log('[2B] FIXED: outer chain continued AFTER waiting');
    });
}
pitfallMissingReturn();


// ============================================================
// 3. EDGE CASE(S) — error propagation through chains
// ============================================================

Promise.resolve(1)
  .then((val) => {
    console.log('[3] step A, val =', val);
    throw new Error('boom in step A');
    // Throwing here REJECTS the promise this .then() returns.
  })
  .then((val) => {
    // SKIPPED ENTIRELY: this .then has no rejection handler, so a
    // rejected input promise just passes the SAME rejection through
    // to its own output promise, unchanged.
    console.log('[3] step B, val =', val);
    return val + 1;
  })
  .catch((err) => {
    // Catches the rejection that was propagated all the way from
    // step A, skipping step B entirely.
    console.log('[3] caught:', err.message);
    return 'recovered';
    // Returning a plain (non-error) value HEALS the chain: the
    // promise .catch() returns is now FULFILLED with 'recovered'.
  })
  .then((val) => {
    // Runs in the FULFILLED path because .catch healed the chain.
    console.log('[3] step C, val =', val);
  });

// EDGE CASE: .then(onFulfilled, onRejected) vs .then().catch()
// are NOT equivalent when onFulfilled itself throws.
function thenRejectVsCatchDemo() {
  console.log('[3] --- then(res,rej) vs then().catch() ---');

  // Version 1: .then(fn, errFn) — errFn ONLY catches the ORIGINAL
  // promise's rejection, NOT an error thrown by fn itself.
  Promise.resolve('ok')
    .then(
      (val) => {
        throw new Error('thrown inside onFulfilled');
      },
      (err) => {
        // This will NOT run — the original promise never rejected,
        // it was the onFulfilled callback that threw afterward.
        console.log('[3] version1 rejection handler (unexpected):', err);
      }
    )
    .catch((err) => {
      // THIS is what actually catches it — a LATER .catch in the
      // chain, because the error came from the onFulfilled callback,
      // which rejects the NEW promise .then() returns.
      console.log('[3] version1 caught via later .catch:', err.message);
    });

  // Version 2: .then(fn).catch(errFn) — catches errors from EITHER
  // the original rejection OR fn throwing. This is why `.catch()`
  // chained AFTER `.then()` is the generally safer pattern.
  Promise.resolve('ok')
    .then((val) => {
      throw new Error('thrown inside fn, version 2');
    })
    .catch((err) => {
      console.log('[3] version2 caught via chained .catch:', err.message);
    });
}
thenRejectVsCatchDemo();


// ============================================================
// 4. THE FOUR COMBINATORS — Promise.all / race / allSettled / any
// ============================================================

function mockTask(label, ms, shouldFail) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (shouldFail) reject(new Error(label + ' failed'));
      else resolve(label + ' succeeded after ' + ms + 'ms');
    }, ms);
  });
}

async function combinatorDemos() {
  // Promise.all: fails fast on the FIRST rejection, loses info
  // about any tasks that hadn't settled yet.
  console.log('[4] --- Promise.all ---');
  try {
    const results = await Promise.all([
      mockTask('all-task-1', 10, false),
      mockTask('all-task-2', 20, true), // this one rejects
      mockTask('all-task-3', 30, false),
    ]);
    console.log('[4] all results (not reached):', results);
  } catch (err) {
    // We never learn whether all-task-3 would have succeeded —
    // Promise.all gives up the instant ONE rejects.
    console.log('[4] Promise.all rejected fast with:', err.message);
  }

  // Promise.race: settles (fulfill OR reject) with whichever
  // promise finishes FIRST, win or lose.
  console.log('[4] --- Promise.race ---');
  try {
    const winner = await Promise.race([
      mockTask('race-slow', 50, false),
      mockTask('race-fast', 10, false),
    ]);
    console.log('[4] Promise.race winner:', winner);
  } catch (err) {
    console.log('[4] Promise.race rejected with:', err.message);
  }

  // Classic real-world use: race a real operation against a
  // timeout to implement "fail if this takes too long".
  console.log('[4] --- Promise.race as a timeout pattern ---');
  function withTimeout(promise, ms) {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timed out after ' + ms + 'ms')), ms)
    );
    return Promise.race([promise, timeout]);
  }
  try {
    const result = await withTimeout(mockTask('slow-op', 100, false), 30);
    console.log('[4] timeout race result (not reached):', result);
  } catch (err) {
    console.log('[4] timeout race correctly timed out:', err.message);
  }

  // Promise.allSettled: NEVER rejects. Gives you an array of
  // { status, value } or { status, reason } for EVERY input.
  console.log('[4] --- Promise.allSettled ---');
  const settled = await Promise.allSettled([
    mockTask('settled-1', 10, false),
    mockTask('settled-2', 10, true),
    mockTask('settled-3', 10, false),
  ]);
  settled.forEach((outcome, i) => {
    if (outcome.status === 'fulfilled') {
      console.log('[4] allSettled[' + i + '] fulfilled:', outcome.value);
    } else {
      console.log('[4] allSettled[' + i + '] rejected:', outcome.reason.message);
    }
  });

  // Promise.any: resolves with the FIRST fulfillment, ignores
  // rejections UNLESS every single one rejects (then AggregateError).
  console.log('[4] --- Promise.any (mirrored sources pattern) ---');
  try {
    const firstSuccess = await Promise.any([
      mockTask('mirror-A', 20, true),  // fails
      mockTask('mirror-B', 10, false), // wins — fastest success
      mockTask('mirror-C', 30, false),
    ]);
    console.log('[4] Promise.any first success:', firstSuccess);
  } catch (err) {
    console.log('[4] Promise.any all failed:', err);
  }

  // Promise.any when EVERY source fails: AggregateError with
  // an .errors array holding each individual rejection reason.
  console.log('[4] --- Promise.any (all fail -> AggregateError) ---');
  try {
    await Promise.any([
      mockTask('dead-A', 10, true),
      mockTask('dead-B', 10, true),
    ]);
  } catch (aggregateErr) {
    console.log('[4] AggregateError message:', aggregateErr.message);
    console.log(
      '[4] AggregateError.errors (each individual reason):',
      aggregateErr.errors.map((e) => e.message)
    );
  }
}
combinatorDemos();


// ============================================================
// 5. UNHANDLED REJECTION — what happens if nothing catches it
// ============================================================

function unhandledRejectionDemo() {
  // This promise rejects and NOTHING attaches a .catch to it
  // synchronously. The engine waits until the current microtask
  // queue drain finishes to decide "was this ever handled?" — if
  // not, it fires an 'unhandledrejection' event (browser) or
  // 'unhandledRejection' event on process (Node).
  const neverCaught = Promise.reject(new Error('[5] intentionally unhandled'));
  // We deliberately do NOT attach .catch() here to demonstrate
  // the event firing below.
  void neverCaught; // acknowledge we're intentionally not handling it
}

if (typeof window !== 'undefined') {
  // Browser: listen for the global event so this demo doesn't
  // just show a scary red console error with no explanation.
  window.addEventListener('unhandledrejection', (event) => {
    console.log('[5] browser unhandledrejection event caught:', event.reason.message);
    event.preventDefault(); // stop it from also logging to the raw console as an error
  });
} else if (typeof process !== 'undefined') {
  // Node.js only: same concept, different event name/target.
  process.on('unhandledRejection', (reason) => {
    console.log('[5] Node unhandledRejection event caught:', reason.message);
  });
}
unhandledRejectionDemo();
