# Day 21: Microtask & Macrotask Scheduling APIs

## 🧠 Core Architectural Concept

By Day 16 you learned the headline rule: microtasks drain completely before
the next macrotask runs. Today we zoom into the *other* schedulers that
production code actually touches — `queueMicrotask`, `requestAnimationFrame`,
`requestIdleCallback`, Node's `process.nextTick`, and `setImmediate` — because
each one plugs into the event loop at a *different* point, and interview
questions love to combine them to see if you actually understand the
mechanism rather than having memorized "microtasks before macrotasks."

Think of the event loop as a loop with distinct, ordered phases, not a single
undifferentiated bucket of "async stuff":

```
┌───────────────────────────────┐
│  1. Run current call stack to  │  synchronous code always wins
│     completion                 │
├───────────────────────────────┤
│  2. Drain the microtask queue  │  queueMicrotask, Promise.then/catch/finally,
│     COMPLETELY, including any  │  async/await resumption — ALL of them,
│     microtasks it schedules    │  even ones queued *while* draining
├───────────────────────────────┤
│  3. (Browser only) rendering   │  if the display needs a frame, the browser
│     opportunity → rAF callbacks│  runs requestAnimationFrame callbacks here,
│     → style/layout/paint       │  right before it paints
├───────────────────────────────┤
│  4. (Browser only) if idle     │  requestIdleCallback callbacks run in
│     time remains before next   │  leftover time, lowest priority of all
│     frame/task                 │
├───────────────────────────────┤
│  5. Pick ONE macrotask from a  │  setTimeout/setInterval callbacks, I/O
│     task queue, run it         │  callbacks, UI events, message channel
├───────────────────────────────┤
│  → back to step 2              │  microtasks drain again before anything else
└───────────────────────────────┘
```

Node.js has a materially different phase structure because it's built on
**libuv**, not a browser rendering loop:

```
timers → pending callbacks → idle/prepare → poll (I/O) → check → close callbacks
   ▲                                                        │
   └── process.nextTick queue drains, THEN microtask queue ─┘
       drains, between EVERY single callback, in EVERY phase
       (not just once per "loop tick")
```

The engine-level mechanics, one API at a time:

- **`queueMicrotask(fn)`** — pushes `fn` straight onto the same microtask
  queue that promise callbacks use. It's the "I want this to run before
  anything else, but after my current synchronous code" primitive. It exists
  because before it shipped, people abused `Promise.resolve().then(fn)` to
  get the same effect — `queueMicrotask` is V8/spec's answer to "stop hacking
  this with promises."
- **`process.nextTick(fn)`** (Node only) — this is **not** the microtask
  queue, even though it behaves similarly. Node maintains a *separate*,
  higher-priority queue. The real algorithm: after every single callback
  (not just once per phase), Node fully drains `nextTick` queue first, then
  fully drains the Promise microtask queue, and only then does it continue.
  This is why `process.nextTick` callbacks always run before
  `queueMicrotask`/`.then()` callbacks scheduled in the same synchronous
  tick — not because nextTick is "faster," but because it's a categorically
  different, earlier-draining queue.
- **`setTimeout(fn, 0)` / `setImmediate(fn)`** (Node only) — both are
  macrotasks, but they live in different phases. `setTimeout(fn, 0)` is
  scheduled in the **timers** phase (and the minimum delay is clamped to
  ~1ms by spec/engine, it is never truly "0"). `setImmediate` runs in the
  **check** phase, which comes right after **poll** (I/O). Ordering between
  them from the *main module* is technically unspecified-but-usually-timers-
  first because of timer-clamping overhead, but **inside an I/O callback**
  (e.g. inside `fs.readFile`'s callback), `setImmediate` is *guaranteed* to
  fire before `setTimeout(fn, 0)` because you're already past the poll phase
  and check comes next, while timers won't be revisited until the loop wraps
  around.
- **`requestAnimationFrame(fn)`** (browser only) — not a macrotask in the
  task-queue sense at all. It's tied to the browser's rendering pipeline: the
  callback runs immediately before the browser recalculates style, lays out,
  and paints the next frame — synced to the display's refresh rate (typically
  ~60Hz / every ~16.6ms), and it's **skipped entirely** if the tab is in a
  background/hidden state (browsers throttle or pause rAF to save battery/CPU).
- **`requestIdleCallback(fn)`** (browser only, not supported in Safari) —
  runs during idle periods *after* layout/paint, when the browser has spare
  time before the next frame is due. It gets a `deadline.timeRemaining()` so
  you can cooperatively yield. This is the lowest-priority scheduler of the
  bunch — great for analytics pings, prefetching, non-critical logging —
  and it can be starved indefinitely on a busy page, which is the #1 trap.

## 🎯 Interview Talking Points

- "I treat `process.nextTick` as a danger zone, not a convenience. I once
  inherited a Node service where a recursive `nextTick` call in a retry
  handler starved the event loop completely — HTTP keep-alive sockets never
  got their I/O serviced because `nextTick`'s queue takes priority on *every*
  single drain point, so if you keep refilling it, you never reach the poll
  phase. `setImmediate` doesn't have this starvation risk in the same way,
  because it's scheduled relative to a loop phase, not drained greedily."
- "`setTimeout(fn, 0)` never means 'run immediately.' Browsers and Node both
  clamp it — HTML spec says nested timeouts get clamped to a 4ms minimum
  after repeated calls, and Node's minimum is ~1ms. If someone says 'just use
  setTimeout 0 to defer,' I ask *why* — usually `queueMicrotask` or a
  dedicated API is the more correct, faster-draining choice."
- "I use `requestAnimationFrame` for anything that touches layout — reading
  `offsetHeight`, animating transforms — because it guarantees I'm reading
  post-layout values synced with the actual paint, instead of racing the
  browser and causing forced synchronous layout thrashing."
- "The trade-off with `requestIdleCallback` is that 'idle' is a promise, not
  a guarantee. On a page with a busy main thread — lots of scroll listeners,
  animations — your idle callback might get starved for seconds. I only use
  it for work that's truly OK to delay indefinitely, like non-critical
  telemetry, never for anything user-visible."
- "A classic follow-up: 'why does `setImmediate` sometimes run before
  `setTimeout(fn, 0)` and sometimes after?' The honest answer is it depends
  on where you are in the loop. From the top-level of a script, it's
  effectively a coin flip based on process startup overhead. From inside an
  I/O callback (`fs.readFile`, a `net` socket event), `setImmediate` always
  wins because you're already past the poll phase and check is the very next
  stop, while timers have to wait for the loop to cycle back around."
- "I've had to explain to a junior why their `.then()` chain ran *after* a
  `setTimeout` they scheduled first — they assumed scheduling order equals
  execution order. It doesn't. Execution order is governed by *which queue*
  you're in, and microtasks always fully drain before the next macrotask is
  even picked up, regardless of timer value or call order."

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Picture a coffee shop with a strict priority system:

1. **Whoever's being served right now** finishes first — that's your
   currently-running synchronous code.
2. **The "quick question" line** (microtasks: `.then()`, `queueMicrotask`,
   `await`) gets served *completely empty* before the barista looks at the
   next full order — even if three new quick-question people joined the line
   while they were being served.
3. In Node, there's an **even faster VIP line** (`process.nextTick`) that
   gets checked before the quick-question line, every single time, not just
   once per order.
4. **The "full order" line** (macrotasks: `setTimeout`, `setImmediate`, I/O,
   click events) — only one order gets made at a time, and after each one,
   the barista re-checks both the VIP line and the quick-question line from
   scratch before taking the next full order.
5. In a browser, there's also a **"let me take a photo before you leave"**
   moment (`requestAnimationFrame`) that happens right before the shop
   updates its window display (a repaint) — and a **"I'll restock shelves
   whenever it's quiet"** task (`requestIdleCallback`) that only happens if
   there's genuinely nothing else to do.

**Common traps:**
- **Trap 1:** "I called `setTimeout` before `.then()`, so `setTimeout` should
  run first." Correction: scheduling order doesn't matter — queue priority
  does. All pending microtasks always run before the next macrotask.
- **Trap 2:** "`process.nextTick` is just a faster `setTimeout`." Correction:
  it's not a timer at all — it's a priority queue that drains before
  microtasks and before the loop even considers moving to the next phase.
- **Trap 3:** "`requestIdleCallback` guarantees my code runs soon."
  Correction: it only runs if the browser is actually idle — on a busy page
  it can be delayed far longer than you'd expect, so never put
  user-blocking work in it.

## 💻 Hands-On Exercise

Open `script.js`. Section 5 ("THE COMBINED TRACE PUZZLE") schedules, in this
exact order, inside one synchronous block:

```js
console.log('A');                          // sync
setTimeout(() => console.log('B'), 0);     // macrotask (timer)
queueMicrotask(() => console.log('C'));    // microtask
Promise.resolve().then(() => console.log('D')); // microtask
console.log('E');                          // sync
```

**Your task:** before running it (in Node via `node script.js`, or in the
browser via `index.html`), write down the order you predict A–E will print
in.

**Expected output and why:**

```
A   // synchronous — runs immediately, before anything is scheduled
E   // still synchronous — the engine finishes the whole top-level block
    // before touching any queue, so A and E always print before B/C/D
C   // microtask queue, FIFO — queueMicrotask was registered first in
    // the microtask queue... BUT
D   // ...wait, D was also registered via Promise.resolve().then AFTER C,
    // so FIFO order within the microtask queue gives us C then D
B   // macrotask — setTimeout's callback only runs after the ENTIRE
    // microtask queue (C and D) has fully drained, even though it was
    // scheduled before C and D in source order
```

Final order: `A, E, C, D, B`. The one-sentence mental model that resolves
every "predict the output" trick on this topic: **the engine finishes
running synchronous code to completion, then drains the microtask queue
completely (FIFO), and only then does it dequeue a single macrotask** — and
that whole cycle repeats.
