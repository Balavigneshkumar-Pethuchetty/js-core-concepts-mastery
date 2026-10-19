# Day 15: Event Loop Foundations (Call Stack, Heap, and Task Queues)

## 🧠 Core Architectural Concept

JavaScript the *language* is single-threaded: one call stack, one thing executing at any
instant, no true parallel execution of your JS code (Web Workers aside, which run
completely separate engine instances with their own stack/heap/loop — they communicate by
message-passing, not shared memory). Given that, the obvious question is: how does a
single-threaded language do non-blocking I/O, animate a UI, and handle thousands of
concurrent network requests without freezing? The answer is that **the JS engine itself
is only one piece of the runtime** — the browser (or Node, via libuv) wraps the engine
with additional machinery, and the **event loop** is the coordination mechanism that
connects them.

Think of the runtime as four cooperating pieces:

```
┌─────────────────────────────────────────────────────────────────┐
│                         JS RUNTIME                                 │
│                                                                     │
│   ┌───────────────┐        ┌───────────────────────────────┐      │
│   │  CALL STACK    │        │  HEAP                          │      │
│   │  (synchronous   │        │  (objects, closures, all       │      │
│   │  execution,     │        │   non-primitive allocations    │      │
│   │  one frame at   │        │   live here — see Day 11/12)   │      │
│   │  a time)        │        └───────────────────────────────┘      │
│   └───────┬───────┘                                                │
│           │ when the stack is EMPTY, the event loop checks queues  │
│           ▼                                                         │
│   ┌─────────────────────────────────────────────────────────┐     │
│   │                      EVENT LOOP                            │     │
│   │   "while (true): if callStack is empty, pull the next     │     │
│   │    ready task from a queue and push it onto the stack"    │     │
│   └─────────────────────────────────────────────────────────┘     │
│           ▲                                                         │
│           │ feeds ready callbacks in, from:                        │
│   ┌───────┴─────────────────────┐   ┌─────────────────────────┐   │
│   │  WEB APIs / Node APIs         │   │  TASK QUEUE(S)            │   │
│   │  (timers, network, DOM        │──▶│  macrotask queue,         │   │
│   │  events, file I/O via libuv)  │   │  microtask queue, etc.    │   │
│   │  run OUTSIDE the JS thread    │   │  (deep dive on Day 16)    │   │
│   └───────────────────────────────┘   └─────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

Here's the mechanism in plain terms: when you call `setTimeout(fn, 1000)`, the JS engine
does **not** sit there waiting a second. It hands the timer off to a *different* system —
the browser's timer API, or in Node, libuv's event loop infrastructure — which runs
completely outside your single JS thread, on its own schedule. Your JS code immediately
continues running whatever's next in the call stack. A second later, once the timer
actually fires, that system doesn't jump straight back into your running code (it can't —
JS can only execute one thing at a time) — it places `fn` into a **task queue**, a
waiting line of "callbacks that are ready to run." The **event loop** is the simple,
repeating process that asks one question forever: *"is the call stack empty? If so, take
the next ready callback off a queue and push it onto the stack to run it."*

This is the whole trick behind "non-blocking single-threaded JS": the *waiting* (for a
timer, a network response, a file read, a user click) never happens on the JS thread at
all — it happens in the surrounding runtime (browser APIs, libuv's thread pool for Node
file/network I/O). The JS thread is only ever busy running actual JS code to completion,
one call-stack frame at a time, and the event loop is the usher deciding what gets to run
next once the stack clears. This is why a long-running **synchronous** JS computation
(e.g. a giant loop, `JSON.parse` on a huge payload) *does* block everything — UI
rendering, timer callbacks, network response handling — because the call stack never
empties, and the event loop can't push anything new onto a stack that's still occupied.
There's no mechanism to interrupt a currently-running JS frame; it runs to completion
before the loop can hand control to anything else, which is also why that long
computation is called "blocking the event loop," a phrase you'll hear constantly in
production debugging.

At this foundational level there's more than one queue (there's a distinction between
**macrotasks** — timers, I/O callbacks, UI events — and **microtasks** — promise
callbacks, `queueMicrotask` — with specific draining order between them), but that's
deliberately the subject of Day 16 onward. The one thing worth planting now: **not all
queues are equal, and ordering between them is precise and spec-defined, not "roughly
whenever."** For today, the mental model that matters is just: call stack runs
synchronous code to completion → stack empties → event loop pulls the next ready
callback from a queue → push it, run it to completion → repeat, forever. Everything in
Days 16-22 is refinement on top of this one loop.

## 🎯 Interview Talking Points

- "The event loop isn't part of the JS language spec (ECMA-262) at all — it's part of the
  *host environment's* spec (the HTML spec for browsers, libuv for Node). This is why
  behavior differs subtly between browsers and Node for things like `setTimeout(fn, 0)`
  timing or microtask draining around I/O — they're different runtimes implementing a
  similar but not identical model around the same single-threaded JS engine."
- "I've debugged a production issue where a 'frozen UI' complaint turned out to be a
  synchronous `.sort()` with a heavy custom comparator running on a 50,000-item array
  directly on user input — nothing to do with any async code being 'slow.' The call
  stack was simply occupied for hundreds of milliseconds, so no click handlers, no
  animation frames, no network callbacks could run until it finished. The fix was moving
  the sort off the main thread into a Web Worker, which has its own call stack entirely."
- "A trade-off worth stating unprompted: the single-threaded model buys you simplicity —
  no locks, no mutexes, no data races on shared memory, because nothing is ever truly
  running at the same instant as your JS code. The cost is that one badly-behaved
  synchronous task can starve everything else, including UI responsiveness. There's no
  preemption — the engine cannot interrupt a running function partway through."
- "Follow-up they might throw at you: 'if JS is single-threaded, how does `fetch` or a
  database query not block everything while waiting for the network?' Answer: the actual
  waiting happens outside the JS thread, in browser/OS networking machinery or, in Node,
  largely in libuv's thread pool for certain APIs. The JS thread just registers a
  callback and moves on; the callback gets queued for the event loop to run only once the
  response is actually ready and the call stack is free."
- "Second follow-up, often used to check if you actually understand this vs. memorized
  it: 'does `setTimeout(fn, 0)` run `fn` immediately?' No — it still goes through the
  full queue/event-loop cycle. It's scheduled to run 'as soon as possible after the
  minimum delay,' not synchronously, and it will always run *after* the current
  synchronous code finishes, even if that current code takes much longer than 0ms."
- "I'd explicitly flag that there isn't just one queue — I'll name that macrotasks and
  microtasks exist and behave differently, but defer the precise ordering rules, because
  getting that wrong in an offhand comment is worse than correctly scoping what I know at
  this level versus what requires the deeper breakdown."

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Picture a single chef in a kitchen (the call stack) who can only do one task at a time,
start to finish, no multitasking mid-task. Orders come in (clicks, timers finishing,
network responses arriving) and get written on tickets that go into a line by the
kitchen window (a task queue) — they don't interrupt the chef. The **event loop** is
simply: "chef finishes whatever they're cooking, then glances at the ticket line, grabs
the next ticket, cooks that, glances again, forever." If the chef gets stuck on one huge,
slow dish (a long synchronous computation), every other ticket just sits in line,
untouched, no matter how long ago it arrived — the kitchen isn't "broken," the chef is
just busy and can't be interrupted.

The reason JS *feels* like it can do many things "at once" — handle a click while a
network request is in flight while a timer is counting down — is that the waiting for
those things happens somewhere else entirely (the restaurant's delivery service, not the
chef), and only the quick "here's your finished order, chef" moment gets handed back to
the one chef, one ticket at a time.

**Common traps:**

1. **"`setTimeout(fn, 0)` should run `fn` right away, basically synchronously."** → It
   still has to wait in line behind whatever synchronous code is currently running, and
   then behind anything else already queued ahead of it. "0ms" means "no extra delay
   added," not "immediate."
2. **"If my app feels frozen, it must be a networking/async problem."** → Far more often
   it's a synchronous computation hogging the call stack (a big loop, heavy
   JSON parsing, a slow render). Async code, by definition, yields the stack while
   waiting — it's synchronous code that can starve everything else.
3. **"JS runs things in parallel because I have multiple things happening at once in my
   app."** → The JS *engine* runs one thing at a time, always. What looks like
   parallelism is really the *runtime* (browser/Node) doing the waiting for you outside
   the JS thread, then handing finished work back into the single queue/stack one piece
   at a time.

## 💻 Hands-On Exercise

Open `script.js`. Before running, write down the exact order you expect these lines to
log, given four things happen in this sequence: a synchronous `console.log`, a
`setTimeout`, a synchronous heavy loop, and another synchronous `console.log` at the very
end of the script.

**Trace to predict (see `script.js` Section 3 for the exact code):**
```
console.log('A - synchronous, start of script')
setTimeout(() => console.log('B - from a timer callback'), 0)
console.log('C - synchronous, runs a 200-million-iteration loop first')
console.log('D - synchronous, end of script')
```

**Expected output order:** `A`, then `C`'s loop runs (blocking, no log until it's done),
then `D`, and only **after the entire script finishes and the call stack is empty** does
`B` finally print — even though the timer was scheduled with a 0ms delay and was
technically "ready" well before the loop even started.

**Why:** `setTimeout` never runs its callback immediately, no matter the delay value — it
hands the callback to the timer system, which queues it for the event loop. The event
loop can only push a new callback onto the call stack once the stack is completely empty.
Since all of `A`, the heavy loop inside `C`, and `D` are synchronous code in the
currently-executing script, the call stack stays occupied through all of them — the
event loop has no opportunity to intervene until the entire synchronous script has run to
completion. `B` was "ready" (its 0ms delay elapsed) almost instantly, but "ready to run"
and "running" are different things — it still has to wait its turn in line until the
chef is free.

Run `index.html` and confirm this exact ordering in the console. Then try changing the
loop's iteration count to something tiny and notice the *relative* gap before `B` prints
shrinks, but the *order* (`A`, `C`, `D`, then `B`) never changes — proving the ordering
rule is structural, not timing-dependent.
