# Day 01 Practice Log — Call Stack & Execution Context Deep Dive

A set of trace puzzles used to stress-test real understanding of the call stack and
execution contexts, beyond what the main README covers. Each one includes the question,
a clean model answer, and the common trap it's designed to expose — written so this can
double as material for explaining the concept to another developer.

---

## Puzzle 1 — The stack has a floor

```js
function countdown(n) {
  console.log(n);
  countdown(n - 1);
}

countdown(100000);
```

**Q: What happens, exactly?**
This throws a `RangeError: Maximum call stack size exceeded`. There's no base case, so
`countdown` never returns — every call pushes a brand-new frame on top of the last one.
The call stack is a small, fixed-size region of memory, *separate from the heap* —
cumulative frame size eventually exceeds that reserved region, and the engine throws.

**Q: Is this a heap / garbage-collection issue?**
No. The heap could have gigabytes free and this still throws at the same depth — the
stack and heap are independent memory regions with independent limits.

**Q: If wrapped in `try { countdown(100000); } catch (e) { ... }`, does the catch run?**
**Yes.** This is the most important trap in this puzzle: a stack-overflow `RangeError`
is a completely ordinary, catchable JavaScript exception — not an uncatchable crash the
way stack overflow is in some lower-level languages. `catch (e)` runs, and
`e.message` is `"Maximum call stack size exceeded"`.

**Q: Would more RAM fix it?**
No (in general). The stack size limit is a fixed reservation the *engine* makes per
thread (configurable in Node via `--stack-size`, but not "however much free RAM the OS
has"). The limit exists for safety/predictability, not because physical memory ran out.

> **Common trap:** assuming JS stack overflow is an unrecoverable crash like it can be in
> C/C++. It isn't — it's a normal, catchable `RangeError`.

---

## Puzzle 2 — Unwinding order

```js
function first() {
  try {
    second();
  } finally {
    console.log('first finally');
  }
}

function second() {
  try {
    third();
  } finally {
    console.log('second finally');
  }
}

function third() {
  throw new Error('boom');
}

try {
  first();
} catch (e) {
  console.log('caught in global:', e.message);
}
```

**Q: Exact output order?**
```
second finally
first finally
caught in global: boom
```

**Q: What does the call stack look like right before `third()` throws?**
```
| third()  |  <- top
| second() |
| first()  |
| GEC      |  <- bottom — always include this frame, it never leaves until the script ends
```

**Q: Why does `second finally` print before `first finally`?**
When `third()` throws, the engine doesn't teleport to the nearest `catch` — it **unwinds
frame by frame**, starting from the top. `third()`'s frame has nothing left to run, so it
pops immediately. As `second()`'s frame unwinds, its pending `finally` runs *before* that
frame is removed — hence `'second finally'`. Same for `first()` next. Only once both
frames are gone does the exception reach the global `try/catch`.

**Q: True or false — exceptions skip `finally` blocks on the way to the nearest `catch`?**
**False.** `finally` is JavaScript's guarantee that cleanup code runs no matter how a
`try` block exits — normal completion, early `return`, or a thrown exception. This is the
entire reason `try/finally` is useful for releasing locks, closing file handles/sockets,
or rolling back a transaction: that cleanup is guaranteed to run even on the error path.

> **Common trap:** forgetting the Global Execution Context (GEC) in stack diagrams — it's
> the permanent bottom frame, created when the script loads, and only pops when the whole
> program finishes.
>
> **Bonus gotcha:** a `finally` block can override everything — if it has its own
> `return`/`throw`, it *replaces* whatever the `try`/`catch` was about to do, silently
> swallowing the original exception. Generally considered a footgun; avoid `return`/`throw`
> inside `finally`.

---

## Puzzle 3 — The tail-call trap

```js
function sum(n, acc = 0) {
  if (n === 0) return acc;
  return sum(n - 1, acc + n); // the recursive call is the very last thing this function does
}

console.log(sum(100000));
```

### What is a tail call?

A **tail call** is when a function call is the *last action* another function performs —
its return value is handed straight back to the caller with **no pending work left**.

```js
function a() { return b(); }      // tail call — nothing left to do after b() returns
function a() { return b() + 1; }  // NOT a tail call — "+ 1" is pending work after b() returns
```

The test: *is there any computation left in the caller after the callee returns, before
the caller itself returns?* If yes → not a tail call.

### Why it matters: frame reuse

If a call is genuinely in tail position, the caller's frame is structurally dead weight —
an engine *could* legally reuse it for the callee's call instead of stacking a new one.
ES2015 formally permits this: **Proper Tail Calls (PTC)**, which would turn tail-recursive
functions into `O(1)` stack space, no matter the recursion depth.

### Does this code actually run safely in Node/Chrome?

**No — it throws the same `RangeError` as Puzzle 1.** The spec *permits* PTC, but **V8
never implemented it**. Only Safari's JavaScriptCore shipped an experimental version
around 2016, and it's not something to rely on as a dependable cross-browser guarantee
today. Writing "tail-recursive" JS does not protect you from stack overflow the way it
would in a language whose compiler actually implements TCO (e.g. Scheme).

### What does "V8 never implemented PTC" actually mean?

V8 **built and shipped an experimental version** of PTC around 2015–2016, then
**deliberately pulled it back out** before it reached stable Chrome/Node. The headline
reason: **debuggability**. If a frame is silently reused instead of pushed, that frame —
and the information about how execution got there — is just gone from stack traces,
making a deep recursive bug chain look like a single frame in the debugger. There's also
a subtler cost: an infinite tail-recursive bug (missing base case) would, with PTC, loop
forever *silently* instead of crashing loudly with a `RangeError` — arguably worse for
catching mistakes. A follow-up "Syntactic Tail Calls" proposal (requiring an explicit
opt-in keyword) stalled in committee and never shipped either.

**Practical fix for real deep recursion: trampolining** (see Puzzle 3C below) — convert
recursion into an explicit loop instead of relying on the engine.

> **Common trap:** confidently claiming "it's tail-recursive, V8 optimizes that away" in
> an interview. This exposes the gap between *"the spec allows X"* and *"the engine I
> actually ship to does X"* — exactly the kind of assumption that causes production
> incidents when someone "optimizes" a hot path assuming TCO kicks in.

---

## Puzzle 3B — Mutual tail recursion

```js
'use strict';

function isEven(n) {
  if (n === 0) return true;
  return isOdd(n - 1);
}

function isOdd(n) {
  if (n === 0) return false;
  return isEven(n - 1);
}

console.log(isEven(100000));
```

**Q: Is `return isOdd(n - 1);` in tail position?**
**Yes.** Apply the same mechanical test: is there anything left to do in `isEven` after
`isOdd` returns? No — the value flows straight back up. Tail position is a property of
**where a call sits in the code**, decided by reading the code — not by the runtime value
of `n`, and not by whether the recursion is "self" or "mutual."

**Q: Does `'use strict'` change what happens in Node?**
**No.** Strict mode is a *precondition* for PTC eligibility per spec — it doesn't *cause*
PTC to happen. V8 doesn't implement the optimization at all, strict mode or not, so this
still grows the stack by one frame per call.

**Q: What actually happens when this runs?**
It throws `RangeError: Maximum call stack size exceeded` — **despite having a correct
base case.** This is an important distinction: a base case prevents *infinite* recursion
(guarantees termination eventually, given unlimited stack), but it does **not** prevent
*stack overflow*, because the base case is only reached after 100,000 nested frames — far
beyond V8's default stack budget (roughly 10,000–15,000 frames, depending on frame size).

**Q: Does mutual recursion (two different functions) vs. self-recursion change tail-call
eligibility?**
**No, not at all.** "Tail position" has zero awareness of *which* function is being
called — same function, different function, recursive or not, it's irrelevant. A plain
`return someUtilityFunction();` to a completely unrelated function is just as much a tail
call as `return isOdd(n-1);`.

> **Common trap:** assuming "Safari supports PTC" is a dependable, current fact to design
> around. Even where an engine once shipped an experimental implementation, treat **no
> major engine you ship to today as reliably implementing PTC** — don't write code that
> silently depends on it.

---

## Puzzle 3C — Spot the bug (debugging a broken trampoline)

```js
function sum(n, acc = 0) {
  if (n === 0) return acc;
  return () => sum(n - 1, acc + n); // returns a thunk instead of calling directly
}

function trampoline(fn) {
  let result = fn();
  return result;
}

console.log(trampoline(() => sum(5)));
```

**Q: What does this actually print?**
A **function**, not the number `15`. `trampoline` calls `fn()` exactly once, getting back
the *next* thunk (`() => sum(4, 5)`), then immediately returns it without checking
whether the result still needs driving further. (Exact printed representation is
environment-dependent: plain Node `console.log` shows `[Function (anonymous)]`; a browser
console, or this course's own sandbox pages — which log via `String(arg)`, and
`String()` on a function calls `.toString()` — would show the function's literal source
text instead.)

**Q: The fix:**
```js
function trampoline(fn) {
  while (typeof fn === 'function') {
    fn = fn();
  }
  return fn;
}
```
Keeps calling as long as the result is still a function (a thunk needing another step),
only returning once it gets back a plain value. Trace: `() => sum(5)` → `sum(4,5)`'s thunk
→ ... → `sum(0, 15)` returns the number `15` (not a function) → loop exits → `15`.

**Q: If someone calls `sum(100000)` directly, with no trampoline — does it overflow?**
**No — and this is the real insight.** `sum` no longer *recurses* at all. Its body is
`return () => sum(n - 1, acc + n);` — that's not a call to `sum`, it's the **creation** of
a function that, if invoked, would call `sum`. So `sum(100000)` runs its body once,
creates one thunk, and returns immediately. Zero recursive calls happen without something
external (the `trampoline` loop) actually driving it forward.

**The whole mechanism of trampolining in one sentence:** you're not avoiding stack
overflow by making the engine smarter about tail calls — you're avoiding it by rewriting
the function so it no longer recurses at all, moving the "keep going" logic into an
explicit loop instead.

---

## What does `'use strict'` actually do?

ES5's opt-in fix for a handful of early JS design mistakes that couldn't be changed by
default without breaking the entire existing web. Modules and class bodies get it
automatically; everything else needs the literal directive as the first line of a file or
function. Key behavior changes:

- Assigning to an undeclared variable **throws** `ReferenceError` instead of silently
  creating a global (the single highest-value one — catches typo bugs immediately).
- `this` inside a plain function call (no explicit receiver) is `undefined`, not the
  global object — directly relevant to Day 5 (`this` binding).
- Assignments that would otherwise fail silently (writing to a frozen object, a
  getter-only property) now throw `TypeError`.
- Duplicate parameter names (`function f(a, a) {}`) are a `SyntaxError`.
- The `with` statement is banned entirely.
- `eval` gets its own scope — can't leak variables into the caller's scope.
- Legacy octal literals (`010`) are banned; `0o10` is required instead.
- `arguments.callee` / `arguments.caller` throw if accessed.
- **Proper Tail Calls only apply in strict-mode functions** per spec (though moot in
  practice since V8 doesn't implement PTC at all — see Puzzle 3).

**One-liner:** things that used to fail silently now throw immediately at the point of
the mistake, instead of corrupting state somewhere downstream — the same philosophy as
the Temporal Dead Zone for `let`/`const` (Day 2).

---

## Final Round — Argument evaluation & execution-context internals

### Part 1 — Evaluation order inside a compound call

```js
let callOrder = [];

function log(label) {
  callOrder.push(label);
  return label;
}

function combine(a, b, c) {
  return `${a}-${b}-${c}`;
}

const result = combine(log('A'), log('B'), log('C'));
```

**Q: What's in `callOrder`, and what's the evaluation order rule?**
`['A', 'B', 'C']`. JavaScript's argument-evaluation order is **specified** as strictly
left-to-right — not engine-dependent.

**Q: At the exact moment `log('B')` is executing, what's on the call stack?**
```
| log('B') |
| GEC      |
```
**Nothing else — `combine` is NOT on the stack yet.** This is the core trap: a function
call can't actually happen until every one of its argument *expressions* is fully
evaluated to a concrete value first — you can't bind parameters to values you don't have.
Evaluating `log('B')` is itself one of those argument expressions, still being resolved
*before* `combine` is ever invoked.

**Q: When does `combine`'s own execution context get created?**
**Only after ALL three arguments have fully completed** — `log('A')` (full push → run →
return → pop), then `log('B')` (same), then `log('C')` (same). Only once concrete values
`'A'`, `'B'`, `'C'` exist does the engine create `combine`'s execution context, bind the
parameters, and run its body. **The general rule: a function's execution context can't
exist until its parameters have known values to bind to — and getting those values is
exactly what evaluating the argument expressions accomplishes.**

> **Common trap:** assuming the outer call's frame is already on the stack while its
> arguments are still being evaluated. It's the reverse — the outer call is always the
> *last* frame to appear, even though it's written *first* in the source.

### Part 2 — Do repeated calls share an execution context?

```js
function bump(start) {
  let current = start;
  current = current + 1;
  return current;
}

console.log(bump(10)); // 11
console.log(bump(10)); // 11
```

**Q: New context each time, or could the engine reuse one?**
**Always a brand-new execution context per call.** If they were somehow shared, the
second call would start from whatever `current` was left at by the first call (`11`)
instead of fresh-binding from its own argument — producing `11` then `12`, not `11`
twice. **This isolation is the exact mechanism that makes recursion possible at all** —
every recursive call needs its own private copy of its locals (like `n`/`acc` in the
`sum` puzzles above), or calls would stomp on each other's state.

### Part 3 — Execution context vs. stack frame (terminology precision)

Often used interchangeably — fine for casual explanation — but technically distinct:

- **Execution context**: a *spec-level* abstraction (ECMA-262) bundling the Variable
  Environment (`var`/function bindings), Lexical Environment (`let`/`const` + scope
  chain), and the `this` binding. Defined independent of how any engine implements it.
- **Stack frame**: the engine's *actual runtime memory structure* implementing the call
  stack — holding the return address, saved state, local storage, typically pointing at
  the execution context's data.

The spec itself describes execution contexts as pushed onto / popped from an "execution
context stack," which is exactly why the two terms blur together so often. If pushed on
this in an interview: *"execution context is the spec-level abstraction of what state is
needed to run this code; stack frame is the engine's concrete memory implementation of
that, and V8 doesn't guarantee a strict 1:1 mapping once optimizations like inlining are
involved."*

---

## Round 2 — Nested call argument evaluation (confidence round)

```js
let trace = [];

function mark(label) {
  trace.push(label);
  return label;
}

function nested() {
  mark('nested-enter');
  const v = mark('nested-value');
  mark('nested-exit');
  return v;
}

function build(x, y, z) {
  mark('build-body');
  return `${x}|${y}|${z}`;
}

const output = build(mark('X'), nested(), mark('Z'));
```

**Q: Full contents of `trace`, in order?**
```
['X', 'nested-enter', 'nested-value', 'nested-exit', 'Z', 'build-body']
```
Easy to under-trace here: after all three arguments resolve, **`build`'s own body still
runs** and logs `'build-body'` — it isn't "done" just because its arguments are ready.
`output` ends up `"X|nested-value|Z"` (`nested()` returns `v`, i.e. `'nested-value'`).

**Q: At the moment `mark('nested-value')` is executing, what's the full stack?**
```
| mark('nested-value') |  <- top, currently executing
| nested()             |
| GEC                  |
```
**Rule to internalize: "at the moment X is executing" always means X's own frame is the
top of the stack at that instant** — that's definitional, not something to re-derive each
time. (`mark('nested-enter')` has already fully popped by this point — that part's easy.)

**Q: Method-call variant — `obj.build(mark('X'), mark('Y'))` — does resolving `obj.build`
happen before or after evaluating the arguments? Does it change the trace order?**
`obj.build` (which function will be called, and what `this` will be bound to) is resolved
**before** the argument list is evaluated. It does **not** change the trace order here —
resolving a plain property has no side effects, so `mark('X')` then `mark('Y')` still fire
in that order. (If `obj.build` were a *getter* instead of a plain property, resolving it
could have side effects and would genuinely change the trace — worth flagging proactively
if it's relevant.)

---

## Quick-reference: rules to internalize

- Arguments are evaluated strictly **left-to-right**, each one fully completing
  (push → run → return → pop) before the next one starts.
- A callee's own execution context is created **only after** all of its arguments have
  been fully evaluated — even though it's written first in the source.
- "At the moment X is executing" always means **X's frame is on top of the stack** —
  never omit it.
- A stack-overflow `RangeError` is an **ordinary, catchable** exception in JS — not an
  uncatchable crash.
- `finally` blocks run **during unwind**, before the exception reaches any enclosing
  `catch` — never skipped. The Global Execution Context is the permanent bottom frame;
  always include it in stack diagrams.
- A base case prevents **infinite** recursion, not **stack overflow** — depth alone can
  still exceed the stack's reserved budget even with a correct base case.
- Tail position is a **structural/syntactic** property of code (last action, nothing
  pending after) — unrelated to the called function's identity, or self- vs.
  mutual-recursion.
- **V8/Node never implemented Proper Tail Calls**, despite the spec permitting it — never
  assume TCO protects you in production JavaScript.
- **Trampolining** converts recursion into an explicit loop to get real `O(1)` stack usage
  when deep recursion is genuinely unavoidable.
- Execution context (spec-level: Variable/Lexical Environment + `this` binding) and stack
  frame (engine's physical call-stack memory) are related but technically distinct —
  interchangeable in casual use, worth separating if an interviewer pushes on it.
