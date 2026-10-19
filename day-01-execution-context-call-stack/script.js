// ============================================================
// DAY 01: EXECUTION CONTEXT, CALL STACK, STACK FRAMES
// ============================================================
// Goal: see, with real console output, how the engine pushes and
// pops execution contexts onto the call stack as functions call
// other functions, and what happens when that stack is exhausted.

// ============================================================
// 1. HAPPY PATH — the mechanism working as expected
// ============================================================

// Each of these functions, when CALLED, gets its own brand-new
// execution context pushed onto the call stack. The context holds
// this function's local variables, its `this` binding, and a
// reference back to the scope it was defined in (not called from --
// that distinction matters a lot later, on Day 03).
function traceC() {
  console.log('ENTER traceC');
  // traceC does no further calls, so it's the first to finish and
  // the first frame to be POPPED off the stack.
  console.log('EXIT traceC');
}

function traceB() {
  console.log('ENTER traceB');
  traceC(); // pushes traceC's EC on top of traceB's EC
  console.log('EXIT traceB');
}

function traceA() {
  console.log('ENTER traceA');
  traceB(); // pushes traceB's EC on top of traceA's EC
  console.log('EXIT traceA');
}

// Calling traceA() pushes its EC on top of the Global EC, which was
// already sitting at the bottom of the stack from the moment this
// file started executing.
traceA();
// Expected order:
// ENTER traceA
// ENTER traceB
// ENTER traceC
// EXIT traceC   <- deepest call finishes first (LIFO)
// EXIT traceB
// EXIT traceA

// ============================================================
// 2. VISUALIZING THE STACK DIRECTLY
// ============================================================
// We can't read V8's real internal stack from user code, but we can
// build a parallel "shadow stack" ourselves to make the push/pop
// mechanic concrete. This mirrors exactly what the engine is doing
// internally every time a function is called and returns.
const shadowStack = [];

function pushFrame(name) {
  shadowStack.push(name);
  console.log(`[stack] push ${name} -> [${shadowStack.join(', ')}]`);
}

function popFrame() {
  const name = shadowStack.pop();
  console.log(`[stack] pop  ${name} -> [${shadowStack.join(', ')}]`);
}

function outer() {
  pushFrame('outer');
  middle();
  popFrame(); // 'outer'
}

function middle() {
  pushFrame('middle');
  inner();
  popFrame(); // 'middle'
}

function inner() {
  pushFrame('inner');
  // At this exact point, shadowStack === ['outer', 'middle', 'inner']
  // which is precisely what the real call stack looks like too.
  console.log('  >> deepest point, shadowStack =', shadowStack.join(' -> '));
  popFrame(); // 'inner'
}

outer();

// ============================================================
// 3. COMMON PITFALL — recursion without a reachable base case
// ============================================================
// This is deliberately WRAPPED in try/catch so the script keeps
// running after demonstrating the crash -- in real production code
// you would almost never want to swallow a stack overflow like this,
// but for a learning script we want to see the error AND keep going.
function recurseForever(depth) {
  // No base case that stops growth -- depth is cosmetic logging only,
  // it never causes the recursion to stop. Every call pushes a new,
  // real execution context, consuming real (small, fixed) stack memory.
  return recurseForever(depth + 1);
}

try {
  recurseForever(0);
} catch (err) {
  // In V8 this is a RangeError, not a generic Error, and the message
  // is specifically about call stack size, not heap/memory in general.
  console.log('Caught expected crash:', err.name, '-', err.message);
}

// ============================================================
// 4. EDGE CASE — correct recursion that DOES terminate
// ============================================================
// Contrast with recurseForever: this has a real base case (n <= 1),
// so the stack grows to a bounded depth (n frames) and then unwinds
// cleanly. Each call's local `n` is independent -- that's the whole
// point of each call getting its OWN execution context.
function factorial(n) {
  if (n <= 1) {
    console.log(`factorial base case hit, n=${n}, returning 1`);
    return 1;
  }
  console.log(`factorial(${n}) -> about to call factorial(${n - 1})`);
  const result = n * factorial(n - 1);
  console.log(`factorial(${n}) resuming after its nested call, result=${result}`);
  return result;
}

console.log('factorial(5) =', factorial(5));
// Notice the two-phase log pattern: all the "about to call" lines
// print on the way DOWN the stack (as frames get pushed), then all
// the "resuming after" lines print on the way back UP (as frames
// get popped) -- in exactly reverse order. That reversal IS the
// LIFO call stack made visible through logging.

// ============================================================
// 5. EDGE CASE — stack depth with a controlled, safe limit
// ============================================================
// Demonstrates that the overflow point is deterministic and tied to
// frame count, not to elapsed time -- it's a memory limit, not a
// timeout. We cap it ourselves here at a safe depth so this part of
// the script never throws, just to show depth tracking in isolation.
function countDepth(current, max) {
  if (current >= max) {
    return current;
  }
  return countDepth(current + 1, max);
}

const reachedDepth = countDepth(0, 1000);
console.log(`Safely recursed to a controlled depth of ${reachedDepth} (well under V8's limit).`);

console.log('--- Day 01 script complete ---');
