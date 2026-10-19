# Day 19: Generators, Iterators & Coroutines

## 🧠 Core Architectural Concept

A generator function (`function*`) is a function whose execution can be
**paused and resumed from the outside**. Calling a generator function does
NOT run its body — it returns a **generator object**, which is both an
iterator and (per Day 14's protocol) an iterable. The body only runs,
incrementally, in response to `.next()` calls.

Mechanically, the engine keeps a **suspended execution context** for the
generator — effectively its own call-stack frame, local variable bindings,
and instruction pointer, frozen in place between `.next()` calls, instead of
being torn down the way a normal function's frame is torn down when it
returns. Each `.next(valueIn)` call:

1. Resumes the frozen frame.
2. Injects `valueIn` as the result of the generator's own LAST `yield`
   expression (the value `yield` "returns" into the generator body).
3. Runs synchronously until the NEXT `yield` (or `return`, or an uncaught
   throw).
4. Packages whatever was yielded as `{ value: yieldedValue, done: false }`
   and hands control back to the caller — or `{ value: returnValue, done:
   true }` if the generator finished.

```
caller                         generator frame (suspended between calls)
  │                                   │
  │──── gen.next(x1) ────────────────►│ resumes, binds x1 to last `yield`
  │                                   │ runs until `yield y1`
  │◄──── { value: y1, done:false } ───│ SUSPENDS here, frame frozen
  │                                   │
  │──── gen.next(x2) ────────────────►│ resumes, binds x2 to that `yield`
  │                                   │ runs until `return y2` (or end)
  │◄──── { value: y2, done:true } ────│ frame torn down, generator exhausted
```

This is a genuine **coroutine** primitive — cooperative multitasking where
the generator itself decides when to yield control back, rather than being
preemptively interrupted. It's the reason Day 18's async/await desugaring
works the way it does: an `async function` IS, under the hood, a generator
whose `yield`s are automatically "driven" by a promise-aware runner that
calls `.next()` for you every time the previously-yielded promise settles.
You don't write the runner by hand (the engine does, natively and far
faster than any userland polyfill) — but the suspend/resume mechanism is
identical.

Lazy evaluation falls directly out of this: a generator computes **nothing**
until you pull a value from it via `.next()`. This lets you model infinite
sequences (an endless counter, an unbounded Fibonacci stream) that would
blow the stack or run forever as an eager array — the consumer decides how
many values actually get computed, one at a time, on demand.

Generators also implement the full **iterator protocol** from Day 14
automatically: every generator object has a `.next()` method returning
`{value, done}`, AND a `[Symbol.iterator]` method that returns itself — which
is exactly why generators plug directly into `for...of`, spread syntax,
destructuring, and `Array.from()` without any extra glue code.

## 🎯 Interview Talking Points

- "I describe generators as 'the primitive async/await is built on.' When
  an interviewer asks 'how does await actually work,' the strongest answer
  references generators explicitly — it shows you understand the mechanism,
  not just the syntax. I walk through the generator+runner desugaring from
  Day 18 verbatim when asked."
- "Production use case I've actually shipped: I built a CSV-streaming
  importer using a generator to lazily parse and yield one row at a time
  from a multi-GB file, instead of loading the whole file into memory as an
  array first. The generator's lazy pull model meant memory usage stayed
  flat regardless of file size — this is the single biggest practical
  payoff of understanding lazy evaluation, not just an academic point."
- "A subtlety I bring up proactively: `yield` is an EXPRESSION, not a
  statement — it evaluates to whatever value gets passed into the NEXT
  `.next()` call. This bidirectional communication (values flow IN via
  `.next(x)` and OUT via `yield y`) is what makes generators strictly more
  powerful than plain iterators — you can use them to implement actual
  coroutines that receive instructions mid-execution, not just produce a
  sequence."
- "`yield*` (delegation) is underused and worth name-dropping: it delegates
  to another iterable/generator, forwarding its `.next()`/`.throw()`/
  `.return()` calls transparently. I've used it to compose smaller
  generator-based parsers into a larger one without manually re-implementing
  the plumbing."
- "Follow-up they might throw at you: 'what happens if you call `.throw()`
  on a generator?' Answer: it injects an exception AT the currently
  suspended `yield` point, as if that `yield` expression itself threw — if
  there's a `try/catch` wrapping that `yield` inside the generator body, it
  catches it normally; otherwise the exception propagates out of the
  `.next()`/`.throw()` call to the caller. This is EXACTLY the mechanism
  Day 18's async/await runner uses to make a rejected awaited promise show
  up as a catchable exception inside the async function."
- "Trade-off: generators give you fine-grained control over execution
  timing (true laziness, cancellable iteration via `.return()`), but
  they're harder to read for a team unfamiliar with the pattern, and
  debugging a suspended generator frame across multiple `.next()` calls in
  a debugger is less intuitive than a straight-line function. I use them
  deliberately for streaming/lazy data and infinite sequences, not as a
  general replacement for plain functions."

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Think of a generator like a **vending machine conversation**, not a normal
function that runs start-to-finish the moment you call it. Calling
`myGenerator()` doesn't dispense anything — it just hands you the machine.
Each time you press the button (`.next()`), it dispenses exactly ONE item
(`yield`s one value) and then freezes, waiting for you to press the button
again. It remembers exactly where it was between button presses — local
variables and all.

A regular array is like a box of donuts already baked and sitting on the
counter — all the work happened up front. A generator is a donut maker that
only fries the next donut when you actually ask for one — nothing is made
until it's needed. That's "lazy evaluation," and it's why generators can
represent infinite sequences without ever running out of memory: you just
never ask for "all of them" at once.

**Common traps:**
1. **"Calling the generator function runs its code."** No — calling
   `function*` just creates the generator object. Nothing inside the body
   runs until you call `.next()` the first time. Correction: generator
   functions are factories for a pausable iterator, not functions that
   execute.
2. **"`yield` is like `return` — it exits the function."** `yield` pauses
   and can be resumed; `return` (or running off the end) permanently finishes
   the generator — a subsequent `.next()` just returns `{value: undefined,
   done: true}` forever after. Correction: `yield` is "pause," `return` is
   "done, for real."
3. **"I need to manually track whether I'm done."** The iterator protocol
   already gives you `done: true/false` on every `.next()` result —
   checking that is enough; don't invent your own flag. Correction: trust
   `result.done`, that's literally what it's for.

## 💻 Hands-On Exercise

Predict the output of this snippet (reproduced in `script.js`), which builds
a custom lazy, infinite iterable and pulls a limited number of values from
it with a `for...of` + `break`:

```js
function* naturalNumbers() {
  let n = 1;
  while (true) {
    const resetTo = yield n;
    n = resetTo !== undefined ? resetTo : n + 1;
  }
}

const gen = naturalNumbers();
console.log(gen.next());        // call 1
console.log(gen.next());        // call 2
console.log(gen.next(100));     // call 3 — injects a value back IN
console.log(gen.next());        // call 4
```

**Predict the four logged objects before reading on.**

**Expected output:**
```
{ value: 1, done: false }
{ value: 2, done: false }
{ value: 100, done: false }
{ value: 101, done: false }
```

**Why:**
- Call 1: the generator runs from the top until the first `yield n` — at
  that point `n` is `1`, so it yields `1` and suspends. `resetTo` is not
  assigned yet (the assignment happens only when `.next()` resumes it).
- Call 2: `.next()` with no argument resumes with `resetTo = undefined`, so
  `n = n + 1 = 2`. The loop goes around, hits `yield n` again with `n = 2`,
  yields `2`, suspends.
- Call 3: `.next(100)` resumes the SAME suspended `yield n` expression,
  this time evaluating it to `100` — so `resetTo = 100`, and since `100 !==
  undefined`, `n` is set directly to `100` (not incremented). The loop goes
  around, hits `yield n` with the NEW `n = 100`, yields `100`, suspends.
- Call 4: `.next()` with no argument again — `resetTo = undefined`, so `n =
  n + 1 = 101`. Yields `101`.

This demonstrates the bidirectional nature of `yield`: it's not just "produce
a value out," it's also "receive a value in" on the very next resume,
exactly like the generator+runner model from Day 18 that feeds a resolved
promise value back into the paused `await` expression via `gen.next(value)`.
