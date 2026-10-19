// ============================================================
// DAY 03: SCOPE, SCOPE CHAIN, LEXICAL ENVIRONMENT RECORDS
// ============================================================
// Goal: see identifier resolution WALK the scope chain, see that
// the chain is fixed by where code is WRITTEN (lexical), not by
// who calls it (dynamic), and see shadowing/TDZ interact with scope.

// ============================================================
// 1. HAPPY PATH — the scope chain being walked across 3 levels
// ============================================================
let globalLevelVar = 'I live in the Global Environment';

function outerScopeDemo() {
  let outerLevelVar = 'I live in outerScopeDemo\'s Function Environment';

  function innerScopeDemo() {
    // Neither of these exists in innerScopeDemo's OWN environment
    // record. The engine walks [[OuterEnv]] to find each one:
    //   innerScopeDemo env -> outerScopeDemo env -> Global env
    console.log('innerScopeDemo sees:', outerLevelVar);
    console.log('innerScopeDemo sees:', globalLevelVar);
  }

  innerScopeDemo();
}
outerScopeDemo();

// ============================================================
// 2. HAPPY PATH — lexical (not dynamic) scoping proof
// ============================================================
// This demonstrates that scope is fixed by WHERE a function is
// DEFINED, not by where/how it is later called from.
let secret = 'defined at module/global level';

function revealSecret() {
  // revealSecret's [[OuterEnv]] points to the Global Environment
  // because that's where it was LEXICALLY written -- forever,
  // regardless of who calls it or from what other scope.
  console.log('revealSecret sees secret =', secret);
}

function callerWithDifferentSecret() {
  // This local `secret` is COMPLETELY invisible to revealSecret,
  // even though callerWithDifferentSecret is the one invoking it.
  // If JS were dynamically scoped, revealSecret might see THIS one.
  let secret = 'a totally different local value';
  revealSecret();
  console.log('callerWithDifferentSecret\'s own local secret is:', secret);
}
callerWithDifferentSecret();
// Output proves revealSecret still sees the GLOBAL secret, never
// the caller's local one -- scope chain is about definition site.

// ============================================================
// 3. COMMON PITFALL — shadowing + TDZ interacting inside one function
// ============================================================
let level = 'outer';

function shadowDemo() {
  try {
    // This LOOKS like it should fall back to the outer `level` since
    // the inner one hasn't been assigned yet on this line. It does
    // NOT. shadowDemo has its OWN `let level` declared later in this
    // function body, which means that name is hoisted (TDZ-locked)
    // across the ENTIRE function scope, shadowing the outer variable
    // from line 1 of the function -- not just from its own line down.
    console.log(level);
  } catch (err) {
    console.log('Caught expected shadowing/TDZ error:', err.name, '-', err.message);
  }

  let level2 = 'inner'; // (renamed to level2 so the rest of the file
  // below doesn't accidentally trip the SAME TDZ trap on `level` --
  // see the dedicated, isolated repro in shadowDemoIsolated below
  // for the exact original trap using the real name twice.)
  console.log('after its own declaration line:', level2);
}
shadowDemo();

function shadowDemoIsolated() {
  try {
    console.log(level); // same trap, with the real shared name `level`
  } catch (err) {
    console.log('Caught expected shadowing/TDZ error (isolated):', err.name, '-', err.message);
  }
  let level = 'inner, shadowing the outer `level`';
  console.log('after its own declaration line (isolated):', level);
}
shadowDemoIsolated();

// ============================================================
// 4. EDGE CASE — block scope vs function scope side by side
// ============================================================
function blockVsFunctionScope() {
  var fnScopedFlag = 'var set outside any block';

  {
    // A bare block still creates a Block Environment for let/const.
    let blockScopedFlag = 'let set inside a bare block';
    var fnScopedFlagInsideBlock = 'var set inside a bare block, but NOT block-scoped';
    console.log('inside block:', blockScopedFlag, '|', fnScopedFlagInsideBlock);
  }

  // blockScopedFlag is gone -- it never existed outside its block.
  // fnScopedFlagInsideBlock IS visible here -- var ignored the block
  // entirely and attached itself to blockVsFunctionScope's own
  // Function Environment, same as fnScopedFlag.
  console.log('outside block, fnScopedFlagInsideBlock still visible:', fnScopedFlagInsideBlock);

  try {
    console.log(blockScopedFlag);
  } catch (err) {
    console.log('Caught expected error, blockScopedFlag never escaped its block:', err.name, '-', err.message);
  }
}
blockVsFunctionScope();

// ============================================================
// 5. EDGE CASE — scope chain enabling a closure (preview of Day 04)
// ============================================================
// This is the exact mechanism that makes closures possible: a
// returned inner function keeps a LIVE reference ([[OuterEnv]]) to
// the Lexical Environment it was defined in, even after the outer
// function's execution context has been popped off the call stack.
function makeCounter() {
  let count = 0; // lives in makeCounter's Function Environment

  // The returned arrow function's [[OuterEnv]] permanently points
  // back to makeCounter's environment record -- that record is kept
  // alive by this reference even after makeCounter() has returned.
  return () => {
    count += 1;
    return count;
  };
}

const counter = makeCounter(); // makeCounter's EC is popped off the stack right after this call returns
console.log('counter() call 1:', counter()); // 1 -- still resolves `count` via the scope chain
console.log('counter() call 2:', counter()); // 2 -- same live binding, not a fresh one
console.log('counter() call 3:', counter()); // 3

console.log('--- Day 03 script complete ---');
