# Day 26: Destructuring, Spread/Rest, and the Shallow-vs-Deep Copy Trap

## 🧠 Core Architectural Concept

Destructuring and spread/rest are **syntax sugar over property reads and iteration
protocols** — they don't change how JavaScript stores or copies values. Understanding
them architecturally means understanding what they *don't* do: they never traverse
nested structures. That single fact is the root of roughly half of all "mutation bug"
tickets you'll ever triage.

**Destructuring** (`const { a, b } = obj`) compiles down to sequential property
lookups — effectively `const a = obj.a; const b = obj.b;` — plus, for arrays, a call to
the object's `[Symbol.iterator]()` and repeated `.next()` calls. That's why you can
destructure a `Map`, a `Set`, a generator, or a `NodeList`, but you *cannot* destructure
a plain object positionally (`const [a] = {0: 'x'}` fails — objects aren't iterable by
default) and you *cannot* array-destructure something that doesn't implement the
iterable protocol.

**Spread** (`{...obj}`, `[...arr]`, `fn(...args)`) is the mirror operation: for objects,
the engine performs `[[OwnPropertyKeys]]` + `[[Get]]` for every **own enumerable**
property (inherited properties are *not* copied — this is a classic "why did my class
instance lose its methods when I spread it?" bug) and assigns each one onto a brand-new
object via `[[Set]]`. For arrays/iterables, it drains the iterator into a new array.
Either way, the engine allocates a new top-level container on the heap and copies
**references** into its slots. If a slot holds a primitive (number, string, boolean),
you get an independent value. If a slot holds an object/array/function, you get a copy
of the *pointer* — both the original and the copy now point at the same heap
allocation.

```
const original = { user: { name: 'Ada' } };
const copy = { ...original };

Heap:
  original ──┐
              ├──► { user: ──► {name:'Ada'} }   <- ONE object, two references pointing at it
  copy ───────┘
```

Mutate `copy.user.name = 'Grace'` and `original.user.name` is now `'Grace'` too —
nothing was "copied twice," there's only ever been one `{name: 'Ada'}` object on the
heap. This is **shallow copy**: one level deep, then references.

**Rest** (`const { a, ...rest } = obj` / `function f(a, ...rest)`) is the inverse of
spread — the engine iterates remaining keys/items (skipping ones already destructured)
and builds a new container the same way spread does. Same shallow semantics apply.

**Deep copy** means recursively walking the *entire* structure and allocating new
containers at every level, not just the top one. V8 gives you a native, engine-level
implementation for this: `structuredClone()`, which uses the **HTML Structured Clone
Algorithm** — the same algorithm the browser uses internally to pass data through
`postMessage`, `IndexedDB`, and Web Workers. It walks the object graph, handles
circular references natively (something `JSON.stringify` cannot do — it throws
`TypeError: Converting circular structure to JSON`), and correctly clones `Map`, `Set`,
`Date`, `RegExp`, `ArrayBuffer`, and typed arrays. What it *cannot* clone: functions,
DOM nodes, `Symbol` values, and anything with a prototype chain it doesn't recognize
(class instances get cloned as plain objects — you lose the prototype, so
`instanceof MyClass` fails on the clone).

The `JSON.parse(JSON.stringify(x))` "deep clone" trick predates `structuredClone` and is
still common in older codebases and interview answers — but it's a leaky abstraction
with real production failure modes: it drops `undefined` values and functions silently,
converts `Date` objects into ISO strings (losing the `Date` type), throws on circular
references, drops `Map`/`Set`/`Symbol` entirely, and loses `NaN`/`Infinity` (coerced to
`null`). A manual recursive clone gives you full control (and is a very common interview
whiteboard exercise) but you own every edge case — circular refs, special object types,
`Symbol` keys — yourself.

## 🎯 Interview Talking Points

- "Spread and rest are shallow by definition — the spec only mandates a copy of own
  enumerable properties at one level. I treat 'shallow vs deep' as a per-call decision,
  not a library default: for a flat config object, `{...config}` is fine and fast; for
  anything with nested objects that downstream code might mutate, I reach for
  `structuredClone` or restructure the state to avoid deep nesting in the first place."
- "I've debugged a Redux-style state bug that came from exactly this: a reducer did
  `return {...state, user: {...state.user}}` to 'immutably' update one field, but a
  *sibling* reducer further down the pipeline still held a reference to
  `state.user.preferences` from before the spread and mutated it directly. The spread
  gave us a false sense of safety at the top level while the leak was two levels down."
- "`JSON.parse(JSON.stringify())` is the thing I actively tell teams to stop using for
  cloning once a codebase matures — it silently corrupts `Date`, `undefined`, and
  `Map`/`Set` data. I've seen a `Date` turn into a string after a 'deep clone,' pass
  type-checking in a loosely-typed codebase, and then blow up three functions downstream
  when `.getMonth()` was called on a string. `structuredClone` is the correct native
  answer in 2024+ runtimes; before that, a well-tested recursive clone or a library like
  lodash's `cloneDeep`."
- "The trade-off with deep copying is always performance and semantics, not just safety.
  Deep-cloning a large object graph is O(n) in total node count and allocates a lot of
  memory — for a hot path (e.g. cloning on every keystroke in a text editor's undo
  stack), that's a real cost. Structural sharing (keeping references to *unchanged*
  subtrees, like Immer or Immutable.js do) gets you the safety of immutability without
  paying for a full deep clone every time."
- "A follow-up they often throw: 'does spread copy the prototype?' No — object spread
  only copies own enumerable properties onto a plain object with `Object.prototype` as
  its prototype. If you spread a class instance, you get a plain object back with all
  the data but none of the methods or `instanceof` identity. `Object.assign` behaves the
  same way for this reason. If you need to preserve the prototype, you want
  `Object.create(Object.getPrototypeOf(obj), Object.getOwnPropertyDescriptors(obj))` or
  simply don't spread class instances — clone via a constructor or a `.clone()` method
  instead."
- "Array destructuring with default values and skipped elements (`const [, second,
  third = 10] = arr`) is iterator-based, not index-based under the hood — for a plain
  array that distinction doesn't matter, but for a `Set` or a generator it means order
  is whatever the iterator yields, and you can only skip positions you've already
  consumed, you can't 'rewind.'"
- "I always point out that `rest` in function parameters (`function f(...args)`) gives
  you a real `Array` — unlike the old `arguments` object, which is array-*like* but not
  an array (no `.map`, no `.filter`) and also doesn't capture arrow function arguments at
  all, since arrow functions have no `arguments` binding of their own."

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Think of an object like a filing cabinet, and each property like a sticky note with
either a number written on it, or a string pointing to *another* filing cabinet in the
next room.

When you do `{...obj}`, you get a brand new filing cabinet with copies of all the sticky
notes. If a sticky note just says "42," great, that's a fully independent copy. But if a
sticky note says "go to Room B," your new cabinet's note *also* says "go to Room B" —
both cabinets send you to the exact same Room B. Change something in Room B through
either cabinet, and anyone going to Room B sees the change, because there's only ever
been one Room B.

That's "shallow copy" — copying stops at the first layer of sticky notes. If you want a
completely independent copy, including a brand new Room B with its own furniture, you
need a "deep copy" — which means walking into every room and rebuilding it from scratch.
`structuredClone(obj)` does that for you automatically, for most real-world data.

**Common traps:**
1. **"I spread it, so it's safe to mutate."** Wrong — only true for primitive fields.
   Correction: if any field is an object or array, spreading it still leaves that nested
   field shared. Check every level you plan to mutate.
2. **"JSON stringify/parse is a safe way to clone anything."** Wrong — it silently
   drops `undefined`, functions, and `Map`/`Set`, and turns `Date` into a plain string.
   Correction: use `structuredClone()` for real data; reserve JSON round-tripping for
   data you're about to send over the wire anyway.
3. **"Rest and spread are the same operator, just reversed."** They look similar
   (`...`) but spread *expands* a collection into individual elements/properties, while
   rest *collects* individual elements/properties back into one container. Correction:
   spread is used where you're *providing* values (`fn(...arr)`, `{...obj}`); rest is
   used where you're *receiving* values (`function f(...args)`, `const {a, ...rest} =
   obj`).

## 💻 Hands-On Exercise

Open `script.js`. Before running it, predict the output of this snippet by tracing
reference vs. value copying by hand:

```js
const original = {
  id: 1,
  tags: ['a', 'b'],
  meta: { created: 2024 },
};

const shallow = { ...original };
shallow.id = 999;
shallow.tags.push('c');
shallow.meta.created = 2099;

console.log(original.id);          // ?
console.log(original.tags);        // ?
console.log(original.meta.created);// ?
```

**Expected answer:**
```
1
['a', 'b', 'c']
2099
```

**Why:** `shallow.id = 999` reassigns a *primitive* slot on the new object only —
`original.id` is untouched because numbers are copied by value. But `shallow.tags` and
`shallow.meta` are the *same array/object references* as `original.tags` and
`original.meta` — spread never cloned them, it just copied the pointer. So
`.push('c')` and `.created = 2099` mutate the one shared array/object that both
`original` and `shallow` are pointing at, and the change is visible through either
variable.

Then run `script.js` in `index.html` and compare against the full worked examples,
including the `structuredClone` deep-copy fix, the JSON round-trip pitfalls (circular
reference throw, `Date`/`undefined`/`Map` corruption), and a complete hand-rolled
recursive `deepClone` implementation with circular-reference handling via a `WeakMap`
visited-set (a nice preview of Day 27's `WeakMap` topic).
