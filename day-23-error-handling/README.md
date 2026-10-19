# Day 23: Error Handling

## 🧠 Core Architectural Concept

Error handling in JS is really three separate mechanisms that look similar
on the surface but propagate through completely different channels:

1. **Synchronous throw/catch** — unwinds the call stack frame by frame. When
   you `throw`, the engine stops executing the current frame, pops it off
   the call stack, and looks for the nearest enclosing `try/catch` in the
   *lexical* call chain. If none exists anywhere up the stack, the engine
   reaches the top, and the runtime's global handler takes over (browser:
   `window.onerror`; Node: it crashes the process by default).
2. **Promise rejection** — does NOT unwind a call stack at all, because by
   the time a promise rejects, the function that created it has often
   already returned and its stack frame is long gone. Instead, rejection is
   a *state* stored on the promise object (`[[PromiseState]] = "rejected"`),
   and it propagates by being piped through `.then()`'s second argument or
   `.catch()` handlers — which are themselves just microtasks. A rejection
   with no attached handler by the time the microtask queue drains and the
   engine does its end-of-turn check is what triggers
   `unhandledrejection`/`unhandledRejection`.
3. **`async/await` throw/catch** — this is the elegant part: because
   `await` is sugar over `.then()`, a rejected awaited promise gets
   converted BACK into a synchronous-style `throw` inside the async
   function's body. That's why `try { await mightReject() } catch (e) {}`
   works exactly like synchronous try/catch even though underneath it's
   100% promise machinery — the engine re-throws the rejection reason at the
   await point when the generator-like coroutine resumes.

The `Error` object itself is not magic — it's a plain object with `message`,
`name`, and (non-standard but universal) `stack`, which V8 captures via
`Error.captureStackTrace` at construction time, walking the call stack
frames that exist *at that moment*. This is why re-throwing a caught error
from a different location doesn't give you a fresh, accurate stack unless
you explicitly create a new `Error` — the stack is frozen at construction,
not at throw time.

Subclassing `Error` is a first-class pattern, not a nice-to-have:

```js
class ValidationError extends Error {
  constructor(message, { field } = {}) {
    super(message);               // sets this.message, populates this.stack
    this.name = 'ValidationError'; // overrides the default "Error" name shown in traces
    this.field = field;            // custom, structured metadata
  }
}
```

Two subtleties that matter in real systems:
- Before target ES2022/modern transpiler configs, subclassing built-ins
  (`Error`, `Array`, `Map`) through Babel without `targets` set correctly
  could silently break `instanceof` checks, because the transpiled
  `super()` call didn't correctly wire up the prototype chain. This bit
  real teams migrating off Babel's default preset — always verify
  `err instanceof ValidationError` survives your build pipeline.
- `Error.cause` (ES2022) lets you chain the *original* low-level error
  without losing it: `throw new DatabaseError('write failed', { cause:
  originalErr })`. This is the standardized replacement for ad-hoc
  `err.originalError = originalErr` patterns teams used to hand-roll.

Global safety nets exist because some errors WILL escape every local
handler, and the goal is graceful degradation, not more crashes:
- Browser: `window.addEventListener('error', ...)` for uncaught sync
  exceptions, `window.addEventListener('unhandledrejection', ...)` for
  promise rejections nothing ever caught.
- Node: `process.on('uncaughtException', ...)` and
  `process.on('unhandledRejection', ...)`. Critically, Node's official
  guidance (and most teams' practice) is to treat `uncaughtException` as a
  **last-resort logging + controlled shutdown** point, not a recovery
  mechanism — the process is in an unknown state once an exception escapes
  everything, and continuing to serve traffic from it risks silent data
  corruption.

## 🎯 Interview Talking Points

- "I've debugged a production incident where a `.catch()` silently
  swallowed a `TypeError` that was actually a real bug (a `null` reference),
  not an expected failure case. The catch block logged-and-continued,
  turning what should have been a loud crash into a slow, confusing data
  corruption that took two days to trace. The fix was discriminating
  between 'expected operational errors' (network timeout, validation
  failure) and 'programmer errors' (null references, type errors) — the
  former you catch and handle, the latter you let propagate and crash loud,
  because it means your invariants are broken."
- "I always add a descriptive `name` and structured fields to custom error
  classes, never just a string message, because at 2am during an incident
  you want to `if (err instanceof RateLimitError)` and branch, not regex
  your way through a message string that a future refactor might casually
  reword."
- "A common follow-up: 'what happens if you throw inside a `.catch()`
  handler?' It produces a new rejected promise from that `.catch()` call —
  rejection propagation doesn't stop just because you were already in an
  error handler; you need a subsequent `.catch()` (or enclosing try/catch in
  async/await) to handle that new failure too, chain-style."
- "I treat `unhandledRejection` as a monitoring signal, not a safety net. In
  one Node service, we had dozens of rejected promises per hour from a
  fire-and-forget analytics call nobody awaited — it never crashed anything,
  but it meant we were silently losing telemetry. Wiring up the handler just
  to log-and-alert turned an invisible problem visible."
- "`finally` runs no matter what — even if `try` returns and `catch` isn't
  triggered, even if an exception is thrown inside `catch`. The trap I've
  seen juniors hit: returning a value from `finally` silently OVERRIDES a
  return from `try`/`catch`, because `finally`'s own `return`/`throw` always
  wins. I avoid ever putting a `return` inside `finally` for exactly this
  reason — it's a footgun, not a feature I rely on."
- "For async code specifically, I push hard for `try/catch` around
  `await`-heavy functions instead of long `.then().catch()` chains, purely
  for stack trace readability — a thrown error inside an `async` function
  keeps a much more legible, linear stack than a deeply chained promise
  pipeline where the original call site gets lost."

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Think of `throw` like pulling a fire alarm in a building: it doesn't matter
what floor (function) you're on — the alarm (error) travels up through every
floor above you until someone with a fire extinguisher (a `try/catch`)
stops it. If nobody stops it before it reaches the roof (top of the call
stack), the whole building (your program) shuts down.

Promises are different: a rejected promise doesn't pull an alarm that
travels up a physical building, because by the time it rejects, that
"floor" might not even exist anymore (the function already returned). It's
more like a sealed envelope marked "FAILED" that gets handed from person to
person (`.then()` to `.then()`) until someone opens it with a `.catch()`. If
nobody ever opens it, it just sits there — and some browsers/Node will
eventually notice and shout about it (`unhandledrejection`).

`async/await` is the best of both: the engine automatically repackages that
"FAILED" envelope back into a normal pulled-fire-alarm (`throw`) the moment
you `await` it, so your `try/catch` works exactly like it does in regular
synchronous code.

**Common traps:**
- **Trap 1:** "I wrapped my whole async function in try/catch, so I'm safe."
  Correction: a `try/catch` only catches errors thrown INSIDE the `try`
  block during THAT synchronous pass — if you kick off a promise and don't
  `await` it inside the `try`, its rejection escapes untouched.
- **Trap 2:** "Catching an error and logging it means I handled it."
  Correction: catching ≠ handling. If you don't fix the underlying state or
  re-throw a meaningful error, you've just hidden the bug — decide
  explicitly whether this error is recoverable here or needs to propagate.
- **Trap 3:** "`finally` is just cleanup code that doesn't affect the
  result." Correction: a `return` or `throw` inside `finally` silently
  overrides whatever `try`/`catch` was about to return or throw — never put
  control-flow statements in `finally`.

## 💻 Hands-On Exercise

Open `script.js`. Section 5 defines this function:

```js
async function riskyPipeline() {
  try {
    const step1 = await stepThatSucceeds();
    const step2 = await stepThatRejects(); // rejects with a custom error
    return step2;
  } catch (err) {
    if (err instanceof RetryableError) {
      console.log('retrying once...');
      return await stepThatSucceeds();
    }
    throw err; // re-throw anything we don't know how to handle
  } finally {
    console.log('pipeline cleanup ran');
  }
}
```

**Your task:** trace through what happens when `stepThatRejects()` throws a
`RetryableError`, versus what happens when it throws a plain `Error`.

**Expected behavior and why:**
- **With `RetryableError`:** the `catch` block matches the
  `instanceof RetryableError` check, logs `'retrying once...'`, and
  `return await stepThatSucceeds()` resolves successfully — but `finally`
  STILL runs after that return value is computed, logging
  `'pipeline cleanup ran'` before the promise returned by `riskyPipeline()`
  actually settles. `finally` always runs, even on a successful recovery
  path inside `catch`.
- **With a plain `Error`:** the `instanceof` check fails, so
  `throw err` re-throws it. `finally` still runs before the throw
  completes propagating — cleanup is guaranteed regardless of whether the
  function is about to return or throw. The caller of `riskyPipeline()`
  then sees a rejected promise and must have its own `.catch()` or
  `try/catch` around the call, or it becomes an unhandled rejection.
