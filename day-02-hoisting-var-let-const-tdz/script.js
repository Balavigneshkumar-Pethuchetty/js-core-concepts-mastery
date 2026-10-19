// ============================================================
// DAY 02: HOISTING, VAR VS LET VS CONST, TEMPORAL DEAD ZONE
// ============================================================
// Goal: see the creation-phase/execution-phase split from Day 01
// applied specifically to variable declarations, and see exactly
// where and why TDZ errors fire.

// ============================================================
// 1. HAPPY PATH — var hoisting gives undefined, not an error
// ============================================================
function varHoistingDemo() {
  // At this point, in the creation phase, `message` was ALREADY
  // registered in this function's Variable Environment and
  // initialized to undefined -- that's why this doesn't throw.
  console.log('varHoistingDemo, before assignment:', message); // undefined

  var message = 'hello from var';

  console.log('varHoistingDemo, after assignment:', message); // 'hello from var'
}
varHoistingDemo();

// ============================================================
// 2. HAPPY PATH — function declarations are fully hoisted
// ============================================================
// We can call this BEFORE its definition appears lexically below,
// because function declarations are hoisted with their entire body
// attached, not just their name.
console.log('Calling hoisted function before its definition:', hoistedGreeting());

function hoistedGreeting() {
  return 'I was fully hoisted, body and all';
}

// ============================================================
// 3. COMMON PITFALL — the Temporal Dead Zone (TDZ)
// ============================================================
// This function is intentionally wrapped in try/catch so the whole
// script can keep running after demonstrating the TDZ ReferenceError.
function tdzDemo() {
  console.log('typeof hoistedVar before its line:', typeof hoistedVar); // 'undefined'
  console.log('hoistedVar before its line:', hoistedVar); // undefined

  try {
    // lockedLet WAS registered in the creation phase (it is hoisted),
    // but its binding is uninitialized -- reading it here throws.
    console.log('lockedLet before its line:', lockedLet);
  } catch (err) {
    console.log('Caught expected TDZ error:', err.name, '-', err.message);
  }

  var hoistedVar = 'assigned';
  let lockedLet = 'also assigned';

  // Now that we're past the declaration line, lockedLet is fully
  // initialized and behaves like any normal variable.
  console.log('lockedLet after its line:', lockedLet);
}
tdzDemo();

// ============================================================
// 4. COMMON PITFALL — const is a locked BINDING, not a locked VALUE
// ============================================================
function constMutabilityDemo() {
  const user = { name: 'Ada', roles: ['admin'] };

  // Allowed: mutating the contents of the object const points to.
  user.roles.push('editor');
  user.name = 'Ada Lovelace';
  console.log('Mutated object through a const binding:', JSON.stringify(user));

  try {
    // NOT allowed: reassigning the binding itself.
    user = { name: 'someone else' };
  } catch (err) {
    console.log('Caught expected reassignment error:', err.name, '-', err.message);
  }
}
constMutabilityDemo();

// ============================================================
// 5. EDGE CASE — var is function-scoped, let/const are block-scoped
// ============================================================
function scopingComparisonDemo() {
  if (true) {
    var fnScoped = 'I leak out of this block';
    let blockScoped = 'I stay inside this block';
    console.log('Inside the if-block:', fnScoped, '|', blockScoped);
  }

  // fnScoped is visible here because var ignores block boundaries --
  // it was hoisted all the way to the top of scopingComparisonDemo.
  console.log('Outside the if-block, fnScoped still visible:', fnScoped);

  try {
    // blockScoped does NOT leak -- it never existed outside the block
    // at all, so this is a plain "not defined" ReferenceError, which
    // is a DIFFERENT error than a TDZ error (TDZ only applies while
    // the binding exists-but-uninitialized within its own scope).
    console.log(blockScoped);
  } catch (err) {
    console.log('Caught expected scoping error:', err.name, '-', err.message);
  }
}
scopingComparisonDemo();

// ============================================================
// 6. EDGE CASE — per-iteration bindings: var vs let in a loop
// ============================================================
// This is the mechanical setup for the classic "loop variable capture"
// bug that gets its full treatment on Day 04 (Closures). Here we just
// demonstrate the BINDING mechanics that cause it.
console.log('--- var loop: one shared binding across all iterations ---');
var varCallbacks = [];
for (var i = 0; i < 3; i++) {
  // Every one of these closures captures the SAME `i` binding,
  // because `var` creates exactly one binding for the whole loop,
  // hoisted to the function/global scope, not one per iteration.
  varCallbacks.push(function () {
    return i;
  });
}
console.log('var-based callbacks all return the FINAL value of i:', varCallbacks.map((fn) => fn())); // [3, 3, 3]

console.log('--- let loop: a fresh binding created per iteration ---');
var letCallbacks = [];
for (let j = 0; j < 3; j++) {
  // The spec requires a NEW lexical environment (a new `j` binding)
  // to be created for each iteration of a let-declared loop variable.
  letCallbacks.push(function () {
    return j;
  });
}
console.log('let-based callbacks each captured their OWN iteration value:', letCallbacks.map((fn) => fn())); // [0, 1, 2]

console.log('--- Day 02 script complete ---');
