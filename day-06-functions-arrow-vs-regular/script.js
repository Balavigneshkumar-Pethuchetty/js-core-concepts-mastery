// ============================================================
// DAY 06 — FUNCTIONS: DECLARATIONS vs EXPRESSIONS vs ARROWS
// ============================================================
// Run this in a browser console, via index.html, or with `node script.js`.
// Every block is self-contained and labeled to match the README exercise.

// ============================================================
// 1. HAPPY PATH — hoisting behavior of a function declaration
// ============================================================

// This call works even though `declaredBefore` is defined BELOW this line.
// WHY: during the creation phase of this script's execution context, the
// engine scans for function declarations and binds the identifier directly
// to a fully-formed function object before the first line runs.
console.log('[1] declaration hoist ->', declaredBefore());

function declaredBefore() {
  return 'I was hoisted!';
}

// ============================================================
// 2. COMMON PITFALL — function EXPRESSION hoisting (TDZ trap)
// ============================================================

// We wrap this in a try/catch because calling it early is a real ReferenceError,
// not just a bad idea — this is the exact mistake that trips people who think
// "function" always means "safe to call early."
try {
  console.log('[2] expression hoist ->', expressionBefore());
} catch (err) {
  // WHY this throws: `const expressionBefore` is hoisted to the Temporal Dead
  // Zone (see Day 02). The binding exists, but accessing it before the `const`
  // line actually runs is illegal. Only the ASSIGNED LINE creates the function.
  console.log('[2] expression hoist -> threw:', err.constructor.name, '-', err.message);
}

const expressionBefore = function () {
  return 'I only exist after this line runs';
};

// Now that the assignment has executed, calling it works fine.
console.log('[2b] after assignment ->', expressionBefore());

// ============================================================
// 3. COMMON PITFALL — arrow function as an OBJECT METHOD
// ============================================================

const user = {
  name: 'Ada',

  // WHY this is broken: arrow functions do not get their own `this` binding.
  // At the moment this object literal is evaluated, the arrow captures `this`
  // from the ENCLOSING lexical scope (this module/script's top level, which in
  // a browser script or Node module is `undefined` in strict-ish contexts, or
  // the global object otherwise) — NOT from `user`, because `user` doesn't
  // even exist yet as a receiver when the arrow is created.
  greetArrow: () => {
    // `this.name` resolves against the captured outer `this`, so it is NOT 'Ada'.
    return `Hello, ${this && this.name}`;
  },

  // WHY this works: a regular function used as a method gets its `this` bound
  // DYNAMICALLY at the call site. `user.greetRegular()` sets `this = user`
  // because the call used the "obj.method()" form.
  greetRegular() {
    return `Hello, ${this.name}`;
  },
};

console.log('[3] arrow-as-method ->', user.greetArrow());
console.log('[3b] regular-as-method ->', user.greetRegular());

// ============================================================
// 4. EDGE CASE — arrow functions cannot be constructors
// ============================================================

const ArrowCtor = () => {};

try {
  // WHY this throws: arrow functions have no internal [[Construct]] slot.
  // `new` specifically invokes [[Construct]], so the engine rejects it outright
  // — this is a static, provable fact about the function's "kind," not a
  // runtime check on the body contents.
  new ArrowCtor();
} catch (err) {
  console.log('[4] new on arrow -> threw:', err.constructor.name, '-', err.message);
}

// Compare: a regular function used as a constructor works fine.
function RegularCtor(name) {
  this.name = name;
}
const instance = new RegularCtor('works fine');
console.log('[4b] new on regular function ->', instance.name);

// ============================================================
// 5. EDGE CASE — arrows have no own `arguments`; use rest params instead
// ============================================================

// This is intentionally written as an arrow to prove the point: arrows do NOT
// have their own `arguments` object. If you reference `arguments` inside an
// arrow, it resolves to the nearest enclosing non-arrow function's `arguments`
// (or throws if there is none, e.g. at module top level in strict mode).
// The modern, correct way to accept variadic args in ANY function type is rest
// parameters — they are not tied to the legacy `arguments` object at all.
const sum = (...args) => {
  // `args` is a real Array (not an array-like), so .reduce works directly —
  // another ergonomic win over the old `arguments` object, which required
  // Array.prototype.slice.call(arguments) to get real array methods.
  return args.reduce((total, n) => total + n, 0);
};

console.log('[5] sum(1,2,3,4,5) ->', sum(1, 2, 3, 4, 5));

// ============================================================
// 6. EDGE CASE — bind/call/apply cannot override an arrow's `this`
// ============================================================

const boundAttempt = {
  label: 'bound-object',
  getLabelArrow: () => this && this.label,
};

// WHY this still doesn't work: `call` tries to set `this` for the duration of
// the invocation, but arrows have no `this` slot to overwrite — the engine
// silently ignores the supplied receiver for arrows. This is a frequent
// "gotcha" question: "can you .bind() an arrow to fix its `this`?" Answer: no.
const forcedCall = boundAttempt.getLabelArrow.call({ label: 'forced-label' });
console.log('[6] call() on arrow ignored ->', forcedCall);

// Contrast: call/apply/bind DO work on a regular function.
function getLabelRegular() {
  return this.label;
}
console.log('[6b] call() on regular function ->', getLabelRegular.call({ label: 'forced-label' }));

// ============================================================
// 7. NAMED FUNCTION EXPRESSION — self-recursion safety
// ============================================================

// The inner name `fact` is ONLY visible inside the function body itself — it
// does not leak into the outer scope. This means even if someone reassigns
// the outer binding `factorial`, the recursive calls inside still resolve
// correctly because they use the untouchable inner name.
const factorial = function fact(n) {
  return n <= 1 ? 1 : n * fact(n - 1);
};

console.log('[7] factorial(5) ->', factorial(5));

const originalFactorial = factorial;
// Simulate someone overwriting the outer binding (a realistic real-world bug:
// a module export getting monkey-patched, or a variable shadowed elsewhere).
// eslint-disable-next-line no-func-assign
var factorialRef = factorial;
factorialRef = null; // outer variable "destroyed" — but it's a different binding, just for clarity
console.log(
  '[7b] original function reference still works after outer var nulled ->',
  originalFactorial(5)
);

// ============================================================
// 8. ASYNC/CALLBACK CONTEXT — why arrows are the right choice here
// ============================================================

class Counter {
  constructor() {
    this.count = 0;
  }

  // Arrow used deliberately here: `increment` needs `this` to mean "the
  // Counter instance" even when passed as a bare callback (e.g. to
  // setTimeout, addEventListener) where the caller controls how the function
  // is invoked and would otherwise strip the receiver.
  startAfterDelay = (delayMs) => {
    setTimeout(() => {
      // Nested arrow -> also lexical -> resolves `this` all the way up to the
      // Counter instance through TWO layers of lexical scoping, with no
      // intermediate binding to go wrong.
      this.count += 1;
      console.log('[8] count incremented via arrow chain ->', this.count);
    }, delayMs);
  };
}

const counter = new Counter();
const detachedStart = counter.startAfterDelay; // detach from the instance, like passing it as a callback
detachedStart(0); // still works correctly because `this` was captured lexically at class-field definition time, not at call time
