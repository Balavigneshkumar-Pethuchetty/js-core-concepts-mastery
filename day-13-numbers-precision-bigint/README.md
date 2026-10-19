# Day 13: Number Precision, IEEE-754, and BigInt

## 🧠 Core Architectural Concept

Every `number` in JavaScript — there is only **one** numeric primitive type for ordinary
numbers, no separate int/float/double like in C or Java — is stored as an **IEEE-754
double-precision floating point** value: 64 bits total, split into 1 sign bit, 11
exponent bits, and 52 mantissa (fraction) bits. This single design decision explains
almost every "weird number bug" you'll ever see in JS.

```
64-bit IEEE-754 double:
┌─┬───────────┬──────────────────────────────────────────────────┐
│S│  EXPONENT │                    MANTISSA (fraction)             │
│1│  11 bits  │                     52 bits                         │
└─┴───────────┴──────────────────────────────────────────────────┘
value ≈ (-1)^sign × 1.mantissa × 2^(exponent - 1023)
```

The mantissa gives you roughly **15-17 significant decimal digits** of precision — fine
for most math, but it means most *decimal fractions* (0.1, 0.2, 0.3...) cannot be
represented exactly in binary, for the same reason 1/3 can't be represented exactly in
decimal (0.3333...). `0.1` in binary floating point is actually a repeating fraction,
rounded to the nearest representable double. So:

```js
0.1 + 0.2 === 0.3 // false
// because:
0.1 -> stored as 0.1000000000000000055511151231257827021181583404541015625
0.2 -> stored as 0.200000000000000011102230246251565404236316680908203125
// their sum rounds to 0.30000000000000004440892..., which is a DIFFERENT
// double than the one 0.3 itself rounds to.
```

This isn't a JavaScript bug — it's IEEE-754 behavior shared by Python, Java, C, Go, every
language that uses double-precision floats, which is almost all of them. The fix is never
"switch languages," it's: compare with an epsilon tolerance (`Math.abs(a - b) < Number.EPSILON`
for a rough check, though real tolerance should be domain-specific), or avoid floating
math for exact decimal needs entirely (money, for instance — store cents as integers, or
use a decimal library / BigInt-based fixed-point representation).

**Integer precision has a hard boundary too.** Because 52 mantissa bits can represent
integers exactly up to 2^53 - 1, JS defines `Number.MAX_SAFE_INTEGER = 2^53 - 1 =
9007199254740991`. Beyond that, integers start silently losing precision — not every
integer above this point is representable, and some operations will produce results that
look plausible but are mathematically wrong:

```js
Number.MAX_SAFE_INTEGER + 1 === Number.MAX_SAFE_INTEGER + 2 // true — both round to the same double!
```

This bites in real systems constantly: a 64-bit database ID or Twitter/Discord-style
snowflake ID serialized as a JSON number can silently corrupt once it exceeds 2^53,
because `JSON.parse` turns it into a `number`. This is exactly why large platforms
serialize big IDs as **strings** in their JSON APIs, not numbers — it's not a style
choice, it's a correctness requirement.

**`BigInt`** (ES2020) is the actual fix for arbitrary-precision integers: a *second*,
distinct primitive type (`typeof 10n === 'bigint'`, not `'number'`) backed by an
arbitrary-precision integer representation, not IEEE-754 at all. It can represent
integers of any size, limited only by memory, with no precision loss. The trade-off:
BigInt arithmetic is slower than Number arithmetic (no hardware FPU fast path, arbitrary
width means variable-cost operations), BigInt and Number **cannot be mixed in arithmetic
without an explicit conversion** (`1n + 1` throws `TypeError`), and BigInt has no decimal
point support at all — it's integers only. You reach for it specifically when you need
exact integers beyond 2^53: cryptographic computations, high-precision timestamps,
financial ledgers doing integer-cents arithmetic at extreme scale, or interop with 64-bit
IDs from systems like Twitter snowflakes or Postgres `bigint` columns.

## 🎯 Interview Talking Points

- "`0.1 + 0.2 !== 0.3` isn't a JS quirk, it's IEEE-754 — I'd actually push back gently if
  an interviewer frames it as 'a JavaScript bug,' because the exact same thing happens in
  Python, Java, and C. What's JS-specific is that there's only one numeric type, so you
  can't just reach for an `int` type to dodge the problem — you have to actively choose a
  strategy: epsilon comparison, integer-cents, or BigInt."
- "I've debugged a production bug where a database used 64-bit snowflake IDs, the API
  serialized them as JSON numbers, and any ID above 2^53 got silently truncated on the
  client — users would occasionally 'like' the wrong post because two different large IDs
  collided after floating-point rounding. The fix was serializing those IDs as strings in
  the API contract, which is standard practice at that point — Twitter's API does exactly
  this for tweet IDs."
- "`Number.isSafeInteger()` is the check I'd actually use in a code review, not just
  `Number.isInteger()` — `isInteger` only confirms there's no fractional part, it doesn't
  confirm the value is representable without precision loss. `9007199254740993` passes
  `isInteger` but fails `isSafeInteger`, and is in fact silently equal to
  `9007199254740992` as a stored double."
- "BigInt is not a free upgrade — I wouldn't reach for it by default. It's slower for
  arithmetic-heavy code, it can't interoperate with `Math.*` functions, and mixing it with
  `Number` in an expression throws a `TypeError` by design — the language is forcing you
  to make the precision/type boundary an explicit decision rather than letting it leak
  silently, which is the right call given how `0.1 + 0.2` already shows what silent
  coercion does to numeric correctness."
- "A follow-up I'd expect: 'why not just always use BigInt and avoid Number entirely?'
  Answer: BigInt has no concept of a fractional value — `3n / 2n` is `1n` (integer
  division, truncated), not `1.5`. It solves arbitrary-precision *integers*, not general
  decimal-precision math, and dragging every arithmetic operation through arbitrary
  precision has real performance cost in hot paths like rendering loops or numeric
  simulations."
- "Another one: 'how do you handle currency correctly then?' My answer: never store money
  as a floating-point dollar amount. Store integer cents (or the smallest currency unit)
  as a `Number` if it stays under 2^53, or `BigInt` if you need to go bigger, and only
  convert to a decimal display string at the UI boundary. This is the same pattern
  Stripe's and most payment APIs' documentation recommends."

## 👨‍🏫 Junior Mentorship Guide (Explain It in 2 Minutes)

Think of a `number` in JS like a measuring tape that only has so many tick marks on it —
it's incredibly precise, but it's still *finite*. Some decimal values (like 0.1) just
don't line up exactly with any tick mark, the same way 1/3 doesn't line up exactly with
any decimal tick mark (0.333... repeats forever). So the computer rounds to the *nearest*
tick mark it has, and when you add two already-slightly-rounded numbers together, the
tiny rounding errors can show up in your result. That's all `0.1 + 0.2 !== 0.3` is — two
already-approximate numbers, added together, producing a third approximate number that
happens not to match the approximation of `0.3`.

`BigInt` is a completely different tool — think of it as swapping the measuring tape for
an infinitely extendable ruler that only measures whole numbers, no fractions at all. It
never runs out of room for bigger integers, but it genuinely cannot measure "half a
unit."

**Common traps:**

1. **"I'll just use `===` to compare two calculated decimals."** → Never do exact equality
   on the *result* of floating-point math. Compare with a tolerance
   (`Math.abs(a - b) < someSmallEpsilon`) or avoid the float math altogether for exact
   needs (e.g. integer cents for money).
2. **"This huge ID number printed fine in the console, so it must be stored
   correctly."** → Printing doesn't prove precision. Once an integer exceeds
   `Number.MAX_SAFE_INTEGER` (2^53 - 1), the *displayed* value can look right while the
   *actual* stored value has already lost precision. Check with `Number.isSafeInteger()`.
3. **"I'll just add `n` to make my BigInt work with my regular numbers."** → You can't mix
   them in arithmetic at all (`1n + 1` throws). You must explicitly convert one side —
   `BigInt(1) + 1n` or `Number(1n) + 1` — and converting a BigInt that's too large back to
   `Number` can itself lose precision, so the conversion direction matters.

## 💻 Hands-On Exercise

Open `script.js`. Before running, predict the output of each labeled section, especially
the two "gotcha" ones:

1. **What does `0.1 + 0.2` actually equal**, printed with full precision via
   `.toFixed(20)`? Predict the digits, then compare.
   *Answer:* `0.30000000000000004441` (it won't be exactly `0.30000000000000000000`) —
   this is the floating-point representation error landing visibly once you ask for more
   digits than the default `console.log` shows.

2. **Is `Number.MAX_SAFE_INTEGER + 2` equal to `Number.MAX_SAFE_INTEGER + 1`?**
   *Answer:* Yes, both round to the same double once you go one step past the safe
   integer boundary — proving that ordinary `+1` arithmetic silently breaks above 2^53.

3. **Does `9007199254740993 === 9007199254740992` evaluate to `true` or `false`,** given
   that these look like different literals in your source code?
   *Answer:* `true`. The literal `9007199254740993` cannot be represented exactly as a
   double, so the parser rounds it at parse time to the nearest representable value,
   which happens to be `9007199254740992`.

4. **What happens when you run `10n + 5`** (BigInt plus Number, no conversion)?
   *Answer:* Throws `TypeError: Cannot mix BigInt and other types, use explicit
   conversions` — by design, to prevent silent precision-losing coercion.

5. **What does `BigInt(Number.MAX_SAFE_INTEGER) + 10n` print**, and why is this the
   correct way to go past the safe integer limit?
   *Answer:* `9007199254741001n` — exact, because once you're in BigInt-land, every
   subsequent integer is represented exactly with no precision ceiling, unlike the
   Number version which would have started silently rounding right at this boundary.
