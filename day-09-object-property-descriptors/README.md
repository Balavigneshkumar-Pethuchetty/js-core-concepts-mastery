# Day 09: Object Property Descriptors

## 🧠 Core Architectural Concept

Every property on a JavaScript object is not just "a key with a value" — internally,
each one is backed by a **property descriptor**, a small record the engine consults on
every read, write, enumeration, and delete. There are two kinds of descriptors:

**Data descriptors** (the ordinary kind): `{ value, writable, enumerable, configurable }`
**Accessor descriptors** (getters/setters): `{ get, set, enumerable, configurable }`
(A property is one or the other, never both — defining `get`/`set` and `value` together
throws a `TypeError`.)

When you write `obj.x = 1` via plain assignment, V8 creates a data descriptor with ALL
THREE flags defaulted to `true`: writable, enumerable, configurable. `Object.
defineProperty` is the only way to create a property with any flag set to `false`, and
this is the entire point of the API — it exists specifically to let you intentionally
restrict what the default "wide open" property behavior allows:

- **`writable: false`** — the value can still be READ, and still shows up in
  enumeration if `enumerable` is true, but assignment is silently ignored in non-strict
  mode and throws `TypeError` in strict mode (which is the default inside modules and
  classes). This is NOT the same as `const` — `const` prevents *rebinding a variable*;
  `writable: false` prevents *reassigning a property value on an object that might
  otherwise be fully mutable*.
- **`enumerable: false`** — the property still exists and is still directly readable/
  writable, but it's invisible to `for...in`, `Object.keys`, `Object.entries`,
  `JSON.stringify`, and spread (`{...obj}`). This is exactly the mechanism that makes
  built-in methods like `Array.prototype.map` or class methods (Day 08) not show up when
  you enumerate an array or instance — the engine defines them as non-enumerable by
  default specifically so user code enumerating "my own data" doesn't get polluted with
  "the methods I inherited."
- **`configurable: false`** — this is the one with teeth. Once `configurable` is
  `false`, you can NEVER go back and change any other attribute of that property (except
  flipping `writable` from `true` to `false`, a one-way ratchet), and you can never
  `delete` it. This is a **one-way door** — there is no API to make a property
  configurable again once it's locked.

**`Object.freeze` / `seal` / `preventExtensions` — three different doors, often
confused:**
```
preventExtensions(obj)  -> can't ADD new properties.      Existing props: unaffected.
seal(obj)                -> preventExtensions + every EXISTING prop becomes configurable:false.
                             (values can still change if writable stays true)
freeze(obj)               -> seal + every EXISTING data prop also becomes writable:false.
                             (the strictest of the three -- fully immutable, shallowly)
```
The word "shallowly" matters enormously and is the single most common trap: `Object.
freeze(obj)` only locks the *direct* properties of `obj`. If `obj.nested` is itself an
object, `obj.nested.value = 'changed'` succeeds without error, because `nested`'s own
properties were never touched by the freeze call on the outer object. I've seen this
cause a real production bug where a team assumed "frozen Redux-adjacent state object"
meant deep immutability and mutated a nested array in place, silently breaking a
reference-equality check (`prevState === nextState`) elsewhere in the app that assumed
freeze guaranteed deep immutability.

**Getters/setters are how you intercept property access without `Proxy`.** A getter
runs arbitrary code every time the property is *read*; a setter runs on every *write*.
This is the mechanism-level answer to "how does a computed property work" and
"how does validation-on-assignment work" without needing a full `Proxy`. Mechanically,
accessing a getter-backed property is **not** a simple memory read — it's a function
call, which means it cannot benefit from V8's fastest property-access inline caches the
same way a plain data property can; this is a real (if usually small) performance
difference, not just an API style choice.

**Performance note:** `Object.freeze`/`seal`/`preventExtensions` all change an object's
hidden class to a special "dictionary mode" or frozen-shape representation in V8 once
applied, and — critically — **objects created via `Object.freeze` on a literal at
definition time** (a common pattern for constants/config objects) can actually be
*faster* to access than a mutable equivalent, because V8 can bake in stronger
assumptions about a shape that provably never changes. The performance risk is the
*reverse* case: freezing/sealing an object AFTER many other objects of "the same shape"
already exist and are being accessed polymorphically — that one frozen outlier can
knock call sites out of their optimized monomorphic state.

## 🎯 Interview Talking Points

- "I reach for `Object.defineProperty` specifically when I need a property that behaves
  differently from the 99% default — a computed/derived value via a getter, a
  write-once config constant via `writable:false`, or a property I deliberately want
  hidden from `JSON.stringify`/`Object.keys` via `enumerable:false`, like an internal
  cache reference on a public-facing object."
- "I've debugged a bug where a config object that looked 'frozen' in a code review still
  got mutated in production — turned out `Object.freeze` was called on the top-level
  object, but a nested `settings.retries` object was mutated directly by a different
  module. Freeze is shallow; I now default to a recursive deep-freeze helper (or a
  library like `immer`) for any state object where deep immutability is actually the
  intent, and I say so explicitly in review comments."
- "The distinction between `writable:false` and `configurable:false` trips up even
  experienced engineers: `writable:false` only blocks reassigning the VALUE; you can
  still redefine the property's other attributes (as long as `configurable` is still
  `true`) or delete it entirely. `configurable:false` is the actual lockdown — no
  redefinition, no deletion, ever, for the life of that object."
- "Getters are a double-edged tool — I love them for derived/computed values (`get
  fullName() { return this.first + ' ' + this.last; }`), but I flag them in review when
  I see a getter doing expensive work (a network call, a heavy computation) because
  callers reasonably assume property access is cheap and synchronous; that assumption
  breaks silently and causes surprising performance cliffs under load."
- "`Object.seal` is underused relative to `Object.freeze` — I use `seal` specifically
  when I want to lock the *shape* of an object (no adding/removing keys, preventing a
  typo like `confg.rety` from silently creating a new property instead of throwing) but
  still need to update existing values at runtime, e.g. a mutable settings object with a
  known, fixed key set."
- "I always check `Object.isExtensible`/`Object.isSealed`/`Object.isFrozen` in defensive
  code rather than assuming — a library consumer might hand me an already-frozen object,
  and blindly trying to mutate it fails silently in non-strict contexts, which is a nasty
  class of bug to track down."
- Anticipate: *"Does `Object.freeze` affect array methods like `.push`?"* — Yes: freezing
  an array makes it both non-extensible (can't add new indices/length) and its existing
  indices non-writable, so `.push()` throws `TypeError` in strict mode because it both
  tries to write a new index AND update `.length` — both blocked.
- Anticipate: *"Why doesn't `Object.assign({}, frozenObj)` give you back a frozen
  object?"* — `Object.assign` just copies own enumerable properties by value into a
  brand-new, perfectly ordinary, fully-open object; freezing is a property of a specific
  object reference, not something that propagates through copying.

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Think of every property on an object as having three little switches attached to it,
invisible unless you go looking: **"can this be changed?" (writable), "does this show
up when I list what's on this object?" (enumerable), and "can these switches themselves
ever be flipped again?" (configurable)**. Plain `obj.x = 1` flips all three switches to
"yes" automatically. `Object.defineProperty` is the tool you use when you want to flip
one of those switches to "no" on purpose.

`freeze`, `seal`, and `preventExtensions` are three sizes of "lock" you can put on the
whole object at once, from loosest to tightest: `preventExtensions` only stops you
adding NEW properties; `seal` also stops you deleting or reconfiguring EXISTING ones
(but you can still change their values); `freeze` is the strictest — nothing about
existing properties can change at all, not even their values.

**Common traps:**
- *Trap 1:* "`Object.freeze(obj)` makes the WHOLE object tree immutable." → Correction:
  freeze is shallow — nested objects inside a frozen object are completely unaffected
  and remain fully mutable.
- *Trap 2:* "`writable: false` and `const` do the same job." → Correction: `const`
  stops you from reassigning a *variable* to point at a different value; `writable:
  false` stops a specific *property* on an object from being reassigned, even if the
  object itself is referenced by a `let` or `var`.
- *Trap 3:* "Getters/setters are basically free, just a different syntax for reading a
  value." → Correction: a getter is a real function call under the hood every single
  time the property is read — if it does meaningful work, that cost is paid on every
  access, unlike a plain data property.

## 💻 Hands-On Exercise

Open `script.js` and predict the output of each block before running it in
`index.html`. Focus especially on Block 3 (the shallow-freeze trap) and Block 5 (the
one-way `configurable:false` door) — both come up constantly in interviews.

**Expected answers (self-check):**

1. Reading `Object.getOwnPropertyDescriptor(obj, 'x')` after plain assignment shows
   `{ value: 1, writable: true, enumerable: true, configurable: true }` — the default,
   wide-open descriptor.
2. After `Object.defineProperty` sets `writable: false`, reassigning the property in
   strict mode throws `TypeError: Cannot assign to read only property`; reading it still
   returns the original value.
3. Freezing `config` prevents `config.topLevel = 'new'` from taking effect, but
   `config.nested.value = 'changed'` SUCCEEDS silently — proving freeze is shallow; the
   deep-freeze helper fixes this by recursing into nested objects before freezing each
   one.
4. `enumerable: false` on `hiddenProp` means it's directly readable
   (`obj.hiddenProp` works) but invisible to `Object.keys`, `for...in`, and
   `JSON.stringify`.
5. Once `configurable: false` is set, a second `Object.defineProperty` call attempting
   to change `enumerable` throws `TypeError: Cannot redefine property` — proving
   `configurable:false` is a one-way lock with no API to reverse it.
6. The getter/setter-backed `temperature` object: reading `.fahrenheit` computes it live
   from `.celsius` (proving it's not a stored value), and setting `.fahrenheit = 32`
   updates the underlying `.celsius` to `0` via the setter's conversion logic.
