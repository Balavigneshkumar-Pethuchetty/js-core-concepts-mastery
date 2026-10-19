'use strict';
// Top-of-file 'use strict' matters for this script: it makes the
// default-binding examples below resolve `this` to `undefined`
// rather than silently falling back to the global object, which is
// the modern, correct behavior you should always be reasoning about.

// ============================================================
// DAY 05: THIS KEYWORD BINDING RULES
// ============================================================
// Goal: see all 4 binding rules (default, implicit, explicit, new)
// fire in isolation, see arrow functions opt OUT of the whole system
// by inheriting `this` lexically instead, and reproduce + fix the
// classic "losing this" callback bug.

// ============================================================
// 1. HAPPY PATH — implicit binding (rule 3): obj.method()
// ============================================================
const user = {
  name: 'Lin',
  greetRegular: function () {
    // `this` here is resolved AT CALL TIME based on what's left of
    // the dot at the call site -- not based on where this function
    // is physically written.
    return `Hi, I'm ${this.name}`;
  },
};

console.log('Implicit binding, user.greetRegular():', user.greetRegular()); // "Hi, I'm Lin"

// ============================================================
// 2. HAPPY PATH — explicit binding (rule 2): call / apply / bind
// ============================================================
function describe(role) {
  return `${this.name} is a ${role}`;
}

const engineer = { name: 'Priya' };
const manager = { name: 'Devon' };

// .call(thisArg, ...args) -- invokes immediately with explicit this
console.log('call():', describe.call(engineer, 'Staff Engineer'));

// .apply(thisArg, [argsArray]) -- same as call, but args as an array
console.log('apply():', describe.apply(manager, ['Engineering Manager']));

// .bind(thisArg) -- does NOT invoke; returns a NEW function with
// `this` permanently locked, regardless of how that new function is
// later called (explicit binding beats every later call-site rule).
const describeAsEngineer = describe.bind(engineer);
console.log('bind(), called later, bare:', describeAsEngineer('Principal Engineer'));

// ============================================================
// 3. HAPPY PATH — new binding (rule 1, highest precedence)
// ============================================================
function Account(initialBalance) {
  // `new Account(...)` creates a brand-new object, sets this
  // function's `this` to point at it, and (absent an explicit
  // returned object) returns that object automatically.
  this.balance = initialBalance;
  this.describe = function () {
    return `Account with balance ${this.balance}`;
  };
}

const acc = new Account(500);
console.log('new binding:', acc.describe());

// ============================================================
// 4. COMMON PITFALL — losing `this` when passing a method as a callback
// ============================================================
class Timer {
  constructor() {
    this.seconds = 0;
  }

  // A regular method, living on Timer.prototype. Its `this` is
  // decided ENTIRELY by how it's called, never by how it's defined.
  tick() {
    this.seconds += 1;
    return this.seconds;
  }
}

const timer = new Timer();
console.log('Correct call, implicit binding:', timer.tick()); // 1 -- called as timer.tick(), this = timer

// Simulate "passing tick as a callback" the way setTimeout would --
// we extract the bare function reference, exactly like
// setTimeout(timer.tick, 1000) would do internally.
const extractedTick = timer.tick;
try {
  // Called bare: no object left of a dot at this call site at all.
  // Default binding applies -- in strict mode, this is undefined.
  extractedTick();
} catch (err) {
  console.log('Caught the classic "losing this" bug:', err.name, '-', err.message);
}

// ---- Fix #1: .bind() ----
const boundTick = timer.tick.bind(timer);
console.log('Fix via .bind(timer):', boundTick()); // 2 -- this permanently locked to timer

// ---- Fix #2: wrapper arrow function ----
const wrappedTick = () => timer.tick();
console.log('Fix via wrapper arrow calling timer.tick():', wrappedTick()); // 3 -- inner call is a fresh implicit-bound method call

// ---- Fix #3: arrow function as an instance field ----
class TimerWithArrowField {
  seconds = 0;

  // This is an instance property whose VALUE is an arrow function,
  // created fresh per instance inside the constructor. It closes
  // over the lexical `this` of the constructor's own scope -- which
  // is correctly bound to the new instance via `new` (rule 1) -- so
  // this arrow permanently carries that `this`, no matter how later
  // callers invoke it.
  tick = () => {
    this.seconds += 1;
    return this.seconds;
  };
}

const timer2 = new TimerWithArrowField();
const extractedArrowTick = timer2.tick; // extract it, same as before
console.log('Fix via arrow class field, called bare:', extractedArrowTick()); // 1 -- still correctly bound

// ============================================================
// 5. EDGE CASE — arrow functions have NO this of their own
// ============================================================
const lexicalThisDemo = {
  name: 'Outer Object',
  regularMethod: function () {
    console.log('regularMethod, this.name:', this.name); // 'Outer Object' -- implicit binding

    const innerArrow = () => {
      // This arrow has no this slot. It looks OUTWARD, to the scope
      // it was lexically defined in -- which is regularMethod's own
      // scope, where `this` is already bound to lexicalThisDemo.
      console.log('innerArrow, this.name:', this.name); // 'Outer Object' -- inherited, NOT re-bound
    };
    innerArrow();

    // Proof that .call()/.bind() CANNOT rebind an arrow's this: the
    // first argument to call/apply/bind is simply ignored by an
    // arrow function, because it has no [[ThisMode]] of "own" to
    // override -- .bind() still returns a new function wrapper, but
    // calling it produces the exact same this.name as calling the
    // original unbound arrow would.
    const attemptedRebind = innerArrow.bind({ name: 'Attempted Impostor' });
    attemptedRebind();
    // Logged line above still prints this.name: 'Outer Object',
    // proving the attempted rebind to "Attempted Impostor" had zero effect.
  },
};
lexicalThisDemo.regularMethod();

// A cleaner, isolated proof of arrows ignoring explicit binding:
const arrowIgnoresBind = () => this; // top-level `this` in this strict script module context
const fakeContext = { name: 'Should Be Ignored' };
const boundArrow = arrowIgnoresBind.bind(fakeContext);
console.log('Arrow .bind() result === original function\'s captured this:', boundArrow() === arrowIgnoresBind());

// ============================================================
// 6. EDGE CASE — default binding differs between strict and non-strict
// ============================================================
function strictDefaultBindingDemo() {
  // Because this entire file starts with 'use strict', this function
  // called bare has `this === undefined`, not the global object.
  return this;
}
console.log('Strict mode bare call, this is:', strictDefaultBindingDemo()); // undefined

console.log('--- Day 05 script complete ---');
