// ============================================================
// DAY 28: FUNCTIONAL PROGRAMMING PATTERNS
// ============================================================
// Run this in a browser console, via index.html, or with Node.

// ============================================================
// 1. HAPPY PATH — currying via nested closures
// ============================================================

console.log('--- 1. Manual currying ---');

// Hand-written in the classic "chain of one-argument functions" style.
const addCurried = (a) => (b) => (c) => a + b + c;
console.log(addCurried(1)(2)(3)); // 6

// Each call returns a NEW closure holding onto the arguments seen so far —
// this is Day 4's closure mechanism doing the actual work here.
const addOne = addCurried(1);
const addOneAndTwo = addOne(2);
console.log(addOneAndTwo(10)); // 13
console.log(addOneAndTwo(100)); // 103 — addOne/addOneAndTwo are reusable, specialized functions

// ============================================================
// 2. HAPPY PATH — a generic curry() helper that works for any arity
// ============================================================

console.log('--- 2. Generic curry() helper ---');

/**
 * Converts a function of N arguments into a curried chain.
 * Uses Function.prototype.length to know how many arguments the
 * original function expects, and accumulates arguments across calls
 * until enough have been collected to actually invoke it.
 */
function curry(fn) {
  return function curried(...args) {
    if (args.length >= fn.length) {
      // We have enough arguments accumulated — call the real function.
      return fn.apply(this, args);
    }
    // Not enough yet — return a new function that collects more,
    // merging what we already have with whatever comes next.
    return (...nextArgs) => curried.apply(this, [...args, ...nextArgs]);
  };
}

function multiply3(a, b, c) {
  return a * b * c;
}

const curriedMultiply = curry(multiply3);
console.log(curriedMultiply(2)(3)(4)); // 24 — fully one-at-a-time
console.log(curriedMultiply(2, 3)(4)); // 24 — curry() also tolerates grouped arguments
console.log(curriedMultiply(2, 3, 4)); // 24 — or all at once, like the original function

// Practical use: specializing a general validator into a reusable, named function.
function validate(field, rule, value) {
  return rule(value) ? `${field} is valid` : `${field} is INVALID`;
}
const curriedValidate = curry(validate);
const validateAgeIsAdult = curriedValidate('age', (v) => v >= 18);
console.log(validateAgeIsAdult(25)); // 'age is valid'
console.log(validateAgeIsAdult(15)); // 'age is INVALID'

// ============================================================
// 3. HAPPY PATH — partial application via bind (more general than currying)
// ============================================================

console.log('--- 3. Partial application via bind ---');

function logMessage(level, scope, message) {
  return `[${level}] (${scope}) ${message}`;
}

// bind() pre-fills `this` (null here — not using it) plus a PREFIX of arguments,
// but unlike strict currying, the resulting function still accepts the rest
// of its arguments all at once, not one at a time.
const logError = logMessage.bind(null, 'ERROR');
console.log(logError('auth', 'token expired')); // '[ERROR] (auth) token expired'
console.log(logError('db', 'connection lost')); // '[ERROR] (db) connection lost'

// ============================================================
// 4. HAPPY PATH — composition: compose (right-to-left) and pipe (left-to-right)
// ============================================================

console.log('--- 4. compose vs pipe ---');

/** compose(f, g, h)(x) === f(g(h(x))) — applies RIGHT TO LEFT. */
function compose(...fns) {
  return (initialValue) => fns.reduceRight((acc, fn) => fn(acc), initialValue);
}

/** pipe(f, g, h)(x) === h(g(f(x))) — applies LEFT TO RIGHT. */
function pipe(...fns) {
  return (initialValue) => fns.reduce((acc, fn) => fn(acc), initialValue);
}

const double = (x) => x * 2;
const addTen = (x) => x + 10;
const square = (x) => x * x;

const pipeline = pipe(double, addTen, square);
console.log('pipe result:', pipeline(3));
// Trace: 3 -> double -> 6 -> addTen -> 16 -> square -> 256
// Expected: 256

const composed = compose(double, addTen, square);
console.log('compose result:', composed(3));
// Trace: 3 -> square (rightmost runs FIRST) -> 9 -> addTen -> 19 -> double -> 38
// Expected: 38 — SAME three functions, different order, very different answer.
// This is exactly the "pipe vs compose argument order" bug called out in the README.

// ============================================================
// 5. REAL-WORLD PATTERN — middleware pipeline built from composition
// ============================================================

console.log('--- 5. Middleware-style pipeline ---');

// Each "middleware" receives a request object and returns a (possibly modified)
// request object, or throws to short-circuit. This mirrors how Express/Redux
// middleware chains actually compose in production — adding a new step is a
// one-line array insertion, not a new branch threaded through an imperative function.
const withTimestamp = (req) => ({ ...req, receivedAt: 'FIXED_TIMESTAMP_FOR_DEMO' });
const withAuthCheck = (req) => {
  if (!req.token) {
    throw new Error('Unauthorized: missing token');
  }
  return { ...req, authenticated: true };
};
const withNormalizedPath = (req) => ({ ...req, path: req.path.toLowerCase() });

const requestPipeline = pipe(withTimestamp, withAuthCheck, withNormalizedPath);

const incomingRequest = { path: '/API/Users', token: 'abc123' };
console.log('Processed request:', requestPipeline(incomingRequest));
// { path: '/api/users', token: 'abc123', receivedAt: 'FIXED_TIMESTAMP_FOR_DEMO', authenticated: true }

try {
  requestPipeline({ path: '/API/Users' }); // no token -> withAuthCheck throws
} catch (err) {
  console.log('Pipeline correctly short-circuited:', err.message); // 'Unauthorized: missing token'
}

// ============================================================
// 6. COMMON PITFALL — the "pure-looking" function that secretly mutates
// ============================================================

console.log('--- 6. Purity bug: mutate-in-place while returning a value ---');

// This LOOKS pure — it returns a new-looking array expression — but
// Array.prototype.push mutates `state.items` IN PLACE before this
// function returns, which is a real, observable side effect on the input.
function addItemImpure(state, newItem) {
  state.items.push(newItem); // BUG: mutates the caller's array directly
  return state;
}

const originalState = { items: ['apple', 'banana'] };
const resultState = addItemImpure(originalState, 'cherry');

console.log('originalState.items was mutated:', originalState.items); // ['apple','banana','cherry'] — the input itself changed!
console.log('resultState === originalState:', resultState === originalState); // true — same reference, not a new object

// Why this matters: a selector/memoizer comparing by reference (===) would
// never detect this as "new state," because the reference never changed —
// exactly the production bug class described in the README.

// The PURE fix: never mutate the input; always build and return a new container.
function addItemPure(state, newItem) {
  return { ...state, items: [...state.items, newItem] };
}

const cleanState = { items: ['apple', 'banana'] };
const newState = addItemPure(cleanState, 'cherry');
console.log('cleanState.items untouched:', cleanState.items); // ['apple', 'banana']
console.log('newState.items has the addition:', newState.items); // ['apple', 'banana', 'cherry']
console.log('newState === cleanState:', newState === cleanState); // false — reference correctly changed

// ============================================================
// 7. EDGE CASE — Object.freeze is shallow, just like spread (Day 26 callback)
// ============================================================

console.log('--- 7. Object.freeze is shallow ---');

const frozenConfig = Object.freeze({
  name: 'app-config',
  limits: { maxUsers: 100 }, // nested object — NOT frozen just because the parent is
});

frozenConfig.name = 'renamed'; // silently fails (non-strict) — this file runs in strict-module-like semantics in most tooling, so this is effectively a no-op either way
console.log('Top-level mutation blocked:', frozenConfig.name); // 'app-config' — unchanged

frozenConfig.limits.maxUsers = 999; // THIS WORKS — `limits` itself was never frozen
console.log('Nested mutation NOT blocked:', frozenConfig.limits.maxUsers); // 999 — changed!

console.log('Object.isFrozen(frozenConfig):', Object.isFrozen(frozenConfig)); // true
console.log('Object.isFrozen(frozenConfig.limits):', Object.isFrozen(frozenConfig.limits)); // false

// A real deep-freeze has to recurse manually (or use a library):
function deepFreeze(obj) {
  Object.getOwnPropertyNames(obj).forEach((key) => {
    const value = obj[key];
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value); // freeze children BEFORE the parent, recursively
    }
  });
  return Object.freeze(obj);
}

const deepFrozenConfig = deepFreeze({ name: 'app-config-v2', limits: { maxUsers: 100 } });
deepFrozenConfig.limits.maxUsers = 999; // now also silently fails
console.log('Deep freeze actually protects nested data:', deepFrozenConfig.limits.maxUsers); // 100 — unchanged

// ============================================================
// 8. EDGE CASE — memoization is only safe for PURE functions
// ============================================================

console.log('--- 8. Why memoization requires purity ---');

function memoize(fn) {
  const cache = new Map(); // simple value-keyed cache for this demo (primitive args only)
  return function memoized(arg) {
    if (cache.has(arg)) {
      return cache.get(arg);
    }
    const result = fn(arg);
    cache.set(arg, result);
    return result;
  };
}

// A genuinely pure function — safe to memoize forever.
let pureCallCount = 0;
function pureSquare(n) {
  pureCallCount += 1; // tracking calls for the demo only — doesn't affect the RETURN VALUE
  return n * n;
}
const memoizedPureSquare = memoize(pureSquare);
memoizedPureSquare(4);
memoizedPureSquare(4);
memoizedPureSquare(4);
console.log('Pure function actually ran this many times:', pureCallCount); // 1 — cache hit the other two times, safely

// An IMPURE function that secretly depends on external, changing state.
let externalMultiplier = 2;
function impureScale(n) {
  return n * externalMultiplier; // depends on state OUTSIDE its arguments — not pure
}
const memoizedImpureScale = memoize(impureScale);
console.log('First call (multiplier=2):', memoizedImpureScale(5)); // 10, and gets cached under key 5
externalMultiplier = 100; // the "real" multiplier changes...
console.log('Second call, SAME arg, multiplier now 100:', memoizedImpureScale(5)); // STILL 10 — stale cached result, the bug is real
