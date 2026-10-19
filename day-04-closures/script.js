// ============================================================
// DAY 04: CLOSURES IN DEPTH
// ============================================================
// Goal: see a closure keep a live (not snapshotted) reference to
// its outer environment, see the classic var-vs-let loop capture
// bug reproduced directly, and see 3 real production patterns that
// rely entirely on this mechanism.

// ============================================================
// 1. HAPPY PATH — a closure holding a LIVE reference, not a snapshot
// ============================================================
function makeCounter() {
  let count = 0; // lives in makeCounter's Function Environment

  // This returned function's [[Environment]] slot points back at
  // makeCounter's environment record. That record survives even
  // after makeCounter() itself has returned and its execution
  // context has been popped off the call stack (Day 01).
  return function increment() {
    count += 1; // mutating the SAME live binding every single call
    return count;
  };
}

const counterA = makeCounter();
const counterB = makeCounter(); // a totally separate environment/count
console.log('counterA:', counterA(), counterA(), counterA()); // 1 2 3
console.log('counterB (independent closure):', counterB(), counterB()); // 1 2
// counterA and counterB never interfere -- each call to makeCounter()
// creates a BRAND NEW environment record with its own `count`.

// ============================================================
// 2. HAPPY PATH — closures see live updates, not frozen values
// ============================================================
function makeGreeter() {
  let name = 'stranger';

  return {
    setName: (newName) => { name = newName; }, // mutates the shared closed-over binding
    greet: () => `Hello, ${name}!`,             // reads the CURRENT value, every call
  };
}

const greeter = makeGreeter();
console.log(greeter.greet()); // 'Hello, stranger!'
greeter.setName('Grace');
console.log(greeter.greet()); // 'Hello, Grace!' -- proves it's a live reference, not a snapshot taken at creation time

// ============================================================
// 3. COMMON PITFALL — the classic var-vs-let loop capture bug
// ============================================================
function buildHandlersVar() {
  var handlers = [];
  for (var i = 0; i < 3; i++) {
    // Every pushed function closes over the SAME `i` binding --
    // var creates exactly one binding for the entire loop, shared
    // across all iterations (Day 02/03 mechanics).
    handlers.push(function () {
      return 'handler for item ' + i;
    });
  }
  return handlers;
}

function buildHandlersLet() {
  var handlers = [];
  for (let i = 0; i < 3; i++) {
    // Every pushed function closes over a FRESH `i` binding --
    // `let` creates a brand-new lexical environment per iteration.
    handlers.push(function () {
      return 'handler for item ' + i;
    });
  }
  return handlers;
}

const varHandlers = buildHandlersVar();
const letHandlers = buildHandlersLet();
console.log('var-based handlers (bug):', varHandlers.map((fn) => fn())); // all say "item 3"
console.log('let-based handlers (fixed):', letHandlers.map((fn) => fn())); // say "item 0", "item 1", "item 2"

// The traditional pre-ES6 fix, shown for completeness: wrap each
// iteration's body in its own function call (an IIFE) so each `i`
// gets passed BY VALUE into its own fresh parameter binding.
function buildHandlersVarWithIIFEFix() {
  var handlers = [];
  for (var i = 0; i < 3; i++) {
    handlers.push(
      (function (capturedI) {
        // capturedI is a fresh PARAMETER for this specific IIFE call,
        // so each inner function closes over its own distinct binding.
        return function () {
          return 'handler for item ' + capturedI;
        };
      })(i)
    );
  }
  return handlers;
}
console.log('var-based handlers, IIFE-fixed:', buildHandlersVarWithIIFEFix().map((fn) => fn()));

// ============================================================
// 4. EDGE CASE — memory implication: a closure pins its WHOLE outer scope
// ============================================================
function makeLeakyAndTightClosures() {
  const smallValueActuallyUsed = 'needed';
  const hugeArrayNeverUsedByClosure = new Array(1_000_000).fill('simulated large retained data');

  // leakyClosure closes over the ENTIRE outer environment record --
  // even though it never references hugeArrayNeverUsedByClosure,
  // that variable lives in the SAME environment record this closure
  // points to, so as long as leakyClosure is reachable, V8 cannot
  // collect that environment record (or anything still linked from
  // it) -- this is the real production leak shape described in the
  // README: a closure pinning memory it never even touches.
  const leakyClosure = () => smallValueActuallyUsed;

  return leakyClosure;
}

const retainedClosure = makeLeakyAndTightClosures();
console.log('retainedClosure() still works:', retainedClosure());
console.log('Note: the huge array from that call is only reclaimable once retainedClosure itself becomes unreachable.');

// ============================================================
// 5. EDGE CASE — production pattern: memoization via closure-held cache
// ============================================================
function memoize(fn) {
  // `cache` lives in memoize's environment, closed over by the
  // returned function below. It persists across every call to the
  // memoized function, without ever touching outer/global scope.
  const cache = new Map();

  return function memoized(arg) {
    if (cache.has(arg)) {
      console.log(`  [memoize] cache HIT for ${arg}`);
      return cache.get(arg);
    }
    console.log(`  [memoize] cache MISS for ${arg}, computing...`);
    const result = fn(arg);
    cache.set(arg, result);
    return result;
  };
}

function expensiveSquare(n) {
  // Simulates a genuinely expensive computation.
  let total = 0;
  for (let k = 0; k < 1000; k++) total += n;
  return n * n;
}

const memoizedSquare = memoize(expensiveSquare);
console.log('memoizedSquare(4) =', memoizedSquare(4)); // MISS, computes
console.log('memoizedSquare(4) =', memoizedSquare(4)); // HIT, reused
console.log('memoizedSquare(5) =', memoizedSquare(5)); // MISS, computes

// ============================================================
// 6. EDGE CASE — production pattern: private state via closure
// ============================================================
function createBankAccount(initialBalance) {
  // `balance` has NO external reference pointing to it directly --
  // the only way to read or change it is through the returned
  // methods, which is true encapsulation via scope, not convention.
  let balance = initialBalance;

  return {
    deposit(amount) {
      balance += amount;
      return balance;
    },
    withdraw(amount) {
      if (amount > balance) {
        throw new Error('Insufficient funds');
      }
      balance -= amount;
      return balance;
    },
    getBalance() {
      return balance;
    },
  };
}

const account = createBankAccount(100);
console.log('Starting balance:', account.getBalance());
console.log('After deposit(50):', account.deposit(50));
console.log('After withdraw(30):', account.withdraw(30));
// There is no `account.balance` property at all -- it genuinely
// cannot be reached from outside except through these 3 methods.
console.log('Direct access attempt, account.balance:', account.balance); // undefined

console.log('--- Day 04 script complete ---');
