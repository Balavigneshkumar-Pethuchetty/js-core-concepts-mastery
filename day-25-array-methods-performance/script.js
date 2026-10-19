// ============================================================
// DAY 25 — ARRAY METHODS & PERFORMANCE
// V8 element kinds, sparse arrays, indexOf vs includes, and a real timed
// micro-benchmark comparing four ways to sum squares of evens.
//
// Run with: node script.js   (or open index.html and check the console)
// ============================================================

// ============================================================
// 1. HAPPY PATH — core array methods doing exactly what they promise
// ============================================================
console.log('--- SECTION 1: happy path ---');

const nums = [1, 2, 3, 4, 5];

const doubled = nums.map((n) => n * 2); // new array, one callback call per element
console.log('1.map doubled:', doubled);

const evens = nums.filter((n) => n % 2 === 0); // new array, keeps elements where callback is truthy
console.log('1.filter evens:', evens);

const sum = nums.reduce((acc, n) => acc + n, 0); // single accumulator folded across the array
console.log('1.reduce sum:', sum);

let forEachTotal = 0;
nums.forEach((n) => {
  forEachTotal += n; // forEach has no return value; side effects only
});
console.log('1.forEach total (via side effect):', forEachTotal);

// ============================================================
// 2. COMMON PITFALL — `delete` creates a hole and permanently demotes
// the array out of V8's fast packed element kind
// ============================================================
console.log('--- SECTION 2: delete vs splice pitfall ---');

const packedArray = [10, 20, 30, 40, 50]; // starts PACKED_SMI_ELEMENTS internally

delete packedArray[2];
// This does NOT shift elements down and does NOT shrink length. It leaves
// a HOLE at index 2. V8 demotes this array to a HOLEY element kind,
// permanently, for the rest of its lifetime — even if you later "fix" it.
console.log('2.after delete, length is still:', packedArray.length); // 5, unchanged
console.log('2.after delete, array looks like:', packedArray); // [10, 20, <1 empty item>, 40, 50]

const correctlyRemoved = [10, 20, 30, 40, 50];
correctlyRemoved.splice(2, 1);
// splice actually shifts subsequent elements down and shrinks length by 1.
// No hole is created — the array stays dense/packed.
console.log('2.after splice, length is:', correctlyRemoved.length); // 4
console.log('2.after splice, array looks like:', correctlyRemoved); // [10, 20, 40, 50]

// Proof that forEach/map/filter SKIP holes entirely, while a plain for
// loop does NOT skip them (it just reads undefined):
let forEachVisitCount = 0;
packedArray.forEach(() => forEachVisitCount++);
console.log('2.forEach visited this many elements (holes skipped):', forEachVisitCount); // 4, not 5

let forLoopVisitCount = 0;
for (let i = 0; i < packedArray.length; i++) {
  forLoopVisitCount++; // a plain for loop visits EVERY index, hole or not
  void packedArray[i]; // reading a hole just yields undefined, no skip
}
console.log('2.plain for-loop visited this many indices (holes included):', forLoopVisitCount); // 5

// ============================================================
// 3. EDGE CASE — sparse arrays from `new Array(n)` vs a genuinely dense array
// ============================================================
console.log('--- SECTION 3: sparse array edge case ---');

const sparseArray = new Array(5); // length 5, but ZERO real elements — all holes
console.log('3.sparseArray.length:', sparseArray.length); // 5
console.log('3.sparseArray.map((x) => x) result:', sparseArray.map((x) => x));
// Expected: another fully-holey array — map's callback is never invoked
// for any index, because every index fails the internal HasProperty check.

const denseArray = Array.from({ length: 5 }); // genuinely dense, every index is `undefined`
console.log('3.denseArray.map((x) => x ?? "mapped") result:', denseArray.map((x) => x ?? 'mapped'));
// Expected: ["mapped","mapped","mapped","mapped","mapped"] — the callback
// DOES run for every index here, because denseArray has real (if
// undefined-valued) elements at every index, not holes.

// ============================================================
// 4. EDGE CASE — indexOf vs includes and the NaN gap
// ============================================================
console.log('--- SECTION 4: indexOf vs includes (NaN) ---');

const withNaN = [1, 2, NaN, 4];

console.log('4.indexOf(NaN):', withNaN.indexOf(NaN));
// Expected: -1 — indexOf uses strict equality (===) internally, and
// NaN === NaN is always false, so indexOf can never find a NaN, ever.

console.log('4.includes(NaN):', withNaN.includes(NaN));
// Expected: true — includes uses the SameValueZero algorithm, which
// treats NaN as equal to itself (this is the ENTIRE reason includes
// exists as a separate method, not just stylistic sugar for indexOf).

// ============================================================
// 5. EDGE CASE — dictionary-mode degradation from non-index properties
// ============================================================
console.log('--- SECTION 5: dictionary-mode trigger ---');

const almostNormalArray = [1, 2, 3];
almostNormalArray.customFlag = true; // a non-index, non-length property on an array
// Attaching arbitrary named properties to an array pushes V8 toward
// treating its backing store more like a generic object/dictionary for
// property lookups, undermining the fast-array assumptions the engine
// otherwise relies on. Arrays should hold array DATA; metadata belongs in
// a separate plain object or a wrapper, not bolted onto the array itself.
console.log('5.array with a stray property:', almostNormalArray, '| customFlag:', almostNormalArray.customFlag);

// ============================================================
// 6. TIMED MICRO-BENCHMARK — filter+map+reduce chain vs single reduce
// vs plain for loop vs for...of, computing sum of squares of evens
// ============================================================
console.log('--- SECTION 6: timed micro-benchmark ---');

const N = 2_000_000;
const bigArray = Array.from({ length: N }, (_, i) => i); // genuinely dense, packed SMI array

function viaChain(arr) {
  // THREE full passes, TWO intermediate arrays allocated and discarded.
  return arr
    .filter((n) => n % 2 === 0)
    .map((n) => n * n)
    .reduce((acc, n) => acc + n, 0);
}

function viaSingleReduce(arr) {
  // ONE pass, but a function call per element for the reduce callback.
  return arr.reduce((acc, n) => (n % 2 === 0 ? acc + n * n : acc), 0);
}

function viaForLoop(arr) {
  // ONE pass, no intermediate allocations, no per-element function-call
  // overhead — direct indexed access.
  let total = 0;
  for (let i = 0; i < arr.length; i++) {
    const n = arr[i];
    if (n % 2 === 0) total += n * n;
  }
  return total;
}

function viaForOf(arr) {
  // ONE pass via the array iterator protocol — close to for-loop speed on
  // modern V8's optimized array-iterator fast path, but not identical.
  let total = 0;
  for (const n of arr) {
    if (n % 2 === 0) total += n * n;
  }
  return total;
}

function timeIt(label, fn) {
  const start = performance.now ? performance.now() : Date.now();
  const result = fn(bigArray);
  const end = performance.now ? performance.now() : Date.now();
  console.log(`6.${label}: result=${result} time=${(end - start).toFixed(2)}ms`);
  return result;
}

const resultChain = timeIt('filter->map->reduce chain', viaChain);
const resultReduce = timeIt('single reduce', viaSingleReduce);
const resultForLoop = timeIt('plain for loop', viaForLoop);
const resultForOf = timeIt('for...of loop', viaForOf);

// Sanity check: all four approaches must agree on the actual answer — the
// point of this benchmark is timing, not correctness, so we assert they
// match before trusting the timing comparison at all.
const allAgree =
  resultChain === resultReduce && resultReduce === resultForLoop && resultForLoop === resultForOf;
console.log('6.all four approaches agree on the result:', allAgree);
console.log(
  '6.expected relative ranking (fastest to slowest): for loop, for...of, single reduce, chain'
);
console.log('6.(exact timings vary by hardware/engine warm-up — the RELATIVE ordering is the lesson)');
