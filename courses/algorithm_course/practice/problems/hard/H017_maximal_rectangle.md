---
id: H017
old_id: F085
slug: maximal-rectangle
title: Maximal Rectangle
difficulty: hard
category: hard
topics: ["matrix"]
patterns: []
estimated_time_minutes: 45
---
# Maximal Rectangle

## Problem

Find the largest rectangle containing only 1s in a binary matrix.

**Diagram:**

Example: Input matrix:
```
┌─────────────────┐
│ 1  0  1  0  0  │
│ 1  0  1  1  1  │
│ 1  1  1  1  1  │
│ 1  0  0  1  0  │
└─────────────────┘

Maximal rectangle (area = 6):
┌─────────────────┐
│ 1  0  1  0  0  │
│ 1  0 [1  1  1] │  ← These form the
│ 1  1 [1  1  1] │  ← largest rectangle
│ 1  0  0  1  0  │
└─────────────────┘
```


## Why This Matters

2D arrays model grids, images, and spatial data. This problem develops your ability to navigate multi-dimensional structures.

## Examples

**Example 1:**
- Input: `matrix = [["0"]]`
- Output: `0`

**Example 2:**
- Input: `matrix = [["1"]]`
- Output: `1`

## Constraints

- rows == matrix.length
- cols == matrix[i].length
- 1 <= row, cols <= 200
- matrix[i][j] is '0' or '1'.

## Think About

1. What's the Brute Force (Checking every single possibility) approach? What's its Time Complexity (Speed of the algorithm)?
2. Can you identify any patterns in the examples?
3. What data structure would help organize the information?

## Approach Hints

<details>
<summary>🔑 Key Insight</summary>

This problem can be reduced to "Largest Rectangle in Histogram" applied to each row. For each row, treat it as the base of a histogram where the height of each bar is the number of consecutive 1s above (including the current cell). Then find the largest rectangle in that histogram. This transforms a 2D problem into multiple 1D problems.

</details>

<details>
<summary>🎯 Main Approach</summary>

Build a height array for each row where height[j] represents consecutive 1s ending at current row in column j. If matrix[i][j] == '0', reset height[j] to 0; otherwise increment it. For each row, use a stack-based approach to find the maximum rectangle area in the histogram formed by the heights. Keep track of the global maximum across all rows.

</details>

<details>
<summary>⚡ Optimization Tip</summary>

Use a monotonic increasing stack to find the largest rectangle in histogram in O(n) time. For each position, pop stack elements while current height is smaller, calculating area with popped height as the smallest. The width extends from the index at top of stack (after popping) to current index. This gives overall O(m×n) complexity where m=rows, n=cols.

</details>

## Complexity Analysis

| Approach | Time | Space | Notes |
|----------|------|-------|-------|
| Brute Force (Checking every single possibility) | O(m²×n²) | O(1) | Check all possible rectangles |
| Dynamic Programming | O(m×n²) | O(m×n) | For each cell, expand rectangle |
| Histogram + Stack | O(m×n) | O(n) | Optimal - treat each row as histogram base |

## Common Mistakes

1. **Not resetting height when encountering '0'**
   ```python
   # Wrong: Continuing to accumulate height through zeros
   for j in range(cols):
       heights[j] += 1 if matrix[i][j] == '1' else 0

   # Correct: Reset height to 0 when cell is '0'
   for j in range(cols):
       if matrix[i][j] == '1':
           heights[j] += 1
       else:
           heights[j] = 0  # Must reset!
   ```

2. **Incorrect area calculation in histogram**
   ```python
   # Wrong: Not handling the width correctly
   while stack and heights[stack[-1]] > heights[i]:
       h = heights[stack.pop()]
       area = h * i  # Missing left boundary!

   # Correct: Width is from left boundary to current position
   while stack and heights[stack[-1]] > heights[i]:
       h_idx = stack.pop()
       h = heights[h_idx]
       # Left boundary is element before popped, or 0 if stack empty
       left = stack[-1] + 1 if stack else 0
       width = i - left
       area = h * width
       max_area = max(max_area, area)
   ```

3. **Forgetting to process remaining elements in stack**
   ```python
   # Wrong: Not processing stack after main loop
   for i in range(n):
       # ... process heights[i]
   return max_area  # Missed elements still in stack!

   # Correct: Process remaining stack elements
   for i in range(n):
       # ... process heights[i]

   # After loop, process remaining elements
   while stack:
       h_idx = stack.pop()
       h = heights[h_idx]
       left = stack[-1] + 1 if stack else 0
       width = n - left
       area = h * width
       max_area = max(max_area, area)
   ```

## Variations

| Variation | Difficulty | Key Difference |
|-----------|------------|----------------|
| Largest Rectangle in Histogram | Hard | 1D version, foundation for this problem |
| Maximal Square | Medium | Find largest square instead of rectangle |
| Count Square Submatrices with All Ones | Medium | Count all squares instead of finding maximum |
| Number of Submatrices That Sum to Target | Hard | Different constraint (sum instead of all 1s) |

## Practice Checklist

- [ ] Solved without hints
- [ ] Optimal Time Complexity (Speed of the algorithm) achieved
- [ ] Clean, readable code
- [ ] Handled all edge cases (empty matrix, all 0s, all 1s)
- [ ] Can explain approach clearly

**Spaced Repetition:** Review in 1 day → 3 days → 7 days → 14 days → 30 days

---
**Strategy Reference:** [Stack Monotonic Pattern](../../strategies/patterns/monotonic-stack.md)
