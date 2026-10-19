# Day 11: Primitives vs Reference Types & Memory Model

## 🧠 Core Architectural Concept

JavaScript has two fundamentally different storage strategies, and almost every "weird"
bug you've ever hit with objects mutating unexpectedly traces back to confusing the two.

**Primitives** — `string`, `number`, `boolean`, `undefined`, `null`, `symbol`, `bigint` —
are *immutable values*. When you write `let a = 10`, the engine doesn't hand you a pointer
to a `10` living somewhere else; conceptually, `a` *is* `10`. V8 actually stores small
integers (SMIs — Small Integers, roughly 31 bits on 32-bit builds / tagged pointers on
64-bit) directly inline in the variable's slot, no heap allocation at all. Strings and
larger numbers get heap-allocated too in practice, but the *semantics* that matter for
interview purposes are: primitives are copied by value, full stop, and nothing you do to
a copy can ever affect the original, because there is no shared identity to begin with.

**Reference types** — plain objects, arrays, functions, `Map`, `Set`, `Date`, everything
created with `{}`, `[]`, or `new` — are allocated on the **heap**. The variable binding
itself (`const obj = {...}`) lives wherever the variable lives (stack frame for a local,
or a closure's environment record), but what it *holds* is not the object — it's a
reference (a pointer, functionally) to a heap address where the object's actual data
lives.

This is the part people get wrong under pressure: **JavaScript is pass-by-value, always.**
There is no pass-by-reference in JS. The confusion is that for objects, the *value* being
passed is the reference itself. So when you pass an object into a function, you're
copying the pointer, not the object. The function gets its own variable holding the same
address. Mutate a property through that pointer (`obj.x = 5`) and the caller sees it,
because both pointers resolve to the same heap cell. Reassign the parameter itself
(`obj = {}`) and the caller's variable is untouched, because you only overwrote your local
copy of the pointer — the caller's pointer still points at the original object.

```
STACK (per call frame)              HEAP
┌─────────────────────┐             ┌───────────────────────┐
│ caller: obj ──────┐  │             │ 0x7f3a: { x: 1, y: 2 } │
│                    │  │   points   │                        │
│ callee: param ─────┼──┼───────────▶│   (same object)        │
│                    │  │             └───────────────────────┘
└─────────────────────┘

mutate(param.x = 99)   -> caller.obj.x is now 99 (shared heap cell)
reassign(param = {})   -> callee's pointer now points elsewhere;
                          caller.obj is untouched
```

**Copying** follows directly from this model:
- `const b = a` where `a` is a primitive → true independent copy.
- `const b = a` where `a` is an object → `b` and `a` are two names for the *same* heap
  object. This is a **shallow reference copy**, not a deep clone.
- `{ ...obj }` and `Object.assign({}, obj)` create a **new top-level object**, but any
  nested object/array properties are still shared references — this is the single most
  common production bug in this space: "I spread it, why did the nested config still
  mutate?" Because spread only copies one level deep.
- `structuredClone(obj)` (modern browsers + Node 17+) does a true deep clone, including
  circular references, `Map`/`Set`/`Date`/typed arrays — things `JSON.parse(JSON.stringify())`
  cannot do (it chokes on circular refs, drops `undefined`/functions/symbols, and mangles
  `Date` into a string).

## 🎯 Interview Talking Points

- "JavaScript has no pass-by-reference — it's pass-by-value for everything, but for
  objects the value being copied is a reference. That distinction is the whole topic,
  and most engineers who say 'JS passes objects by reference' are using imprecise
  language that will get picked apart in a systems-level interview."
- "I debugged a production bug where a Redux reducer did `const next = { ...state };
  next.user.permissions.push('admin')` — looked immutable, passed the linter, but it was
  mutating the original `permissions` array in place because spread is shallow. We fixed
  it by switching to a proper deep-clone utility for nested writes and added an
  `Object.freeze` in dev mode to catch the next one at the source."
- "Stack vs heap matters for performance, not just correctness: primitive variables in a
  hot loop are cheap — no allocation, no GC pressure. Every object literal you create
  inside a loop body is a heap allocation and a future GC candidate. I've optimized hot
  paths in render loops specifically by hoisting object creation outside the loop and
  mutating fields instead of recreating objects every frame."
- "The follow-up question I'd expect here: 'if I pass an array into a function and call
  `.push()` on it, does the caller see the change? What if I do `arr = arr.concat(x)`
  inside the function instead?' Answer: `.push()` mutates the shared heap object, so yes,
  caller sees it. `.concat()` creates a *new* array and reassigns the local parameter
  binding to point at it — the caller's original reference is never touched. This is
  exactly the mutate-vs-reassign distinction from the diagram above, and it's the reason
  'treat props as read-only' is a load-bearing rule in React, not just a style
  preference."
- "`structuredClone` is the modern, correct deep-clone primitive — I steer teams away from
  `JSON.parse(JSON.stringify(x))` the moment I see it in a review, because it silently
  drops `undefined` values, functions, and symbols, converts `Date` to a string, and
  throws on circular references. `structuredClone` handles all of that correctly and
  ships natively in Node 17+ and all modern browsers."
- "Equality is the other half of this: `{} === {}` is `false` even with identical shape,
  because `===` on objects compares reference identity, not structural equality. This is
  why React's `useMemo`/`useEffect` dependency arrays break when you inline a new object
  literal every render — it's a *new* reference every time even though it 'looks the
  same'."

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Think of a primitive like writing a number on a sticky note and handing someone a
**photocopy** — they have their own sticky note now, completely independent. Think of an
object like handing someone a **house key** — you both now have a key to the *same*
house. If they rearrange the furniture (mutate the object), you'll see it next time you
walk in, because it's the same house. But if they go buy a brand new house and start
living there instead (reassign the variable to a new object), your key still opens the
original house — you were never affected.

**Common traps:**

1. **"I copied it with `{ ...obj }`, why did my original still change?"** → Spread/`Object.assign`
   only copies the top level. Any object or array *inside* that object is still the same
   shared key/house. Use `structuredClone(obj)` for a real deep copy.
2. **"If I pass an array into a function, can the function change my original array?"**
   → Yes, if it calls mutating methods like `.push`, `.sort`, `.splice`. No, if it does
   `arr = [...arr, x]` and returns a new array — that only changes the function's own
   local copy of the key, not the house itself.
3. **"Why is `{a:1} === {a:1}` false?"** → `===` checks "is this the exact same house,"
   not "do these houses look the same." Two separately-built objects are never `===`,
   no matter how identical their contents.

## 💻 Hands-On Exercise

Open `script.js` and, **before running it**, predict the console output for each labeled
section. Pay special attention to Section 3 (shallow vs deep copy) and Section 4
(mutate vs reassign inside a function) — write down your guess for each `console.log`,
then run it in `index.html` or a browser console and compare.

**Expected answers (with reasoning):**

1. `primitiveA` stays `10` after `primitiveB` is reassigned to `99` — primitives copy by
   value, there's no shared identity to mutate.
2. `original.name` becomes `"Changed"` after mutating `alias.name`, because `alias` and
   `original` point at the same heap object — this proves reference copying.
3. After `const shallow = { ...user }`, mutating `shallow.address.city` **also changes**
   `user.address.city`, because `address` is a nested object and spread only copied the
   outer shell. Mutating `shallow.name` directly does **not** affect `user.name`, because
   `name` is a primitive string field living directly on the (separately copied) outer
   object.
4. Inside `mutateArray`, `.push(4)` changes the caller's array (shared reference — you
   can see length go from 3 to 4 outside the function). Inside `reassignArray`, doing
   `arr = [...arr, 4]` does **not** change the caller's array — the parameter's local
   pointer was redirected to a brand-new array, the caller's original pointer never
   moved.
5. `structuredClone` produces a deep copy where mutating the clone's nested object has
   zero effect on the original — contrast this directly against the shallow-copy result
   in step 3 to see the difference land.
