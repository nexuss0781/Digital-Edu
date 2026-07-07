# Algorithm Learning Glossary

A comprehensive reference of terminology used throughout the StructWeave algorithm repository. Terms are organized by category to help you build a systematic understanding of algorithmic concepts.

---

## Complexity Analysis

### Big-O Notation (How fast the program runs as data grows)

Mathematical notation that describes how an algorithm's runtime or space requirements grow relative to input size. For example, O(n) means linear growth, O(n²) means quadratic growth.

### Time Complexity (Speed of the algorithm)

Measure of how an algorithm's execution time increases as input size grows. Helps predict performance and compare algorithm efficiency.

### Space Complexity (Memory usage of the algorithm)

Measure of how much additional memory an algorithm requires relative to input size. Includes auxiliary space for variables, recursive call stacks, and temporary data structures.

### Average performance over time

Technique for analyzing the average performance of operations over a sequence of executions. Used when occasional operations are expensive but most are cheap (e.g., dynamic array resizing).

### Best Case

The minimum time/space an algorithm requires on the most favorable input. Often less useful than average or worst case for practical analysis.

### Average Case

Expected time/Space Complexity (Memory usage of the algorithm) across all possible inputs of a given size. Requires understanding input distribution and probability.

### Worst Case

Maximum time/space an algorithm requires on the most challenging input. Most commonly used for algorithm analysis as it guarantees upper bounds.

### Constant Time (Same time regardless of data size) - O(1)

Operations that take the same amount of time regardless of input size. Examples include array access by index or hash table lookup.

### Linear Time (Time grows directly with data) - O(n)

Operations where time grows proportionally with input size. Examples include iterating through an array or linked list traversal.

### Logarithmic Time (Time grows slowly as data grows) - O(log n)

Operations where time grows logarithmically with input size. Common in divide-and-conquer algorithms like binary search or balanced tree operations.

### Quadratic Time (Time grows very fast with data, like a square) - O(n²)

Operations where time grows with the square of input size. Often seen in nested loops processing all pairs of elements.

---

## Data Structures

### Array

Connected sequence of memory blocks storing elements of the same type. Provides O(1) random access but fixed size in most languages.

### Dynamic Array

Resizable array that automatically grows when capacity is exceeded. Amortized O(1) append operation despite occasional O(n) resizing.

### Linked List

Linear collection of nodes where each node contains data and a reference to the next node. Enables O(1) insertion/deletion but O(n) access.

### Doubly Linked List

Linked list where each node has references to both next and previous nodes. Allows bidirectional traversal and O(1) removal when you have a node reference.

### Stack

Last-In-First-Out (LIFO (Last-In-First-Out, like a stack of plates)) data structure supporting push and pop operations. Used for recursion, parsing, and depth-first traversal.

### Queue

First-In-First-Out (FIFO (First-In-First-Out, like a line at a store)) data structure supporting enqueue and dequeue operations. Used for breadth-first traversal and task scheduling.

### Deque

Double-ended queue allowing insertion and removal from both ends. Useful for sliding window problems and maintaining monotonic sequences.

### Hash Table (Hash Map)

Data structure mapping keys to values using a hash function for O(1) average-case lookup, insertion, and deletion. Critical for complement search patterns.

### Hash Set

Collection of unique elements using hashing for O(1) membership testing. Used to track visited elements or detect duplicates.

### Heap

Binary tree structure where parent nodes satisfy a priority relationship with children. Min-heap keeps smallest element at root, max-heap keeps largest.

### Priority Queue

Concept-based data structure serving elements by priority rather than insertion order. Typically implemented with a heap for O(log n) operations.

### Tree

Hierarchical data structure with a root node and child nodes forming a parent-child relationship. No cycles allowed.

### Binary Tree

Tree where each node has at most two children (left and right). Foundation for many efficient data structures and algorithms.

### Binary Search Tree (BST)

Binary tree where left subtree contains smaller values and right subtree contains larger values. Supports O(log n) search in balanced cases.

### Balanced Tree

Tree maintaining height bounds through rotations or restructuring. Examples include AVL trees and Red-Black trees with guaranteed O(log n) operations.

### Trie (Prefix Tree)

Tree structure for storing strings where each path from root represents a prefix. Enables efficient prefix matching and autocomplete functionality.

### Graph

Collection of nodes (vertices) connected by edges. Can be directed (one-way) or undirected (two-way), weighted or unweighted.

### Directed Graph

Graph where edges have direction, meaning edge (u,v) doesn't imply edge (v,u). Used to model one-way relationships or dependencies.

### Undirected Graph

Graph where edges are bidirectional. If node A connects to B, then B connects to A.

### Weighted Graph

Graph where edges have associated numerical values (weights) representing cost, distance, or capacity.

### Adjacency List

Graph representation using an array of lists where each index stores neighbors of that vertex. Space-efficient for sparse graphs.

### Adjacency Matrix

Graph representation using a 2D array where matrix[i][j] indicates edge presence/weight. Enables O(1) edge lookup but uses O(V²) space.

---

## Algorithm Patterns

### Two Pointers

Technique using two indices to traverse data structure, often from opposite ends or at different speeds. Reduces nested loops from O(n²) to O(n).

### Sliding Window

Pattern maintaining a contiguous subrange (window) that slides through data. Optimizes subarray/substring problems from O(n²) to O(n).

### Fast and Slow Pointers

Two-pointer variant where pointers move at different speeds. Used for cycle detection and finding middle elements.

### Binary Search

Divide-and-conquer algorithm that repeatedly halves search space on sorted data. Achieves O(log n) search time.

### Breadth-First Search (BFS)

Graph/tree traversal exploring all nodes at current depth before moving deeper. Uses queue, finds shortest paths in unweighted graphs.

### Depth-First Search (DFS)

Graph/tree traversal exploring as deep as possible before backtracking. Uses stack (or recursion), useful for path finding and cycle detection.

### Dynamic Programming (DP)

Optimization technique breaking problems into overlapping subproblems, solving each once and storing results. Trades space for time efficiency.

### Backtracking

Algorithmic technique for exploring all possible solutions by building candidates incrementally and abandoning those that fail constraints.

### Greedy Algorithm

Approach making locally optimal choices at each step hoping to find global optimum. Works when local choices lead to global solution.

### Divide and Conquer

Strategy dividing problem into smaller independent subproblems, solving recursively, then combining results. Examples include merge sort and quicksort.

### Topological Sort

Linear ordering of directed graph vertices where every edge goes from earlier to later in sequence. Only possible for acyclic graphs.

### Union-Find (Disjoint Set)

Data structure tracking elements partitioned into disjoint sets. Supports efficient union and find operations for connectivity problems.

### Prefix Sum

Precomputed array where each index stores sum of all elements up to that point. Enables O(1) range sum queries.

### Monotonic Stack

Stack maintaining elements in monotonic (increasing or decreasing) order. Solves next greater/smaller element problems in O(n).

### Line Sweep

Algorithm processing events in sorted order (usually by coordinate). Used for interval problems and computational geometry.

---

## Problem-Solving Terms

### Brute Force (Checking every single possibility)

Straightforward approach checking all possibilities without optimization. Often O(n²) or worse but useful as starting point.

### Best possible solution

Most efficient solution minimizing time and/or Space Complexity (Memory usage of the algorithm). Often the target after developing Brute Force (Checking every single possibility) approach.

### Edge Case (Unusual or extreme situation)

Unusual or extreme input scenario that may break normal logic. Examples include empty input, single element, all duplicates, or maximum constraints.

### Base Case

Simplest problem instance in recursion that can be solved directly without further recursive calls. Prevents infinite recursion.

### Recursive Case

Problem instance solved by reducing to smaller instances of same problem. Core of recursive problem solving.

### Rule that never changes

Property or condition that remains true throughout algorithm execution. Useful for proving correctness and designing loops.

### Subproblem

Smaller instance of original problem. Foundation of divide-and-conquer and dynamic programming approaches.

### Overlapping Subproblems

Characteristic where same subproblem appears multiple times. Indicates dynamic programming may be applicable.

### Optimal Substructure

Property where Best possible solution contains optimal solutions to subproblems. Required for dynamic programming to work.

### Memoization (Saving results to avoid repeating work)

Top-down dynamic programming technique caching results of expensive function calls. Typically implemented with hash maps or arrays.

### Tabulation (Building a table of results from the bottom up)

Bottom-up dynamic programming technique filling table of subproblem solutions. Builds from smallest subproblems to final answer.

### State

Current configuration of problem at any point. In DP, represents unique subproblem identified by parameters.

### State Transition

Relationship between states showing how to compute one state from others. Defines Formula that defines a step based on previous steps in dynamic programming.

### Formula that defines a step based on previous steps

Mathematical equation expressing solution in terms of solutions to smaller instances. Foundation of recursive and DP approaches.

### Algorithm that uses only the existing space

Algorithm modifying input directly without allocating proportional auxiliary space. Typically O(1) Space Complexity (Memory usage of the algorithm).

### Stable Algorithm

Sorting algorithm preserving relative order of equal elements. Important when sorting by multiple criteria.

### Comparison-based Algorithm

Algorithm making decisions only through comparing elements. Limited to O(n log n) for sorting.

---

## Interview Terms

### Constraints

Limits on input size, value ranges, or problem parameters. Critical for choosing appropriate algorithm and data structures.

### Trade-off

Compromise between competing objectives like time vs. space, simplicity vs. performance, or memory vs. speed.

### Time-Space Trade-off

Common optimization choice between using more memory for faster execution or using less memory with slower execution.

### Follow-up Question

Additional question exploring variations, optimizations, or extensions of original problem. Tests depth of understanding.

### Clarifying Question

Question asked to interviewer to understand problem requirements, constraints, or expected behavior. Shows careful problem analysis.

### Test Case

Specific input-output pair used to verify algorithm correctness. Should cover normal cases, edge cases, and corner cases.

### Corner Case (Very rare combination of problems)

Rare combination of edge conditions. More specific than Edge Case (Unusual or extreme situation), like empty input with special flag set.

### Manual step-by-step test

Manual step-through of algorithm with sample input to verify logic. Essential debugging and understanding technique.

### Step-by-step plan in plain English

High-level description of algorithm using informal programming syntax. Helps plan before implementing.

### Code Smell

Pattern in code suggesting potential problems, inefficiency, or poor design. Indicates refactoring may be needed.

### Refactoring

Restructuring code without changing external behavior to improve readability, maintainability, or performance.

### Slowest part of the process

Part of algorithm consuming most resources (time or space). Primary target for optimization efforts.

### Auxiliary Space

Extra space used beyond input storage. Distinguishes algorithm's space usage from space needed to hold input.

---

## Additional Concepts

### Practical rule of thumb

Practical approach using experience or rules of thumb to find good-enough solutions when optimal solutions are impractical.

### Cutting off unnecessary steps

Optimization eliminating unnecessary branches in search tree. Dramatically improves backtracking and search algorithm performance.

### Window

Contiguous subrange of data structure. Central concept in sliding window pattern for substring/subarray problems.

### Complement

Value that when combined with current element produces target. Key concept in two-sum style problems using hash tables.

### Pivot

Element used to partition data in divide-and-conquer algorithms. Choice affects performance in algorithms like quicksort.

### Sentinel

Special marker value simplifying boundary conditions. Examples include dummy head nodes or infinity values.

### Cycle

Path in graph or linked list that returns to starting point. Detection is common interview problem.

### Connected Component

Maximal set of vertices in graph where each pair is connected by some path. Found using BFS or DFS traversal.

### Strongly Connected Component

Set of vertices in directed graph where every vertex is reachable from every other vertex. Requires specialized algorithms like Tarjan's.

### In-degree / Out-degree

For directed graphs, in-degree counts incoming edges, out-degree counts outgoing edges. Important for topological sort and dependency graphs.

---

## Usage Notes

This glossary is designed to be referenced while working through problems in the repository. Each term is explained with practical context to help you understand not just what concepts mean, but how they apply to real problem-solving.

When encountering unfamiliar terms in problem descriptions or strategy guides, check this glossary for clear definitions and usage examples.
