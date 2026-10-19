# Day 08: Classes Under the Hood

## 🧠 Core Architectural Concept

ES6 `class` is **syntactic sugar over the exact same prototype mechanism from Day 07**
— there is no separate "class" concept inside V8's object model. When the engine parses
a `class` declaration, it desugars it (conceptually) into: a constructor function, a
`.prototype` object that instance methods get attached to (non-enumerable, unlike the
old manual pattern), and a few strictly-enforced behavioral rules that plain functions
don't have.

```js
class Animal {
  constructor(name) { this.name = name; }
  speak() { return `${this.name} makes a sound`; }
  static create(name) { return new Animal(name); }
}

// Roughly equivalent to (not 100% identical -- see the "but" list below):
function Animal(name) { this.name = name; }
Object.defineProperty(Animal.prototype, 'speak', {
  value: function () { return `${this.name} makes a sound`; },
  writable: true, enumerable: false, configurable: true, // class methods are NOT enumerable
});
Animal.create = function (name) { return new Animal(name); }; // statics attach to the function itself
```

**The real, enforced differences that make `class` MORE than sugar:**
1. **Class declarations are not hoisted the way function declarations are.** The binding
   is hoisted to the Temporal Dead Zone, same as `let`/`const` — you cannot reference
   the class before its definition executes (Day 02).
2. **Calling a class without `new` throws `TypeError`.** Regular constructor functions
   silently let you forget `new` (and then quietly corrupt the global object or throw
   confusingly later) — V8 marks class constructors with an internal flag that makes
   `[[Call]]` (invocation without `new`) explicitly throw instead of running.
3. **Class bodies are always strict mode**, regardless of the surrounding file's mode.
4. **Methods defined in a class body are non-enumerable** on the prototype — `for...in`
   and `Object.keys` on an instance will NOT show inherited class methods, whereas the
   manual `Dog.prototype.bark = function(){}` pattern from Day 07 DOES create an
   enumerable property by default. This is a real, observable, and frequently
   interview-tested difference.

**`extends` and `super` — the two-link chain**
`extends` wires up TWO separate prototype links, not one — this is the detail that
separates people who've memorized the syntax from people who understand it:
```
class Dog extends Animal {}
// Link 1 (instance chain, same as Day 07): Dog.prototype.__proto__ === Animal.prototype
//   -> so dog.speak() walks dog -> Dog.prototype -> Animal.prototype and finds speak()
// Link 2 (static chain, exists ONLY with class/extends): Dog.__proto__ === Animal
//   -> so Dog.create(...) walks Dog -> Animal and finds the STATIC method create()
```
`super(...)` inside a subclass constructor is not just "call the parent constructor" —
it is **mandatory** before you can touch `this` in a derived class, because of how
`[[Construct]]` works differently for derived classes: a base class constructor
allocates `this` itself and hands it to you; a **derived** class constructor does NOT
get a `this` binding until `super()` runs and returns the object built by the parent
chain. Access `this` before calling `super()` in a derived constructor and you get a
`ReferenceError`, not `undefined` — this is V8 enforcing the spec's "this is
uninitialized until super() completes" rule, and it's a very commonly asked trick
question.

**Static members** attach directly to the class/constructor function itself (never to
`.prototype`), which is why they're inherited via the *second* prototype link
(`Dog.__proto__ === Animal`) rather than the instance chain — static methods are never
reachable from an instance (`dog.create` is `undefined`; only `Dog.create` works).

**Private fields (`#field`) are not just "renamed with a #" — they are a different kind
of slot entirely.** A `#field` is stored in an internal, non-enumerable, *not
reflectable* slot keyed by a unique per-class "private name" — it is not a string or
Symbol property at all, which is why `Object.keys`, `JSON.stringify`,
`Reflect.ownKeys`, and bracket-notation access (`obj['#field']`) **cannot see or reach
it**, even from outside code that has a reference to the instance. V8 implements this
with a dedicated internal mechanism (private symbols / private name objects) distinct
from the regular property table — accessing `#field` from inside the declaring class
compiles to a direct, fast slot-load, not a dictionary lookup, which is actually
*faster* than a normal property access in some engine implementations, not slower. The
hard rule interviewers probe for: accessing `instance.#field` from code **outside** the
class that declared it is a `SyntaxError` at parse time (not a runtime `undefined`) —
the engine can tell statically that the private name isn't in scope.

## 🎯 Interview Talking Points

- "I describe `class` as 'the prototype chain with guardrails' — same engine mechanism
  as manual prototype wiring, but with TDZ hoisting, mandatory `new`, strict mode, and
  non-enumerable methods baked in. I've used this exact explanation to correct a
  candidate's assumption that classes are a fundamentally different inheritance model
  from what existed in ES5."
- "The 'methods are non-enumerable' detail has bitten a real codebase I worked on — a
  generic `Object.keys(instance).forEach(serialize)` serializer worked fine with
  ES5-style `Constructor.prototype.method = fn` objects (because those ARE enumerable)
  but silently dropped nothing when we migrated to `class` syntax, because class methods
  were never enumerable in the first place — the bug people expected (methods leaking
  into serialization) never actually happens with real `class` syntax, which is itself
  worth knowing cold."
- "I always explain the TWO prototype links `extends` creates: the instance chain for
  `speak()`-style instance methods, and the SEPARATE static chain
  (`Subclass.__proto__ === SuperClass`) for inherited static methods. People who've only
  memorized `extends` usually can't explain why `Dog.create()` finds `Animal`'s static
  method — it's because `Dog.__proto__ === Animal`, not because of the instance chain
  at all."
- "The 'this is uninitialized until super() runs' rule in derived constructors isn't
  trivia for its own sake — it exists because a derived class constructor literally does
  not receive a `this` binding from `[[Construct]]` the way a base class does; `super()`
  is what obtains it from the parent chain. I use this to explain why you physically
  cannot do field initialization before `super()` in a subclass, and why forgetting
  `super()` entirely gives you a `ReferenceError` on first `this` access, not later."
- "Private fields aren't 'just convention' like the old `_underscore` naming trick — I've
  relied on this when building a library that had to guarantee true encapsulation (e.g.
  internal cache state that must never be serialized by `JSON.stringify` or tampered
  with via bracket access by consumer code) — `#field` genuinely cannot be reached from
  outside, which `_field` never actually enforced, it was always just a social
  convention."
- "Calling a class constructor without `new` throws immediately by design — I treat this
  as a feature, not an annoyance, because the equivalent mistake with an old-style
  constructor function silently sets properties on the global object (non-strict mode)
  or throws a confusing `Cannot set property of undefined` deep inside the constructor
  body (strict mode) instead of failing loudly and immediately at the call site."
- Anticipate: *"Can you use arrow functions for class methods?"* — Not as class-body
  methods (the `class` method syntax always produces a non-arrow function on the
  prototype), but you CAN declare a class **field** with an arrow function value
  (`handleClick = () => {}`), which is common specifically to auto-bind `this` for
  callback use — trade-off: one function instance per object instance instead of one
  shared prototype method (see Day 06).
- Anticipate: *"Is `class` always strictly better than the old prototype pattern?"* — For
  readability and correctness guardrails, yes, almost always; the one case I'd reach for
  manual `Object.create`/prototype wiring instead is when I need prototypal inheritance
  WITHOUT a constructor function at all (e.g., a shared behavior mixin object), since
  `class` always implies a constructor-based instantiation model.

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

`class` is a nicer-looking way to write the exact same prototype wiring you'd do by hand
— think of it as a form with blanks pre-filled in correctly so you can't mess up the
wiring by accident. Under the form, it's still "objects linked to objects" exactly like
Day 07; `class` just won't let you forget `new`, won't let you call the constructor in
sloppy mode, and keeps your methods off of `for...in` loops automatically.

`extends` quietly wires up TWO links, not one: a link so instances can find inherited
*instance* methods, and a separate link so the class *itself* can find inherited
*static* methods. Most people only know about the first one.

`super()` in a subclass constructor isn't optional politeness — it's literally where
your subclass's `this` comes from. Until you call it, `this` doesn't exist yet in a
subclass constructor.

**Common traps:**
- *Trap 1:* "A class method and a function assigned to `.prototype` manually are 100%
  identical." → Correction: class methods are non-enumerable by default; manually
  assigned prototype methods are enumerable — this changes what `for...in` and
  `Object.keys` on an instance will show.
- *Trap 2:* "I can access `this.name` before calling `super()` in my subclass
  constructor, I just need to remember to call `super()` eventually." → Correction:
  touching `this` before `super()` runs in a derived class throws a `ReferenceError`
  immediately — it's not a style issue, it's enforced by the engine.
- *Trap 3:* "`#privateField` is basically the same as naming it `_privateField`." →
  Correction: `_privateField` is just a naming convention — any outside code can still
  read/write it. `#privateField` is a genuinely unreachable engine-level slot; outside
  code gets a `SyntaxError` just trying to reference `instance.#privateField` by name.

## 💻 Hands-On Exercise

Open `script.js` and predict the output of each block before running it in
`index.html`. Pay close attention to Block 3 (the enumerability difference) and Block 5
(the `super()`-before-`this` trap) — these are the two most commonly misunderstood
class-internals questions in interviews.

**Expected answers (self-check):**

1. `new Animal('Rex').speak()` returns `"Rex makes a sound"` — ordinary prototype method
   lookup, same mechanism as Day 07.
2. Calling `Animal('Rex')` WITHOUT `new` throws
   `TypeError: Class constructor Animal cannot be invoked without 'new'` — enforced by
   an internal engine flag on class constructors.
3. `Object.keys(rex)` returns only `['name']` — instance DATA properties are own and
   enumerable, but `speak` lives on the prototype and is non-enumerable, so it never
   appears even via `for...in`.
4. `Dog.create('Fido')` works and returns a `Dog` instance — proving the STATIC
   prototype link (`Dog.__proto__ === Animal`) lets `Dog` find `Animal`'s static
   `create` method, even though `Dog` never defined its own `create`.
5. The `BrokenDog` subclass that reads `this.breed` before calling `super()` throws
   `ReferenceError: Must call super constructor in derived class before accessing 'this'
   or returning from derived constructor` — proving `this` genuinely does not exist yet.
6. `instance.#secret` accessed from inside the class works and returns the private
   value; the commented-out external access line would throw a `SyntaxError` at parse
   time if uncommented, and `Object.keys(instance)` / `JSON.stringify(instance)` never
   show the private field at all.
