---
id: H099
old_id: A245
slug: swim-in-rising-water
title: Swim in Rising Water
difficulty: hard
category: hard
topics: ["matrix"]
patterns: ["dp-2d"]
estimated_time_minutes: 45
---
# Swim in Rising Water

## Problem

Consider an `n x n` grid where each cell `grid[i][j]` stores an elevation value for position `(i, j)`.

Water begins rising uniformly across the entire grid. At any moment `t`, the water level has reached depth `t`. Movement between cells is governed by the following rule: you can move from your current cell to any orthogonally adjacent cell (up, down, left, right) only when both cells have elevations no greater than the current water level `t`. Movement between accessible cells is instantaneous, and you must remain within grid boundaries.

Starting from the top-left corner `(0, 0)`, calculate the minimum time required to reach the bottom-right corner `(n - 1, n - 1)`.


**Diagram:**

```
Example 1: grid = [[0,2],[1,3]]

Grid elevations:
┌───┬───┐
│ 0 │ 2 │  Start at (0,0), Goal at (1,1)
├───┼───┤
│ 1 │ 3 │
└───┴───┘

At time t=0: Can access cell (0,0) only
At time t=1: Can access (0,0) and (1,0)
At time t=2: Can access (0,0), (1,0), (0,1)
At time t=3: Can access all cells and reach (1,1)

Minimum time = 3

Example 2: grid = [[0,1,2,3,4],[24,23,22,21,5],[12,13,14,15,16],[11,17,18,19,20],[10,9,8,7,6]]

Grid elevations:
┌──┬──┬──┬──┬──┐
│ 0│ 1│ 2│ 3│ 4│
├──┼──┼──┼──┼──┤
│24│23│22│21│ 5│
├──┼──┼──┼──┼──┤
│12│13│14│15│16│
├──┼──┼──┼──┼──┤
│11│17│18│19│20│
├──┼──┼──┼──┼──┤
│10│ 9│ 8│ 7│ 6│
└──┴──┴──┴──┴──┘

Optimal path (shown with →):
0→1→2→3→4→5→16→20→6

Maximum elevation on this path = 16
Minimum time = 16
```


## Why This Matters

2D arrays model grids, images, and spatial data. This problem develops your ability to navigate multi-dimensional structures.

## Constraints

- n == grid.length
- n == grid[i].length
- 1 <= n <= 50
- 0 <= grid[i][j] < n²
- Each value grid[i][j] is **unique**.

## Think About

1. What makes this problem challenging? What's the core difficulty?
2. Can you identify subproblems? Do they overlap?
3. What invariants must be maintained?
4. Is there a mathematical relationship to exploit?

## Approach Hints

<details>
<summary>🔑 Key Insight</summary>
This is a modified shortest path problem where instead of minimizing total distance, you minimize the maximum elevation along the path. Use a priority queue (min-heap) to always explore the cell with smallest elevation next, similar to Dijkstra's algorithm but tracking maximum elevation seen so far.
</details>

<details>
<summary>🎯 Main Approach</summary>
Use Dijkstra-like approach with priority queue. Start at (0,0) with its elevation as initial time. Pop cell with minimum time from heap, if it's destination return time. Otherwise, explore all 4 neighbors: the time to reach a neighbor is max(current_time, neighbor_elevation). Push unvisited neighbors to heap. Track visited cells to avoid cycles.
</details>

<details>
<summary>⚡ Optimization Tip</summary>
Alternative approach: Binary search on answer (time value from 0 to n²-1). For each candidate time, check if path exists using BFS/DFS where you can only visit cells with elevation ≤ time. This gives O(n² log(n²)) complexity. Union-Find can also work: sort cells by elevation and union adjacent cells until start and end are connected.
</details>

## Complexity Analysis

| Approach | Time | Space | Notes |
|----------|------|-------|-------|
| DFS/BFS on each time | O(n⁴) | O(n²) | Try all possible times |
| Binary Search + BFS | O(n² log(n²)) | O(n²) | Binary search on time value |
| Dijkstra with Heap | O(n² log(n²)) | O(n²) | Priority queue approach |
| Union-Find | O(n² α(n²)) | O(n²) | Sort cells, union by elevation |

## Common Mistakes

1. **Using standard shortest path instead of minimax path**
   ```python
   # Wrong: Summing elevations like standard Dijkstra
   new_time = current_time + grid[nr][nc]

   # Correct: Taking maximum elevation along path
   new_time = max(current_time, grid[nr][nc])
   ```

2. **Not handling starting cell elevation correctly**
   ```python
   # Wrong: Starting with time 0
   heap = [(0, 0, 0)]  # (time, row, col)

   # Correct: Must wait for starting cell elevation
   heap = [(grid[0][0], 0, 0)]  # Start time is grid[0][0]
   ```

3. **Revisiting cells in priority queue approach**
   ```python
   # Wrong: Not tracking visited cells
   while heap:
       time, r, c = heappop(heap)
       for nr, nc in neighbors:
           heappush(heap, (max(time, grid[nr][nc]), nr, nc))

   # Correct: Mark cells as visited
   visited = set()
   while heap:
       time, r, c = heappop(heap)
       if (r, c) in visited:
           continue
       visited.add((r, c))
   ```

## Variations

| Variation | Difficulty | Key Difference |
|-----------|------------|----------------|
| Path With Minimum Effort | Medium | Minimize maximum absolute difference |
| Minimum Cost to Make at Least One Valid Path | Hard | Grid with directed edges, different cost model |
| Cheapest Flights Within K Stops | Medium | Graph with edge weights and stop constraint |
| Network Delay Time | Medium | Standard Dijkstra with total weight |

## Practice Checklist

- [ ] Solved without hints
- [ ] Optimal Time Complexity (Speed of the algorithm) achieved
- [ ] Clean, readable code
- [ ] Handled all edge cases (starting elevation, visited tracking)
- [ ] Can explain approach clearly

**Spaced Repetition:** Review in 1 day → 3 days → 7 days → 14 days → 30 days

---
**Strategy Reference:** [Dijkstra's Algorithm](../../strategies/patterns/shortest-path.md) | [Binary Search](../../strategies/patterns/binary-search.md)
