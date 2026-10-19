# Day 12: Garbage Collection (V8 Internals & Real Memory Leaks)

## 🧠 Core Architectural Concept

JavaScript doesn't have manual memory management — no `malloc`/`free` — but that doesn't
mean memory is magic. V8 (and every modern engine) uses **automatic garbage collection**
built on one core idea: **reachability**. An object is considered "alive" if it's
reachable from a set of **roots** (global object, currently executing function's local
variables, the call stack, closures still referenced by live callbacks) by a chain of
references. Anything *unreachable* from those roots is garbage, no matter how large or
how recently it was touched. GC does not care about reference *counts* going to zero in
V8's main algorithm (that's a different, older strategy with a fatal flaw — circular
references never hit zero) — it cares about *reachability from roots*, which correctly
collects cycles that aren't reachable from anywhere live.

**V8's actual implementation is generational**, because empirically most objects die
young (short-lived closures, temporary objects in a function call) while a minority live
a long time (caches, the DOM tree, module-level singletons). Treating all objects the
same would waste enormous time repeatedly scanning long-lived objects that never
die. So V8 splits the heap:

```
┌─────────────────────────────┐   survives 2 scavenges   ┌───────────────────────────┐
│   NEW SPACE (Young Gen)      │ ───────────────────────▶ │  OLD SPACE (Old Gen)      │
│   small (~1-8MB), two halves │                           │  large, long-lived objects │
│   "nursery" + "intermediate" │                           │                            │
│   collected by: SCAVENGER    │                           │  collected by: MARK-COMPACT│
│   (fast, frequent, parallel) │                           │  (slower, infrequent, uses │
└─────────────────────────────┘                           │   incremental + concurrent │
                                                            │   marking to avoid long    │
                                                            │   main-thread pauses)      │
                                                            └───────────────────────────┘
```

- **Scavenger (Minor GC)**: New Space is split into two halves. Live objects are copied
  from the active half to the inactive half (Cheney's algorithm); anything left behind is
  garbage and the whole active half is just wiped. This is fast specifically *because* it
  doesn't need to trace dead objects — it only copies the living ones, then nukes the
  rest in bulk. Objects that survive **two** scavenge cycles get promoted ("tenured") to
  Old Space, on the theory that anything that's lived this long is probably going to keep
  living.
- **Mark-Compact (Major GC)**: Old Space is scanned with a **mark-and-sweep**-style
  tracing pass starting from the roots — mark everything reachable, then everything
  unmarked is garbage — followed by a **compaction** pass that slides live objects
  together to eliminate fragmentation (important because Old Space objects live a long
  time, and fragmented free lists get expensive to allocate into). Because a full mark
  pass over a large, long-lived heap can take tens of milliseconds — enough to visibly
  jank a 60fps UI — V8 uses **incremental marking** (small chunks of marking work
  interleaved with JS execution) and **concurrent marking** (marking on background threads
  while the main thread keeps running JS), with only a short, mostly-concurrent
  final "atomic pause" on the main thread.

**What actually causes memory leaks in JS**, given that GC is automatic: leaks are never
"GC is broken," they're always "something is still reachable that the developer didn't
realize was still reachable." The four classics I see over and over in production:

1. **Detached DOM nodes** — you remove a node from the document (`el.remove()` or
   `innerHTML = ''`) but a JS variable (often in a closure or a Map cache) still holds a
   reference to it. The node is gone from the visible page but still alive on the heap,
   along with its entire subtree, because something still points to it.
2. **Forgotten event listeners / timers** — `addEventListener` on a long-lived target
   (e.g. `window`, `document`) with a handler that closes over a component's state, and
   the component unmounts without calling `removeEventListener`. The target keeps the
   listener alive, the listener keeps the closure alive, the closure keeps the whole
   component's scope alive. Same story with `setInterval` that's never `clearInterval`'d.
3. **Closures holding references longer than intended** — a closure capturing a large
   object just because it's in the same lexical scope as a variable the closure actually
   needs, even though the closure never uses the large object. V8 is reasonably good at
   trimming genuinely unused bindings from a closure's captured scope, but this gets
   murky fast with `eval`, `with`, or just large shared scopes, and I've seen real
   megabyte-scale leaks from "the callback only needs `id` but it's declared in the same
   function as a 50MB buffer, so the whole scope stays retained."
4. **Global caches/Maps that grow forever** — a `Map` used as a memoization cache keyed
   by request ID that's never evicted. Technically "working as designed," but it's an
   unbounded leak under load. This is exactly the problem `WeakMap`/`WeakSet` solve
   (Day 27) — they let the key be garbage collected even while still referenced by the
   map, as long as nothing else references the key.

## 🎯 Interview Talking Points

- "I've debugged a memory leak that came from exactly the detached-DOM-node pattern: a
  single-page app cached modal elements in a `Map<string, HTMLElement>` for reuse, but
  never removed the entry when a modal was permanently closed. Heap snapshots in DevTools
  showed thousands of detached `div` trees retained purely by that cache — the fix was
  evicting the cache entry on close, not changing anything about how GC works."
- "V8's GC is generational because most allocations are short-lived — that's not a
  guess, it's measured behavior across real JS workloads, sometimes called the
  'generational hypothesis.' The Scavenger is cheap precisely because it only has to
  touch *live* objects and bulk-discards everything else; Mark-Compact is expensive
  because Old Space is large and long-lived, so V8 spends real engineering effort
  (incremental + concurrent marking) just to keep Major GC from causing visible jank."
- "A trade-off worth naming unprompted: compaction fixes fragmentation but costs CPU time
  to physically move objects and fix up every pointer to them. That's why it only happens
  during Major GC on Old Space, not on every collection."
- "`WeakMap`/`WeakSet` aren't just 'a Map that doesn't leak' — the key insight is they
  hold **weak references** to their keys, meaning the key being referenced by the
  WeakMap doesn't count as a reason to keep it alive. That's exactly the right tool for
  'metadata about an object that should disappear when the object does,' like DOM-node
  metadata or per-instance caches."
- "Follow-up they might throw at you: 'does setting `obj = null` force garbage
  collection?' No — it just removes *one* reference. The object is only collected once
  it becomes fully unreachable from all roots, and even then, collection timing is up to
  the engine, not immediate. `null`-ing things out is good hygiene for breaking reference
  chains, but it's not a GC trigger."
- "Second follow-up: 'how do you actually find a leak in production?' Chrome DevTools
  Memory tab — take a heap snapshot, perform the suspected leaking action several times,
  take another snapshot, and use the 'Comparison' view to see which object types grew
  and didn't shrink. For detached DOM specifically, filter the snapshot for 'Detached'
  — Chrome flags these explicitly. The 'Allocation instrumentation on timeline' tool is
  the right choice when you don't know *what* is leaking yet, only that memory climbs."
- "I'd also mention `WeakRef` and `FinalizationRegistry` (modern JS, ES2021) exist for
  advanced cases — holding a reference to an object without keeping it alive, and running
  cleanup logic when it's collected — but I'm explicit in interviews that
  `FinalizationRegistry` callback timing is intentionally non-deterministic and the spec
  warns against relying on it for correctness-critical cleanup. It's a diagnostic/cache
  tool, not a substitute for explicit `dispose()`/`cleanup()` patterns."

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Think of the JS heap like a library. Every book (object) that's checked out and traceable
back to a librarian's desk (a "root" — your running code, global variables) is
considered "in use." Garbage collection is the librarian periodically walking the whole
library starting from the desk, following every connection, and marking every book they
can reach as "still needed." Any book that can't be reached by walking from the desk —
even if it's sitting right there on a shelf — gets thrown out. You never explicitly
"return" a book in JS; you just stop holding a connection to it, and eventually the
librarian notices it's unreachable and clears it.

A memory leak, then, is never "the librarian is broken" — it's always "you accidentally
left a connection to a book you meant to be done with." A sticky note in a drawer
(a closure, a cache, an event listener) that still references the book counts as a
connection, even if you forgot the sticky note exists.

**Common traps:**

1. **"I set `node.remove()`, why didn't the memory go down?"** → Removing a node from the
   DOM tree doesn't make it unreachable if a JS variable, closure, or cache still
   references it. Null out or evict every reference to a removed node, not just the DOM
   removal.
2. **"I thought `obj = null` frees the memory immediately."** → It removes *one*
   reference. If something else still points to that object, it's still alive. And even
   fully unreachable objects aren't necessarily collected the instant they become
   unreachable — GC runs on the engine's own schedule.
3. **"My `setInterval`/event listener feels harmless, it's just a function."** → A
   running interval or an attached listener keeps its entire closure scope alive for as
   long as it's registered. If you never `clearInterval` or `removeEventListener`, that
   scope — and everything it references — never gets collected, for the lifetime of the
   page.

## 💻 Hands-On Exercise

Open `script.js`. It contains a deliberately leaky pattern (a cache that never evicts)
next to a fixed version using `WeakMap`. Before running, answer:

1. **Why does `strongCache` keep growing even after `removeAndDiscard()` is called on an
   element?**
   Answer: `strongCache` is a regular `Map`, which holds a **strong reference** to its
   keys. Even though the element is removed from the DOM and the local variable pointing
   to it is reassigned, the `Map` itself still references the element object, so it
   remains reachable from the root (the global `strongCache` variable) and can never be
   collected. The DOM removal and the Map entry are two *separate* reference chains —
   clearing one does nothing to the other.

2. **Why doesn't `weakCache` have the same problem?**
   Answer: `WeakMap` holds a **weak reference** to its keys — the entry existing in the
   `WeakMap` does not, by itself, keep the key object alive. Once every *other* strong
   reference to that element is gone (it's removed from the DOM and no variable points
   to it anymore), the element becomes eligible for garbage collection, and its
   `WeakMap` entry is automatically removed along with it — you can't even enumerate a
   `WeakMap`'s keys, by design, specifically to prevent you from building logic that
   depends on observing collection timing.

3. **Trace the `createListenerLeak()` function: which object stays alive, and why,
   until `cleanupListener()` runs?**
   Answer: the handler closure captures `hugeBuffer` (even though it only logs `.length`,
   the whole enclosing scope is retained in practice when the closure is reachable via
   the still-registered listener), and `window` holds a reference to the listener itself
   via `addEventListener`. So the chain is: `window` (a root) → listener → closure →
   `hugeBuffer`. Nothing is collected until `removeEventListener` breaks that first link,
   at which point the whole chain becomes unreachable in one shot.

Run it in `index.html` and watch the console trace confirm each step. For real-world
practice, open Chrome DevTools → Memory tab, take a heap snapshot before and after
running the leaky path repeatedly, and confirm you see retained `Map` entries growing in
the comparison view.
