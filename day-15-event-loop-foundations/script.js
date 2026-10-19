// ============================================================
// DAY 15 — EVENT LOOP FOUNDATIONS: CALL STACK, HEAP, AND TASK QUEUES
// ============================================================
// Run in a browser console, via index.html, or with `node script.js`.
// This is the CONCEPTUAL on-ramp day -- deep microtask/macrotask ordering
// rules are deliberately deferred to Day 16 onward. Here we only establish:
// synchronous code always runs to completion before ANY queued callback runs.

console.log('=== SECTION 1: THE CALL STACK RUNS SYNCHRONOUS CODE TO COMPLETION ===');

// ------------------------------------------------------------
// 1. HAPPY PATH — nested synchronous function calls, one stack, no interruption
// ------------------------------------------------------------
function first() {
  console.log('first() -- pushed onto the call stack');
  second(); // this call stacks a NEW frame on top of first()'s frame
  console.log('first() -- resuming after second() returned and was popped');
}
function second() {
  console.log('second() -- pushed onto the call stack, on top of first()');
  third();
  console.log('second() -- resuming after third() returned');
}
function third() {
  console.log('third() -- pushed onto the call stack, on top of second()');
  // nothing left to call -- this frame finishes and gets POPPED
}
first();
// Expected order: first() start, second() start, third() start,
// second() resume, first() resume -- a classic LIFO (last in, first out) stack trace.


console.log('\n=== SECTION 2: setTimeout NEVER RUNS IMMEDIATELY -- IT QUEUES ===');

// ------------------------------------------------------------
// 2. HAPPY PATH — proving a callback is queued, not executed inline
// ------------------------------------------------------------
console.log('before scheduling the timer');
setTimeout(() => {
  console.log('inside the timer callback -- this only runs once the call stack is EMPTY');
}, 0);
console.log('after scheduling the timer (this logs BEFORE the callback above, despite 0ms delay)');
// Expected order: "before scheduling", "after scheduling", THEN (once this
// synchronous block fully finishes) "inside the timer callback".


console.log('\n=== SECTION 3: THE CORE EXERCISE — A SYNCHRONOUS BLOCK STARVES THE QUEUE ===');

// ------------------------------------------------------------
// 3. HAND-TRACE EXERCISE — predict this order BEFORE reading the comments below
// ------------------------------------------------------------
console.log('A - synchronous, start of script');

setTimeout(() => {
  console.log('B - from a timer callback');
}, 0); // scheduled immediately, "ready" almost instantly -- but NOT run yet

console.log('C - synchronous, about to run a heavy loop');
let sum = 0;
for (let i = 0; i < 200_000_000; i++) {
  // A deliberately heavy synchronous computation. While this runs, the call
  // stack is OCCUPIED -- the event loop cannot intervene, cannot check the
  // timer queue, cannot do anything else, no matter how "ready" B already is.
  sum += i;
}
console.log('C - loop finished, sum =', sum);

console.log('D - synchronous, end of script');

// EXPECTED FULL ORDER FOR THIS SECTION: A, C(start log), C(finish log), D,
// and ONLY THEN, once the entire synchronous script body has finished and
// the call stack is completely empty, does B finally print.
// B's 0ms timer elapsed almost instantly -- but "ready to run" just means
// "queued," not "running." The event loop only pulls from the queue once
// there is nothing left on the call stack.


console.log('\n=== SECTION 4: WHY THIS MATTERS -- "BLOCKING THE EVENT LOOP" ===');

// ------------------------------------------------------------
// 4. EDGE CASE — demonstrating that even DOM-adjacent callbacks respect this rule
// ------------------------------------------------------------
function expensiveSynchronousWork(iterations) {
  // Simulates something like a huge array .sort() with a heavy comparator,
  // or JSON.parse on a massive payload -- entirely synchronous, entirely
  // blocking for however long it takes, by design of this demonstration.
  let total = 0;
  for (let i = 0; i < iterations; i++) {
    total += Math.sqrt(i);
  }
  return total;
}

const startTime = Date.now();
setTimeout(() => {
  const delay = Date.now() - startTime;
  console.log(`queued callback finally ran after ~${delay}ms (it was scheduled essentially at time 0)`);
  console.log('the gap above is almost entirely the heavy synchronous work below BLOCKING the stack');
}, 0);

console.log('starting expensive synchronous work -- notice NOTHING else can run until this returns');
const result = expensiveSynchronousWork(50_000_000);
console.log('expensive synchronous work finished, result (unused, just proving it ran):', result > 0);


console.log('\n=== SECTION 5: THE RUNTIME HANDLES WAITING OUTSIDE THE JS THREAD ===');

// ------------------------------------------------------------
// 5. HAPPY PATH — multiple "concurrent" timers, proving the model, not real parallelism
// ------------------------------------------------------------
console.log('scheduling three timers with different delays -- none of this blocks the next line');
setTimeout(() => console.log('timer fired: 30ms'), 30);
setTimeout(() => console.log('timer fired: 10ms'), 10);
setTimeout(() => console.log('timer fired: 20ms'), 20);
console.log('all three timers scheduled synchronously in a few microseconds -- script keeps running immediately');
console.log('(the actual WAITING for 10/20/30ms happens outside the JS thread entirely;');
console.log(' the event loop will deliver each callback in delay order once the stack is free)');
// Expected eventual order (after this synchronous block finishes): the
// 10ms timer fires first, then 20ms, then 30ms -- proving callbacks queue
// up based on when the underlying runtime timer actually completes, not
// the order they were written in source code.
