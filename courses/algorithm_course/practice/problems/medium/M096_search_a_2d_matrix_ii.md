---
id: M096
old_id: I040
slug: search-a-2d-matrix-ii
title: Search a 2D Matrix II
difficulty: medium
category: medium
topics: ["matrix", "binary-search", "divide-and-conquer"]
patterns: ["matrix-search"]
estimated_time_minutes: 30
frequency: high
related_problems: ["E074", "M240", "H378"]
prerequisites: ["binary-search", "2d-arrays", "search-space-reduction"]
---
# Search a 2D Matrix II

## Problem

You're given an `m x n` integer matrix with two special properties: each row is sorted in increasing order from left to right, and each column is sorted in increasing order from top to bottom. Your task is to determine whether a target value exists anywhere in this matrix. At first glance, you might think this is similar to searching a fully sorted 1D array, but there's a key difference: the last element of one row isn't necessarily smaller than the first element of the next row. This means standard binary search on a flattened array won't work directly. However, the dual-sorting property gives you a clever alternative. If you start from certain corners of the matrix (specifically the top-right or bottom-left), you can make smart decisions about which direction to move based on comparisons with the target, effectively eliminating entire rows or columns with each step. This creates a search path similar to traversing a binary search tree, achieving better than Linear Time (Time grows directly with data) Complexity (Speed of the algorithm).


**Diagram:**

```
Matrix example (searching for target = 5):
┌────┬────┬────┬────┬────┐
│  1 │  4 │  7 │ 11 │ 15 │
├────┼────┼────┼────┼────┤
│  2 │ [5]│  8 │ 12 │ 19 │  ← Found at [1,1]
├────┼────┼────┼────┼────┤
│  3 │  6 │  9 │ 16 │ 22 │
├────┼────┼────┼────┼────┤
│ 10 │ 13 │ 14 │ 17 │ 24 │
├────┼────┼────┼────┼────┤
│ 18 │ 21 │ 23 │ 26 │ 30 │
└────┴────┴────┴────┴────┘

Each row is sorted left to right.
Each column is sorted top to bottom.
```


## Why This Matters

Searching partially sorted 2D structures appears frequently in practical applications. Database systems often use multi-dimensional indexes where data is sorted by multiple columns simultaneously, and queries need to efficiently find records matching certain criteria. Image processing algorithms search pixel grids where rows and columns have sorted properties (like gradient magnitudes). In game development, spatial grids like tilemap coordinates or collision detection matrices often have ordered properties. Scientists analyzing experimental data frequently work with matrices where both dimensions represent ordered parameters (time, temperature, concentration, etc.), and they need to quickly locate specific measurements. The "staircase search" technique you'll learn here is a fundamental algorithm for navigating structured 2D data efficiently, demonstrating how understanding data properties can lead to elegant solutions.

## Constraints

- m == matrix.length
- n == matrix[i].length
- 1 <= n, m <= 300
- -10⁹ <= matrix[i][j] <= 10⁹
- All the integers in each row are **sorted** in ascending order.
- All the integers in each column are **sorted** in ascending order.
- -10⁹ <= target <= 10⁹

## Think About

1. What's the Brute Force (Checking every single possibility) approach? Why is it inefficient?
2. What property of the input can you exploit?
3. Would sorting or preprocessing help?
4. Can you reduce this to a problem you've seen before?

## Approach Hints

<details>
<summary>💡 Hint 1: Conceptual</summary>

You can't use standard binary search because the matrix isn't fully sorted. However, consider starting from a corner of the matrix. From the top-right corner (or bottom-left), you have a special property: moving left decreases values, moving down increases values. This creates a search path similar to a BST.

</details>

<details>
<summary>🎯 Hint 2: Approach</summary>

Start at the top-right corner (row 0, col n-1). Compare the current element with the target. If current > target, move left (eliminate the column). If current < target, move down (eliminate the row). If equal, you found it. This eliminates one row or column at each step, guaranteeing O(m+n) time.

</details>

<details>
<summary>📝 Hint 3: Algorithm</summary>

```
row = 0
col = n - 1  # Start at top-right

while row < m and col >= 0:
  current = matrix[row][col]

  if current == target:
    return True
  elif current > target:
    col -= 1  # Move left, eliminate column
  else:  # current < target
    row += 1  # Move down, eliminate row

return False
```

</details>

## Complexity Analysis

| Approach | Time | Space | Notes |
|----------|------|-------|-------|
| Brute Force (Checking every single possibility) | O(mn) | O(1) | Check every cell |
| Binary Search Each Row | O(m log n) | O(1) | Binary search on each of m rows |
| Divide and Conquer | O(m log n) | O(log m) | Recursively partition matrix |
| **Staircase Search** | **O(m + n)** | **O(1)** | Start from corner, eliminate row/col each step |

## Common Mistakes

### Mistake 1: Starting from wrong corner
```python
# Wrong - starting from top-left doesn't help
row, col = 0, 0
while row < m and col < n:
    if matrix[row][col] == target:
        return True
    # Both down and right increase - can't eliminate!

# Correct - start from top-right or bottom-left
row, col = 0, n - 1
while row < m and col >= 0:
    if matrix[row][col] == target:
        return True
    elif matrix[row][col] > target:
        col -= 1
    else:
        row += 1
```

### Mistake 2: Boundary condition errors
```python
# Wrong - incorrect boundary check
while row <= m and col >= 0:  # Should be < m, not <= m
    # ...

# Correct
while row < m and col >= 0:
    # ...
```

### Mistake 3: Using binary search incorrectly on 2D matrix
```python
# Wrong - treating as flattened 1D array (only works if fully sorted)
def searchMatrix(matrix, target):
    # This only works if matrix[i][n-1] < matrix[i+1][0]
    # which is NOT guaranteed in this problem!

# Correct - use staircase search for this problem
def searchMatrix(matrix, target):
    row, col = 0, len(matrix[0]) - 1
    while row < len(matrix) and col >= 0:
        # ... staircase logic
```

## Variations

| Variation | Difficulty | Key Difference |
|-----------|-----------|----------------|
| Search 2D Matrix I | Medium | Fully sorted (last of row < first of next row) |
| Kth Smallest in Sorted Matrix | Medium | Find kth smallest instead of search |
| Count Negative Numbers | Easy | Count negatives in sorted matrix |
| Peak Element in 2D | Medium | Find local maximum in matrix |

## Practice Checklist

- [ ] Implement staircase search from top-right
- [ ] Implement staircase search from bottom-left
- [ ] Test with target at corners
- [ ] Test with target not in matrix
- [ ] Test with single row matrix
- [ ] Test with single column matrix
- [ ] Compare Time Complexity (Speed of the algorithm) with binary search approach

**Spaced Repetition Schedule:**
- Day 1: Initial attempt, understand corner property
- Day 3: Implement both top-right and bottom-left starts
- Day 7: Solve Search 2D Matrix I variant
- Day 14: Implement divide-and-conquer approach
- Day 30: Speed solve under 15 minutes

**Strategy**: See [Binary Search](../strategies/patterns/binary-search.md)
