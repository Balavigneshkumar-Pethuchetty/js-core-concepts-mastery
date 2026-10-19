# Day 28: Functional Programming Patterns — Currying, Composition, Purity, Immutability

## 🧠 Core Architectural Concept

JavaScript isn't a "pure" functional language like Haskell — it's a multi-paradigm
language where functions are first-class values (they can be stored in variables,
passed as arguments, returned from other functions, and have properties attached to
them, because under the hood a `Function` is just an `Object` with an internal
`[[Call]]` slot). Functional programming in JS is about **disciplined use of that
first-class-function capability**, not a different runtime model. Four mechanisms do
almost all of the work:

**Closures** (Day 4) are the actual engine mechanism behind currying and partial
application. When you write `const add = a => b => a + b`, calling `add(1)` creates a
new function whose lexical environment has a reference to the *specific* `a = 1`
binding — V8 allocates that environment record on the heap (not the stack) precisely
because the inner function might outlive the call to the outer one, and keeps it alive
as long as the returned function is reachable. **Currying** is: transform a function of
N arguments into a chain of N functions that each take one argument and return the next
function, using nested closures to accumulate the arguments one at a time. **Partial
application** is the more general cousin: fixing *some* arguments of a function now and
deferring the rest — you can implement it with `Function.prototype.bind`, which creates
a new bound function with a pre-filled `this` and a prefix of arguments baked in at the
engine level.

**Function composition** is literally function application chained: `compose(f, g)(x)
=== f(g(x))`. Mechanically this is nothing more than a loop/reduce over an array of
functions, calling each one and feeding its return value into the next — there's no
special engine support, the "magic" is entirely in how you structure the call graph.
The practical payoff is that it turns a pipeline of transformations into data: an array
of functions you can log, reorder, test independently, and insert into/remove from
without touching the call sites that depend on the pipeline's behavior.

**Purity** is a property of a function's *implementation*, not something the engine
enforces: a pure function (1) always returns the same output for the same input, and
(2) causes no observable side effects (no mutating arguments, no writing to module-level
state, no I/O). This matters architecturally because pure functions are **referentially
transparent** — you can replace a call with its result anywhere without changing program
behavior, which is exactly what makes memoization (Day 27's `WeakMap` cache!), parallel
execution, and predictable testing possible. Impure functions can't be safely cached or
reordered because "when" and "how many times" they run is semantically meaningful.

**Immutability** in JS is a *convention enforced by discipline and tooling*, not a
language-level guarantee for objects (unlike, say, a `const` binding, which only freezes
the *variable*, not what it points to — Day 11's primitives-vs-references distinction
is the prerequisite here). `Object.freeze()` gives you real, engine-enforced
shallow immutability (attempts to mutate a frozen object's own properties silently fail
in non-strict mode, or throw a `TypeError` in strict mode/classes) — but it is shallow,
exactly like spread (Day 26): freezing an object does not freeze its nested objects.
Libraries like Immer achieve *efficient* deep immutability via **structural sharing** —
producing a new top-level object that shares untouched subtrees by reference with the
old one (via `Proxy`-based draft tracking), so "copying" a large nested state tree on
every update is O(depth-of-change), not O(size-of-whole-tree).

## 🎯 Interview Talking Points

- "I treat FP ideas as a toolbox for *reducing cognitive load in a specific class of
  problems*, not a religion. Middleware pipelines are the clearest production win I've
  shipped this on: Express middleware, Redux middleware, and a request-validation
  pipeline I built all reduce to `compose(...middlewares)` — adding a new validation
  step is a one-line array insertion instead of threading another `if` branch through an
  imperative function. That's the actual ROI: change becomes local and additive instead
  of requiring you to re-read the whole function."
- "I've debugged a production bug that came from an 'almost pure' function: a reducer
  that looked pure but did `state.items.push(newItem)` instead of returning a new array
  before returning `state`. It passed every unit test because the tests checked the
  return value, not whether the *input* got mutated — but a selector memoized on
  reference equality (`===`) elsewhere in the app never re-rendered, because the
  reference never changed even though the content did. That's the single most common
  real-world purity bug: mutating in place while still returning something that looks
  right."
- "Currying's real value for me isn't 'look how clever this is' — it's building
  specialized functions from a general one without repeating arguments. `const
  validateAge = curry(validate)('age')` reads better and avoids an entire class of
  typo-bugs where someone copies a validation call and forgets to update one argument
  in a long parameter list."
- "The trade-off against OOP I'm upfront about: FP composition shines for data
  transformation pipelines — stateless, input-to-output logic. It gets awkward fast for
  things that genuinely have identity and internal state over time — a WebSocket
  connection, a UI component's lifecycle, a stateful parser. I don't try to force those
  into a 'pure functions all the way down' model; a class with encapsulated state, or a
  state machine, communicates intent better there. Picking the right paradigm per
  *problem*, not per codebase-wide decree, is the senior judgment call."
- "A follow-up they like to ask: 'if immutability means copying data all the time, isn't
  that slow?' My answer: naive deep-copying at every update, yes, that's real
  overhead — but production-grade immutable-update tools (Immer, Immutable.js) use
  structural sharing, so an update to one deeply nested field only allocates new objects
  along the *path* to that field, reusing every sibling subtree by reference. The
  complexity-vs-safety trade-off is usually worth it for shared application state,
  and usually not worth it for a hot inner loop processing millions of array elements —
  I'd mutate a local, function-scoped array there and return a fresh copy only at the
  function's boundary."
- "I also point out `Array.prototype.map/filter/reduce` (Day 25) ARE the FP idioms most
  teams already use daily without calling it 'functional programming' — chaining them is
  informal composition. The jump to explicit `compose()`/`pipe()` helpers is just making
  that pattern reusable across arbitrary functions, not arbitrary arrays."
- "On memoization specifically: pure functions are the *only* functions you can safely
  memoize, because memoization is a bet that 'same input -> same output, forever.' I've
  seen a bug where someone memoized a function that secretly read `Date.now()` internally
  — it's not pure, so the cache returned a stale timestamp from the first call forever
  after. Purity isn't academic — it's the precondition for half the caching tricks in
  the toolbox."

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Think of a pure function like a vending machine: you put in exact change for item B4,
you always get the same snack, and nothing about the machine or the room changes besides
your snack appearing. An impure function is like asking a friend to grab you a snack —
maybe they eat one on the way back, maybe the vending machine is out of stock today and
they bring something different, maybe they rearrange the shelf while they're at it.
Same "request," unpredictable effects on the world and inconsistent results.

**Currying** is just: instead of one function that needs three ingredients handed to it
all at once, you have a function that takes one ingredient and hands you back a new,
more-specific "chef" who's already holding that ingredient, ready for the next one. Each
step narrows things down until you finally get your finished dish.

**Composition** is an assembly line: raw material goes into station 1, its output feeds
directly into station 2, whose output feeds station 3. `compose(f, g, h)` just wires
those stations together in order, so you can swap, add, or remove a station without
rebuilding the whole line.

**Immutability** means: instead of painting over an existing picture when you want to
change it, you make a new picture that looks 99% the same but with your one change — and
you keep the old picture around, untouched, in case anyone else still needed to look at
it.

**Common traps:**
1. **"I return a new object, so my function must be pure."** Not necessarily — check
   if it *also* mutated something it was given, logged to console, or read external
   state. Correction: purity is about the *whole* function body, not just the return
   statement.
2. **"`Object.freeze()` makes my whole nested state immutable."** It only freezes the
   top level. Correction: `Object.freeze(obj)` doesn't freeze `obj.nested` — you'd need
   to recursively freeze every level, or just use an immutable-update library.
3. **"Currying and partial application are the same thing."** Close, but not quite.
   Correction: currying *always* produces a strict chain of one-argument functions;
   partial application fixes *any subset* of arguments in one step and can still accept
   multiple arguments at a time afterward.

## 💻 Hands-On Exercise

Open `script.js`. Before running, predict the output of this composition pipeline:

```js
const double = x => x * 2;
const addTen = x => x + 10;
const square = x => x * x;

const pipeline = pipe(double, addTen, square); // pipe runs LEFT TO RIGHT
console.log(pipeline(3)); // ?
```

**Expected answer:**
```
256
```

**Why:** `pipe` applies functions left-to-right, so `3` first goes through `double` ->
`6`, then `addTen` -> `16`, then `square` -> `256`. (Contrast with `compose`, which runs
**right-to-left**: `compose(double, addTen, square)(3)` would instead do `square(3) = 9`,
then `addTen(9) = 19`, then `double(19) = 38` — same functions, different order, very
different answer. Mixing up `pipe` vs `compose` order is a real, easy-to-make bug when
switching between libraries that default to different conventions.)

Then run `script.js` via `index.html` for the full set: a hand-written `curry()` helper
that works for any arity, a `compose`/`pipe` pair with worked traces, a pure-vs-impure
function pair demonstrating the exact mutation bug described above, an `Object.freeze`
shallow-vs-deep demonstration, and a small middleware-pipeline example modeled on how
Express/Redux-style middleware actually composes in production.
