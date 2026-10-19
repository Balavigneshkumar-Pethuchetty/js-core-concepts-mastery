# Day 07: Prototypes & Prototypal Inheritance

## 🧠 Core Architectural Concept

Every object in JavaScript carries a hidden internal slot called `[[Prototype]]` — a
pointer to another object (or `null`). When you access a property that doesn't exist
directly on an object, the engine doesn't give up; it walks `[[Prototype]]` → that
object's `[[Prototype]]` → and so on, until it either finds the property or hits `null`.
This chain of pointers is the **prototype chain**, and it is the *entire* mechanism
behind what looks like "inheritance" in JavaScript. There are no classes at the engine
level underneath this — just objects linked to other objects.

**`__proto__` vs `.prototype` — the two most confused words in JS**
- `obj.__proto__` is an accessor property (a getter/setter) that exposes an object's
  actual internal `[[Prototype]]` slot. Every *object instance* has this.
- `Function.prototype` is a completely different thing: it's a regular object property
  that only exists on **functions**, and it's the object that will become the
  `[[Prototype]]` of any instance created by calling that function with `new`.

```
function Dog(name) { this.name = name; }
Dog.prototype.bark = function () { return `${this.name} says woof`; };

const rex = new Dog('Rex');

// What `new Dog('Rex')` actually does, step by step:
// 1. Create a brand-new plain object.
// 2. Set that object's internal [[Prototype]] to Dog.prototype.
//    (this is the link: rex.__proto__ === Dog.prototype  -> true)
// 3. Call Dog with `this` bound to the new object.
// 4. If Dog doesn't explicitly return an object, return the new object.

rex.bark();
// Property lookup trace:
//   rex.bark -> not an OWN property of rex
//            -> walk rex.[[Prototype]] (= Dog.prototype) -> found `bark` here. Stop.
rex.toString();
// Longer walk: rex -> Dog.prototype (no toString) -> Object.prototype (found it) -> stop
//            Dog.prototype.[[Prototype]] === Object.prototype by default
// rex -> Dog.prototype -> Object.prototype -> null
```

**`Object.create(proto)`** builds an object with a *chosen* `[[Prototype]]` directly,
with no constructor function and no `new` involved at all — this is "prototypal
inheritance" in its purest, class-free form, and it's exactly how you'd simulate
inheritance before ES6 `class` existed (and still how `class` works under the hood —
see Day 08):

```js
const animal = { describe() { return `I am a ${this.kind}`; } };
const dog = Object.create(animal);   // dog.[[Prototype]] === animal, directly, no constructor
dog.kind = 'dog';
dog.describe(); // 'I am a dog' — found via one hop up the chain
```

**V8 performance mechanics — this is where staff-level depth shows up.** V8 does not
do a naive object-map lookup for every property access. It assigns every object a
**hidden class** (also called a "Map" internally, not to be confused with the `Map`
data structure) that describes its shape — which properties it has, in which order, and
where they live in memory. When you access `rex.bark` repeatedly from the same call
site, V8's inline cache (IC) remembers "objects with hidden class X find `bark` by
walking exactly one prototype link to hidden class Y" and skips re-walking the chain on
subsequent hits — this is called a **monomorphic inline cache hit**. Two things destroy
this optimization:
1. **Deep prototype chains.** Every additional link is an extra hop the IC has to
   validate (or, on a cache miss, actually walk) — a 10-level-deep inheritance chain
   built from a framework's `extends extends extends...` pattern is measurably slower
   per-property-access than a 2-level chain, especially for cold/polymorphic call sites.
2. **Mutating prototypes after objects already exist** (`SomeClass.prototype.newMethod =
   ...` added late, or worse, `obj.__proto__ = somethingElse` at runtime). This
   invalidates hidden classes and inline caches that were already built, forcing V8 to
   deoptimize and rebuild — I've seen this show up directly in a CPU profile as a spike
   in `LoadIC_Miss` after a "helpful" runtime monkey-patch.

## 🎯 Interview Talking Points

- "I treat `Object.create(null)` as a specific tool for building a true dictionary/map
  object with zero inherited baggage — no `toString`, no `hasOwnProperty`, nothing from
  `Object.prototype` — which matters when the keys are untrusted user input and you want
  to rule out prototype-pollution-style collisions with built-in names like
  `__proto__` or `constructor` entirely."
- "`__proto__` and `.prototype` get confused constantly, and I always clarify with one
  line: `.prototype` lives on constructor *functions* and is the blueprint for future
  instances; `__proto__` lives on *instances* and is the actual live link to their
  prototype. `instance.__proto__ === Constructor.prototype` is the equation that ties
  them together."
- "I've debugged a real prototype-pollution vulnerability where a deep-merge utility
  did `target[key] = source[key]` recursively without guarding against `key ===
  '__proto__'` — an attacker-controlled JSON payload with a `__proto__` key let them
  inject properties onto `Object.prototype` itself, silently affecting every object in
  the process. The fix was using `Object.create(null)` for the merge target and/or
  checking `Object.hasOwn(target, key)` before assigning."
- "Deep prototype chains are a real performance smell, not just a style complaint — I
  review PRs that build 5+ levels of `class A extends B extends C extends D` and ask
  whether composition (has-a) would serve better than inheritance (is-a), partly for
  design reasons and partly because I've seen V8 deopt megamorphic call sites in chains
  that deep under profiling."
- "`Object.create` versus a constructor function with `new` are functionally similar but
  philosophically different: `new Foo()` always builds the SAME shape (same hidden
  class) for every instance, which V8 optimizes beautifully; `Object.create` composed ad
  hoc per-call can produce objects with different shapes even when they 'look' like the
  same type, which hurts monomorphism. I pick constructors/classes when I need many
  instances of a stable shape, and `Object.create` when I need a one-off object with
  deliberate, explicit prototype wiring — e.g., a mixin base."
- Anticipate: *"Why does `for...in` walk the prototype chain but `Object.keys` doesn't?"*
  — `for...in` enumerates all enumerable properties including inherited ones;
  `Object.keys`/`Object.entries`/`Object.values` only return **own** enumerable
  properties. This is exactly why you almost always see a `hasOwnProperty` guard inside
  `for...in` loops in real codebases — to filter out inherited noise.
- Anticipate: *"What does `Object.getPrototypeOf` give you that `__proto__` doesn't?"* —
  functionally the same read, but `Object.getPrototypeOf`/`Object.setPrototypeOf` are
  the standardized, spec-sanctioned API; `__proto__` is a legacy accessor that exists for
  web compatibility and is explicitly called out in the spec annex as something new code
  should avoid for *setting* (read access is fine, mutation is where it gets dangerous
  and slow).

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Imagine every object has an invisible string tied to another object — its "parent."
When you ask an object for something it doesn't have, it doesn't say "I don't know" —
it follows the string to its parent and asks *them*. If the parent doesn't have it
either, the parent follows *their* string, and so on, until someone answers or the
string runs out (hits `null`). That invisible string is `[[Prototype]]`, and you can see
where it points with `obj.__proto__`.

`Constructor.prototype` is different — think of it as a shared "parent object" that a
factory (the constructor function) ties onto every single item it stamps out with
`new`. It's not the item's own string — it's the string that *gets* tied on, once, for
every new object the factory makes.

**Common traps:**
- *Trap 1:* "`.prototype` and `__proto__` are just two spellings of the same thing." →
  Correction: `.prototype` is a property on constructor *functions* (the blueprint);
  `__proto__` is the live link on *instances* (the actual connection). They're related
  but not the same thing.
- *Trap 2:* "If I add a method to `Dog.prototype` after creating `rex`, `rex` won't see
  it." → Correction: the prototype chain is a *live link*, not a snapshot copy — `rex`
  will immediately see any method added to `Dog.prototype`, even ones added after `rex`
  was created, because lookup happens at access-time, not creation-time.
- *Trap 3:* "I'll just set `obj.__proto__ = other` whenever I want to change inheritance
  on the fly." → Correction: mutating `__proto__` at runtime is slow (it deoptimizes V8's
  hidden-class assumptions) and considered bad practice; use `Object.create` to set the
  prototype correctly at *creation time* instead.

## 💻 Hands-On Exercise

Open `script.js` and predict the output of each block before running it in
`index.html`. Focus especially on the chain-walking trace in Block 2 and the
prototype-pollution demo in Block 5 — both are classic interview whiteboard questions.

**Expected answers (self-check):**

1. `rex.bark()` returns `"Rex says woof"` — found one hop up the chain on
   `Dog.prototype`, proving method lookup isn't a copy, it's a live reference walk.
2. `rex.toString()` returns `"[object Object]"` — found two hops up, on
   `Object.prototype`, since `Dog.prototype` itself doesn't define `toString`.
3. Adding `Dog.prototype.fetch = ...` AFTER `rex` is created still makes
   `rex.fetch()` work — the chain is live, not a snapshot.
4. `Object.create(null).toString` is `undefined` — a `null`-prototype object inherits
   nothing, not even the most basic `Object.prototype` methods.
5. The naive merge function lets a `__proto__`-keyed payload pollute `Object.prototype`,
   demonstrated by a plain `{}` suddenly having a `polluted` property it never had
   explicitly — this is the exact production vulnerability pattern; the guarded version
   using `Object.hasOwn` and an explicit key-deny-list prevents it.
6. `dog.describe()` via `Object.create(animal)` returns `"I am a dog"` — pure
   prototypal inheritance with zero constructor functions involved.
