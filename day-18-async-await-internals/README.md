# Day 18: Async/Await Internals

## 🧠 Core Architectural Concept

`async`/`await` is **syntax sugar** — it compiles down to the same
microtask-based promise machinery from Day 17. Nothing new runs underneath;
it's a different surface for writing promise chains that reads like
synchronous code.

The conceptual desugaring (this is literally how early Babel transpiled it,
and it's the mental model V8's implementation matches):

```js
async function getData() {
  const a = await fetchA();
  const b = await fetchB(a);
  return b;
}

// is conceptually equivalent to a GENERATOR + a PROMISE RUNNER that
// drives it:

function getData() {
  return new Promise((resolve, reject) => {
    function* generatorBody() {
      const a = yield fetchA();
      const b = yield fetchB(a);
      return b;
    }
    const gen = generatorBody();

    function step(input) {
      let result;
      try {
        result = gen.next(input);
      } catch (err) {
        return reject(err);
      }
      if (result.done) {
        return resolve(result.value);
      }
      // result.value is whatever was yielded (a promise, here).
      // The runner waits for it, then feeds the resolved value
      // back into the generator via gen.next(), continuing
      // execution exactly where it left off.
      Promise.resolve(result.value).then(step, (err) => {
        try {
          gen.throw(err); // inject the error at the await point
        } catch (e) {
          reject(e);
        }
      });
    }
    step();
  });
}
```

This is exactly why Day 19 (Generators) is a direct prerequisite concept —
`async function` is V8's native, optimized version of "generator whose
`yield`s are automatically driven by a promise-aware runner." You don't
write the runner; the engine provides it natively and far faster than any
userland polyfill, but the *shape* of the control flow is identical.

Key mechanical facts that fall out of this model:

1. **An `async function` always returns a Promise**, even if you `return` a
   plain value (it gets wrapped via the same `[[Resolve]]` logic from Day
   17) or if the function has no explicit `return` (implicitly resolves
   `undefined`).
2. **`await x` is roughly `Promise.resolve(x).then(...)` under the hood** —
   it always yields control back to the event loop and resumes via the
   microtask queue, even if `x` is already a non-promise value or an
   already-resolved promise. This means **every single `await`, no matter
   what it awaits, introduces at least one microtask tick** before the next
   line runs — a fact that trips up ordering predictions constantly (see the
   Hands-On Exercise).
3. **The code before the first `await` in an async function runs
   synchronously**, in the same tick as the caller — the function doesn't
   "go async" until it hits its first `await`.
4. **`try/catch` around `await` works because a rejected awaited promise is
   converted into a thrown exception at the await point** — this is the
   `gen.throw(err)` step in the desugaring above. It's real exception
   propagation, not a simulation; `catch` blocks, `finally` blocks, and even
   rethrows all behave exactly like synchronous exception handling, just
   resumed asynchronously.

## 🎯 Interview Talking Points

- "I describe async/await as 'promises with better scar tissue' — same
  microtask engine as Day 17, just syntax that lets you write top-to-bottom
  logic instead of nesting or chaining `.then()`. I make sure to say this
  explicitly in interviews because a surprising number of candidates think
  async/await is a *different concurrency mechanism* than promises — it
  isn't, at all."
- "The pitfall I've personally lost hours debugging: **sequential `await` in
  a `for` loop when the operations are independent.** I inherited a service
  that did `for (const id of ids) { await fetchUser(id); }` over 200 IDs —
  each fetch waited for the previous one to fully resolve before starting
  the next, turning what should've been one network round-trip's worth of
  latency (via `Promise.all`) into 200 sequential round trips. Fixed it with
  `await Promise.all(ids.map(fetchUser))` and cut p99 latency by over 90%."
- "The counter-case I always pair with that: sometimes sequential `await` in
  a loop is CORRECT — if each iteration depends on the previous result, or
  if you're intentionally rate-limiting calls to avoid overwhelming a
  downstream service. I've seen the 'always use Promise.all' advice applied
  blindly and cause a self-inflicted thundering-herd DDoS on an internal
  API. The real skill is recognizing which case you're in."
- "On unhandled rejections: an `await`ed rejection inside an `async`
  function that has no surrounding `try/catch` doesn't just vanish — it
  rejects the promise the `async function` itself returns. If THAT'S not
  handled by the caller either, it becomes an unhandled promise rejection,
  same as Day 17's mechanism. I treat every `async function` whose caller
  might not await/`.catch()` it as a potential silent-failure risk."
- "`try/catch` scoping is a real interview trap: if you put the `try` around
  the entire function body but have multiple `await`s, you lose the ability
  to apply different recovery logic per step. I generally scope `try/catch`
  tightly around the specific `await` whose failure I actually know how to
  handle, and let unrelated failures propagate to an outer handler."
- "Follow-up they'll throw at you: 'does `await` block the thread?' Answer:
  no — it never blocks. It suspends the *async function's own execution
  context* and returns control to the event loop immediately; the thread is
  completely free to do other work (handle clicks, run other code) while
  the awaited promise is pending. The illusion of 'pausing' is scoped
  entirely to that one function's local continuation, driven by the
  microtask queue when the awaited value settles."
- "I also flag: `await` outside an `async function` is a SyntaxError at the
  top level of a script in most environments unless you're using ES module
  top-level await — worth knowing the distinction between script vs module
  context when someone asks 'why did my quick console snippet fail?'"

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Think of an `async function` as a recipe card where some steps say "wait for
the oven timer." When the function hits `await`, it's like the cook putting
a sticky note on that exact line, walking away to do OTHER kitchen work (the
event loop keeps running everything else), and coming back to resume
*exactly where the sticky note is* the instant the timer (the awaited
promise) goes off. The cook never just stands at the oven blocking the
kitchen — that's the "non-blocking" part.

Under the hood, `await` isn't magic — it's `.then()` in a trench coat. Every
`await` is doing the same "wait for the microtask queue, then resume" dance
you learned on Day 16 and Day 17; `async`/`await` just lets you write it
without nesting callbacks.

**Common traps:**
1. **"`await` pauses my whole program."** No — it only pauses that one
   function's continuation. Everything else (other functions, UI events,
   timers) keeps running. Correction: `await` suspends a function, not the
   runtime.
2. **"I'll just put `await` in a loop, it's simpler to read."** Fine if each
   step genuinely depends on the last one — but if the iterations are
   independent, you're serializing work that could run in parallel.
   Correction: ask "does step N need step N-1's result?" If no, use
   `Promise.all(items.map(asyncFn))`.
3. **"My `try/catch` wraps the whole function, so I'm safe."** A `try/catch`
   around an `async function`'s body only catches errors from `await`s and
   synchronous throws *inside that same function's execution* — it does NOT
   catch errors from promises you fired off without awaiting them (fire-and
   -forget calls). Correction: if you don't `await` it, wrapping it in
   `try/catch` does nothing for it — you need a `.catch()` directly on that
   orphaned promise.

## 💻 Hands-On Exercise

Predict the console output order of this snippet (reproduced in
`script.js`):

```js
console.log('A: start');

async function asyncFn() {
  console.log('B: inside asyncFn, before await');
  await null;
  console.log('C: inside asyncFn, after await');
}

asyncFn();

console.log('D: after calling asyncFn (sync)');

Promise.resolve().then(() => console.log('E: a plain promise microtask'));

console.log('F: end of script');
```

**Predict the order before reading on.**

**Expected output:** `A, B, D, F, C, E`

**Why, line by line:**
- `A` logs synchronously, immediately.
- Calling `asyncFn()` begins running the function **synchronously** — the
  code before the first `await` is NOT deferred. So `B` logs immediately,
  in the same tick as the caller.
- `await null` is reached. Per the mental model above, this is roughly
  `Promise.resolve(null).then(resumeFunction)` — control returns IMMEDIATELY
  to the caller (`asyncFn()`'s caller gets back a pending promise), and the
  rest of `asyncFn` (`C`) is scheduled to resume as a microtask.
- Back in the caller: `D` logs synchronously (we're still unwinding the
  original synchronous call stack).
- `Promise.resolve().then(...)` registers ANOTHER microtask (the one that
  will log `E`), enqueued AFTER the resume-asyncFn microtask (because the
  `await null` resume job was enqueued first, back when we hit the `await`).
- `F` logs synchronously, finishing the main script (the initial macrotask).
- NOW the microtask queue drains: first the resume job for `asyncFn`, which
  logs `C` and lets the function run to completion (resolving the promise
  `asyncFn()` returned, which nobody is awaiting here, so that resolution is
  just discarded). Then the second microtask, which logs `E`.

If you predicted `C` before `D` or `F`, the fix to your mental model is:
**`await` — even `await null` or `await 5` — ALWAYS yields at least one
microtask tick**, it never resumes synchronously no matter how "instant"
the awaited value looks.
