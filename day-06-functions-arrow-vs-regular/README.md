# Day 06: Functions — Declarations vs Expressions vs Arrow Functions

## 🧠 Core Architectural Concept

All functions in JavaScript are objects — a callable object with an internal `[[Call]]`
method, and if it's a regular function, also an internal `[[Construct]]` method that
lets it be invoked with `new`. The *way* you write a function changes which internal
slots V8 attaches to it, when it gets memory-allocated during parsing, and what gets
bound implicitly when it executes. That's the real axis of difference — not syntax
sugar, but which internal machinery is wired up.

**Function Declarations** (`function foo() {}`)
During the *creation phase* of the surrounding execution context (Day 01), the JS engine
walks the code and fully hoists function declarations — not just the name (like `var`),
but the entire function body, already compiled into a callable object, bound to the
identifier in the Variable Environment before a single line executes. That's why you can
call a declared function above its physical position in the file. V8's parser does this
in one pass over the source before Ignition (the bytecode interpreter) ever starts
executing — it builds a `SharedFunctionInfo` for each declaration eagerly at this stage.
Declarations also get `[[Construct]]`: `new Foo()` works, `.prototype` exists, and `this`
is dynamic (determined by the call site).

**Function Expressions** (`const foo = function() {}`)
Only the variable binding is hoisted (and only to `undefined`, or left in the TDZ if
declared with `let`/`const` — see Day 02). The function object itself is not created
until the assignment line actually executes. This is the single most common interview
trip-up: people assume "function" always means "hoisted," but it's the *declaration
form*, specifically, that gets full hoisting. A named function expression
(`const foo = function bar() {}`) also creates a second, expression-internal binding
`bar` that's only visible inside the function body itself — useful for self-recursion
without polluting the outer scope, and it's how you get a readable name in stack traces
when `foo` is reassigned elsewhere.

**Arrow Functions** (`const foo = () => {}`)
Arrow functions are expressions only — no declaration form exists. But the deeper
architectural difference is that an arrow function has **no `[[Construct]]` slot**, no
own `this`, no own `arguments` object, and no own `super` or `new.target` binding. When
the parser/interpreter resolves any of those four inside an arrow body, it doesn't
create a new binding — it walks up the **lexical scope chain** (the same mechanism that
resolves a free variable, per Day 03) and resolves to whatever the nearest enclosing
*non-arrow* function (or the global/module scope) has for that binding. Mechanically,
arrow functions never push a new "this/arguments/super" environment record; they are
transparent to those four bindings. That's also why `Function.prototype.bind/call/apply`
cannot change an arrow's `this` — there is no `this` slot on the arrow to overwrite, the
engine just ignores the first argument to `call`/`apply`/`bind` for arrows.

```
Call-site resolution trace for `this` inside an arrow:

  function Outer() {           // Outer has its own [[ThisMode]] = "global/dynamic"
    this.name = 'outer';
    return () => {             // arrow: [[ThisMode]] = "lexical" — no slot allocated
      console.log(this.name);  // engine looks up scope chain -> finds Outer's `this`
    };
  }
  const fn = new Outer();
  fn();                        // 'outer' — resolved at DEFINITION site, not call site
```

Hidden-class note: V8 does not give functions created as class methods or via arrow
syntax any special fast-path over regular functions purely because of syntax — the real
perf lever is monomorphic call sites and stable shapes of the objects you pass in/close
over, which is a Day 25/Day 08 topic. Don't let anyone tell you arrows are "faster";
they're not — they're *leaner in allocation* (no `arguments` object, no prototype
object, no separate `this` binding to set up), which matters in **hot loops called
millions of times**, not in ordinary application code.

## 🎯 Interview Talking Points

- "I treat function declarations as the default for anything that needs to be a named,
  top-level, hoisted unit of behavior — route handlers, utility functions — because
  hoisting lets me organize a file top-down (public API first, helpers below) without
  worrying about declaration order. I reserve function expressions for cases where the
  function is a value being passed around or conditionally assigned."
- "The `this`/`arguments` transparency of arrows is exactly why arrows are correct for
  callbacks nested inside methods (`this.items.map(x => this.transform(x))`) and exactly
  why they are wrong for object methods and prototype methods — I've seen a junior write
  `const obj = { value: 10, getValue: () => this.value }` and get `undefined` because the
  arrow captured `this` from the *module/global* scope, not from `obj`, since arrows are
  defined before `obj` even exists as a receiver."
- "I've debugged a production bug where a timer callback used `function` instead of an
  arrow inside a class method — `setTimeout(function() { this.stop(); }, 1000)` — and
  `this` was `undefined` (class bodies are strict mode) or the global object depending on
  environment. Converting it to an arrow fixed it because arrows don't rebind `this` on
  invocation; they keep the enclosing method's `this`."
- "Arrow functions can never be constructors — no `[[Construct]]`, so `new (() => {})()`
  throws `TypeError: ... is not a constructor`. If someone asks 'can I use an arrow as a
  class method shorthand to auto-bind `this`,' the honest answer is: yes, as a class
  *field* (`handleClick = () => {}`), and that's a legitimate, common pattern for React
  event handlers — but it costs you one function instance **per object instance** instead
  of one shared function on the prototype, which is a real memory trade-off at scale with
  thousands of instances."
- "Named function expressions (`const x = function self() {...}`) are underused — the
  inner name `self` lets you recurse safely even if someone reassigns the outer `x`
  variable later, and it shows up correctly in stack traces and the debugger instead of
  `<anonymous>`."
- Anticipate: *"If arrows don't have `arguments`, how do you accept variadic args in an
  arrow?"* — Answer: rest parameters, `(...args) => {...}`, which work identically in
  both forms and are the modern preferred way to do variadic args regardless of function
  type; I avoid the legacy `arguments` object entirely in new code.
- Anticipate: *"Is `function` hoisting ever dangerous?"* — Yes: when two declarations
  share a name, or when a `function` declaration sits inside a block in non-strict
  sloppy-mode code, browsers have historically disagreed on "annex B" semantics for
  block-scoped function hoisting; I always lint against relying on that edge case.

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Think of it like three ways to get a tool into your toolbox:

1. **Function declaration** = a tool that's already hanging on the wall the moment you
   walk into the workshop (your code file), because someone hung it up *before* the shop
   even opened (hoisting). You can grab it the instant you walk in, even before the line
   of code where it was "hung."
2. **Function expression** = a tool that's handed to you and placed in a drawer at the
   exact moment that line of code runs — you can't use it before that line executes.
3. **Arrow function** = like a function expression (same drawer rule), but it's a tool
   with **no handle of its own** — if you try to use "this" thing it's attached to, it
   just points at whatever "this" meant in the room it was built in, not the room you're
   currently standing in.

**Common traps:**
- *Trap 1:* "I'll just use an arrow for every method so I don't have to think about
  `this`." → Correction: arrows borrow `this` from their surroundings; on a plain object
  literal method, that "surrounding" is the outer scope, not the object — use a regular
  `function` (or method shorthand) for object/prototype methods, arrows for callbacks
  *inside* them.
- *Trap 2:* "Function declarations and expressions are basically the same thing with
  different syntax." → Correction: only declarations are fully hoisted with their body;
  calling an expression-based function before its assignment line throws or gives
  `undefined is not a function`.
- *Trap 3:* "Arrows are just shorter syntax, nothing else changes." → Correction: arrows
  structurally lack `this`, `arguments`, `super`, `new.target`, and `[[Construct]]` — it's
  a different kind of function object, not a shorthand for the same one.

## 💻 Hands-On Exercise

Open `script.js` and, before running it, predict the console output of each labeled
block. Pay special attention to Block 3 (the object-method arrow trap) and Block 4 (the
hoisting race) — write down your guess for each, then run `index.html` and compare.

**Expected answers (self-check):**

1. `declaredBefore()` logs `"I was hoisted!"` even though it's called before its textual
   definition — because function declarations are fully hoisted with their bodies during
   the creation phase, before any statement executes.
2. Calling `expressionBefore()` before its `const` line throws
   `ReferenceError: Cannot access 'expressionBefore' before initialization` — because
   `const` bindings are hoisted to the Temporal Dead Zone (Day 02), not initialized with
   the function until the assignment line runs.
3. `user.greetArrow()` logs `"Hello, undefined"` (or throws reading `.name` of
   `undefined` in strict mode) — the arrow's `this` is lexically bound to the module/
   global scope at the time the object literal was written, not to `user`, so
   `this.name` is not the user's name.
4. `user.greetRegular()` logs `"Hello, Ada"` — a regular method's `this` is bound
   dynamically at the call site (`user.greetRegular()` sets `this = user`).
5. `new ArrowCtor()` throws `TypeError: ArrowCtor is not a constructor` — arrows have no
   `[[Construct]]` internal method.
6. The `sum(...args)` call with 5 arguments correctly sums all of them via rest params,
   proving arrows get full variadic support without the legacy `arguments` object.
