# Day 24: Modules — CommonJS vs ES Modules

## 🧠 Core Architectural Concept

CommonJS (CJS) and ES Modules (ESM) aren't just two different syntaxes for
the same thing — they're two fundamentally different *loading algorithms*,
and almost every practical difference (circular dependencies, tree-shaking,
top-level await, interop pain) traces back to this one distinction:

- **CommonJS is synchronous and runtime-resolved.** `require(path)` is a
  real function call that executes *immediately*, synchronously, blocking
  until the required module's entire top-level code has run. Node resolves
  the path, checks its module cache (keyed by resolved absolute path), and
  if not cached, reads the file, wraps it in a function
  (`function(exports, require, module, __filename, __dirname) { ... }`),
  and executes it right then, top to bottom. `module.exports` is just a
  plain object reference that gets handed back — a **value**, copied at
  the moment of `require()`, not a live link.
- **ES Modules are static and asynchronously linked.** `import`/`export`
  declarations are not function calls — they're declarative syntax the
  engine parses *before* running any module code, building a full
  dependency graph first (the "parse" phase), then **asynchronously**
  fetching/resolving every module in that graph, then linking bindings, and
  only then executing module bodies top to bottom (the "evaluate" phase).
  Because imports are statically known at parse time (you can't
  `import` a dynamically computed path with static `import` syntax —
  that's what `import()` the dynamic function is for), tooling can
  analyze the whole graph without running any code at all.

This static-vs-dynamic distinction is *the* reason tree-shaking works well
with ESM and poorly with CJS: a bundler can look at `import { used } from
'./utils.js'` and know, without executing anything, exactly which exports
are referenced — dead code elimination falls out for free. With CJS,
`module.exports` is an arbitrary runtime value (it could be the result of a
conditional, a loop, a function call) — the bundler would have to actually
*execute* code to know what's exported, which is why CJS tree-shaking is
fundamentally harder and often just doesn't happen.

**Live bindings vs value copies** is the other load-bearing difference:

```js
// cjs-counter.js
let count = 0;
module.exports.increment = () => count++;
module.exports.count = count; // a COPY of count's value AT THIS MOMENT (0)

// consumer.js (CJS)
const { increment, count } = require('./cjs-counter');
increment();
console.log(count); // still 0 — count was copied by value at require() time
```

```js
// esm-counter.mjs
export let count = 0;
export const increment = () => count++;

// consumer.mjs (ESM)
import { increment, count } from './esm-counter.mjs';
increment();
console.log(count); // 1 — ESM imports are LIVE BINDINGS (references to the
                     // exporting module's own binding), not value copies
```

**Circular dependencies** expose this most dramatically:

- In CJS, if `a.js` requires `b.js`, which requires `a.js` back, Node
  detects the cycle and gives `b.js` whatever `a.js`'s `module.exports`
  object looked like *at that point in its execution* (usually incomplete —
  properties defined after the circular `require()` line simply aren't
  there yet). This is a classic "why is this undefined" bug.
- In ESM, because bindings are live references resolved through the module
  graph rather than snapshotted values, a circular import can still work
  correctly as long as the actual *access* to the circularly-imported value
  happens after both modules finish evaluating (e.g., inside a function
  body called later, not at the top level during the circular import
  itself) — the binding resolves correctly once evaluation completes,
  rather than being frozen at an incomplete snapshot.

## 🎯 Interview Talking Points

- "I've debugged a 'why is this exported function `undefined`' bug that
  turned out to be a circular `require()` — module A required module B at
  the top, B required A back before A had finished defining its exports, so
  B got a half-built `module.exports` object. The fix was restructuring so
  the circular dependency only happened inside a function body, deferring
  the `require()` call past both modules' initial load."
- "The trade-off I explain to teams migrating to ESM: you gain live
  bindings, static analyzability, and real tree-shaking, but you lose the
  ability to `require()` conditionally/dynamically with plain syntax — you
  need the asynchronous `import()` function instead, which changes code
  structure, especially for lazy-loading patterns."
- "A follow-up I expect: 'can you import a CJS module from ESM and vice
  versa?' Node lets ESM `import` a CJS module (it gets wrapped, exposing
  `module.exports` as the default export, with best-effort named export
  detection via static analysis of `module.exports.x = ...` patterns), but
  a CJS module can't `require()` a genuine ESM module synchronously at
  all — because ESM evaluation is fundamentally asynchronous, you'd need
  dynamic `import()`, which returns a promise, inside an async context."
- "I treat `package.json`'s `\"type\": \"module\"` field, plus the `.mjs`/
  `.cjs` extensions, as the two levers that actually decide which loader
  Node uses per file — I've seen real outages from a `.js` file silently
  being interpreted as CJS when a nearby `package.json` didn't declare
  `\"type\": \"module\"`, so `import` syntax in it threw a syntax error in
  production despite working in a dev environment with a different root
  config."
- "Top-level `await` is only legal in ESM, not CJS, and that's not an
  arbitrary restriction — it's a direct consequence of ESM's evaluation
  phase already being asynchronous by design. Bolting top-level await onto
  CJS's synchronous `require()` model would mean every synchronous
  `require()` call could unpredictably block on an unrelated promise deep
  in the graph, which is exactly the kind of implicit, hard-to-reason-about
  async behavior the language has otherwise avoided."
- "I prefer named ESM exports over a single default export in shared
  libraries specifically because named exports are what makes tree-shaking
  and IDE auto-import/rename-refactoring reliable — a default export is
  effectively an anonymous value from the bundler's perspective."

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Think of CommonJS like ordering food at a counter: you ask for an item
(`require('./thing')`), and the kitchen stops everything and makes it for
you *right then* before handing you a plate (a snapshot of whatever was
ready at that moment). If you order the same thing again, you get the exact
same plate from before (the module cache) — not a fresh one.

ESM is more like a restaurant with a pre-printed menu that's built by
reading every dish's recipe card *before* the kitchen opens (the static
parse/link phase) — the kitchen knows the whole dependency graph between
dishes ahead of time, which is why it can skip ingredients nobody ordered
(tree-shaking). And when you get your plate, it's not a snapshot — it's
more like a live video feed of the kitchen's pot; if the kitchen adds more
salt later, your "plate" (the binding) reflects it, because you're looking
at the same pot, not a copy.

**Common traps:**
- **Trap 1:** "`module.exports.x` and `exports.x` are interchangeable."
  Correction: `exports` is just a local variable alias to `module.exports`
  — reassigning `exports = {...}` breaks the link entirely; only
  reassigning `module.exports = {...}` actually changes what's exported.
- **Trap 2:** "I can mix `require()` and `import` freely in the same file."
  Correction: a file is CJS or ESM based on its extension/`package.json`
  `type` field — you don't choose per-line; mixing requires explicit
  interop (dynamic `import()` from CJS, or Node's CJS-into-ESM wrapping).
- **Trap 3:** "Destructuring an ESM import creates a local copy, just like
  destructuring any other object." Correction: destructured ESM imports are
  still live bindings under the hood — reassigning the imported name
  directly is disallowed by the engine (imports are read-only bindings),
  which is a deliberate safety guarantee CJS does not provide.

## 💻 Hands-On Exercise

Open `script.js`. It builds a self-contained CJS-vs-ESM comparison using
Node's `vm`-free approach: since this single file can't literally contain
both a `require()` graph and an `import` graph at once (a file is one
module type), the script demonstrates the **CJS value-copy problem** and
the **ESM live-binding fix** using two small CJS modules written to disk at
runtime, plus a fully worked-out trace of what the equivalent ESM version
would output, with the exact reasoning spelled out in comments.

**Your task:** before reading the explanation block in section 3, predict
what `count` will log in the CJS consumer after calling `increment()` once.

**Expected output and why:**
```
CJS consumer sees count = 0
```
Because `const { count } = require('./cjs-counter')` copies the *value* of
`count` (which was `0`) into the consumer's local binding at the moment
`require()` ran. Calling `increment()` afterward mutates the *module's
internal* `count` variable, but the consumer's local `count` binding is an
independent copy from an instant in time — it has no ongoing connection to
the module's internal state. The ESM equivalent, by contrast, would log `1`,
because `import { count }` is a live, read-only reference to the exporting
module's own `count` binding, not a copy — when the module's internal
`count` changes, every importer observing it sees the updated value on next
read.
