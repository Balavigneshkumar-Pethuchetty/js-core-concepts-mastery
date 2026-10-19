# Day 01: Execution Context, Call Stack & Stack Frames

## 🧠 Core Architectural Concept

Every time JavaScript runs *any* code, it does so inside an **Execution Context (EC)** — a container object the engine creates that holds everything a chunk of code needs to run: its variable bindings, the value of `this`, a reference to the outer (parent) scope, and the line it's currently executing. There are three kinds you'll actually deal with: the **Global Execution Context** (created once, when the file/script first loads), **Function Execution Contexts** (one created *every single time* any function is invoked — not once per function definition, once per *call*), and **Eval Execution Context** (rare, created by `eval()`, mostly irrelevant in modern code but worth knowing exists).

Under the hood (V8, specifically), an execution context creation happens in two distinct phases, and this two-phase split is *the* reason hoisting exists and behaves the way it does:

1. **Creation phase (a.k.a. "memory creation" / compile phase):** V8's parser walks the code and creates the **Variable Environment** and **Lexical Environment** records before a single line executes. `var` declarations and function declarations are allocated memory and initialized — `var` gets set to `undefined`, function declarations get fully hoisted with their body attached. `let`/`const` are also registered in this phase but left in an **uninitialized** state (this is the TDZ — full depth on Day 02). The `this` binding is also resolved in this phase, based on how the function was called.
2. **Execution phase:** The engine now runs line by line, assigning real values to variables, executing statements, and — critically — whenever it hits a function *call* (not a definition), it creates a brand-new Execution Context for that call and **pushes it onto the Call Stack**.

The **Call Stack** is a LIFO (last-in-first-out) data structure — literally a stack of these execution context records. The bottom frame is always the Global Execution Context. Every function call pushes a new frame on top; when that function returns (explicitly via `return`, or implicitly by reaching the end of its body), its frame is **popped off**, and control resumes at the frame now exposed underneath — exactly where the call happened.

```
Call Stack (grows upward, LIFO)

  |  thirdFunction()  EC  |   <- currently executing (top of stack)
  |  secondFunction() EC  |
  |  firstFunction()  EC  |
  |  Global EC             |   <- always at the bottom
  -------------------------
```

Trace through `firstFunction()` calling `secondFunction()` calling `thirdFunction()`:

```
1. Global EC created, pushed.                         Stack: [Global]
2. firstFunction() called -> new EC created, pushed.  Stack: [Global, first]
3. Inside first, secondFunction() called -> pushed.   Stack: [Global, first, second]
4. Inside second, thirdFunction() called -> pushed.   Stack: [Global, first, second, third]
5. third finishes, returns -> popped.                 Stack: [Global, first, second]
6. second finishes, returns -> popped.                Stack: [Global, first]
7. first finishes, returns -> popped.                 Stack: [Global]
```

Each stack frame is a small, fixed-ish chunk of memory. This is why **Stack Overflow** happens: every recursive call (or mutually recursive call chain) pushes another frame, and the stack has a hard size limit (engine- and platform-dependent — commonly a few thousand to ~10-15k frames in V8 depending on frame size, roughly ~1MB of stack space by default in V8/Node unless you bump `--stack-size`). A `RangeError: Maximum call stack size exceeded` is literally the engine telling you "I ran out of memory reserved for stack frames" — it is *not* related to heap memory or garbage collection at all; that's a separate, much larger memory region.

One more mechanical detail that matters at the staff level: V8 doesn't run your code by direct interpretation of the AST forever. The **Ignition** interpreter first turns your function into bytecode and executes that (cheap to start, no long compile delay). If a function gets called enough times ("hot"), **TurboFan**, V8's optimizing JIT compiler, kicks in and compiles it down to optimized machine code with assumptions baked in (e.g., "this argument is always a number"). If those assumptions are later violated, TurboFan **deoptimizes** back to bytecode. This doesn't change the call-stack model conceptually, but it explains why a function can be fast for 10,000 calls and then suddenly slow down — a deopt just happened, usually because of a shape/type change.

## 🎯 Interview Talking Points

- "I think about the call stack as the thing that gives JS synchronous execution its *determinism* — at any instant, there is exactly one frame executing, and I can always answer 'what called this?' by reading the stack downward. That's what a stack trace literally is: a snapshot of that structure at the moment of a thrown error."
- "I've debugged a production stack overflow that wasn't an obvious infinite recursion — it was a recursive tree-serialization function walking a cyclic object graph that *should* have been a DAG, but a bug in an upstream service occasionally produced a cycle. The fix wasn't 'add a base case,' it was adding a visited-set guard, because the recursion itself was correct — the *input* violated the function's invariant."
- "Trade-off I always bring up: recursion is often the clearest way to express a solution (tree traversal, divide-and-conquer), but JS, unlike some languages, does not reliably guarantee tail-call optimization in production engines — ES6 specified proper tail calls, but V8 never shipped it for compatibility/debuggability reasons. So for genuinely deep recursion (large trees, big N), I'll convert to an explicit iterative approach with my own stack (an array), or trampolining, rather than trust the engine to collapse the frames."
- "Every function *call* gets its own execution context, not every function *definition*. This trips people up with recursion — `factorial(5)` creates five separate execution contexts, each with its own `n`, all alive on the stack simultaneously until they start popping off as base cases resolve."
- "If someone asks 'does an execution context include the call stack,' I correct the framing: the execution context is the *frame*; the call stack is the *structure holding* the frames. They often get used interchangeably in casual speech but they're not the same thing, and an interviewer testing precision will note if you conflate them."
- Anticipated follow-up: *"Why doesn't V8 just give every script an unlimited stack?"* — Answer: stack memory is allocated contiguously and cheaply managed with simple pointer bumps (push/pop), which is what makes function calls fast; that speed comes from the size being bounded and reserved upfront. An unbounded or heap-allocated stack would make every call slower and risk silently consuming all available memory from a runaway bug instead of failing fast with a clear `RangeError`.

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Think of the call stack like a stack of plates at a buffet. Every time a function gets called, you put a new plate on top. Whatever's on the very top plate is the thing currently running. When that function finishes, you take its plate off, and now you can see — and you go back to — whatever was running underneath it, right where it left off.

Each "plate" (execution context) carries its own little notebook: its own local variables, and a note about what `this` means in that function, and a pointer back to "where do I look if I can't find a variable in my own notebook" (its outer scope).

**Common traps:**
1. **"I called the function, so it should run its code immediately, right?"** — Usually yes for synchronous code, but if it's inside a callback, promise, or timer, it doesn't go on the stack *now* — it gets scheduled and placed on the stack later, after the current stack fully empties. (Full mechanics on Day 15.) Correction: *the call stack only ever holds synchronous, currently-running work.*
2. **"Infinite recursion just makes my function run forever."** — No: it crashes fast with a stack overflow, because the stack has a hard, fairly small size limit. Correction: *recursion without a reachable base case isn't "slow," it's a guaranteed crash, usually within milliseconds.*
3. **"A stack trace is random/unordered."** — It's not; it's literally the call stack printed top-to-bottom at the moment of the error, so it tells you the exact chain of calls that got you there. Correction: *read a stack trace as "most recent call at the top, read downward to see who-called-who."*

## 💻 Hands-On Exercise

Open `script.js` alongside this file (or run it via `index.html`). Before running it, trace through `traceA`, `traceB`, and `traceC` by hand and predict the exact order of the `console.log` "ENTER" / "EXIT" lines, then predict what happens when `recurseForever()` is called.

**Task:** Without running the code, write out the full sequence of ENTER/EXIT log lines for the `traceA -> traceB -> traceC` chain, and state in one sentence why `recurseForever()` throws rather than hangs.

**Expected answer:**
```
ENTER traceA
ENTER traceB
ENTER traceC
EXIT traceC
EXIT traceB
EXIT traceA
```
Why: each function fully completes (including every nested call it makes) before it returns and gets popped — that's the LIFO property. `traceC` is called last (pushed last) so it finishes first and is the first to log EXIT; `traceA` is called first (pushed first, sits at the bottom above Global) so it's the last to finish and the last to log EXIT.

For `recurseForever()`: it throws a `RangeError: Maximum call stack size exceeded` rather than hanging, because each call pushes a new, real execution context frame consuming actual reserved stack memory — there's no way to "spin" without consuming a frame per call, and that memory region is finite and fixed-size, so it's exhausted and the engine throws deterministically rather than looping forever.
