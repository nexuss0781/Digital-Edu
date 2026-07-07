---
id: M014
old_id: F050
slug: powx-n
title: Pow(x, n)
difficulty: medium
category: medium
topics: ["math", "recursion", "divide-and-conquer"]
patterns: ["binary-exponentiation", "divide-and-conquer"]
estimated_time_minutes: 25
frequency: high
related_problems: ["M015", "E005", "H002"]
prerequisites: ["recursion-basics", "bit-manipulation-basics"]
strategy_ref: ../strategies/patterns/divide-and-conquer.md
---

# Pow(x, n)

## Problem

Implement the mathematical power function: given a base number `x` (which can be a decimal like 2.5) and an integer exponent `n` (which can be negative), compute x raised to the power n (written as x^n). For example, 2^10 = 1024, and 2^(-2) = 0.25.

The naive approach of multiplying x by itself n times works but becomes impractically slow for large exponents. If n = 1,000,000,000, you'd need a billion multiplications! The key insight is **binary exponentiation** (also called "exponentiation by squaring"): you can compute x^10 by repeatedly squaring rather than multiplying 10 times.

Consider that x^10 = (x^5)^2, and x^5 = x^2 × x^2 × x. By halving the exponent at each step (and handling odd exponents by multiplying one extra x), you reduce the number of operations from O(n) to O(log n). This is the difference between one billion operations and about 30 operations.

Edge cases to handle: negative exponents (x^(-n) = 1/x^n), zero exponent (always returns 1), and the tricky case where n = -2^31 (the minimum 32-bit integer, which can't be negated without overflow in some languages).

```
Visualization:
2^10 = 1024

Naive: 2 × 2 × 2 × 2 × 2 × 2 × 2 × 2 × 2 × 2  (10 multiplications)

Binary exponentiation:
2^10 = (2^5)^2 = ((2^2)^2 × 2)^2  (only ~4 multiplications!)
```

## Why This Matters

Binary exponentiation is one of those "unlock" algorithms that appears everywhere once you know it. It's fundamental to modern cryptography (RSA encryption would be impossibly slow without it), competitive programming (required for modular arithmetic problems), and algorithm optimization (matrix exponentiation for computing Fibonacci numbers in Logarithmic Time (Time grows slowly as data grows) uses this exact technique).

**Real-world applications:**
- **Cryptography**: RSA encryption/decryption, Diffie-Hellman key exchange (compute a^b mod p efficiently)
- **Competitive programming**: Solving problems involving large powers with modular arithmetic
- **Scientific computing**: Calculating compound interest, population growth, radioactive decay over many periods
- **Computer graphics**: Efficiently computing transformation matrix powers for animations
- **Algorithms**: Fast Fibonacci calculation via matrix exponentiation [[1,1],[1,0]]^n
- **Number theory**: Primality testing (Fermat's test, Miller-Rabin) relies on fast modular exponentiation

This problem tests whether you can recognize opportunities to divide-and-conquer on the exponent rather than iterating linearly. The O(log n) speedup is enormous: for n = 2^31, it's the difference between 2 billion operations and 31 operations.

## Examples

**Example 1:**
- Input: `x = 2.00000, n = 10`
- Output: `1024.00000`
- Explanation: 2^10 = 1024

**Example 2:**
- Input: `x = 2.10000, n = 3`
- Output: `9.26100`
- Explanation: 2.1^3 = 2.1 × 2.1 × 2.1 = 9.261

**Example 3:**
- Input: `x = 2.00000, n = -2`
- Output: `0.25000`
- Explanation: 2^(-2) = 1/2^2 = 1/4 = 0.25

**Example 4:**
- Input: `x = 0.00001, n = 2147483647`
- Output: `0.0`
- Explanation: Large positive exponent on small number approaches 0

## Constraints

- -100.0 < x < 100.0
- -2^31 <= n <= 2^31 - 1
- n is an integer
- Either x is not zero or n > 0
- -10^4 <= x^n <= 10^4

## Think About

1. Why is the naive O(n) approach problematic for n = 2^31?
2. What mathematical property lets us reduce x^n to a smaller problem?
3. How do you handle negative exponents?
4. What's the Edge Case (Unusual or extreme situation) when n = -2^31 (minimum 32-bit integer)?

---

## Approach Hints

<details>
<summary>💡 Hint 1: The squaring insight</summary>

Consider how exponents work mathematically:
- x^10 = x^5 × x^5 (when n is even)
- x^5 = x^2 × x^2 × x (when n is odd)

For even n: `x^n = (x^(n/2))^2`
For odd n: `x^n = x × x^(n-1)`

This lets you halve the exponent each step, giving O(log n) time!

**Think about:**
- How would you compute x^1000 using this insight?
- How many multiplications do you actually need?

</details>

<details>
<summary>🎯 Hint 2: Handle negative exponents</summary>

For negative n: `x^(-n) = 1 / x^n`

But be careful with n = -2^31:
- In 32-bit integers, -(-2^31) overflows!
- Solution: Convert to positive carefully, or use `abs()` with 64-bit

```
if n < 0:
    x = 1 / x
    n = -n  # Careful: overflow if n = -2^31
```

Better approach: Work with negative exponent directly by tracking sign.

</details>

<details>
<summary>📝 Hint 3: Iterative binary exponentiation</summary>

```
def pow(x, n):
    if n < 0:
        x = 1 / x
        n = -n

    result = 1
    while n > 0:
        if n is odd:          # n % 2 == 1 or n & 1
            result = result * x
        x = x * x             # Square the base
        n = n // 2            # Halve the exponent

    return result
```

**Why this works:**
- n in binary: e.g., 13 = 1101 (binary) = 8 + 4 + 1
- x^13 = x^8 × x^4 × x^1
- We pick up x^(power of 2) when that bit is set

**Trace for x=2, n=13:**
```
n=13 (1101): odd, result=2, x=4, n=6
n=6  (0110): even, result=2, x=16, n=3
n=3  (0011): odd, result=32, x=256, n=1
n=1  (0001): odd, result=8192, x=..., n=0
Return 8192 = 2^13 ✓
```

</details>

---

## Complexity Analysis

| Approach | Time | Space | Notes |
|----------|------|-------|-------|
| Naive multiplication | O(n) | O(1) | TLE for n = 2^31 |
| Recursive binary exp | O(log n) | O(log n) | Stack space for recursion |
| **Iterative binary exp** | **O(log n)** | **O(1)** | Optimal |

**Why binary exponentiation wins:**
- For n = 2^31: Naive = 2 billion ops, Binary = 31 ops
- Constant space with iterative approach
- Same technique works for matrix exponentiation

---

## Common Mistakes

### 1. Integer overflow with -2^31

```python
# WRONG: Overflow in many languages
n = -n  # If n = -2147483648, -n overflows!

# CORRECT: Use long/64-bit or handle specially
n = abs(n)  # Python handles big ints natively
# In Java/C++: cast to long first
```

### 2. Not handling x = 0

```python
# WRONG: 0^negative is undefined
return 1 / pow(0, positive_n)  # Division by zero!

# CORRECT: Handle early
if x == 0:
    return 0.0 if n > 0 else float('inf')  # or error
```

### 3. Forgetting to square before halving

```python
# WRONG: Order matters!
n = n // 2
x = x * x  # Should square BEFORE halving

# CORRECT: Square first, then halve
x = x * x
n = n // 2
```

### 4. Off-by-one in recursion

```python
# WRONG: Infinite recursion
def pow(x, n):
    if n == 0: return 1
    return pow(x, n) * x  # n never decreases!

# CORRECT: Decrease n in recursive call
def pow(x, n):
    if n == 0: return 1
    half = pow(x, n // 2)
    if n % 2 == 0:
        return half * half
    else:
        return half * half * x
```

### 5. Floating point precision

```python
# CAREFUL: Floating point accumulates errors
# For very large n, result may have precision issues
# This is expected behavior, not a bug
```

---

## Visual Walkthrough

```
Computing 2^13 using binary exponentiation:

13 in binary = 1101
   = 1×8 + 1×4 + 0×2 + 1×1
   = 2^3 + 2^2 + 2^0

So 2^13 = 2^8 × 2^4 × 2^1

Iterative trace:
┌─────────────────────────────────────────────────┐
│ Step │ n (binary) │ n odd? │ result │ x (base) │
├─────────────────────────────────────────────────┤
│  0   │ 13 (1101)  │  Yes   │ 1×2=2  │ 2→4      │
│  1   │  6 (0110)  │  No    │ 2      │ 4→16     │
│  2   │  3 (0011)  │  Yes   │ 2×16=32│ 16→256   │
│  3   │  1 (0001)  │  Yes   │32×256= │ ...      │
│      │            │        │ 8192   │          │
│  4   │  0 (0000)  │  Stop  │ 8192   │          │
└─────────────────────────────────────────────────┘

Result: 8192 = 2^13 ✓

Recursive visualization:
pow(2, 13)
├── pow(2, 6) × 2
│   ├── pow(2, 3)^2
│   │   ├── pow(2, 1) × 2
│   │   │   └── pow(2, 0) = 1
│   │   │   = 1 × 2 = 2
│   │   = 2^2 × 2 = 8
│   = 8^2 = 64
= 64 × 2 = 128... wait, that's wrong!

Correction for odd case:
pow(2, 13) = pow(2, 6)^2 × 2
           = (pow(2, 3)^2)^2 × 2
           = ((pow(2, 1)^2 × 2)^2)^2 × 2
           = ((2^2 × 2)^2)^2 × 2
           = (8^2)^2 × 2
           = 64^2 × 2... still tricky

Simpler: 2^13 = 2^6 × 2^6 × 2 = 64 × 64 × 2 = 8192 ✓
```

---

## Variations

| Variation | Change | Approach Adjustment |
|-----------|--------|---------------------|
| **Modular exponentiation** | Return (x^n) % mod | Apply mod after each multiplication |
| **Matrix exponentiation** | Compute A^n for matrix A | Same algorithm, matrix multiply instead |
| **Fibonacci in O(log n)** | Compute Fib(n) fast | Use matrix [[1,1],[1,0]]^n |
| **Super power (x^y^z...)** | Tower of exponents | Apply modular arithmetic with Euler's theorem |
| **Negative base** | x < 0 | Handle sign separately based on n parity |

**Modular exponentiation (common in competitive programming):**
```
def pow_mod(x, n, mod):
    result = 1
    x = x % mod
    while n > 0:
        if n & 1:
            result = (result * x) % mod
        x = (x * x) % mod
        n >>= 1
    return result
```

---

## Practice Checklist

**Correctness:**
- [ ] Handles positive exponents
- [ ] Handles negative exponents
- [ ] Handles n = 0 (returns 1)
- [ ] Handles x = 0 correctly
- [ ] Handles n = -2^31 without overflow
- [ ] Handles fractional base (x = 0.5)

**Algorithm Understanding:**
- [ ] Can explain why binary exponentiation is O(log n)
- [ ] Can trace through iterative version by hand
- [ ] Understands bit manipulation version (n & 1, n >>= 1)
- [ ] Can derive recursive version independently

**Interview Readiness:**
- [ ] Can explain approach in 2 minutes
- [ ] Can code solution in 10 minutes
- [ ] Can discuss time/Space Complexity (Memory usage of the algorithm)
- [ ] Can extend to modular exponentiation

**Spaced Repetition Tracker:**
- [ ] Day 1: Initial solve
- [ ] Day 3: Solve without hints
- [ ] Day 7: Implement modular version
- [ ] Day 14: Explain to someone
- [ ] Day 30: Quick review + matrix exponentiation

---

**Strategy**: See [Divide & Conquer Pattern](../../strategies/patterns/divide-and-conquer.md) | [Recursion Guide](../../strategies/fundamentals/recursion.md)
