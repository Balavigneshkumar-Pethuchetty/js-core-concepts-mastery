# Day 14: Symbols, Well-Known Symbols, and the Iterator/Iterable Protocol

## 🧠 Core Architectural Concept

`Symbol` is a primitive type (`typeof Symbol() === 'symbol'`) introduced in ES2015 whose
entire purpose is to produce a value that is **guaranteed unique** and used primarily as
a **collision-proof object property key**. `Symbol('id') !== Symbol('id')` — every call
to `Symbol()` mints a brand-new, globally unique value, even with identical description
strings. This solves a real problem: before symbols, any string key you added to an
object for your own purposes (metadata, a library adding an internal flag) could silently
collide with a key some other code — or a future spec feature — also decided to use.
Symbols give you a key that *cannot* collide, because nothing else can produce the same
symbol by accident. They're also non-enumerable in the ways that matter for
compatibility: `for...in`, `Object.keys()`, `JSON.stringify()`, and `Object.assign`'s
*own-enumerable-string-keys-only* default all skip symbol-keyed properties, which is
exactly why they're a reasonable choice for "metadata that shouldn't show up in normal
iteration or serialization."

**Well-known symbols** are a specific, fixed set of symbols the spec itself defines and
uses as *extension points* into language-level behavior — the mechanism by which you
plug your own object into built-in language machinery. The one you'll use constantly:

- **`Symbol.iterator`** — defines how an object behaves when iterated: `for...of`,
  array/object spread (`[...x]`), destructuring (`const [a, b] = x`), and anything that
  consumes an iterable (`Array.from`, `Promise.all`, `new Map(x)`) all look for a function
  at `obj[Symbol.iterator]` and call it to get an iterator.
- **`Symbol.asyncIterator`** — the async counterpart, consumed by `for await...of`,
  returning an object whose `.next()` returns a `Promise` resolving to `{ value, done }`.
- Others worth knowing by name: `Symbol.toPrimitive` (controls coercion — e.g. what `+obj`
  or template-literal interpolation produces), `Symbol.toStringTag` (controls what
  `Object.prototype.toString.call(x)` reports, e.g. `"[object Map]"`), `Symbol.hasInstance`
  (controls `instanceof` behavior).

**The iterator protocol itself is a plain, deliberately simple contract — two objects,
one method each:**

```
ITERABLE  = { [Symbol.iterator]: () => ITERATOR }
ITERATOR  = { next: () => { value, done } }
```

An object is **iterable** if it implements `Symbol.iterator`, a method that returns an
**iterator**. An iterator is any object with a `.next()` method that returns
`{ value, done }` — `done: false` means "here's a value, keep calling me"; `done: true`
means "iteration is finished, ignore `value`." That's the entire protocol — no base
class, no inheritance requirement, just two method shapes. `for...of` is syntactic sugar
over exactly this: call `obj[Symbol.iterator]()` once to get the iterator, then call
`.next()` repeatedly until `done` is `true`, binding `value` to the loop variable each
time.

This is why `for...of` works on arrays, strings, `Map`, `Set`, `NodeList`, and arguments
objects (all built-in iterables), but **not** on a plain object literal — plain objects
don't implement `Symbol.iterator` by default, which is exactly why `for...of` throws
`TypeError: obj is not iterable` on `{}` while `for...in` (a completely different,
older mechanism that walks enumerable property *keys*, not values, with no protocol
requirement at all) works fine on it. **Generators** (covered in depth on Day 19) are the
easiest way to *implement* `Symbol.iterator` by hand — a generator function already
returns something that satisfies the iterator shape, so `[Symbol.iterator]: function*() {...}`
is a one-line way to make any custom object iterable without manually writing a `.next()`
state machine.

## 🎯 Interview Talking Points

- "I've used `Symbol.iterator` to make a custom data structure — a priority queue, a
  linked list — work transparently with `for...of` and spread syntax without the
  consumer ever knowing it's not a plain array. That's the real value: the iterator
  protocol is the extension point that lets *your* types integrate with language-level
  syntax, not just built-in collections."
- "Symbols as object keys solved a real interoperability problem before they existed:
  library A adds a `_metadata` string key to objects it processes, library B does the
  same thing for a different purpose, and now they silently stomp on each other. A
  Symbol-keyed property can never collide like that, and `JSON.stringify`/`Object.keys`
  skipping them by default means you get a safe 'hidden channel' for metadata that
  doesn't leak into serialization or normal enumeration."
- "The follow-up I'd expect: 'why doesn't `for...of` work on a plain object?' Because
  plain objects don't implement `Symbol.iterator` — iteration isn't about having
  key-value pairs, it's about explicitly opting into the iterator contract. `for...in`
  is the mechanism for walking a plain object's enumerable keys; `for...of` is for
  consuming values from anything that implements the protocol. People conflate these
  constantly and it's worth stating the distinction unprompted."
- "A trade-off worth naming: writing an iterator by hand (manually tracking state and
  returning `{ value, done }` from `.next()`) is verbose and easy to get subtly wrong —
  for example, forgetting that calling `.next()` again after `done: true` should keep
  returning `{ value: undefined, done: true }`, not throw or restart. Generator
  functions sidestep all of that because the engine manages the state machine for you;
  I'd reach for a generator every time unless there's a specific reason not to."
- "`Symbol.for(key)` is the one exception to 'every Symbol call is unique' — it uses a
  **global symbol registry**, so `Symbol.for('x') === Symbol.for('x')` is `true` even
  across different files or even different realms (iframes, workers) that share the same
  registry. I'd use this specifically when I need the *same* well-known symbol accessible
  from code that can't share a module-level `const`, which is rarer than people think —
  most of the time a module-scoped `const mySymbol = Symbol('x')` is the correct choice,
  precisely because you usually *want* the collision-proof uniqueness, not a shared
  registry key."
- "One subtlety that trips people in a live-coding setting: spreading an iterable
  (`[...iterable]`) and destructuring (`const [a, b] = iterable`) both fully go through
  the iterator protocol, calling `.next()` under the hood — this means spreading an
  infinite iterator (like a generator that never sets `done: true`) will hang forever.
  I've seen this exact bug when someone wrote a generator meant to be consumed lazily
  with `for...of` + an early `break`, then spread it into an array by mistake."

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Think of `Symbol.iterator` like a USB-C port. It doesn't matter what's inside the device
(array, Map, your own custom class) — if it has that port, any cable that expects USB-C
(`for...of`, spread, destructuring) can plug in and pull data out, one piece at a time,
using the exact same universal method: "give me the next thing, and tell me when you're
out." An object is "iterable" simply because it has that port; it doesn't matter what
data structure is underneath.

A plain `Symbol()` is just a guaranteed-unique ID tag — think of it like a serial number
stamped on a part that no other part in the universe will ever have, specifically so two
different systems can tag the same object with their own private label without ever
stepping on each other's tag.

**Common traps:**

1. **"Why doesn't `for...of` work on my plain object `{ a: 1, b: 2 }`?"** → Plain objects
   don't have the `Symbol.iterator` "port" by default. Use `for...in` for keys, or
   `Object.entries(obj)` combined with `for...of` (because `Object.entries` *returns* an
   array, which IS iterable) if you want to iterate an object's data.
2. **"I thought two symbols with the same name would be equal."** → `Symbol('x') ===
   Symbol('x')` is `false` — the string is just a human-readable label for debugging,
   not an identity. Only `Symbol.for('x') === Symbol.for('x')` is `true`, because that
   specific function looks up a shared global registry instead of minting a new symbol.
3. **"I'll just spread my custom iterator into an array to see all its values."** → If
   the iterator is infinite or very large by design (e.g., a generator meant to be
   consumed lazily), spreading it will hang or exhaust memory. Use `for...of` with an
   explicit `break`, or call `.next()` manually, when you don't need every value
   upfront.

## 💻 Hands-On Exercise

Open `script.js`. It builds a custom iterable (a `Range` class) from scratch using the
raw protocol, then rewrites the same thing with a generator for comparison. Before
running, answer:

1. **Why does `for...of` work on an instance of `Range` but `for...in` gives a different,
   less useful result?**
   *Answer:* `for...of` calls `range[Symbol.iterator]()` and walks the returned
   iterator's `.next()` calls — this is exactly what `Range` was built to support.
   `for...in` instead walks the object's own *enumerable string keys* (here, just
   `start` and `end`, the stored instance properties), which has nothing to do with the
   iterator protocol at all — it would print `"start"` and `"end"`, not the sequence of
   numbers.

2. **What happens if you call `.next()` on the iterator manually, three times past
   `done: true`?**
   *Answer:* A correctly implemented iterator keeps returning `{ value: undefined, done:
   true }` indefinitely rather than throwing or resetting — the exercise's manual
   implementation demonstrates this explicitly so you can see the "keep calling me, I'll
   just keep saying I'm done" contract in action.

3. **Why does the generator-based rewrite of `Range` produce identical behavior with far
   less code?**
   *Answer:* A generator function automatically returns an object that already satisfies
   the iterator shape (`.next()` returning `{ value, done }`), and `yield` inside it
   handles pausing/resuming state for you — you never manually track "where am I" the
   way the hand-written version has to with its own `current` variable.

Run `index.html` and confirm the console trace matches your predictions for each of the
three sections, including the infinite-iterator caution demonstrated with an explicit
`break` instead of a dangerous full spread.
