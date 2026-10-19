// ============================================================
// DAY 19: GENERATORS, ITERATORS & COROUTINES
// ============================================================
// function* creates a FACTORY for a pausable execution context.
// Calling it does NOT run the body — only .next() does, one
// `yield` at a time. This is the primitive async/await (Day 18)
// is built on.
// ============================================================


// ============================================================
// 1. HAPPY PATH — basic generator mechanics
// ============================================================

function* simpleGenerator() {
  console.log('[1] generator body: before first yield');
  const received1 = yield 'first value';
  console.log('[1] generator body: resumed with', received1);
  const received2 = yield 'second value';
  console.log('[1] generator body: resumed with', received2);
  return 'final return value';
}

console.log('[1] calling simpleGenerator() does NOT run the body yet:');
const gen1 = simpleGenerator();
console.log('[1] ^ confirmed: nothing logged above this line from inside the body');

console.log('[1] call next() #1:', gen1.next());
// Body runs from top until the FIRST yield, logs 'before first
// yield', yields 'first value', suspends. received1 not yet set.

console.log('[1] call next() #2 (passing "hello"):', gen1.next('hello'));
// Resumes right after the first yield; 'hello' becomes received1's
// value. Runs to the SECOND yield, logs the resume message,
// yields 'second value', suspends.

console.log('[1] call next() #3 (passing "world"):', gen1.next('world'));
// Resumes; 'world' becomes received2. Runs off the end via
// `return` -> { value: 'final return value', done: true }.

console.log('[1] call next() #4 (already exhausted):', gen1.next());
// Generator is finished. Further calls just return
// { value: undefined, done: true } forever — it does NOT restart.


// ============================================================
// 2. COMMON PITFALL(S)
// ============================================================

// PITFALL A: forgetting that calling a generator function doesn't
// execute anything — a classic "why isn't my log printing" bug.
function* pitfallNotCalledYet() {
  console.log('[2A] this will NOT print until the first .next() call');
  yield 1;
}
function demoPitfallA() {
  console.log('[2A] creating the generator object...');
  const g = pitfallNotCalledYet();
  console.log('[2A] ...generator object created, body has NOT run yet');
  g.next(); // THIS is what actually triggers the body to start running
  console.log('[2A] ...now the body has run up to its first yield');
}
demoPitfallA();

// PITFALL B: treating a generator as reusable/restartable. Once
// exhausted (done: true), you must create a NEW generator object
// to iterate again — you cannot "rewind" one.
function* pitfallAssumingRestart() {
  yield 'only value';
}
function demoPitfallB() {
  const g = pitfallAssumingRestart();
  console.log('[2B] first pass:', [...g]); // spread drains it fully
  console.log('[2B] second pass on SAME generator:', [...g]); // empty! already exhausted
  const freshG = pitfallAssumingRestart();
  console.log('[2B] correct: new generator instance:', [...freshG]);
}
demoPitfallB();

// PITFALL C: confusing `yield` (pause, resumable) with `return`
// (finish for good).
function* pitfallYieldVsReturn() {
  yield 'A';
  return 'B'; // generator is DONE after this — no more values ever
  yield 'C';  // UNREACHABLE — dead code, never runs
}
function demoPitfallC() {
  const g = pitfallYieldVsReturn();
  console.log('[2C] next 1:', g.next()); // { value: 'A', done: false }
  console.log('[2C] next 2:', g.next()); // { value: 'B', done: true } — 'C' never happens
  console.log('[2C] next 3:', g.next()); // { value: undefined, done: true }
}
demoPitfallC();


// ============================================================
// 3. EDGE CASE(S)
// ============================================================

// EDGE CASE A: generators auto-implement the iterable protocol,
// so they work directly with for...of, spread, and destructuring.
function* threeValues() {
  yield 'x';
  yield 'y';
  yield 'z';
}
console.log('[3A] for...of over a generator:');
for (const val of threeValues()) {
  console.log('[3A]  ->', val);
}
console.log('[3A] spread into array:', [...threeValues()]);
const [first, , third] = threeValues();
console.log('[3A] destructured (skipping middle):', first, third);

// EDGE CASE B: lazy evaluation with an INFINITE generator — this
// would be impossible to represent as an eager array.
function* naturalNumbersInfinite() {
  let n = 1;
  while (true) {
    yield n;
    n++;
  }
}
function demoLazyInfinite() {
  console.log('[3B] pulling only 5 values from an INFINITE generator:');
  const results = [];
  for (const n of naturalNumbersInfinite()) {
    results.push(n);
    if (results.length === 5) break; // generator suspends forever here, no leak
  }
  console.log('[3B] results:', results);
  // Nothing beyond 5 was ever computed — true lazy evaluation.
  // An eager `Array.from({length: Infinity})` equivalent would
  // hang/crash; the generator never materializes more than asked.
}
demoLazyInfinite();

// EDGE CASE C: yield* delegates to another iterable/generator,
// forwarding next()/throw()/return() transparently.
function* innerGenerator() {
  yield 'inner-1';
  yield 'inner-2';
}
function* outerGenerator() {
  yield 'outer-start';
  yield* innerGenerator(); // delegates — forwards all of innerGenerator's yields
  yield* ['array', 'works', 'too']; // yield* works on ANY iterable, not just generators
  yield 'outer-end';
}
console.log('[3C] yield* delegation:', [...outerGenerator()]);

// EDGE CASE D: .throw() injects an exception AT the suspended
// yield point — the SAME mechanism Day 18's async/await runner
// uses to turn a rejected awaited promise into a catchable throw.
function* generatorWithTryCatch() {
  try {
    yield 'about to maybe receive an exception';
    yield 'this only runs if no exception was thrown';
  } catch (err) {
    console.log('[3D] caught INSIDE the generator:', err.message);
    yield 'recovered, continuing after catch';
  }
}
function demoThrowIntoGenerator() {
  const g = generatorWithTryCatch();
  console.log('[3D] next():', g.next());
  console.log(
    '[3D] throw() injects exception at the suspended yield:',
    g.throw(new Error('[3D] injected error'))
  );
}
demoThrowIntoGenerator();

// EDGE CASE E: building a custom ITERABLE OBJECT (not just a bare
// generator) by implementing Symbol.iterator with a generator
// method — this is the idiomatic way to make your own class
// work with for...of (direct callback to Day 14).
class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
  // Implementing [Symbol.iterator] via a generator method means
  // we get a fully protocol-compliant iterator for free, instead
  // of hand-writing a next()/done object ourselves.
  *[Symbol.iterator]() {
    for (let i = this.start; i <= this.end; i++) {
      yield i;
    }
  }
}
console.log('[3E] custom iterable class via generator method:');
for (const n of new Range(5, 8)) {
  console.log('[3E]  ->', n);
}
console.log('[3E] spread also works:', [...new Range(1, 3)]);


// ============================================================
// 4. GENERATOR + PROMISE RUNNER — the async/await connection
// ============================================================
// This is the SAME desugaring shown in Day 18's script.js,
// included here too because it's the direct, concrete proof
// that async/await is generators + a scheduler, not a separate
// primitive. Read this section alongside Day 18.

function runGeneratorAsPromise(generatorFn) {
  // This function IS a hand-written version of what the engine
  // does natively for every `async function`.
  return new Promise((resolve, reject) => {
    const gen = generatorFn();

    function step(input) {
      let result;
      try {
        result = gen.next(input);
      } catch (err) {
        return reject(err);
      }
      if (result.done) {
        return resolve(result.value);
      }
      Promise.resolve(result.value).then(step, (err) => {
        try {
          const thrown = gen.throw(err);
          // if the generator catches it and yields again, keep driving
          if (thrown.done) resolve(thrown.value);
          else Promise.resolve(thrown.value).then(step);
        } catch (e) {
          reject(e);
        }
      });
    }
    step();
  });
}

function* coroutineStyleTask() {
  console.log('[4] coroutine: step 1');
  const a = yield Promise.resolve('A');
  console.log('[4] coroutine: step 2, a =', a);
  const b = yield Promise.resolve(a + 'B');
  console.log('[4] coroutine: step 3, b =', b);
  return b;
}

runGeneratorAsPromise(coroutineStyleTask).then((finalResult) =>
  console.log(
    '[4] runGeneratorAsPromise final result (equivalent to an async function\'s return):',
    finalResult
  )
);


// ============================================================
// 5. ASYNC ORDERING TRACE — bidirectional yield puzzle from README.md
// ============================================================

function theOrderingPuzzle() {
  function* naturalNumbers() {
    let n = 1;
    while (true) {
      // `yield n` SUSPENDS here, and whatever value is passed into
      // the NEXT .next(x) call becomes the result of THIS
      // expression when execution resumes — that's the
      // bidirectional channel: values go OUT via yield's argument,
      // values come IN via .next()'s argument, at the SAME point.
      const resetTo = yield n;
      n = resetTo !== undefined ? resetTo : n + 1;
    }
  }

  const gen = naturalNumbers();

  console.log('call 1:', gen.next());
  // WHY { value: 1, done: false }: body runs from the top, n=1,
  // hits `yield n` for the first time -> yields 1, suspends.
  // `resetTo` is NOT assigned yet (assignment happens on resume).

  console.log('call 2:', gen.next());
  // WHY { value: 2, done: false }: resumes with resetTo = undefined
  // (no argument passed) -> n = n + 1 = 2. Loop continues, hits
  // `yield n` again with n=2 -> yields 2, suspends.

  console.log('call 3 (passing 100):', gen.next(100));
  // WHY { value: 100, done: false }: resumes the SAME suspended
  // `yield n` expression, this time it evaluates to 100 ->
  // resetTo = 100. Since 100 !== undefined, n is set DIRECTLY to
  // 100 (no increment). Loop continues, hits `yield n` with the
  // NEW n=100 -> yields 100, suspends.

  console.log('call 4:', gen.next());
  // WHY { value: 101, done: false }: resumes with resetTo =
  // undefined again -> n = n + 1 = 101. Yields 101.
}
theOrderingPuzzle();
