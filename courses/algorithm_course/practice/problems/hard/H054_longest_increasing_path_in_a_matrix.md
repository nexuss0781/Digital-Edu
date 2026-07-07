---
id: H054
old_id: I128
slug: longest-increasing-path-in-a-matrix
title: Longest Increasing Path in a Matrix
difficulty: hard
category: hard
topics: ["matrix"]
patterns: ["dp-2d"]
estimated_time_minutes: 45
---
# Longest Increasing Path in a Matrix

## Problem

You are provided with an `m x n` matrix containing integers. Find and return the length of the longest path where values strictly increase along the path.

Movement is restricted to four cardinal directions: left, right, up, and down. **Diagonal movement** is prohibited, and you **cannot move beyond** the matrix boundaries (no wrapping allowed).


**Diagram:**

```
Example 1: matrix = [[9,9,4],[6,6,8],[2,1,1]]

Matrix:              Longest increasing path:
┌───┬───┬───┐       ┌───┬───┬───┐
│ 9 │ 9 │ 4 │       │   │   │ 4 │
├───┼───┼───┤       ├───┼───┼───┤
│ 6 │ 6 │ 8 │       │ 6 │   │ 8 │
├───┼───┼───┤       ├───┼───┼───┤
│ 2 │ 1 │ 1 │       │ 2 │ 1 │   │
└───┴───┴───┘       └───┴───┴───┘

Path: 1 → 2 → 6 → 9
Length: 4
```

```
Example 2: matrix = [[3,4,5],[3,2,6],[2,2,1]]

Matrix:              Longest increasing path:
┌───┬───┬───┐       ┌───┬───┬───┐
│ 3 │ 4 │ 5 │       │ 3 │ 4 │ 5 │
├───┼───┼───┤       ├───┼───┼───┤
│ 3 │ 2 │ 6 │       │   │ 2 │ 6 │
├───┼───┼───┤       ├───┼───┼───┤
│ 2 │ 2 │ 1 │       │   │   │   │
└───┴───┴───┘       └───┴───┴───┘

Path: 2 → 3 → 4 → 5 → 6
Length: 5
```


## Why This Matters

Two-dimensional arrays represent grids, visual data, and spatial relationships. This challenge strengthens your skills in traversing and analyzing multi-dimensional data.

## Examples

**Example 1:**
- Input: `matrix = [[1]]`
- Output: `1`

## Constraints

- m == matrix.length
- n == matrix[i].length
- 1 <= m, n <= 200
- 0 <= matrix[i][j] <= 2³¹ - 1

## Think About

1. What's the Brute Force (Checking every single possibility) approach? Why is it inefficient?
2. What property of the input can you exploit?
3. Would sorting or preprocessing help?
4. Can you reduce this to a problem you've seen before?

## Approach Hints

<details>
<summary>🔑 Key Insight</summary>
This is a directed acyclic graph (DAG) problem in disguise. Since values must strictly increase along the path, there can be no cycles. Each cell can be treated as a node, and edges connect to adjacent cells with larger values. The answer is the longest path in this DAG.
</details>

<details>
<summary>🎯 Main Approach</summary>
Use DFS with Memoization (Saving results to avoid repeating work). For each cell, recursively compute the longest path starting from that cell by exploring all four directions (only moving to cells with larger values). Cache results in a 2D DP table to avoid recomputation. The answer is the maximum across all starting positions.
</details>

<details>
<summary>⚡ Optimization Tip</summary>
The Memoization (Saving results to avoid repeating work) is crucial - without it, the Time Complexity (Speed of the algorithm) becomes exponential. Since we only move to cells with strictly larger values, the recursion naturally terminates and has no cycles. You can also use topological sort (Kahn's algorithm) starting from cells with no outgoing edges, but DFS+memo is simpler.
</details>

## Complexity Analysis

| Approach | Time | Space | Notes |
|----------|------|-------|-------|
| DFS without Memoization (Saving results to avoid repeating work) | O(4^(m×n)) | O(m×n) | Exponential, recomputes subproblems |
| DFS with Memoization (Saving results to avoid repeating work) | O(m×n) | O(m×n) | Each cell computed once |
| Topological Sort | O(m×n) | O(m×n) | Alternative approach, same complexity |

## Common Mistakes

1. **Not memoizing results**
   ```python
   # Wrong: Recomputing same cells multiple times
   def dfs(i, j):
       max_len = 1
       for di, dj in [(0,1), (0,-1), (1,0), (-1,0)]:
           ni, nj = i + di, j + dj
           if valid(ni, nj) and matrix[ni][nj] > matrix[i][j]:
               max_len = max(max_len, 1 + dfs(ni, nj))
       return max_len

   # Correct: Cache results
   def dfs(i, j):
       if dp[i][j] != 0:
           return dp[i][j]
       max_len = 1
       for di, dj in [(0,1), (0,-1), (1,0), (-1,0)]:
           ni, nj = i + di, j + dj
           if valid(ni, nj) and matrix[ni][nj] > matrix[i][j]:
               max_len = max(max_len, 1 + dfs(ni, nj))
       dp[i][j] = max_len
       return max_len
   ```

2. **Allowing non-strictly increasing paths**
   ```python
   # Wrong: Using >= instead of >
   if matrix[ni][nj] >= matrix[i][j]:
       # This allows cycles and equal values

   # Correct: Strictly increasing only
   if matrix[ni][nj] > matrix[i][j]:
       max_len = max(max_len, 1 + dfs(ni, nj))
   ```

3. **Incorrect initialization of DP table**
   ```python
   # Wrong: Initializing with -1 or None without proper checks
   dp = [[-1] * n for _ in range(m)]
   # Later: if dp[i][j] >= 0  # Fails when path length is 0

   # Correct: Use 0 as uncomputed marker (since min path is 1)
   dp = [[0] * n for _ in range(m)]
   if dp[i][j] != 0:
       return dp[i][j]
   ```

## Variations

| Variation | Difficulty | Key Difference |
|-----------|------------|----------------|
| Longest Increasing Subsequence | Medium | 1D version of the problem |
| Dungeon Game | Hard | DP on matrix with different constraints |
| Minimum Path Sum | Medium | Similar grid DP but with sums |
| Number of Increasing Paths in a Grid | Hard | Count all paths instead of longest |

## Practice Checklist

- [ ] Solved without hints
- [ ] Optimal Time Complexity (Speed of the algorithm) achieved
- [ ] Clean, readable code
- [ ] Handled all edge cases
- [ ] Can explain approach clearly

**Spaced Repetition:** Review in 1 day → 3 days → 7 days → 14 days → 30 days

---
**Strategy Reference:** [2D Dynamic Programming](../../strategies/patterns/dp-2d.md)
