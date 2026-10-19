# Day 02: Hoisting, var vs let vs const, and the Temporal Dead Zone

## 🧠 Core Architectural Concept

Hoisting is not "JavaScript moves your declarations to the top of the file." That's the folk explanation and it's close enough to be dangerous. What actually happens, continuing directly from Day 01's two-phase execution context creation: during the **creation phase**, before any line of your code actually executes, V8 scans the current scope and registers every declaration it finds — `var`, `let`, `const`, `function`, and `class` — into that scope's environment record. The difference between them is entirely about **what value they're given at that moment** and **when they become accessible**:

- **`var`** declarations are registered *and* initialized to `undefined` immediately in the creation phase. This is why reading a `var` before its line of code runs doesn't throw — you get `undefined`, not an error. `var` is also **function-scoped** (or global-scoped), not block-scoped — a `var` inside an `if` block or `for` loop is hoisted all the way to the nearest enclosing function (or global scope).
- **`let` and `const`** declarations are also registered in the creation phase (they ARE hoisted — this is a common interview trap, people say "let isn't hoisted," which is wrong), but they are left in an **uninitialized binding state**. The spec calls this the binding's status in the **Temporal Dead Zone (TDZ)**. Any attempt to read or write the variable while it's in this state throws a `ReferenceError: Cannot access 'x' before initialization` — a *distinct* error from "undefined variable," and interviewers who know the material will notice if you call it the same thing. The TDZ for a given variable ends exactly at the line where its `let`/`const` declaration statement actually executes.
- **`function` declarations** are fully hoisted, body and all — they're registered in the creation phase with the actual function object as their value, which is why you can call a function declaration before the line it's written on.
- **`class` declarations** behave like `let`/`const`: hoisted but TDZ-locked. You cannot reference a class before its declaration line executes, even though under the hood a class is "just a function" with a prototype — that TDZ protection is a deliberate spec decision to prevent classes from being used before their (often side-effecting, via static blocks/fields) initialization completes.

**Why does the TDZ exist at all?** It's not an engine limitation — it's a deliberate design decision for two real reasons: (1) it stops a class of real bugs where code "looks like" it's reading a value from an outer scope when it's actually about to be shadowed by a lower `let`, and (2) it's what makes `const` meaningfully "constant" — the binding isn't usable until the single point where it's assigned, so you can never observe a `const` in a semi-initialized state. If `let`/`const` behaved like `var` (silently `undefined` until their line ran), that silent `undefined` would frequently get used by accident in loops or conditionals and cause hard-to-trace logic bugs instead of a loud, immediate, and precisely-located `ReferenceError`.

Ordered trace of what the engine does for this snippet:
```js
console.log(a); // ?
console.log(b); // ?
var a = 1;
let b = 2;
```
```
CREATION PHASE (before line 1 runs):
  - scope scans the whole block
  - `a` (var)  -> registered, initialized to undefined
  - `b` (let)  -> registered, left UNINITIALIZED (in TDZ)

EXECUTION PHASE:
  line 1: console.log(a)   -> prints undefined (a exists, is undefined)
  line 2: console.log(b)   -> THROWS ReferenceError (b is in TDZ)
  -- execution halts here, lines 3-4 never run in this example --
```

One more mechanical nuance worth knowing cold: **function-scoping vs block-scoping** is a V8 environment-record detail, not just a style rule. A `var` inside a `for` loop body creates ONE binding shared across every iteration (it lives in the function's Variable Environment). A `let` inside a `for` loop header creates a **fresh binding for every single iteration** — V8 literally creates a new Lexical Environment per loop iteration for `let`-declared loop variables. That mechanical difference is the entire reason the classic "closures in a loop" bug (Day 04) behaves differently with `var` vs `let`.

## 🎯 Interview Talking Points

- "People will tell you `let` and `const` 'aren't hoisted.' I correct that precisely: they ARE hoisted — registered in the environment record during the creation phase — they're just left uninitialized, which is the TDZ. If you say 'not hoisted' in an interview, a strong interviewer will push on that, and you want to be the one who volunteers the nuance first."
- "I've seen a production bug where a developer wrote a module-level `let config` that got assigned later via an async IIFE, and a sibling function, invoked by an event listener that could theoretically fire during that async gap, tried to read `config` before it resolved. It didn't throw — because by the time any event could fire, the microtask assigning `config` had already run. But it was a landmine: if that initialization had been even one tick slower, it would've thrown a TDZ ReferenceError in production. The fix was making the dependency explicit — passing config in, not closing over a maybe-not-yet-initialized module-level binding."
- "Trade-off I bring up proactively: `var`'s function-scoping and silent-`undefined` hoisting feels 'safer' in the sense that it never throws — but that's exactly the problem. It trades a loud, early, precise error for a silent `undefined` that then propagates through your logic and surfaces as a confusing bug three function calls later. `let`/`const` fail fast and fail at the right line."
- "I always mention the per-iteration binding behavior of `let` in loops — it's not just trivia, it's *the* mechanism that makes `for (let i ...) { setTimeout(() => console.log(i)) }` print 0,1,2,3,4 instead of 5,5,5,5,5 the way the equivalent `var` version does. If I'm asked to explain that classic bug, I go straight to 'each `let` iteration gets its own lexical environment record' rather than hand-waving about 'closures capturing the final value.'"
- "On `const`: I'm careful to say it makes the *binding* immutable, not the *value*. `const obj = {}` still lets you mutate `obj.x = 1` — what you can't do is reassign `obj` itself. I've had to correct teammates' code review comments that assumed `const` meant deep immutability; it doesn't, and conflating the two is a real source of bugs when people assume a `const`-declared array or object can't change out from under them."
- Anticipated follow-up: *"If let/const are hoisted and registered during the creation phase, why can't I just... not initialize them and get undefined like var?"* — Answer: because the spec defines the binding's lifecycle state explicitly as "uninitialized" until its declaration statement executes, and any access in that state is defined to throw. It's not an oversight that it doesn't fall back to `undefined` — allowing that fallback was the exact class of bug (reading a value too early and getting a masquerading `undefined`) that `let`/`const` were introduced to eliminate.

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Imagine the engine reads through your code TWICE. The first pass (before anything actually runs) it's just making a guest list — writing down every name (`var`, `let`, `const`, `function`) it sees, reserving a spot for each. For `var` names, it writes "value: undefined" on the list right away. For `let`/`const` names, it writes the name down but leaves the value box literally empty and roped off — you can see the name is on the list, but you're not allowed to touch it yet. That roped-off period is called the **Temporal Dead Zone** — "temporal" because it's about *time* (before vs after the declaration line runs), not about *where* the code is physically written.

The second pass is the engine actually running your code top to bottom for real, and the rope comes down for a `let`/`const` the instant its line executes.

**Common traps:**
1. **"`let` and `const` don't get hoisted, only `var` does."** — Wrong; all of them get registered up front. The difference is `let`/`const` stay locked (TDZ) until their line runs. Correction: *say "hoisted but uninitialized," not "not hoisted."*
2. **"I got `undefined`, so the variable must not exist yet."** — With `var`, `undefined` just means "exists, no value assigned yet" — it does NOT mean "doesn't exist." Correction: *`undefined` is a real, assigned value; it is not the same as "not declared."*
3. **"`const` means the value can never change."** — Only the *binding* (the variable name pointing to a thing) is locked. If that thing is an object or array, its contents are still fully mutable. Correction: *`const` locks the box, not what's inside it.*

## 💻 Hands-On Exercise

Predict the exact console output (including whether anything throws, and if so, where execution stops) for the code in `script.js`'s section 3 (`tdzDemo`) before running it.

```js
function tdzDemo() {
  console.log(typeof hoistedVar);  // ?
  console.log(hoistedVar);         // ?
  console.log(lockedLet);          // ? (does this even run?)
  var hoistedVar = 'assigned';
  let lockedLet = 'also assigned';
}
tdzDemo();
```

**Expected answer:**
```
undefined
undefined
Uncaught ReferenceError: Cannot access 'lockedLet' before initialization
```
Why: `hoistedVar` (a `var`) is registered and initialized to `undefined` in the creation phase, so both `typeof hoistedVar` and `hoistedVar` itself safely print `undefined` — `typeof` on a declared-but-unassigned `var` is simply `"undefined"`, same as the value. `lockedLet` (a `let`) IS registered in the creation phase too, but its binding is uninitialized — it is sitting in the TDZ — so the very attempt to read it throws immediately, and execution halts right there; the two assignment lines below never run, and the function never returns normally.
