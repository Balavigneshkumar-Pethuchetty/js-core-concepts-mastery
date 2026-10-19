# Day 10: Equality & Type Coercion

## 🧠 Core Architectural Concept

JavaScript has three distinct equality mechanisms, and the engine runs a genuinely
different algorithm for each — this isn't one algorithm with different strictness
knobs, it's three separate spec-defined procedures:

**`===` (Strict Equality, spec algorithm `IsStrictlyEqual`)**
Compares type first; if types differ, immediately `false`, no conversion ever happens.
If types match: primitives compare by value, objects compare by *reference identity*
(same pointer in memory). This is almost always what you want by default.

**`==` (Abstract Equality, spec algorithm `IsLooselyEqual`)**
This is where the infamous coercion rules live. The simplified decision tree the engine
actually runs through:
```
If types are the same -> same as ===, no coercion needed.
If one is null and the other is undefined -> true (this is the ONE special-cased pair).
If one is a Number and the other a String -> convert the String to a Number, compare.
If one is a Boolean -> convert the Boolean to a Number (true->1, false->0), compare.
If one is an object and the other is a primitive (not null/undefined) ->
    call ToPrimitive on the object, then re-run the comparison.
Otherwise -> false.
```
`ToPrimitive(obj)` (the step that makes `[] == ![]` evaluate to `true`, see below) tries
`obj[Symbol.toPrimitive]` first if it exists; otherwise, for a "default" hint, it tries
`obj.valueOf()` then `obj.toString()`, using the first one that returns a primitive.
For a plain array, `valueOf()` returns the array itself (not a primitive, so it's
skipped), and `toString()` joins elements with commas — `[].toString()` is `''`, an
empty string.

**`Object.is` (SameValue algorithm)**
The strictest of the three, and the ONLY one that gets two specific edge cases
"correct" relative to mathematical/identity intuition rather than IEEE-754 float
semantics:
- `Object.is(NaN, NaN)` → `true` (whereas `NaN === NaN` → `false`, because `===` uses
  IEEE-754 numeric comparison, and by that spec, NaN is defined to be unequal to
  itself — a deliberate floating-point standard decision, not a JS quirk).
- `Object.is(0, -0)` → `false` (whereas `0 === -0` → `true`, because `===` treats
  positive and negative zero as numerically equal, but `Object.is` distinguishes their
  actual bit representation).
`Object.is` is what React's reconciliation and other identity-sensitive internals
actually use, specifically because `===`'s NaN/−0 behavior is wrong for "is this
literally the same value" semantics in a dependency-comparison context.

**The coercion funnel: `ToPrimitive` → `ToNumber`/`ToString`.** Every confusing coercion
result in JS traces back to this funnel being invoked somewhere. `ToNumber` on a string
trims whitespace then parses it as a full numeric literal or returns `NaN` if anything
doesn't fit (`Number('12px')` is `NaN`, but `parseInt('12px')` is `12` — a DIFFERENT
algorithm, this distinction is a classic gotcha). `ToNumber(null)` is `0`.
`ToNumber(undefined)` is `NaN`. `ToNumber([])` goes through `ToPrimitive` first (empty
array → `''`) then `ToNumber('')` is `0`. This chain is exactly why `[] == 0` is `true`.

```
Trace: [] == ![]
Step 1: ![] -> ! coerces via ToBoolean first. ToBoolean(any object, including []) = true.
        So ![] = !true = false.
Step 2: Now comparing [] == false.
Step 3: Types differ (object vs boolean) -> Boolean converts to Number: false -> 0.
Step 4: Now comparing [] == 0 -> object vs number -> ToPrimitive([]) -> '' (empty string).
Step 5: Now comparing '' == 0 -> string vs number -> ToNumber('') -> 0.
Step 6: 0 == 0 -> true.
RESULT: [] == ![]  evaluates to  true.
```

## 🎯 Interview Talking Points

- "I default to `===` everywhere and treat `==` as a deliberate, narrow tool for exactly
  one case: checking for `null` or `undefined` at once with `value == null`, because
  that's the one place the abstract equality spec's null/undefined special-case is
  actually useful instead of surprising — it's shorter and clearer than
  `value === null || value === undefined`."
- "I've debugged a production bug caused by `==` coercion in a filter condition:
  `if (userId == 0)` was meant to catch a falsy/missing ID, but it ALSO matched the
  string `'0'` and the boolean `false` coming from an inconsistently-typed API response,
  silently treating a valid user ID of the literal string `'0'` as 'no user.' Switching
  to `===` and handling each falsy case explicitly fixed it — this is exactly the class
  of bug linters like `eslint-plugin-eqeqeq` exist to prevent."
- "`NaN !== NaN` is the question I expect every candidate to know, but the one that
  separates deeper understanding is WHY — it's not a JS design mistake, it's IEEE-754
  floating point spec behavior that JS inherited wholesale for its Number type. I follow
  up by asking how you'd actually test for NaN: `Number.isNaN(x)` (strict, only true for
  the actual NaN value) over the legacy global `isNaN(x)` (which coerces its argument
  first, so `isNaN('abc')` is `true` because `'abc'` coerces to `NaN` — a surprising
  false positive for non-numeric-looking inputs that aren't actually NaN)."
- "`Object.is` isn't just 'Object.is is stricter than ===' trivia — I point to a concrete
  use case: dependency comparison in reactive frameworks. If a hook or memoization
  compared previous/next values with `===`, you'd get a false 'no change' on `-0` vs `0`
  transitions (rare but real in financial/graphics code) and a false 'changed' on
  `NaN` vs `NaN` even when the value is legitimately unchanged — `Object.is` is the
  correct primitive for 'is this literally the same value for change-detection
  purposes.'"
- "`ToPrimitive` defaulting to `valueOf` before `toString` is why `new Date() + 1` and
  `new Date() - 1` behave completely differently — `+` on an object prefers the
  'default' hint (tries valueOf first, which for Date returns a timestamp number... but
  actually Date overrides this to prefer toString for the 'default'/'string' hint,
  giving string concatenation for `+`), while `-` forces a 'number' hint, calling
  valueOf directly. This exact asymmetry is a real interview 'gotcha' precisely because
  Date is special-cased to prefer string coercion where most other objects prefer
  numeric."
- "I always mention `Symbol.toPrimitive` as the actual override point — if I need an
  object to coerce predictably in both `==` and template-literal contexts, I implement
  `[Symbol.toPrimitive](hint)` directly rather than relying on the ambiguous
  valueOf/toString fallback chain, because that fallback chain is exactly what produces
  the bizarre array/boolean coercion results people memorize as 'JS quirks' instead of
  understanding as 'the ToPrimitive default path, unoverridden.'"
- Anticipate: *"Give me every 'falsy' value in JS."* — `false`, `0`, `-0`, `0n` (BigInt
  zero), `''`, `null`, `undefined`, `NaN`. Everything else, including `[]`, `{}`, and
  `'0'` (a non-empty string!), is truthy — the `[] == false` result from the trace above
  is NOT "arrays are falsy," it's "arrays coerce to `''` via ToPrimitive, and `''`
  happens to coerce further to `0` in THIS comparison chain" — a completely different
  mechanism than truthiness, and conflating the two is the #1 sign of shaky fundamentals
  I listen for.

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

`===` asks "are you the exact same type AND the exact same value?" with zero
negotiation — if the types don't match, it's an instant no. `==` is more like a
translator at a border crossing: if the two things speak different "type languages," it
tries to translate one into the other's language *before* comparing — and the
translation rules are where all the weird surprises come from. That's why I tell
juniors: always reach for `===` by default; only reach for `==` in the one specific
case of `value == null`, which conveniently catches both `null` and `undefined` in one
check.

`Object.is` is the pickiest judge of the three — it's the only one that says "NaN
equals NaN" (treating it as the same conceptual value, not doing floating-point math)
and the only one that says "0 and -0 are actually different" (looking at their literal
bit pattern, not their math value).

**Common traps:**
- *Trap 1:* "`==` is just a more lenient version of `===`, so it's always safe to use
  when I'm not sure of the types." → Correction: `==`'s coercion rules produce
  genuinely surprising results (`'' == 0` is `true`, `[] == ![]` is `true`) — "lenient"
  is not the same as "safe"; use `===` and convert types explicitly yourself.
- *Trap 2:* "`NaN === NaN` being `false` means JavaScript is broken." → Correction:
  that's IEEE-754 floating-point spec behavior, not a JS bug — use
  `Number.isNaN(x)` or `Object.is(x, NaN)` to actually detect NaN.
- *Trap 3:* "If a value is falsy, it must be one of `false`, `0`, `null`, `undefined`,
  or empty-string/array/object." → Correction: `[]` and `{}` are BOTH truthy — the
  complete falsy list is just eight specific values (see the talking points above);
  memorize that exact list, don't infer it from "looks empty."

## 💻 Hands-On Exercise

Open `script.js` and predict the output of each block before running it in
`index.html`. The classic gotchas in Block 4 are the ones to trace through by hand on
paper first — write out each coercion step before checking your answer.

**Expected answers (self-check):**

1. `1 === 1` is `true`; `1 === '1'` is `false` (different types, no coercion);
   `1 == '1'` is `true` (string coerced to number first).
2. `null == undefined` is `true` (the one special-cased pair in the abstract equality
   algorithm); `null === undefined` is `false` (different types); `null == 0` is
   `false` (null is ONLY loosely equal to undefined and itself, nothing else — this
   surprises people who expect null to behave like a generic "empty" value in
   comparisons).
3. `NaN === NaN` is `false`; `Object.is(NaN, NaN)` is `true`; `Number.isNaN(NaN)` is
   `true`; `isNaN('hello')` is `true` even though `'hello'` is not numerically NaN,
   because the legacy global `isNaN` coerces its argument first.
4. `0 === -0` is `true`; `Object.is(0, -0)` is `false`; `1 / 0` is `Infinity` while
   `1 / -0` is `-Infinity` — proving the two zeros really are distinct values at the
   bit level, even though most operators treat them as equal.
5. `[] == ![]` is `true` (full trace in the README's Core Concept section);
   `[] == []` is `false` (two DIFFERENT array objects, reference comparison always
   applies to object-vs-object regardless of `==` or `===` since neither side is a
   primitive to coerce).
6. `'5' + 3` is `'53'` (string concatenation wins when `+` sees any string operand);
   `'5' - 3` is `2` (minus has no string-concatenation meaning, so both sides are
   forced through `ToNumber` instead).
