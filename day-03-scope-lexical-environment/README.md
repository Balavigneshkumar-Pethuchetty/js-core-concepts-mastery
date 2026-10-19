# Day 03: Scope, the Scope Chain & Lexical Environment Records

## 🧠 Core Architectural Concept

Every Execution Context (Day 01) owns a **Lexical Environment** — a data structure with two parts: an **Environment Record** (the actual storage: a map from identifier names to their bound values/bindings) and a **reference to the outer environment**, often called `[[OuterEnv]]`. That outer reference is not optional plumbing — it is the entire mechanism behind "scope." When code tries to resolve an identifier (say, reading a variable `x`), the engine performs **identifier resolution**: look in the current environment record; found it? use it. Not found? follow `[[OuterEnv]]` to the parent environment and repeat. This walk, environment by environment, up to the Global Environment, is the **scope chain**, and it terminates in one of two ways: a binding is found, or you reach the top with nothing found and get a `ReferenceError`.

The critical word is **lexical**. The outer environment reference is fixed at the moment a function is *defined* (where it sits in the source code, textually nested), not at the moment it is *called*. This is why JS is **lexically scoped** rather than **dynamically scoped**: if function `inner` is defined inside function `outer`, `inner`'s `[[OuterEnv]]` permanently points to `outer`'s Lexical Environment, regardless of who calls `inner` or from where. Contrast this directly with `this` (Day 05), which IS resolved dynamically, based on the call site — that asymmetry (lexical scope vs dynamic `this`) is one of the most commonly confused pairs in JS and a favorite "do you actually get this" interview wedge.

Concretely, there are a small number of environment-record-creating constructs you should be able to name on command:
- **Global Environment** — created once per realm (tab/worker/Node process), holds global `var`/function declarations and (in a separate "declarative record" since ES6) global `let`/`const`/`class`.
- **Function Environment** — created fresh every function *call* (ties back to Day 01), holds parameters, `var`s, inner function declarations, and an `arguments` object for regular functions.
- **Block Environment** — created for every `{ }` block that contains a `let`, `const`, or `class` (an `if`, `for`, `while`, or bare block). `var` ignores these entirely; it only ever lives in the nearest Function or Global Environment. A `for (let i...)` loop additionally creates a **new** block environment per iteration (the TDZ/per-iteration-binding mechanic from Day 02 is literally this).
- **Module Environment** — one per ES module file, sits between the module's top-level code and the Global Environment.

Ordered trace, showing the scope chain being WALKED (not re-created) at resolution time:

```js
let outerVar = 'from outer';

function outer() {
  let outerLocal = 'local to outer';

  function inner() {
    console.log(outerLocal); // resolve: not in inner's env -> walk to outer's env -> found
    console.log(outerVar);   // resolve: not in inner's env -> not in outer's env -> walk to Global -> found
  }

  inner();
}

outer();
```
```
inner's Lexical Environment:  { } ---[[OuterEnv]]---> outer's Lexical Environment: { outerLocal } ---[[OuterEnv]]---> Global Environment: { outerVar, outer }
```

Why this is the enabling mechanism for closures (full depth Day 04): because `[[OuterEnv]]` is a **reference**, not a copy, `inner` doesn't get a snapshot of `outerLocal`'s value at definition time — it holds a live pointer to `outer`'s actual environment record. If `outer` returned `inner` as a value and `outer`'s own execution context then got popped off the call stack, the *execution context* is gone, but its **Lexical Environment object is not garbage collected**, because `inner`'s `[[OuterEnv]]` still references it, and GC (Day 12) only reclaims what's unreachable. That's the whole trick, and it's purely a consequence of scope-chain mechanics, not some separate "closure feature" bolted on.

One more nuance that separates a solid answer from a great one: the scope chain is about **where code is written**, and it's fully determined at parse time — V8 can, and does, statically analyze most of this chain during compilation (which is part of why property/variable access can be optimized so aggressively). This is different from, say, Python's dynamic `globals()`/`locals()` mutability — JS gives you no supported way to reach into an arbitrary outer scope and add a variable to it at runtime (the deprecated, non-strict-mode `with` statement tried to blur this and is exactly why it's banned in strict mode and modules).

## 🎯 Interview Talking Points

- "I always draw the distinction explicitly: scope is lexical (fixed at write-time, by nesting), `this` is dynamic (fixed at call-time, by how you invoked the function). I've watched candidates lose points by describing `this` as if it followed scope rules — it doesn't, and conflating them is one of the fastest tells that someone has memorized examples rather than the mechanism."
- "I've debugged a bug where a teammate assumed 'lexical scope' meant 'scope determined by call stack depth' — they had a deeply nested callback and expected it to see a variable from the function that *invoked* it, not the function it was *defined inside*. It compiled fine, ran fine, and silently resolved to a totally different same-named variable three scopes up, because that's where it was lexically nested. No error, just wrong behavior — the nastiest kind of bug."
- "Trade-off/design note I bring up: lexical scoping being statically determinable is a deliberate performance and predictability choice. It's why engines can pre-resolve most variable lookups into fast slot references instead of doing a runtime dictionary walk every time — V8's inline caches and hidden classes (you'll hear this again around prototypes, Day 07) lean on the fact that scope structure doesn't change at runtime the way, say, object shape can."
- "If asked 'what's the difference between scope and context,' I keep it crisp: scope answers 'which variables can this code see,' resolved via the lexical environment chain; context (`this`) answers 'what object is this code executing on behalf of,' resolved via the call site. Two completely separate resolution mechanisms that happen to both be properties of an execution context."
- "I'll proactively bring up `with` and global implicit variable creation (assigning to an undeclared bare name in non-strict mode leaks it onto the global object) as examples of scope resolution gone wrong by design, and why strict mode / modules close both holes — it signals I know the historical warts, not just the clean modern mental model."
- Anticipated follow-up: *"Does the scope chain get walked at runtime on every single variable access — isn't that slow?"* — Answer: conceptually yes, that's the model, but V8 doesn't naively walk a chain of hash maps every time. Because scope is statically known at compile time, Ignition/TurboFan can resolve most variable references to fixed slot indices in a function's context ahead of time; the "walk the chain" mental model is correct for *reasoning about resolution*, but the actual runtime cost is heavily optimized away for the common case.

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Think of scope like a kid looking for a word in a dictionary, except the dictionary has a cover page that says "if it's not in here, check THIS other dictionary," and that one has its own cover page pointing to yet another. When your code asks "what is `x`?", it checks its own dictionary first. Not there? It follows the pointer on the cover to the next dictionary out. It keeps doing that until it either finds `x` or runs out of dictionaries — and if it runs out, that's a `ReferenceError`.

The important part: which dictionary a function's cover page points to is decided the moment you **write** the function, based on where it sits in your code — not decided later by who happens to call it. That's what "lexical" means.

**Common traps:**
1. **"This function can see whatever variables exist wherever it gets called from."** — No. It can only see variables from where it was *written* (its nesting), never from the caller's scope. Correction: *scope is about where you wrote it, not who called it.*
2. **"Blocks (`if`, `for`) don't create new scope, only functions do."** — True for `var`, false for `let`/`const`. Every `{ }` with a `let`/`const`/`class` inside it creates its own block scope. Correction: *`var` only respects function boundaries; `let`/`const` respect block boundaries too.*
3. **"If I can't find a variable, JS will just make a global one for me, no harm done."** — In non-strict mode, assigning to an undeclared bare name silently creates a global — a classic source of typo bugs ( `nmae = 'Sam'` instead of `name = 'Sam'`). Correction: *always use strict mode (or modules, which are strict by default) so that mistake throws instead of silently polluting global scope.*

## 💻 Hands-On Exercise

Predict the output of the scope-shadowing trace in `script.js`'s section 3, then explain in one sentence why the inner `console.log` in `shadowDemo` does NOT see the outer `level` variable.

```js
let level = 'outer';

function shadowDemo() {
  console.log(level); // ? -- careful, this is a trap
  let level = 'inner';
  console.log(level); // ?
}
shadowDemo();
```

**Expected answer:**
```
Uncaught ReferenceError: Cannot access 'level' before initialization
```
(the second `console.log` never runs)

Why: this looks like it should print `'outer'` on the first line (falling through to the outer `level` since the inner one "hasn't been assigned yet"), but it does NOT — because `shadowDemo` has its own `let level` declared anywhere in its body, that name is hoisted (registered, TDZ-locked) for the **entire function scope** from the top of the function. The inner declaration **shadows** the outer variable for the whole function body, including lines before the `let` statement textually appears. So the first `console.log(level)` resolves to the *inner*, not-yet-initialized `level` — still in its own TDZ — and throws, rather than politely falling back to the outer one.
