# 30-Day Core JavaScript Interview & Mentorship Curriculum

A production-grade, 30-day deep dive into core JavaScript — built for two jobs at once:
sounding like a Principal Engineer in a senior/staff interview, and being able to explain
the same concept to a junior dev in under two minutes without letting them fall into the
common traps.

Every day lives in its own folder with three files:

- **`README.md`** — Core Architectural Concept (how the engine actually does it) →
  Interview Talking Points (spoken from production experience, not textbook definitions)
  → Junior Mentorship Guide (2-minute explanation + common traps) → Hands-On Exercise.
- **`script.js`** — heavily commented, fully runnable code: happy paths, pitfalls, edge
  cases, and for the async days, line-by-line ordering traces. This is the single source
  of truth; `index.html` is generated from it (see Setup below).
- **`index.html`** — a browser sandbox, broken into the same labeled sections as
  `script.js` (Happy Path, Common Pitfall, Edge Case, …). Each section shows that block's
  source code directly above the live output it produces, so you can correlate "this
  code" with "this result" instead of reading a blind console dump — the code's own
  inline comments are the explanation for why you got that result. Async callbacks are
  correctly attributed back to the section that scheduled them even when they fire out of
  order, which matters most for the Day 15–22 material.

## The 30 Days

### Week 1 — Execution Model & Scope
| Day | Topic |
|---|---|
| [01](day-01-execution-context-call-stack/) | Execution Context & Call Stack |
| [02](day-02-hoisting-var-let-const-tdz/) | Hoisting, `var`/`let`/`const` & the Temporal Dead Zone |
| [03](day-03-scope-lexical-environment/) | Scope & the Lexical Environment |
| [04](day-04-closures/) | Closures |
| [05](day-05-this-keyword-binding/) | The `this` Keyword & Binding Rules |

### Week 2 — Functions, Objects & Types
| Day | Topic |
|---|---|
| [06](day-06-functions-arrow-vs-regular/) | Functions: Declarations, Expressions & Arrow Functions |
| [07](day-07-prototypes-prototypal-inheritance/) | Prototypes & Prototypal Inheritance |
| [08](day-08-classes-under-the-hood/) | Classes Under the Hood |
| [09](day-09-object-property-descriptors/) | Object Property Descriptors, Getters/Setters, Freeze/Seal |
| [10](day-10-equality-type-coercion/) | Equality & Type Coercion |

### Week 3 — Memory, Numbers & Protocols
| Day | Topic |
|---|---|
| [11](day-11-primitives-vs-references-memory/) | Primitives vs References & Memory |
| [12](day-12-garbage-collection/) | Garbage Collection |
| [13](day-13-numbers-precision-bigint/) | Numbers, Floating-Point Precision & BigInt |
| [14](day-14-symbols-iterators-iterables/) | Symbols, Iterators & Iterables |
| [15](day-15-event-loop-foundations/) | The Event Loop — Foundations |

### Week 4 — The Event Loop & Async Mastery (the heart of the course)
| Day | Topic |
|---|---|
| [16](day-16-macrotasks-vs-microtasks/) | Macrotasks vs Microtasks |
| [17](day-17-promises-deep-dive/) | Promises Deep Dive |
| [18](day-18-async-await-internals/) | Async/Await Internals |
| [19](day-19-generators-iterators-coroutines/) | Generators, Iterators & Coroutines |
| [20](day-20-runtime-apis-browser-vs-node/) | Runtime APIs: Browser vs Node |
| [21](day-21-microtask-macrotask-scheduling-apis/) | Scheduling APIs: `queueMicrotask`, `rAF`, `process.nextTick`, `setImmediate` |
| [22](day-22-async-ordering-mastery/) | Async Ordering Mastery (capstone tracing puzzles) |

### Week 5 — Patterns, Performance & the Capstone
| Day | Topic |
|---|---|
| [23](day-23-error-handling/) | Error Handling |
| [24](day-24-modules-commonjs-vs-esm/) | Modules: CommonJS vs ESM |
| [25](day-25-array-methods-performance/) | Array Methods & Performance |
| [26](day-26-destructuring-spread-rest-copying/) | Destructuring, Spread/Rest & Copying |
| [27](day-27-weakmap-weakset-memory-safe-caching/) | WeakMap/WeakSet & Memory-Safe Caching |
| [28](day-28-functional-programming-patterns/) | Functional Programming Patterns |
| [29](day-29-design-patterns-in-js/) | Design Patterns in JS |
| [30](day-30-capstone-system-design-performance/) | Capstone: System Design & Performance |

## Setup (one time, or after cloning/editing)

Each day's `README.md` and `script.js` are the single sources of truth — the only things
tracked in git for that folder. `guide.html`, `practice.html` (where present), and
`index.html` are all **generated build artifacts** (gitignored, not committed). Generate
them once before browsing:

```
node scripts/build-guides.js
node scripts/build-sandbox-pages.js
```

- `build-guides.js` renders each `README.md` (and `PRACTICE.md`, if present) into a
  styled `guide.html` / `practice.html`, via a small, dependency-free markdown renderer.
- `build-sandbox-pages.js` parses each `script.js` into its labeled sections and
  generates `index.html`, pairing each section's code with the live output it produces.

Re-run either script any time you edit the corresponding source file, to keep the
generated page in sync. Both are pre-render steps rather than live fetch-and-render
because browsers block a `file://` page from `fetch()`-ing a sibling local file — so a
single runtime viewer can't read another file directly when these pages are just
double-clicked from Explorer, without running a local server.

## How to use this

1. Open the root **[`index.html`](index.html)** in a browser — it's a menu of all 30
   days with a one-line description of each.
2. Click **📖 Guide** to read that day's README rendered as a styled page (not raw
   markdown), or **▶ Sandbox** to run that day's `script.js` live in the browser.
3. For Days 15–22, don't skip the tracing puzzles — predicting async output correctly,
   under pressure, is the single highest-leverage interview skill this course builds.
4. If you're mentoring someone, use the "Junior Mentorship Guide" section verbatim as
   your talking points — it's written to be said out loud in under two minutes.
