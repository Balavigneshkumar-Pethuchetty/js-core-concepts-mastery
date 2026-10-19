# Day 27: WeakMap & WeakSet — Memory-Safe Caching and Private State

## 🧠 Core Architectural Concept

To understand `WeakMap`/`WeakSet`, you first have to understand how V8's garbage
collector decides what's alive. V8 uses a **mark-and-sweep** (with generational and
incremental refinements) collector: starting from a set of "roots" (global scope,
currently-executing call stack frames), it walks every reachable reference and marks
each object it finds as live. Anything *not* marked after the walk is garbage and gets
swept. The key idea: **an object is kept alive by being reachable, not by any intrinsic
property of the object itself.** A reference is just a pointer that counts as a vote for
"keep this alive."

A regular `Map` holds its keys with a **strong reference**. If you do
`map.set(someObject, data)`, that `Map` entry is itself a GC root-reachable path to
`someObject` — even if every other variable pointing at `someObject` goes out of scope,
the `Map` keeps voting "alive," so the object can never be collected until you explicitly
`map.delete()` it or the `Map` itself becomes unreachable. This is precisely how DOM-node
caches, event-listener maps, and "metadata by object" caches leak memory over the
lifetime of a long-running page or server process: the cache outlives the thing it was
caching data *about*.

`WeakMap` holds its keys with a **weak reference** — a reference that does *not* count
as a vote in the mark-and-sweep walk. If `someObject` has zero other strong references
anywhere in the program, the engine is free to collect it, and when it does, the
`WeakMap` entry for that key is automatically removed too (specifically, at some
GC-determined point — not necessarily instantly). You get caching/metadata-attachment
semantics with **zero manual cleanup** and no leak risk tied to forgetting to call
`.delete()`.

This has a structural consequence that trips people up every time: **`WeakMap`/`WeakSet`
are not iterable, and have no `.size`, `.keys()`, `.forEach()`, or way to list their
contents.** This isn't an arbitrary omission — it's load-bearing. If you could enumerate
a `WeakMap`'s keys, the act of iterating would itself be a reference to those keys at
that moment, and because GC can happen at *any time* between synchronous statements in
principle (engines batch it opportunistically), the set of "currently valid keys" isn't
even a well-defined, deterministic thing you could iterate safely — the collection's
contents are fundamentally **non-deterministic from the outside**. The spec closes this
whole can of worms by simply not giving you enumeration. You can only `get`, `set`,
`has`, and `delete` by a key you already hold a reference to.

Constraint that falls out of the same design: **`WeakMap` keys (and `WeakSet` values)
must be objects (or, since ES2023, registered `Symbol`s) — never primitives.** Primitives
like strings and numbers are not reference-counted/garbage-collected the same way
objects are (`'abc'` isn't an "object living at an address" that can become unreachable
in the same sense), so "weakly referencing" one wouldn't have any meaning.

## 🎯 Interview Talking Points

- "I reach for `WeakMap` any time I need to attach metadata to an object I don't own
  the lifecycle of — DOM nodes are the textbook case. I've built a tooltip system that
  mapped DOM elements to their tooltip state in a `WeakMap`; when a node got removed from
  the DOM and dropped by every other reference, its tooltip state was collected
  automatically. With a regular `Map`, that would have been a slow, silent memory leak
  that only showed up after hours of SPA navigation in a heap snapshot."
- "The private-instance-data pattern is the other big use case, especially in codebases
  stuck on older JS targets before `#privateFields` were available: a module-level
  `WeakMap` keyed by `this`, where each instance's truly private data lives outside the
  instance object itself, inaccessible to anyone without a closure reference to that
  `WeakMap`. It's more verbose than `#field` syntax, but it was the only real
  encapsulation mechanism before ES2022, and it's still relevant for understanding how
  transpiled private fields and some proxy/mixin libraries work under the hood."
- "The trade-off I'm explicit about: `WeakMap`/`WeakSet` are deliberately a *restricted*
  tool. No iteration, no size, no clearing all at once. If you need to inspect, log, or
  bulk-clear your cache, you've picked the wrong structure — that's a signal you actually
  want a `Map` plus a disciplined, explicit cleanup strategy (TTL, LRU eviction,
  `FinalizationRegistry` for telemetry), not a `WeakMap`."
- "A follow-up they like to throw: 'if WeakMap keys can be collected at any time, can I
  rely on a WeakMap-backed cache being populated when I check it a moment later?' Answer:
  within synchronous code, yes — GC won't run in the middle of your synchronous turn and
  invalidate a key you're actively holding a strong reference to (if you hold a strong
  ref, it's not eligible for collection in the first place). The non-determinism is about
  *when stuff you've stopped referencing finally gets swept*, not about pulling the rug
  out from under code still using the object."
- "I've also used `WeakSet` to mark objects as 'already processed' in a recursive
  traversal (serializers, deep-equality checkers, the same cycle-detection problem from
  Day 26's deep-clone exercise) without that marker outliving the traversal and leaking
  memory for every object the function ever touched."
- "Memoization is the other classic fit: cache a pure function's expensive result keyed
  by the object argument itself. With a plain `Map`, memoizing on object identity means
  every unique object you've ever called the function with stays cached forever. With a
  `WeakMap`, the cache entry disappears exactly when nothing else cares about that object
  anymore — the cache's lifetime tracks the data's lifetime instead of the program's
  lifetime."
- "One nuance worth naming unprompted: `WeakRef` and `FinalizationRegistry` (newer,
  ES2021) solve an adjacent but different problem — observing collection or holding a
  non-owning reference to a *single* value, versus `WeakMap`'s job of weakly keying a
  *collection* of values. I'd reach for `FinalizationRegistry` only for diagnostics/cache
  telemetry, never for core program logic, because the spec explicitly says finalizer
  timing is not guaranteed — you cannot build correctness-critical behavior on top of it."

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Imagine a `Map` is like writing someone's name on a sticky note and keeping that note in
your own wallet, forever, even after they've moved away and you'll never see them again.
As long as the sticky note is in your wallet, some tiny part of your brain is obligated
to "remember" them — the system can't declare them "gone" because your wallet is still
holding evidence they matter.

A `WeakMap` is like writing the same note, but on a note that *disappears automatically*
the moment the person is actually gone from everywhere else in your life. You don't have
to remember to throw the note away yourself — it just stops existing when it would
otherwise be pointless to keep.

That's why you can't "look through" a `WeakMap` and list everyone in it — the notes can
vanish at basically any moment the garbage collector decides to clean up, so there's
never a frozen, reliable "list" to hand you.

**Common traps:**
1. **"I'll just use a `WeakMap` so I don't have to think about memory."** It helps, but
   it only auto-cleans the *key*. If the *value* you stored is a big object that
   references other things, and the key is still alive, nothing gets freed yet.
   Correction: `WeakMap` prevents the "cache outlives its subject" leak — it's not a
   magic wand for all memory problems.
2. **"I tried to loop over my `WeakMap` to debug it and it has no `.forEach`."** That's
   by design, not a missing feature. Correction: if you need to inspect or iterate your
   cache, you need a regular `Map` with a manual cleanup strategy instead.
3. **"I'll use a string as my `WeakMap` key for convenience."** `WeakMap` keys must be
   objects — strings/numbers aren't eligible for the "weak reference" mechanism to apply
   to, so this throws a `TypeError` immediately. Correction: key by the actual object
   (e.g. the DOM node, the instance) you want the lifecycle tied to.

## 💻 Hands-On Exercise

Open `script.js`. Before running, predict what this logs:

```js
const cache = new WeakMap();

function attachMetadata(obj, data) {
  cache.set(obj, data);
}

let userRecord = { name: 'Grace' };
attachMetadata(userRecord, { lastSeen: Date.now() });

console.log(cache.has(userRecord)); // ?

userRecord = null; // drop the only strong reference

// We can't deterministically force/observe GC timing in normal code, but
// CONCEPTUALLY: once nothing else references the original object,
// is there anything an outside caller could ever do to retrieve
// that metadata again?
```

**Expected answer:**
```
true
```
followed by: once `userRecord` is set to `null`, there is no variable anywhere holding a
strong reference to the original `{ name: 'Grace' }` object anymore. The `WeakMap`'s
reference doesn't count as a vote to keep it alive, so the object becomes eligible for
garbage collection, and — eventually, at a time the engine chooses, not observable
deterministically from your code — its `cache` entry is removed along with it. Critically,
you also have no way to get that metadata back even if you wanted to: you'd need the
*original object reference* to call `cache.get(...)`, and you no longer have one. This is
the exact mechanism that makes `WeakMap` safe for caching "extra data about an object I
don't control the lifetime of" — the cache can never be the *reason* something stays in
memory.

Then run `script.js` via `index.html` for the complete worked set: a DOM-node-metadata
cache simulation, a private-instance-data pattern using a module-level `WeakMap`, a
memoization cache keyed by object identity, a `WeakSet`-based cycle-detector for
traversal, and a side-by-side comparison showing why swapping in a regular `Map` for the
same caching job is a textbook memory-leak setup.
