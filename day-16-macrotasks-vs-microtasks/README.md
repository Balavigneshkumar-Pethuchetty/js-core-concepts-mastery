# Day 16: Macrotasks vs Microtasks

## 🧠 Core Architectural Concept

The event loop (covered at a high level on Day 15) doesn't run one flat queue —
it runs **two different queue tiers**, and the rule for how they interleave is
the single most-tested piece of async trivia in senior JS interviews.

- **Macrotask queue** (also called the "task queue"): `setTimeout`,
  `setInterval`, `setImmediate` (Node), I/O callbacks, UI events (`click`,
  `scroll`), `postMessage`, and the initial script execution itself is treated
  as the first macrotask.
- **Microtask queue**: `Promise.prototype.then`/`.catch`/`.finally` callbacks,
  `queueMicrotask()`, and (in Node) `process.nextTick` — which actually runs
  in its *own* even-higher-priority queue ahead of the regular microtask
  queue, detailed on Day 20.

The mechanism, precisely:

```
1. Run one macrotask to completion (this includes the top-level script on
   first execution — it counts as a macrotask for this purpose).
2. After that macrotask finishes, drain the ENTIRE microtask queue —
   not just what was there when the macrotask started, but also any new
   microtasks that got enqueued WHILE draining (microtasks can enqueue
   more microtasks, and they all run before the loop moves on).
3. Only once the microtask queue is completely empty does the event loop
   pick the next macrotask off the macrotask queue.
4. Repeat.
```

This is why it's called "draining fully" — it's not "run one microtask, check
for a macrotask, run one microtask again." It's exhaustive. If a `.then`
callback schedules another `.then`, and that schedules another, all of that
chain resolves before a single pending `setTimeout(fn, 0)` gets a chance to
run, no matter how long the chain is (modulo literally infinite chains, which
will starve the macrotask queue forever — a real footgun, see Common Pitfalls
in `script.js`).

ASCII mental model:

```
Call Stack empty?
      │
      ▼
┌─────────────────────┐
│  Drain ALL microtasks │◄────────────┐
│  (Promise .then,      │             │
│   queueMicrotask)      │             │ a microtask callback
└──────────┬───────────┘             │ can enqueue another
           │ queue empty              │ microtask — loop
           ▼                          │ back and keep draining
┌─────────────────────┐              │
│  Pop ONE macrotask    │──────────────┘
│  (setTimeout, click,  │   new microtasks from running
│   I/O callback)        │   this macrotask get drained
└──────────┬───────────┘   before the NEXT macrotask
           │
           └──► back to top
```

Under the hood in V8, this isn't magic — `Promise` reactions are literally
pushed onto an internal **job queue** (the "PromiseReactionJob" / microtask
queue defined by the ECMA-262 spec's Job abstraction), while `setTimeout`
callbacks are registered with the *host environment* (the browser or
libuv in Node) and scheduled back into V8 only when the host's timer fires
and the host pushes a task onto its task queue. The JS spec itself defines
microtasks ("jobs") formally; macrotasks are a *host* concept — the spec
never says the words "macrotask queue." That distinction matters and is
explored fully on Day 20.

## 🎯 Interview Talking Points

- "The mental model I give every junior is: **microtasks are VIP skip-the-line
  tickets, macrotasks wait for the next event loop turn.** Once the call
  stack is empty, JS will exhaustively clear every promise callback — even
  ones scheduled *during* that clearing — before it ever looks at a pending
  `setTimeout`."
- "I debugged a UI jank bug once where a chain of ~40 chained `.then()` calls
  (each doing a bit of data transformation) was blocking a `setTimeout`-based
  progress-bar update from ever rendering mid-chain — the macrotask queue was
  being starved because microtasks kept re-enqueuing themselves faster than
  the chain finished. The fix was breaking the chain with a `setTimeout(fn,
  0)` at intervals to yield back to the macrotask queue and let the browser
  paint."
- "`setTimeout(fn, 0)` never means 'run in 0ms.' It means 'put this at the
  back of the macrotask queue, after the current microtask queue is fully
  drained, and after browsers' minimum clamp (historically 4ms for nested
  timers) has elapsed.' I've seen engineers assume `setTimeout(fn, 0)` runs
  before a `Promise.resolve().then(fn)` — it never does."
- "A follow-up they'll throw at you: 'does `requestAnimationFrame` count as a
  macrotask?' Answer: it's its own task source, scheduled by the browser to
  run before the next repaint, after microtasks have drained — not the same
  queue as `setTimeout`, and its timing relative to other macrotasks depends
  on the render pipeline, not FIFO ordering. I always flag that I'd verify
  exact scheduling in DevTools Performance panel rather than guess blind in a
  high-stakes system."
- "Trade-off I talk about: using `queueMicrotask` vs `setTimeout(fn, 0)` to
  defer work. `queueMicrotask` runs sooner (same turn, before paint/IO) but
  if abused it can delay rendering and I/O indefinitely under load;
  `setTimeout` yields to the browser/Node's other work but adds real latency.
  I pick `queueMicrotask` for 'finish this logical operation asynchronously
  but atomically relative to other promises,' and `setTimeout` for 'yield to
  the platform.'"
- "I also point out `MutationObserver` callbacks are microtasks too — a
  commonly forgotten one that bites people doing DOM-diffing libraries."

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Think of the event loop like an airport security line with two lanes: a
**VIP lane** (microtasks: promises) and a **regular lane** (macrotasks:
timers, clicks, network callbacks). Every time the VIP lane has even one
person in it, security clears the *entire* VIP lane — including people who
joined the VIP line while they were already processing it — before letting a
single person from the regular lane through.

So: `console.log('A'); setTimeout(() => console.log('B'), 0);
Promise.resolve().then(() => console.log('C')); console.log('D');` logs
`A, D, C, B` — not `A, D, B, C` — because `C` is a VIP (microtask) and `B` is
regular-lane (macrotask), and VIPs always clear first once the main script
(itself a macrotask) finishes.

**Common traps:**
1. **"`setTimeout(fn, 0)` runs immediately."** No — it runs after the current
   synchronous code AND after every pending promise callback, not "right
   away." Correction: treat `0` as "as soon as possible, but after
   microtasks."
2. **"Promises run on a separate thread, that's why they're async."** No —
   JS is single-threaded. Promises just *defer* their callback to the
   microtask queue; the actual work inside `new Promise((resolve) => {...})`
   still runs synchronously, immediately, on the main thread when you call
   it. Correction: it's not concurrency, it's a scheduling queue.
3. **"If I add more `.then()`s, I'm making it more async/slower."** Not
   necessarily blocking in the macrotask sense, but every `.then()` adds one
   more microtask turn — in a tight loop this can silently monopolize the
   thread and starve rendering. Correction: long microtask chains can block
   paint just like long synchronous code can.

## 💻 Hands-On Exercise

Open `script.js`'s `ASYNC ORDERING TRACE` section. Before running it, predict
the exact console output order for this snippet (it's reproduced verbatim in
the file):

```js
console.log('1: script start');

setTimeout(() => console.log('2: setTimeout 1'), 0);

Promise.resolve()
  .then(() => console.log('3: promise 1'))
  .then(() => console.log('4: promise 1 chained'));

setTimeout(() => console.log('5: setTimeout 2'), 0);

Promise.resolve().then(() => console.log('6: promise 2'));

console.log('7: script end');
```

**Write down your predicted order (1-7, using the labels) before reading
further.**

**Expected output order:** `1, 7, 3, 6, 4, 2, 5`

**Why, line by line:**
- `1` and `7` are synchronous — they run immediately as the main script
  (itself the first macrotask) executes top to bottom. Nothing can interrupt
  synchronous code mid-flow.
- Both `setTimeout` calls (`2` and `5`) are registered as macrotasks and go
  to the back of the macrotask queue — they cannot run until the *entire*
  microtask queue is empty, which is after the main script's current
  synchronous run finishes AND all promise reactions settle.
- `3` and `6` are the *first* `.then()` on each promise chain — both promises
  were already resolved synchronously when created, so both reactions are
  enqueued as microtasks during the main script's synchronous run, in the
  order they were attached: `3` before `6`.
- `4` is the *second* `.then()` in the first chain — it can only be enqueued
  once `3`'s callback actually runs and returns (chaining `.then` enqueues
  the next microtask only after the previous one resolves). So by the time
  `4` is scheduled, `6` is already ahead of it in the queue — hence `6`
  before `4`.
- Once the microtask queue is fully drained (`3, 6, 4` all done), the loop
  finally moves to the macrotask queue, running the two `setTimeout`
  callbacks in the FIFO order they were registered: `2` then `5`.

If you predicted `1, 7, 3, 4, 6, 2, 5` — the classic mistake — re-read the
`4` vs `6` explanation above: chaining does not front-load every `.then` in a
chain into the queue at once; each one is enqueued only after its predecessor
resolves.
