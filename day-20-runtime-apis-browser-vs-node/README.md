# Day 20: Runtime APIs — Browser vs Node.js

## 🧠 Core Architectural Concept

Here's the fact that reframes everything from Days 15-19: **"the event
loop" is not defined by the JavaScript specification (ECMA-262) at all.**
The spec defines the **Job/microtask queue** (promise reactions,
`queueMicrotask`) as part of the language. It says nothing about
`setTimeout`, I/O, rendering, or how a "task queue" is structured — those
are **host environment** concerns. V8 is just the engine that executes
JS; the browser and Node.js each bolt their OWN event loop implementation
around it, and the two are meaningfully different machines that happen to
both run JS.

### Browser event loop

A browser's event loop is built around **task sources** feeding a single
conceptual task queue (specified by the HTML Living Standard, not
ECMA-262), plus the microtask queue (which IS spec'd by ECMA-262) draining
between tasks, plus a rendering opportunity:

```
┌─ one task from a task source (timer, click, message, etc.) ─┐
│  run it to completion                                        │
└───────────────────────┬────────────────────────────────────┘
                         ▼
          drain the ENTIRE microtask queue (spec'd by ECMA-262)
                         ▼
     "should we render a frame?" — browser decides based on
     ~60Hz display refresh budget, not every single loop turn
                         ▼
          if yes: run requestAnimationFrame callbacks,
          then perform style/layout/paint/composite
                         ▼
                 back to top — next task
```

`requestAnimationFrame` is its OWN task source, intentionally scheduled to
fire right before a repaint — NOT FIFO-equivalent to `setTimeout`. This is
why rAF-based animations stay smooth even under event-queue pressure: the
browser tries to give rAF callbacks priority right before paint, rather
than treating them as a plain macrotask stuck behind whatever else is
queued.

### Node.js event loop (libuv)

Node's event loop is implemented by **libuv**, a C library, and it's
organized into **distinct phases**, each with its own FIFO queue, cycled
through in a fixed order every "tick" of the loop:

```
   ┌───────────────────────┐
┌─►│      timers            │  setTimeout / setInterval callbacks
│  │  (expired ones only)   │  whose delay has elapsed
│  └───────────┬───────────┘
│  ┌───────────▼───────────┐
│  │   pending callbacks     │  some system-level I/O callbacks
│  │  (a.k.a. "pending I/O") │  deferred to the next loop iteration
│  └───────────┬───────────┘
│  ┌───────────▼───────────┐
│  │     idle / prepare      │  internal libuv bookkeeping
│  └───────────┬───────────┘
│  ┌───────────▼───────────┐
│  │        poll             │  retrieves new I/O events; executes
│  │                         │  their callbacks (fs, network, etc.)
│  └───────────┬───────────┘
│  ┌───────────▼───────────┐
│  │        check            │  setImmediate() callbacks — ALWAYS
│  │                         │  run right after the poll phase
│  └───────────┬───────────┘
│  ┌───────────▼───────────┐
│  │   close callbacks       │  e.g. socket.on('close', ...)
│  └───────────┬───────────┘
└──────────────┘
```

Two things are NOT phases but sit outside/above this entire diagram and cut
in line ahead of everything:

- **`process.nextTick()`**: this is NOT part of the microtask queue, and
  NOT a libuv phase. It has its OWN queue that is drained **completely,
  before the regular Promise microtask queue, after every single callback
  Node runs** — not just between loop phases, but after literally any
  individual callback completes. It's the highest-priority scheduling
  mechanism Node offers, and Node's own internals use it for things like
  error-emission timing guarantees.
- **The Promise microtask queue**: spec'd by ECMA-262, same as the browser
  — drains fully after `process.nextTick`'s queue, at each of these
  transition points.

So the real Node priority order, from highest to lowest, at every
callback-boundary: **`process.nextTick` queue (fully drained) → Promise
microtask queue (fully drained) → next libuv phase's callback.**

### `setTimeout(fn, 0)` vs `setImmediate(fn)` in Node — the classic gotcha

From the **top-level** of a script (not inside an I/O callback), their
relative order is technically **not guaranteed** — it depends on process
startup performance (whether the timer's minimum threshold has elapsed by
the time the loop reaches the timers phase). But **inside an I/O callback
(e.g., inside a `fs.readFile` callback, during the poll phase)**,
`setImmediate` is GUARANTEED to run before any `setTimeout(fn, 0)`, because
the check phase (where `setImmediate` runs) comes immediately after poll in
the SAME loop iteration, whereas the timer would require a NEW loop
iteration to reach the timers phase again.

## 🎯 Interview Talking Points

- "The framing I open with: 'the event loop' is a runtime detail, not a
  JS-spec feature. I've seen senior candidates confidently describe THE
  event loop as if it's one universal thing — and the strongest answer
  distinguishes what ECMA-262 guarantees (the microtask/Job queue) from what
  the HOST (browser or Node) layers on top. That distinction is usually what
  separates a mid-level answer from a staff-level one."
- "I debugged a real production incident caused by exactly this gap: code
  that worked correctly in the browser (dev environment) had subtly
  different ordering once deployed to a Node-based SSR service, because a
  `setTimeout(fn, 0)` we used to 'defer to next tick' actually interleaved
  differently with a `process.nextTick`-using library dependency. The fix
  was replacing the ad hoc timeout with an explicit promise-based
  scheduling primitive that behaves identically in both runtimes."
- "On `process.nextTick` specifically: it is NOT a microtask by ECMA-262's
  definition — it has Node's own, even-higher-priority queue. I call this
  out explicitly because 'process.nextTick is just Node's microtask queue'
  is a common but slightly wrong simplification — it's actually a layer
  ABOVE the microtask queue in Node's priority order, and recursive
  `process.nextTick` calls can starve I/O entirely, which is a documented
  Node footgun (Node's own docs warn about this)."
- "On `setImmediate` vs `setTimeout(fn, 0)`: I always give the precise
  answer — order is non-deterministic at the top level, but deterministic
  (setImmediate wins) inside an I/O callback — because giving a flat 'they're
  the same' answer is wrong, and a flat 'setImmediate always wins' answer is
  also wrong. Precision here signals real production debugging experience."
- "Follow-up they might throw at you: 'why does requestAnimationFrame exist
  if setTimeout can already schedule a callback?' Answer: rAF is
  synchronized to the browser's actual repaint cycle — it won't fire more
  often than the display can render (typically capping near monitor refresh
  rate), and it automatically pauses in background/inactive tabs to save
  battery/CPU, neither of which `setTimeout` does on its own."
- "Trade-off I discuss: Node's phase-based model gives you fine-grained
  control (you can intentionally target 'run right after I/O, before any
  timer' via `setImmediate`), but it means the SAME conceptual 'queue a task
  for later' intent (`setTimeout(fn, 0)` vs `setImmediate` vs
  `process.nextTick` vs `queueMicrotask`) has four different real-world
  timings in Node, each suited to a different situation — and picking the
  wrong one is a subtle source of race conditions in server code."

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Think of **JavaScript the language** as a car engine, and **the browser /
Node.js** as two completely different cars built around that same engine —
a sports car and a delivery truck. Both have an engine (V8, running your JS
code and its microtask queue), but the chassis, dashboard, and controls
around it (how tasks get scheduled, what APIs exist — `fetch` vs
`fs.readFile`, DOM vs file system) are totally different, because they're
built for different jobs. "The event loop" is really "whatever scheduling
system THIS PARTICULAR car was built with around the engine" — the browser
built one kind, Node built a different kind (phases, via libuv), and they
only agree on one small piece: the engine's own microtask queue.

**Common traps:**
1. **"The event loop works the same everywhere JS runs."** It doesn't — the
   microtask queue (promises) is consistent because it's part of the
   language spec, but macrotask scheduling, phases, and extra APIs like
   `process.nextTick` are runtime-specific. Correction: always specify
   "in the browser" or "in Node" when describing scheduling order.
2. **"`setImmediate` and `setTimeout(fn, 0)` are basically the same
   thing."** They behave differently depending on WHERE in the loop you
   call them from. Correction: inside I/O callbacks, `setImmediate` wins;
   at the top level, it's not guaranteed either way.
3. **"`process.nextTick` is Node's version of `queueMicrotask`."** It's
   similar in spirit (both defer and run soon) but it's actually a SEPARATE,
   higher-priority queue that drains before the Promise microtask queue in
   Node. Correction: `process.nextTick` queue > Promise microtask queue in
   Node's priority order — they are not the same queue.

## 💻 Hands-On Exercise

This exercise has two parts because the behavior genuinely differs by
runtime — run the Node-only block with `node script.js` AND open
`index.html` in a browser to see the browser-equivalent block, then compare.

**Node.js block — predict the order:**
```js
console.log('start');
setTimeout(() => console.log('timeout'), 0);
setImmediate(() => console.log('immediate'));
process.nextTick(() => console.log('nextTick'));
Promise.resolve().then(() => console.log('promise'));
console.log('end');
```

**Expected Node output:** `start, end, nextTick, promise, timeout, immediate`
(**OR** `start, end, nextTick, promise, immediate, timeout` — see explanation)

**Why:** `start`/`end` are synchronous. Then, at the first
callback-boundary, Node drains `process.nextTick`'s queue FULLY first
(`nextTick`), then the Promise microtask queue FULLY (`promise`) — both
ahead of ANY timer or I/O phase. Then the loop proceeds to the **timers**
phase (`timeout`, if its minimum delay has elapsed) before reaching the
**check** phase (`immediate`) later in the same iteration. At the TOP
LEVEL of a script (not inside an I/O callback), whether `timeout` or
`immediate` logs first is technically **non-deterministic** — it depends on
how much time elapsed between process start and the loop reaching the
timers phase — which is why the Interview Talking Points above call this
out explicitly rather than claiming one fixed order. `script.js` includes a
second version run from INSIDE an I/O callback (`fs.readFile`'s callback)
where the order becomes deterministic: `immediate` always wins there.

**Browser-equivalent block — predict the order:**
```js
console.log('start');
setTimeout(() => console.log('timeout'), 0);
Promise.resolve().then(() => console.log('promise'));
console.log('end');
```

**Expected browser output:** `start, end, promise, timeout` — there's no
`process.nextTick` or `setImmediate` in a browser, so this collapses to
the Day 16 rule: microtasks (promise) drain fully before the next
macrotask (timeout).
