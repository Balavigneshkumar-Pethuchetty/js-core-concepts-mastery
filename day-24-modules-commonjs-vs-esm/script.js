// ============================================================
// DAY 24 — MODULES: COMMONJS VS ES MODULES
// Real, runnable demonstrations of: synchronous vs asynchronous loading,
// value-copy vs live-binding exports, and circular dependency behavior.
//
// Run with: node script.js   (full demo, writes small temp module files
//   to disk to prove real require()/import() behavior, not just claims)
// In the browser (index.html), the Node-only parts are skipped and a
// real in-browser ESM live-binding demo runs instead, using a Blob URL
// module + dynamic import() — a genuine browser-native equivalent.
// ============================================================

const isNode =
  typeof process !== 'undefined' &&
  process.versions != null &&
  process.versions.node != null;

if (isNode) {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { pathToFileURL } = require('url');

  // Create an isolated scratch directory so this demo never pollutes the
  // actual project folder and always starts from a clean slate.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'day24-modules-'));

  // ============================================================
  // 1. HAPPY PATH — CommonJS require() is synchronous and cached
  // ============================================================
  console.log('--- SECTION 1: CJS require() is synchronous + cached ---');

  const basicModulePath = path.join(tmpDir, 'basic.js');
  fs.writeFileSync(
    basicModulePath,
    `
    console.log('1.basic.js: top-level code runs the FIRST time it is required');
    module.exports = { value: 42 };
    `
  );

  const first = require(basicModulePath);
  const second = require(basicModulePath);
  // Expected: "1.basic.js: top-level code runs..." prints only ONCE, even
  // though require() is called twice — Node caches modules by resolved
  // absolute path. The second require() call returns the SAME cached
  // module.exports object reference, not a re-executed module.
  console.log('1.first === second (same cached object):', first === second); // true

  // ============================================================
  // 2. COMMON PITFALL — CJS exports are VALUE COPIES, not live bindings
  // ============================================================
  console.log('--- SECTION 2: CJS value-copy pitfall ---');

  const cjsCounterPath = path.join(tmpDir, 'cjs-counter.js');
  fs.writeFileSync(
    cjsCounterPath,
    `
    let count = 0;
    module.exports.increment = () => count++;
    // This line copies count's VALUE (0) into the exports object, right now.
    // There is no ongoing link between this exported "count" and the
    // module-internal "count" variable above after this point.
    module.exports.count = count;
    `
  );

  const cjsCounter = require(cjsCounterPath);
  cjsCounter.increment(); // mutates the MODULE'S internal count (now 1)
  console.log('2.CJS consumer sees count =', cjsCounter.count);
  // Expected: 0 — proves require() destructured/accessed a frozen snapshot,
  // not a live reference. This is exactly the bug class interview answers
  // should call out: "exported primitives in CJS don't update."

  // ============================================================
  // 3. EDGE CASE — circular require() returns an INCOMPLETE module.exports
  // ============================================================
  console.log('--- SECTION 3: CJS circular dependency pitfall ---');

  const aPath = path.join(tmpDir, 'circular-a.js');
  const bPath = path.join(tmpDir, 'circular-b.js');

  fs.writeFileSync(
    aPath,
    `
    console.log('3.circular-a.js: start');
    module.exports.aReady = false; // defined BEFORE the circular require below
    const b = require(${JSON.stringify(bPath)});
    console.log('3.circular-a.js: b.doSomething() ->', b.doSomething());
    module.exports.aReady = true;  // defined AFTER — b never sees this update
    module.exports.name = 'a';
    console.log('3.circular-a.js: end');
    `
  );

  fs.writeFileSync(
    bPath,
    `
    console.log('3.circular-b.js: start');
    // This require() call hits Node's module cache for 'a' mid-execution,
    // because 'a' is already in the process of loading (it required us).
    // Node returns a's CURRENT, INCOMPLETE module.exports object instead
    // of waiting for a to finish — this is the circular dependency trap.
    const a = require(${JSON.stringify(aPath)});
    console.log('3.circular-b.js: a.aReady at this point ->', a.aReady);
    module.exports.doSomething = () => 'b-result';
    console.log('3.circular-b.js: end');
    `
  );

  require(aPath);
  // Expected trace:
  //   3.circular-a.js: start
  //   3.circular-b.js: start
  //   3.circular-b.js: a.aReady at this point -> false   <-- the trap: a's
  //       module.exports only had "aReady: false" defined BEFORE a required
  //       b, so b sees that incomplete snapshot, not a's eventual final state
  //   3.circular-b.js: end
  //   3.circular-a.js: b.doSomething() -> b-result
  //   3.circular-a.js: end

  // ============================================================
  // 4. ESM LIVE BINDINGS — the fix, demonstrated with a real dynamic import()
  // ============================================================
  // Dynamic import() is available even inside a CommonJS file/process —
  // it's a runtime operator, not tied to the importing file's module type.
  // We write a genuine .mjs file to prove ESM's live-binding behavior for
  // real, not just assert it in a comment.
  console.log('--- SECTION 4: ESM live-binding fix (real dynamic import) ---');

  const esmCounterPath = path.join(tmpDir, 'esm-counter.mjs');
  fs.writeFileSync(
    esmCounterPath,
    `
    export let count = 0;
    export const increment = () => { count++; };
    `
  );

  (async () => {
    // Node requires a proper file:// URL for dynamic import() of an
    // absolute filesystem path on Windows — a raw path string will throw.
    const esmCounterUrl = pathToFileURL(esmCounterPath).href;
    const esmCounter = await import(esmCounterUrl);

    esmCounter.increment(); // mutates the module's internal count
    console.log('4.ESM consumer sees count =', esmCounter.count);
    // Expected: 1 — unlike section 2's CJS copy, this is a LIVE BINDING.
    // The imported "count" is a direct reference to the exporting module's
    // own binding, so calling increment() is immediately visible to every
    // importer, with no re-import or re-require needed.

    // Cleanup the scratch directory now that every async demo has finished.
    fs.rmSync(tmpDir, { recursive: true, force: true });
  })();
} else {
  // ============================================================
  // BROWSER PATH — fs/require aren't available, but dynamic import() of a
  // Blob-URL module is a genuine, real ESM live-binding demonstration.
  // ============================================================
  console.log('--- BROWSER: Node-only CJS require() demos are skipped here ---');
  console.log('(CommonJS require() does not exist in browsers; see script.js run under Node for that half.)');

  console.log('--- BROWSER: real ESM live-binding demo via Blob URL + dynamic import() ---');

  const moduleSource = `
    export let count = 0;
    export const increment = () => { count++; };
  `;
  const blob = new Blob([moduleSource], { type: 'text/javascript' });
  const moduleUrl = URL.createObjectURL(blob);

  import(/* webpackIgnore: true */ moduleUrl).then((esmCounter) => {
    esmCounter.increment();
    console.log('Browser ESM consumer sees count =', esmCounter.count);
    // Expected: 1 — same live-binding guarantee as section 4's Node demo,
    // proven here using a real, dynamically-constructed ESM module, not a
    // simulation.
    URL.revokeObjectURL(moduleUrl); // free the blob once we're done with it
  });
}
