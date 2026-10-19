# Day 25: Array Methods & Performance

## 🧠 Core Architectural Concept

Every array method you use (`map`, `filter`, `reduce`, `forEach`, `for`) is
built on the same JS semantics, but V8 does NOT store all arrays the same
way internally, and that representation — not the method you call — is the
single biggest performance lever. Understanding V8's **element kinds** is
the mechanism behind "why did my array suddenly get slow":

```
PACKED_SMI_ELEMENTS   -> every element is a small integer (fits in 31 bits),
                          no holes. Fastest possible representation —
                          stored as a flat, unboxed array of raw integers.
PACKED_DOUBLE_ELEMENTS -> every element is a number but at least one needs
                          float precision (e.g. 1.5, or a SMI got promoted).
                          Still flat and fast, but boxed as doubles.
PACKED_ELEMENTS        -> at least one element is a non-number (string,
                          object, mixed types). Stored as tagged pointers.
                          Still contiguous/no holes — still reasonably fast.
HOLEY_* (SMI/DOUBLE/ELEMENTS) -> same as above, but the array has at least
                          one "hole" (a missing index, e.g. from `delete
                          arr[2]` or `new Array(5)`). Every access now needs
                          an extra check: "is this index actually present,
                          or do I need to walk the prototype chain?"
DICTIONARY_ELEMENTS   -> V8 gives up on the fast array representation
                          entirely and stores elements in a hash-map-like
                          structure. This happens with very sparse arrays,
                          huge arrays with scattered indices, or arrays with
                          non-index properties attached (e.g. arr.foo = 1).
```

The transition only ever goes ONE DIRECTION, in order of specificity —
**SMI → DOUBLE → ELEMENTS → DICTIONARY** — and V8 never demotes an array
back to a faster kind for the rest of that array's life, even if you
"clean it up" afterward. This is why a single `arr.push(1.5)` into what was
a clean integer array, or a single `delete arr[i]`, can permanently degrade
every future operation on that array, including ones that look unrelated.

**Sparse arrays** (arrays with holes) are the classic silent performance
killer:
```js
const arr = new Array(1000);     // length 1000, ZERO actual elements — all holes
arr[999] = 'x';                   // still sparse; only one real element
arr.forEach(x => ...);            // skips every hole entirely (does NOT call
                                   // the callback for missing indices) —
                                   // different from a `for` loop, which
                                   // would read `undefined` for each hole
```
`map`, `filter`, `forEach`, and `reduce` all specifically **skip holes**
per spec (they check `HasProperty` before invoking the callback) — a plain
`for (let i = 0; i < arr.length; i++)` does not skip anything, it just reads
`undefined` for the hole. This is a real, spec-mandated behavioral
difference, not just a performance one.

**`indexOf` vs `includes`**: functionally almost identical (`includes`
exists specifically because `indexOf` can't detect `NaN` — `[NaN].indexOf(NaN)
=== -1` always, because `indexOf` uses strict equality internally, and
`NaN !== NaN`; `includes` uses the SameValueZero algorithm, so
`[NaN].includes(NaN) === true`). Performance-wise they're the same
underlying linear scan — the choice between them should be about semantics
(do you need NaN-detection, or the index itself), not speed.

**When idiomatic methods cost you in hot paths:** `map`/`filter`/`reduce`
each allocate a brand-new array/accumulator and invoke a function call per
element — that function call has real overhead (can't always be inlined,
especially with polymorphic callbacks the engine can't monomorphize via
TurboFan). Chaining `arr.filter(...).map(...)` walks the array TWICE and
allocates TWO intermediate arrays. In a genuinely hot path (processing
millions of elements per frame, a render loop, a parsing hot loop), a single
hand-written `for` loop that does filtering+mapping+reducing in one pass,
with no intermediate allocations, can be meaningfully faster — this is a
real, measurable trade-off, not premature optimization paranoia, but it
only matters once you've actually profiled and found an array operation as
the bottleneck.

## 🎯 Interview Talking Points

- "I debugged a dashboard that got progressively slower only after certain
  user actions, and it traced back to a single `delete arr[i]` call in a
  'remove item' handler instead of `arr.splice(i, 1)`. `delete` leaves a
  hole and permanently demotes that array out of V8's fast packed
  representation for its whole lifetime — `splice` actually shifts
  elements and keeps the array dense. The fix was a one-line change, but
  understanding WHY required knowing V8's element-kind transitions."
- "I always reach for `Array.isArray` + a real profiler before
  micro-optimizing `map`/`filter` chains into manual `for` loops — in 95%
  of real code the bottleneck is elsewhere (network, DOM, a bad query), and
  rewriting readable functional code into a dense loop for a theoretical
  gain that never shows up in a flame graph is a trade against
  maintainability I won't make without evidence."
- "A follow-up I expect: 'why is `for...of` slower than a classic indexed
  `for` loop in some benchmarks?' `for...of` goes through the iterator
  protocol — calling `.next()` repeatedly, allocating a result object each
  time in naive implementations (though modern engines heavily optimize
  this for arrays specifically) — versus a classic `for` loop doing direct
  indexed access with no protocol overhead. For typed/dense arrays in a
  genuinely hot loop, the classic `for` loop is still the safest bet."
- "I treat `new Array(n)` as a trap for junior devs — it creates a sparse
  array with `length = n` and zero actual elements, not an array filled
  with `undefined`. `Array.from({ length: n })` or
  `new Array(n).fill(undefined)` are the correct ways to get a genuinely
  dense array of a known size, and only the dense version stays in a fast
  element kind."
- "`reduce` gets a bad reputation for being 'hard to read,' and I push back
  on that only when it's used to force something that's naturally a
  `forEach` with side effects into a pure-functional shape nobody asked
  for. Where `reduce` genuinely shines — folding a list into a single
  derived value, building a lookup map from an array — I'll defend it every
  time over a manually mutated accumulator variable with a `for` loop,
  because it makes the data transformation's INTENT obvious."
- "I always profile with real data shapes before trusting a microbenchmark
  someone posted online — V8's JIT (TurboFan) behaves very differently on
  a tight synthetic loop with warmed-up monomorphic types than it does in
  a real app with megamorphic call sites and mixed element kinds. A
  'benchmark' showing method X is 3x faster than method Y in isolation can
  completely invert once real heap shapes and GC pressure are involved."

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Think of an array like a row of labeled parking spots. If every car (array
element) is the same size and every spot is filled, the valet (the engine)
can find any car instantly by just counting spots — that's your fast,
packed array. The moment you leave an EMPTY spot in the middle (a hole, from
`delete` or `new Array(n)`), the valet can no longer assume "spot n always
has a car" — now every lookup needs an extra "wait, is this spot actually
occupied?" check. Do that enough, or let the gaps get too scattered, and the
valet gives up on the row-of-spots system entirely and switches to a
clipboard lookup list (dictionary mode) — which works, but is slower for
everything from then on, even the simple cases.

`forEach`/`map`/`filter` are like telling the valet "walk every OCCUPIED
spot and do X" — empty spots get silently skipped. A plain `for` loop is
like saying "check every spot number from 0 to the end, no exceptions" — it
will stop at an empty spot and just tell you "nothing here" (`undefined`)
instead of skipping it.

**Common traps:**
- **Trap 1:** "`new Array(5)` gives me 5 `undefined` values I can map
  over." Correction: it gives you 5 *holes* — `.map()` will skip every one
  of them and return another equally-holey array, not call your callback
  5 times.
- **Trap 2:** "`.forEach()` is basically the same as a `for` loop, just
  nicer syntax." Correction: `forEach` cannot be stopped early (`break`
  does nothing inside it, and `return` only skips that one iteration),
  skips holes, and has function-call overhead per element — a `for` loop
  (or `for...of` with `break`) is the right tool when you need early exit.
- **Trap 3:** "Chaining `.filter().map().reduce()` is always fine
  performance-wise because it's idiomatic." Correction: idiomatic doesn't
  mean free — each link in the chain is a full extra pass over the array
  plus a new allocation; this is completely fine for UI-scale data (tens to
  low thousands of items) but worth collapsing into one loop for genuinely
  hot, large-N paths.

## 💻 Hands-On Exercise

Open `script.js`. Section 6 runs a real, timed micro-benchmark comparing
four ways of computing "sum of squares of all even numbers in a large
array": a `filter().map().reduce()` chain, a single `reduce()`, a plain
`for` loop, and a `for...of` loop.

**Your task:** before running it, rank the four approaches from fastest to
slowest, and explain your reasoning in terms of allocations and passes over
the array — not just "loops are faster," but *why*.

**Expected result and why (ranking will hold directionally across engines,
though exact numbers vary by hardware/V8 version):**
1. **Plain `for` loop** — fastest. Single pass, zero intermediate
   allocations, no per-element function-call overhead, direct indexed
   access on a packed element kind.
2. **`for...of` loop** — very close to the `for` loop on modern V8 (the
   array iterator fast-path is heavily optimized), but still carries a
   thin layer of iterator-protocol overhead the indexed loop doesn't have.
3. **Single `reduce()`** — one pass over the array (good), but pays a real
   function-call cost on every element for the callback, which the engine
   can't always fully inline, especially once the callback becomes
   polymorphic.
4. **`filter().map().reduce()` chain** — slowest. THREE full passes over
   the array and TWO extra intermediate arrays allocated and immediately
   discarded, on top of three separate per-element callback-call costs.

The lesson isn't "never chain array methods" — for most UI/application-
scale code the chain is more readable and the performance difference is
invisible. The lesson is knowing WHERE that cost comes from so you can
correctly identify when it's actually your bottleneck versus when you're
optimizing something that was never slow to begin with.
