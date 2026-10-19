# Day 17: Promises Deep Dive

## 🧠 Core Architectural Concept

A `Promise` is a state machine with exactly three states and one allowed
transition direction:

```
        resolve(value)
   ┌───────────────────────► FULFILLED (settled)
   │
PENDING
   │
   └───────────────────────► REJECTED (settled)
        reject(reason)
```

Once a promise leaves `pending`, it is **settled forever** — it cannot
transition again. Calling `resolve()` a second time, or calling `reject()`
after `resolve()`, is silently a no-op. This immutability-after-settlement is
what makes promises safe to hand to multiple consumers: everyone who attaches
a `.then()` — now or later — gets the same final value, computed once.

Internally (conceptually matching the spec and how V8 implements it), every
promise object holds:
- `[[PromiseState]]`: pending / fulfilled / rejected
- `[[PromiseResult]]`: the value or reason once settled
- `[[PromiseFulfillReactions]]` / `[[PromiseRejectReactions]]`: an internal
  list of callback pairs registered via `.then()` while still pending

When you call `.then(onFulfilled, onRejected)`:
- If the promise is still pending, your callbacks are pushed onto those
  internal reaction lists, to be invoked later as **microtask jobs** once the
  promise settles.
- If the promise is already settled, your callback is scheduled as a
  microtask job **immediately** (not run synchronously — `.then` NEVER
  calls back synchronously, even on an already-settled promise; this is a
  deliberate spec guarantee called "always asynchronous" that prevents
  "sometimes sync, sometimes async" bugs).
- `.then()` ALWAYS returns a **new** promise — this is the mechanism that
  makes chaining work. That new promise's resolution is determined by
  whatever your callback returns:
  - return a plain value → the new promise fulfills with it.
  - return another promise/thenable → the new promise "adopts" that
    promise's eventual state (this adoption logic is the `[[Resolve]]`
    algorithm, and it's recursive — it keeps unwrapping nested
    thenables until it hits a non-thenable value).
  - throw → the new promise rejects with the thrown value.

`Promise.all`, `Promise.race`, `Promise.allSettled`, and `Promise.any` are
four different **combinators** over an iterable of promises, and each exists
because production code hits a genuinely different requirement:

| Combinator | Resolves when | Rejects when | Use case |
|---|---|---|---|
| `Promise.all` | ALL fulfill | ANY ONE rejects (fails fast) | You need every result, and one failure means the whole operation is meaningless (e.g., fetch all required config files). |
| `Promise.race` | FIRST to settle (fulfill OR reject) wins | — | Timeout patterns: race a fetch against a timer. |
| `Promise.allSettled` | ALL settle (never rejects) | never | You want every outcome regardless of individual failures (e.g., batch-notify 50 users, log failures, don't abort). |
| `Promise.any` | FIRST to FULFILL wins | ALL reject (`AggregateError`) | You need just one success from redundant sources (e.g., hit 3 mirrored CDNs, use whichever responds first). |

## 🎯 Interview Talking Points

- "The one guarantee I lean on constantly: `.then()` callbacks are *always*
  asynchronous, even if the promise is already settled when you attach the
  handler. I've seen bugs where someone assumed a resolved promise's `.then`
  would run synchronously 'because it's already done' — it never does, by
  spec design — which matters when you're reasoning about execution order
  relative to other synchronous code right after the `.then()` call."
- "I've debugged a production bug caused by the **promise constructor
  anti-pattern**: wrapping an already-promise-returning API (like `fetch`)
  in a redundant `new Promise((resolve, reject) => { fetch(...).then(resolve,
  reject) })`. The real bug was that an exception thrown synchronously
  *inside* that executor before any `.then` was attached got silently
  swallowed in one code path because the surrounding try/catch wasn't
  promise-aware. Fix: never wrap a function that already returns a promise —
  just return it."
- "A subtle one juniors trip on constantly: **forgetting to `return` inside a
  `.then()`**. If you do async work in a `.then` callback without returning
  it, the outer chain resolves immediately with `undefined`, and the async
  work you kicked off becomes an orphaned, unhandled side effect running on
  its own schedule. I treat a missing `return` before an async call inside a
  chain as an automatic code review comment."
- "On `Promise.all` vs `allSettled`: I use `all` for anything where partial
  success is a system failure — e.g., a transaction needing 3 service calls
  to succeed atomically. I use `allSettled` for fan-out operations like
  'send notifications to this list of 200 users' where some failures are
  expected and shouldn't kill the batch. Getting this choice wrong is a
  common root cause of 'one slow/failing dependency took down an entire
  unrelated batch job.'"
- "`Promise.any` is underused — it's the right tool for redundant/mirrored
  sources (multi-region API calls, CDN failover) where you want the fastest
  success and don't care which source won. If they all fail you get an
  `AggregateError` with an `.errors` array containing every individual
  rejection reason — worth knowing because naively doing `.catch(err =>
  console.log(err.message))` loses all that detail."
- "Error propagation through a chain: a `.catch()` anywhere in the chain
  catches a rejection from ANY earlier link, not just the immediately
  preceding one — rejections propagate forward through unhandled `.then`s
  until they hit a rejection handler. Follow-up question I'd expect: 'what
  happens if nothing ever catches it?' Answer: it surfaces as an
  `unhandledrejection` event in the browser / an `unhandledRejection` event
  on `process` in Node, and in modern Node (since v15) an unhandled
  rejection crashes the process by default — I've seen teams get bitten
  upgrading Node versions because of exactly this default change."
- "One more I bring up proactively: chaining `.then(resolve, reject)` vs
  `.then(fn).catch(errFn)` are NOT equivalent for error handling — if `fn`
  itself throws, the first form's `reject` won't catch it (it only handles
  the ORIGINAL promise's rejection), while `.catch()` after `.then()` catches
  errors thrown by `fn` too. This is a real interview 'gotcha' question."

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

A promise is like a **coat-check ticket** at a restaurant. The moment you
hand over your coat, you get a ticket — that's the pending promise, created
immediately and synchronously. You don't get your coat yet, but you have a
guaranteed way to be notified when it's ready (`.then()`). Eventually one of
two things happens: the attendant either hands you your coat (fulfilled) or
tells you it was lost (rejected) — and once that happens, it never changes
again. You can hand your ticket to a friend and they get notified too — any
number of people can `.then()` the same promise.

Chaining `.then().then().then()` is like a bucket-brigade: each person takes
what the previous person handed them, does something to it, and passes a
NEW bucket down the line — that's why `.then()` always returns a new
promise, not the same one.

**Common traps:**
1. **"I'll just wrap this in `new Promise()` to be safe."** If the thing
   you're wrapping already returns a promise (like `fetch`), don't — you're
   adding a layer that can swallow errors and adds no value. Correction:
   only use `new Promise()` to wrap genuinely callback-based (non-promise)
   APIs.
2. **"My `.then()` does an async call, so it's handled."** If you don't
   `return` that async call's promise, the chain moves on without waiting
   for it, and any error inside it becomes unhandled. Correction: always
   `return` a promise you create inside a `.then`.
3. **"`Promise.all` will tell me which ones failed."** No — `Promise.all`
   rejects with only the FIRST rejection reason and gives up on the rest
   immediately. Correction: use `Promise.allSettled` if you need to know the
   outcome of every item.

## 💻 Hands-On Exercise

Run `script.js`. Before running, predict the output of this snippet from the
file's error-propagation section:

```js
Promise.resolve(1)
  .then((val) => {
    console.log('step A, val =', val);
    throw new Error('boom in step A');
  })
  .then((val) => {
    // this should be SKIPPED entirely
    console.log('step B, val =', val);
    return val + 1;
  })
  .catch((err) => {
    console.log('caught:', err.message);
    return 'recovered';
  })
  .then((val) => {
    console.log('step C, val =', val);
  });
```

**Predict:** which steps log, and in what order?

**Expected output:**
```
step A, val = 1
caught: boom in step A
step C, val = recovered
```

**Why:** Step A throws, which rejects the promise step A's `.then` returned.
That rejection propagates forward — skipping step B entirely, because step B
is a `.then` with no rejection handler, so it just passes the rejection
through unchanged — until it reaches `.catch`, which handles it and returns
the string `'recovered'`. Because `.catch` returned a plain value (not a
thrown error), the NEXT `.then` (step C) receives a FULFILLED promise with
value `'recovered'` — the chain is "healed" after the catch and continues in
the fulfilled path from that point on.

Then check the `Promise.all` vs `Promise.allSettled` vs `Promise.any`
section in `script.js` and verify your predictions against the inline
comments explaining each combinator's exact resolution/rejection behavior
with timed mock promises.
