// ============================================================
// DAY 11 — PRIMITIVES VS REFERENCE TYPES & MEMORY MODEL
// ============================================================
// Run this in a browser console, via index.html, or with `node script.js`.
// Every section is self-contained and complete — no placeholders.

console.log('=== SECTION 1: PRIMITIVES COPY BY VALUE ===');

// ------------------------------------------------------------
// 1. HAPPY PATH — primitives are independent copies
// ------------------------------------------------------------
let primitiveA = 10;
let primitiveB = primitiveA; // copies the VALUE 10, not a link to primitiveA
primitiveB = 99; // only affects primitiveB's own slot

console.log('primitiveA:', primitiveA); // 10 -- untouched
console.log('primitiveB:', primitiveB); // 99 -- reassigned independently

// Same is true for strings and booleans -- they are immutable values.
let str1 = 'hello';
let str2 = str1;
str2 = str2.toUpperCase(); // .toUpperCase() returns a NEW string, doesn't mutate str1
console.log('str1:', str1); // 'hello'
console.log('str2:', str2); // 'HELLO'


console.log('\n=== SECTION 2: OBJECTS SHARE A HEAP REFERENCE ===');

// ------------------------------------------------------------
// 2. HAPPY PATH — assigning an object copies the REFERENCE, not the data
// ------------------------------------------------------------
const original = { name: 'Alice', address: { city: 'Austin' } };
const alias = original; // `alias` now points at the SAME heap object as `original`

alias.name = 'Changed'; // mutating through `alias`'s pointer...

console.log('original.name:', original.name); // 'Changed' -- same object, both pointers see it
console.log('alias === original:', alias === original); // true -- identical heap address


console.log('\n=== SECTION 3: SHALLOW COPY VS DEEP COPY ===');

// ------------------------------------------------------------
// 3. COMMON PITFALL — spread/Object.assign only copy ONE level deep
// ------------------------------------------------------------
const user = { name: 'Bob', address: { city: 'Denver' } };

// { ...user } creates a NEW top-level object, so `name` is safely independent.
const shallow = { ...user };
shallow.name = 'Bobby';
console.log('user.name after shallow.name change:', user.name); // 'Bob' -- untouched, good

// BUT `address` is a nested object -- spread only copied the POINTER to it,
// not the object itself. Both `shallow.address` and `user.address` point at
// the same heap cell.
shallow.address.city = 'Seattle';
console.log('user.address.city after shallow mutation:', user.address.city); // 'Seattle' -- LEAKED!
console.log('shallow.address === user.address:', shallow.address === user.address); // true -- shared reference

// Fix: structuredClone performs a true deep clone (Node 17+, all modern browsers).
const user2 = { name: 'Carol', address: { city: 'Denver' }, joined: new Date('2024-01-01') };
const deep = structuredClone(user2);
deep.address.city = 'Miami';
console.log('user2.address.city after deep clone mutation:', user2.address.city); // 'Denver' -- safe
console.log('deep.address === user2.address:', deep.address === user2.address); // false -- separate heap cells

// Why NOT JSON.parse(JSON.stringify(x)) for this: it mangles Dates into strings,
// drops functions/undefined/symbols, and throws on circular references.
console.log('deep.joined instanceof Date:', deep.joined instanceof Date); // true -- structuredClone preserves type
const viaJson = JSON.parse(JSON.stringify(user2));
console.log('viaJson.joined instanceof Date:', viaJson.joined instanceof Date); // false -- became a string, a real bug source


console.log('\n=== SECTION 4: MUTATE VS REASSIGN INSIDE A FUNCTION ===');

// ------------------------------------------------------------
// 4. HAPPY PATH + PITFALL — pass-by-value-of-the-reference, demonstrated
// ------------------------------------------------------------
function mutateArray(arr) {
  // `arr` is a LOCAL variable holding a COPY of the pointer passed in.
  // Calling a mutating method follows that pointer to the SAME heap array
  // the caller owns, so the caller sees the change.
  arr.push(4);
}

function reassignArray(arr) {
  // This does NOT mutate the shared array. It creates a brand-new array
  // via spread, then points the LOCAL `arr` binding at it. The caller's
  // original pointer is never touched.
  arr = [...arr, 4];
  return arr;
}

const callerArray = [1, 2, 3];
mutateArray(callerArray);
console.log('callerArray after mutateArray:', callerArray); // [1, 2, 3, 4] -- caller affected

const callerArray2 = [1, 2, 3];
const returned = reassignArray(callerArray2);
console.log('callerArray2 after reassignArray:', callerArray2); // [1, 2, 3] -- caller UNAFFECTED
console.log('returned from reassignArray:', returned); // [1, 2, 3, 4] -- only the return value has it


console.log('\n=== SECTION 5: EDGE CASES ===');

// ------------------------------------------------------------
// 5. EDGE CASES
// ------------------------------------------------------------

// Edge case A: structural equality vs reference equality.
console.log('{} === {}:', JSON.stringify({}) === JSON.stringify({})); // true -- comparing STRINGS here, not objects
console.log('{a:1} === {a:1}:', ({ a: 1 }) === ({ a: 1 })); // false -- two distinct heap objects, never equal

// Edge case B: const does NOT make objects immutable -- it only locks the BINDING.
const lockedBinding = { count: 0 };
lockedBinding.count += 1; // totally legal -- we're mutating the object, not reassigning the variable
console.log('lockedBinding.count:', lockedBinding.count); // 1
try {
  // This line would throw if uncommented, because `const` forbids rebinding the
  // variable itself: lockedBinding = { count: 99 };
  console.log('(const only locks the binding, not the contents)');
} catch (e) {
  console.log('error:', e.message);
}

// Edge case C: Object.freeze gives true (shallow) immutability -- mutations
// silently fail in non-strict mode, or throw in strict mode / modules.
const frozen = Object.freeze({ nested: { a: 1 } });
frozen.nested.a = 999; // freeze is SHALLOW -- nested objects are still mutable!
console.log('frozen.nested.a after mutation attempt:', frozen.nested.a); // 999 -- freeze did NOT protect nested data

// Edge case D: function parameters that are primitives vs objects, side by side.
function tryToReset(primitiveArg, objectArg) {
  primitiveArg = 0; // local copy only, caller's primitive is untouched
  objectArg.reset = true; // mutates the shared heap object, caller sees it
}
let num = 42;
const obj = { reset: false };
tryToReset(num, obj);
console.log('num after tryToReset:', num); // 42 -- primitive, unaffected
console.log('obj after tryToReset:', obj); // { reset: true } -- reference, affected
