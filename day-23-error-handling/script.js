// ============================================================
// DAY 23 — ERROR HANDLING
// try/catch/finally mechanics, Error subclassing, error handling across
// sync code / promises / async-await, and global safety nets.
//
// Run with: node script.js   (or open index.html and check the console)
// ============================================================

const isNode =
  typeof process !== 'undefined' &&
  process.versions != null &&
  process.versions.node != null;

// ============================================================
// 1. HAPPY PATH — basic try/catch/finally mechanics
// ============================================================
console.log('--- SECTION 1: happy path try/catch/finally ---');

function divide(a, b) {
  try {
    if (b === 0) {
      // throw immediately unwinds this function's frame; the engine looks
      // for the nearest enclosing catch in the LEXICAL call chain.
      throw new Error('Division by zero');
    }
    return a / b;
  } catch (err) {
    console.log('1.caught:', err.message);
    return null;
  } finally {
    // finally ALWAYS runs — whether try succeeded, whether catch ran,
    // whether an exception is still propagating. It's a guaranteed
    // cleanup hook, not conditional on outcome.
    console.log('1.finally ran, regardless of outcome');
  }
}

console.log('1.result (success case):', divide(10, 2)); // try succeeds, finally still runs
console.log('1.result (failure case):', divide(10, 0)); // catch runs, then finally, then returns null

// ============================================================
// 2. COMMON PITFALL — `finally` silently overriding a return/throw
// ============================================================
console.log('--- SECTION 2: finally override pitfall ---');

function finallyOverridesReturn() {
  try {
    return 'from try';
  } finally {
    // DANGER: a return inside finally ALWAYS wins, discarding the try
    // block's return value entirely. This is legal JS but a footgun —
    // never put control-flow statements (return/throw/break/continue)
    // inside finally in real code.
    return 'from finally (this silently wins)';
  }
}

console.log('2.result:', finallyOverridesReturn());
// Expected: "from finally (this silently wins)" — proves finally's own
// return statement overrides whatever try was about to return.

// ============================================================
// 3. CUSTOM ERROR SUBCLASSING
// ============================================================
console.log('--- SECTION 3: custom error subclassing ---');

class AppError extends Error {
  constructor(message, options = {}) {
    super(message, { cause: options.cause }); // ES2022 Error.cause chains the original low-level error
    this.name = this.constructor.name; // so subclasses report their OWN name, not "Error"
    Object.setPrototypeOf(this, new.target.prototype); // defensive: keeps instanceof correct across transpiler edge cases
  }
}

class ValidationError extends AppError {
  constructor(message, { field } = {}) {
    super(message);
    this.field = field; // structured metadata beats parsing a message string later
  }
}

class RetryableError extends AppError {
  constructor(message, options = {}) {
    super(message, options);
  }
}

try {
  throw new ValidationError('Email is required', { field: 'email' });
} catch (err) {
  console.log('3.name:', err.name);                      // "ValidationError", not generic "Error"
  console.log('3.message:', err.message);                 // "Email is required"
  console.log('3.field:', err.field);                      // "email" — structured, not string-parsed
  console.log('3.instanceof AppError:', err instanceof AppError);        // true — inheritance chain intact
  console.log('3.instanceof ValidationError:', err instanceof ValidationError); // true
}

// Error.cause demonstration: chaining a low-level error without losing it.
try {
  try {
    JSON.parse('{ not valid json');
  } catch (lowLevelErr) {
    throw new AppError('Failed to parse config', { cause: lowLevelErr });
  }
} catch (err) {
  console.log('3.cause chain message:', err.message);
  console.log('3.cause chain original:', err.cause.message); // the original SyntaxError is preserved, not lost
}

// ============================================================
// 4. ERROR HANDLING ACROSS SYNC / PROMISE / ASYNC-AWAIT
// ============================================================
console.log('--- SECTION 4: sync vs promise vs async/await error channels ---');

// 4a. Synchronous throw — unwinds the call stack immediately.
function syncThrows() {
  throw new Error('sync failure');
}
try {
  syncThrows();
} catch (err) {
  console.log('4a.caught synchronously:', err.message);
}

// 4b. Promise rejection — does NOT unwind a stack; it's STATE on the
// promise object, propagated through .then()'s rejection handler or .catch().
function promiseRejects() {
  return new Promise((resolve, reject) => {
    reject(new Error('promise failure'));
  });
}
promiseRejects()
  .then(() => console.log('4b.this never runs, promise rejected'))
  .catch((err) => console.log('4b.caught via .catch():', err.message));

// 4c. async/await — the rejection is converted BACK into a throw at the
// await point, so ordinary try/catch works, even though under the hood
// it's the exact same promise machinery as 4b.
async function asyncAwaitThrows() {
  try {
    await promiseRejects();
    console.log('4c.this never runs either');
  } catch (err) {
    console.log('4c.caught via try/catch around await:', err.message);
  }
}
asyncAwaitThrows();

// 4d. PITFALL: kicking off a promise INSIDE a try block but not awaiting
// it means its rejection escapes the try/catch entirely, because the
// catch block's synchronous pass has already finished by the time the
// promise rejects.
async function forgottenAwaitPitfall() {
  try {
    const p = promiseRejects(); // NOT awaited — fire and forget
    console.log('4d.try block finished without awaiting the promise');
    // p rejects later, asynchronously, long after this try/catch has
    // already exited — nothing here will ever catch it.
    p.catch((err) =>
      console.log('4d.the rejection had to be caught separately, here:', err.message)
    );
  } catch (err) {
    console.log('4d.this catch block never fires for the unawaited rejection');
  }
}
forgottenAwaitPitfall();

// ============================================================
// 5. EDGE CASE — catch + conditional recovery + finally, matching README exercise
// ============================================================
console.log('--- SECTION 5: riskyPipeline exercise (README hands-on) ---');

function stepThatSucceeds() {
  return Promise.resolve('step-ok');
}

function stepThatRejectsWith(ErrorClass, message) {
  return Promise.reject(new ErrorClass(message));
}

async function riskyPipeline(ErrorClassToThrow) {
  try {
    const step1 = await stepThatSucceeds();
    console.log('5.step1 succeeded:', step1);

    const step2 = await stepThatRejectsWith(ErrorClassToThrow, 'step2 failed');
    return step2; // never reached when step2 rejects
  } catch (err) {
    if (err instanceof RetryableError) {
      console.log('5.retrying once... (matched RetryableError)');
      return await stepThatSucceeds(); // recovery path
    }
    console.log('5.unrecognized error, re-throwing:', err.name);
    throw err; // propagate anything we don't know how to recover from
  } finally {
    // Runs in BOTH the recovery path and the re-throw path — cleanup is
    // unconditional, and importantly it runs BEFORE the function's
    // returned promise actually settles (resolves or rejects).
    console.log('5.pipeline cleanup ran');
  }
}

async function runPipelineDemo() {
  // Case A: RetryableError triggers the recovery branch inside catch.
  const recovered = await riskyPipeline(RetryableError);
  console.log('5.case A final result:', recovered); // "step-ok", from the retry

  // Case B: a plain Error (via AppError, not RetryableError) is re-thrown,
  // so the caller here must catch it, or it becomes an unhandled rejection.
  try {
    await riskyPipeline(AppError);
  } catch (err) {
    console.log('5.case B caller caught the re-thrown error:', err.message);
  }
}
runPipelineDemo();

// ============================================================
// 6. GLOBAL SAFETY NETS — environment-specific, both demonstrated
// ============================================================
console.log('--- SECTION 6: global unhandled error/rejection handlers ---');

if (isNode) {
  // Node.js only: process-level safety nets.
  process.on('unhandledRejection', (reason) => {
    console.log('6.Node unhandledRejection caught globally:', reason.message);
  });
  process.on('uncaughtException', (err) => {
    // Treat this as last-resort logging + controlled shutdown, NOT a
    // recovery mechanism — the process state is no longer trustworthy.
    console.log('6.Node uncaughtException caught globally:', err.message);
  });

  // Deliberately create an unhandled rejection to demonstrate the hook.
  Promise.reject(new Error('intentionally unhandled, for demonstration'));
} else if (typeof window !== 'undefined') {
  // Browser-equivalent global safety nets.
  window.addEventListener('unhandledrejection', (event) => {
    console.log('6.Browser unhandledrejection caught globally:', event.reason.message);
    event.preventDefault(); // prevents the default "uncaught in promise" console noise
  });
  window.addEventListener('error', (event) => {
    console.log('6.Browser window.onerror caught globally:', event.message);
  });

  // Deliberately create an unhandled rejection to demonstrate the hook.
  Promise.reject(new Error('intentionally unhandled, for demonstration'));
}
