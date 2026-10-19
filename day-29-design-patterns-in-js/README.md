# Day 29: Classic Design Patterns, Idiomatically Expressed in JS

## 🧠 Core Architectural Concept

Design patterns from the Gang-of-Four world were largely written against class-based,
statically-typed languages (C++, Java) where the language itself forces a lot of
ceremony to get basic things like "one instance" or "hide this data" working. JavaScript
has first-class functions, closures, and dynamic objects, so several "patterns" compress
down to a few lines of idiomatic JS instead of a multi-class hierarchy. Understanding
*why* they compress is the actual interview signal — reciting the pattern names is not.

**Module pattern (IIFE / revealing module)** exploits closures (Day 4) for
encapsulation: an **Immediately Invoked Function Expression** creates a new function
scope, executes it once, and whatever it `return`s becomes the only way to reach
anything defined inside. Everything not returned is lexically trapped in that closure's
environment record forever — unreachable, and therefore private, with no special
"private" keyword needed. The **revealing module** variant tightens this further: define
everything as local functions/variables first, then return an object literal that
explicitly maps public names to the private implementations, so the "public API" is one
readable block instead of scattered `this.x =` assignments. Before ES2022 private class
fields (`#field`), this was *the* real encapsulation mechanism in JS, and it still
underpins how many bundler-wrapped modules and older libraries (jQuery plugins, early
Node modules before `require` existed) structure themselves.

**Singleton** guarantees exactly one instance exists and is globally reachable. In
class-heavy languages this needs a private constructor and a static accessor method with
lazy initialization. In JS, a plain **module** already *is* a singleton — `import { db }
from './db.js'` always gets the same module-evaluation result, because the module system
caches the evaluated module object by resolved path and never re-runs it. This is why
"the Singleton pattern" in modern JS is usually just "export a pre-constructed object
from a module" rather than a class with guard logic.

**Factory** decouples *what gets constructed* from *the code that needs an instance* —
instead of callers doing `new SpecificClass()` directly (which hard-codes a concrete
type into every call site), a factory function/object decides which concrete
class/shape to build based on input, so callers depend on the factory's interface, not
on every concrete constructor. Mechanically, this is nothing more than a function
containing a `switch`/lookup table that returns different object literals or `new
SomeClass()` calls — the pattern is in the *responsibility boundary*, not in any special
syntax.

**Observer / Pub-Sub** decouples a thing that produces events from the things that react
to them. An internal registry (commonly a `Map<eventName, Set<listenerFn>>` or a plain
array) holds subscriber callbacks; `emit(event, data)` iterates that registry and
invokes each one synchronously, in registration order, with the event payload. This is
the exact mechanism DOM `addEventListener`, Node's `EventEmitter`, and virtually every
pub-sub library in the ecosystem use internally — understanding "it's just an array of
callbacks looped over on emit" demystifies all of them at once. The "Observer" and
"Pub-Sub" naming distinction people argue about: classic Observer has subjects calling
observers directly and knowing about them; Pub-Sub routes everything through a
shared broker/event-bus so publishers and subscribers never reference each other at
all — a stricter decoupling.

## 🎯 Interview Talking Points

- "I treat every pattern as a cost, not a virtue — the actual skill is knowing when
  the complexity it adds is cheaper than the complexity it removes. A Factory earns its
  place when you genuinely have multiple interchangeable implementations behind one
  call site and that set is expected to grow (payment providers, auth strategies, log
  transports). I've also seen a one-off object get wrapped in a 'factory function' that
  returns the same literal every time — that's pure ceremony, not decoupling, because
  there's nothing to decouple from."
- "Singleton is the pattern I'm most cautious selling to a team. A module-level
  singleton for something like a database connection pool is reasonable. But I've
  debugged a test suite where a 'singleton' config object was mutated by one test and
  silently poisoned every subsequent test in the same process, because Node caches the
  module instance across the whole test run. The fix wasn't 'stop using modules as
  singletons' — it was making the singleton's public API immutable after init, and
  giving tests an explicit reset/teardown hook."
- "Pub-Sub is how I decouple analytics/logging/side-effects from core business logic
  without threading callback parameters through five layers of functions. I shipped a
  checkout flow where `emit('order:placed', order)` let three independent, unrelated
  listeners (email receipt, inventory decrement, analytics ping) react without the
  checkout function needing to know any of them exist. The trade-off I'm upfront about:
  debugging gets harder — a stack trace from inside a listener doesn't show you who
  emitted the event, so I always log the event name and a correlation ID at both ends."
- "The Module/Revealing-Module pattern is mostly legacy now that ES modules and
  `#privateFields` exist natively, but I still reach for an IIFE-closure when I want
  private state *without* committing to a class — a stateful counter/cache factory
  function is a perfectly idiomatic 'module pattern' even today, just without the
  historical ceremony of wrapping a whole `<script>` tag in one."
- "A follow-up they often ask: 'how is the Observer pattern different from just using
  Promises/async-await?' My answer: Promises model a *single* eventual value — they
  settle once. Observer/EventEmitter models a *stream* of events over time, zero to
  many, with multiple independent subscribers. They're complementary, not competing —
  I've wired an EventEmitter's events into an async generator or a Promise-based queue
  plenty of times when I needed to await 'the next event' from inside linear async code."
- "On Factory vs `new`: I point out that in JS, 'factory function' and 'class
  constructor' aren't opposing camps — a factory function can internally call `new` on
  whichever concrete class it picks. The pattern is about the *call site not needing to
  know* which constructor runs, not about avoiding classes entirely."
- "The over-engineering smell I call out in code review most often: a Factory, a
  Singleton-wrapped config, AND an Observer bus all introduced for a feature with one
  caller and no planned extension point. Patterns are supposed to pay for themselves in
  flexibility you'll actually use — introducing three of them 'because it's best
  practice' for a throwaway script is a cost with no matching benefit."

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Think of these four patterns as answers to four very ordinary real-life problems:

- **Module pattern** = a vending machine. You can press buttons on the outside (the
  public API) but you can never reach in and mess with the gears, coin mechanism, or
  inventory count directly (the private closure variables). The outside interface is the
  *only* way in.
- **Singleton** = "the" office printer. There's exactly one, everyone in the building
  shares the same one, and nobody gets to secretly have their own personal copy of it —
  anyone asking for "the printer" gets routed to that same physical machine.
- **Factory** = a restaurant kitchen. You order "a burger" (the factory call) — you
  don't need to know whether the cook uses a gas grill or a flat-top (the concrete
  class/implementation) to make it. You just need your burger to show up matching what
  you ordered.
- **Observer/Pub-Sub** = a group chat. Someone posts a message (emit), and everyone
  who joined that chat (subscribed) gets notified automatically — the poster doesn't
  need to know anyone's phone number individually, and new people can join or leave the
  chat without the poster changing anything about how they post.

**Common traps:**
1. **"I need a class with a private static instance variable for a Singleton in JS."**
   You almost never do. Correction: a module that exports a plain object/value already
   behaves as a singleton, because the module system caches and reuses it.
2. **"My factory function is pointless, it just does `return new Thing()`."** That's
   a sign the pattern isn't earning its keep yet. Correction: only reach for a Factory
   when there's real branching logic over *which* type gets built — otherwise just call
   the constructor directly.
3. **"I used Pub-Sub so now I don't need to think about execution order."** Listeners
   usually run synchronously, in the order they were registered — order is still very
   much real and can still bite you. Correction: don't rely on the "fire and forget"
   feeling of `emit()` to mean "I don't need to reason about ordering or errors inside
   listeners" — an uncaught throw inside one listener can still crash the emit loop
   depending on implementation, so defensive code matters.

## 💻 Hands-On Exercise

Open `script.js`. Before running, predict the output of this Pub-Sub trace:

```js
const bus = createEventBus();

bus.on('greet', (name) => console.log(`Hello, ${name}!`));
bus.on('greet', (name) => console.log(`(logging) greet event fired for ${name}`));

bus.emit('greet', 'Ada');

const unsubscribe = bus.on('greet', (name) => console.log(`Third listener: ${name}`));
unsubscribe();
bus.emit('greet', 'Grace');
```

**Expected output:**
```
Hello, Ada!
(logging) greet event fired for Ada
Hello, Grace!
(logging) greet event fired for Grace
```

**Why:** The first `emit('greet', 'Ada')` runs both currently-registered listeners
**synchronously, in registration order** — that's why the greeting log always precedes
the "(logging)" line, deterministically, every run. The third listener is registered and
then immediately unsubscribed *before* the second `emit` call, so it never fires for
`'Grace'` at all — subscribing and then calling the returned `unsubscribe()` function
removes it from the internal registry before any event reaches it again.

Then run `script.js` via `index.html` for the complete worked set: a revealing-module
counter factory with genuinely private state, a module-level singleton configuration
object (plus the mutation-leak bug it can cause across repeated calls, intentionally
demonstrated), a Factory that builds different notification-sender objects based on a
`type` argument, and a full `createEventBus()` implementation with `on`/`off`/`emit`,
including the unsubscribe-function return value used in the exercise above.
