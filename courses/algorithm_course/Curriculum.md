# Algorithm Mastery Curriculum

> A structured, tiered learning path from foundational computational thinking to advanced graph algorithms and system design. Built on the StructWeave open-source content, reorganized for progressive mastery.

---

## Overview

| Tier | Name | Focus | Duration | Modules |
|------|------|-------|----------|---------|
| 01 | **Beginner** | Computational thinking, basic data structures, core patterns | 6-8 weeks | 6 |
| 02 | **Intermediate** | Linear data structures, trees, heaps, binary search | 6-8 weeks | 5 |
| 03 | **Advanced** | Backtracking, dynamic programming, greedy, divide & conquer | 8-10 weeks | 5 |
| 04 | **Pro** | Graphs, shortest paths, union-find, advanced topics, system design | 6-8 weeks | 5 |

**Total**: 21 modules across 4 tiers, 26-34 weeks of structured study.

---

## Design Principles

1. **Progressive complexity** — Each tier builds on the previous. No skipping.
2. **Concept before practice** — Every module starts with notes (what/why/how), then examples, then practice references.
3. **Pattern-first learning** — Algorithms taught as reusable patterns, not isolated tricks.
4. **Separated concerns** — Notes (learning) live in tier modules. Practice (problems, drills) lives in `practice/`. Assessments live in `assessments/`.
5. **Parseable by DigitalEdu** — All note files use `type: note` with proper YAML front-matter.

---

## Directory Structure

```
algorithm_course/
│
├── Curriculum.md                          # This file
│
├── 01-beginner/                           # TIER 1: Foundations
│   ├── 01-computational-thinking/
│   │   ├── 00-index.md                    # Module overview
│   │   ├── 01-concept.md                  # What is computational thinking
│   │   ├── 02-number-theory.md            # Primes, GCD, LCM, modular arithmetic
│   │   ├── 03-digit-manipulation.md       # Digit extraction, palindromes, base conversion
│   │   └── 04-practice.md                 # Curated problem list (F001-F028)
│   │
│   ├── 02-arrays-and-strings/
│   │   ├── 00-index.md
│   │   ├── 01-concept.md                  # Memory layout, indexing, operations
│   │   ├── 02-techniques.md               # In-place ops, two-pass, edge cases
│   │   └── 03-practice.md                 # E001, E006, E010, E051, E083, E108, E123
│   │
│   ├── 03-hash-tables/
│   │   ├── 00-index.md
│   │   ├── 01-concept.md                  # Hashing, collision handling, O(1) lookup
│   │   ├── 02-techniques.md               # Complement search, frequency counting, anagrams
│   │   └── 03-practice.md                 # E001, E026, E083, E095
│   │
│   ├── 04-two-pointers/
│   │   ├── 00-index.md
│   │   ├── 01-concept.md                  # Opposite ends, same direction, fast-slow
│   │   ├── 02-techniques.md               # When to use, decision tree, complexity
│   │   ├── 03-examples.md                 # Worked walkthroughs (from examples/)
│   │   └── 04-practice.md                 # E006, E010, E052, M017
│   │
│   ├── 05-sliding-window/
│   │   ├── 00-index.md
│   │   ├── 01-concept.md                  # Fixed vs dynamic window
│   │   ├── 02-techniques.md               # Window expansion/shrinking, hash map inside window
│   │   └── 03-practice.md                 # M002, M081
│   │
│   └── 06-basic-recursion/
│       ├── 00-index.md
│       ├── 01-concept.md                  # Base case, recursive case, call stack
│       ├── 02-techniques.md               # Tail recursion, tree recursion, recursion to iteration
│       └── 03-practice.md                 # E033, M005, M014
│
├── 02-intermediate/                       # TIER 2: Core Data Structures
│   ├── 01-linked-lists/
│   │   ├── 00-index.md
│   │   ├── 01-concept.md                  # Singly, doubly, circular
│   │   ├── 02-techniques.md               # Dummy nodes, fast-slow, reversal, cycle detection
│   │   ├── 03-examples.md
│   │   └── 04-practice.md                 # E057, E082, E015, M004, H028
│   │
│   ├── 02-stacks-and-queues/
│   │   ├── 00-index.md
│   │   ├── 01-concept.md                  # LIFO, FIFO, monotonic stack
│   │   ├── 02-techniques.md               # Parentheses matching, next greater element, BFS
│   │   └── 03-practice.md                 # E014, E060, E062, M367
│   │
│   ├── 03-trees-and-bst/
│   │   ├── 00-index.md
│   │   ├── 01-concept.md                  # Traversals, BST properties, balanced trees
│   │   ├── 02-techniques.md               # In/pre/post/level order, LCA, recursion on trees
│   │   ├── 03-examples.md
│   │   └── 04-practice.md                 # E042, E043, E045, E086, E091, M039, M093
│   │
│   ├── 04-heaps/
│   │   ├── 00-index.md
│   │   ├── 01-concept.md                  # Min-heap, max-heap, priority queue
│   │   ├── 02-techniques.md               # Top K, median finding, merging sorted sequences
│   │   └── 03-practice.md                 # M085, M149, H042, H003
│   │
│   └── 05-binary-search/
│       ├── 00-index.md
│       ├── 01-concept.md                  # Search space reduction, boundary handling
│       ├── 02-techniques.md               # Standard, rotated arrays, search on answer
│       ├── 03-examples.md
│       └── 04-practice.md                 # E220, E020, M008, M063, M475
│
├── 03-advanced/                           # TIER 3: Algorithm Paradigms
│   ├── 01-backtracking/
│   │   ├── 00-index.md
│   │   ├── 01-concept.md                  # Decision trees, state spaces, undo
│   │   ├── 02-techniques.md               # Permutations, combinations, constraint satisfaction
│   │   └── 03-practice.md                 # E024, E025, E036, E037, E053, H011
│   │
│   ├── 02-dynamic-programming-1d/
│   │   ├── 00-index.md
│   │   ├── 01-concept.md                  # Overlapping subproblems, optimal substructure
│   │   ├── 02-techniques.md               # Memoization vs tabulation, state definition
│   │   ├── 03-examples.md
│   │   └── 04-practice.md                 # E033, E077, E119, M126, E039
│   │
│   ├── 03-dynamic-programming-2d/
│   │   ├── 00-index.md
│   │   ├── 01-concept.md                  # Grid DP, string DP, interval DP
│   │   ├── 02-techniques.md               # State transition on grids, LCS, edit distance
│   │   └── 03-practice.md                 # M022, M088, M003, H014, H002
│   │
│   ├── 04-greedy/
│   │   ├── 00-index.md
│   │   ├── 01-concept.md                  # Greedy choice property, when greedy works
│   │   ├── 02-techniques.md               # Interval scheduling, activity selection
│   │   └── 03-practice.md                 # E027, E054, M193
│   │
│   └── 05-divide-and-conquer/
│       ├── 00-index.md
│       ├── 01-concept.md                  # Split, solve, combine
│       ├── 02-techniques.md               # Merge sort, quicksort, tree recursion
│       └── 03-practice.md                 # M014, M017
│
├── 04-pro/                                # TIER 4: Graphs & Mastery
│   ├── 01-graph-traversal/
│   │   ├── 00-index.md
│   │   ├── 01-concept.md                  # Adjacency list/matrix, DFS, BFS
│   │   ├── 02-techniques.md               # Cycle detection, connected components, bipartite
│   │   ├── 03-examples.md                 # Course Schedule walkthrough
│   │   └── 04-practice.md                 # M077, M055, M079, M180, M136, M108
│   │
│   ├── 02-shortest-paths/
│   │   ├── 00-index.md
│   │   ├── 01-concept.md                  # BFS for unweighted, Dijkstra, Bellman-Ford
│   │   ├── 02-techniques.md               # When to use which, negative weights, all-pairs
│   │   └── 03-practice.md                 # M039, M371, M408
│   │
│   ├── 03-union-find/
│   │   ├── 00-index.md
│   │   ├── 01-concept.md                  # Disjoint sets, union by rank, path compression
│   │   ├── 02-techniques.md               # Connectivity, cycle detection, component counting
│   │   └── 03-practice.md                 # M255, M329, M355
│   │
│   ├── 04-advanced-topics/
│   │   ├── 00-index.md
│   │   ├── 01-topological-sort.md         # Kahn's algorithm, DFS-based
│   │   ├── 02-tries.md                    # Prefix trees, autocomplete
│   │   ├── 03-two-heaps.md                # Median finding, balanced partitions
│   │   ├── 04-k-way-merge.md              # Merge K sorted sequences
│   │   ├── 05-bitwise-xor.md              # Find unique elements, bit tricks
│   │   └── 06-practice.md                 # M080, M082, M083, H032, E055, E076
│   │
│   └── 05-system-design/
│       ├── 00-index.md                    # Overview and navigation
│       └── reference/                     # Symlink or index to system_design/ folder
│
├── practice/                              # SEPARATE: Practice problems (NOT notes)
│   ├── problems/                          # The 990 problems, organized by difficulty
│   │   ├── foundation/                    # F001-F028 (28 problems)
│   │   ├── easy/                          # E001-E270 (270 problems)
│   │   ├── medium/                        # M001-M575 (575 problems)
│   │   └── hard/                          # H001-H117 (117 problems)
│   │
│   ├── drills/                            # Pattern-specific focused practice
│   │   ├── two-pointers-drill.md
│   │   ├── sliding-window-drill.md
│   │   ├── binary-search-drill.md
│   │   ├── backtracking-drill.md
│   │   ├── dp-drill.md
│   │   └── number-theory-drill.md
│   │
│   ├── mixed/                             # Multi-pattern practice sets
│   │   ├── easy-mix-001.md
│   │   ├── medium-mix-001.md
│   │   └── hard-mix-001.md
│   │
│   ├── warmup/                            # Quick warmup problems
│   │   └── warmup-5min.md
│   │
│   └── review/                            # Spaced repetition schedules
│       ├── daily-review.md
│       ├── weekly-review.md
│       └── spaced-repetition-guide.md
│
├── assessments/                           # SEPARATE: Tests and evaluations
│   ├── entry-assessment.md                # Determine starting tier
│   ├── beginner-assessment.md             # Phase 1 assessment
│   ├── intermediate-assessment.md         # Phase 2 assessment
│   ├── advanced-assessment.md             # Phase 3 assessment
│   └── pro-assessment.md                  # Phase 4 assessment
│
├── examples/                              # SEPARATE: Worked walkthroughs (reference)
│   ├── two-sum-walkthrough.md
│   ├── valid-parentheses-walkthrough.md
│   ├── merge-intervals-walkthrough.md
│   ├── course-schedule-walkthrough.md
│   └── lru-cache-walkthrough.md
│
├── glossary.md                            # Terminology reference
│
├── languages/                             # REFERENCE: Language-specific guides
│   ├── python/
│   ├── golang/
│   ├── typescript/
│   └── rust/
│
└── system-design/                         # REFERENCE: System design topics
    ├── 1.1-distributed-rate-limiter/
    ├── ... (235 topics)
    └── insights/
```

---

## Module Template

Every module follows this structure:

### `00-index.md` — Module Overview

```yaml
---
type: note
id: beginner-04-two-pointers-index
title: "Two Pointers — Module Overview"
prerequisites: [beginner-02-arrays-and-strings, beginner-03-hash-tables]
---
```

Content:
- What you will learn (3-5 bullet points)
- Why this matters (real-world relevance)
- Prerequisites (links to previous modules)
- Estimated time
- Table of contents linking to other module files

### `01-concept.md` — Core Concept

```yaml
---
type: note
id: beginner-04-two-pointers-concept
title: "Two Pointers Pattern — Concept"
prerequisites: [beginner-04-two-pointers-index]
---
```

Content:
- Definition and mental model
- When to use this pattern
- Visual diagrams (Mermaid)
- Quick reference card (complexity, variants, key signals)
- First-principles explanation

### `02-techniques.md` — Implementation Details

```yaml
---
type: note
id: beginner-04-two-pointers-techniques
title: "Two Pointers Pattern — Techniques"
prerequisites: [beginner-04-two-pointers-concept]
---
```

Content:
- Step-by-step approach
- Code templates (language-agnostic pseudocode)
- Variations (opposite ends, same direction, fast-slow)
- Decision tree for choosing variation
- Common pitfalls

### `03-examples.md` — Worked Walkthroughs

```yaml
---
type: note
id: beginner-04-two-pointers-examples
title: "Two Pointers Pattern — Examples"
prerequisites: [beginner-04-two-pointers-techniques]
---
```

Content:
- 2-3 worked examples with step-by-step walkthroughs
- Multiple approaches (brute force → optimal)
- Complexity analysis for each approach
- Links to full walkthrough files in `examples/`

### `04-practice.md` — Curated Problem List

```yaml
---
type: note
id: beginner-04-two-pointers-practice
title: "Two Pointers Pattern — Practice"
prerequisites: [beginner-04-two-pointers-techniques]
---
```

Content:
- Ordered list of problems to solve
- Each problem links to `practice/problems/` by ID
- Difficulty progression within the module
- Time estimates
- Which technique from this module applies

---

## Tier Dependency Graph

```
BEGINNER
  01-computational-thinking     (no prerequisites)
  02-arrays-and-strings         (depends on: 01)
  03-hash-tables                (depends on: 02)
  04-two-pointers               (depends on: 02, 03)
  05-sliding-window             (depends on: 02, 03)
  06-basic-recursion            (depends on: 01)

INTERMEDIATE
  01-linked-lists               (depends on: beginner/06)
  02-stacks-and-queues          (depends on: beginner/06)
  03-trees-and-bst              (depends on: intermediate/01, beginner/06)
  04-heaps                      (depends on: intermediate/03)
  05-binary-search              (depends on: beginner/02)

ADVANCED
  01-backtracking               (depends on: beginner/06, intermediate/03)
  02-dynamic-programming-1d     (depends on: beginner/06, beginner/02)
  03-dynamic-programming-2d     (depends on: advanced/02)
  04-greedy                     (depends on: beginner/02)
  05-divide-and-conquer         (depends on: beginner/06, beginner/02)

PRO
  01-graph-traversal            (depends on: intermediate/01, intermediate/02)
  02-shortest-paths             (depends on: pro/01)
  03-union-find                 (depends on: pro/01)
  04-advanced-topics            (depends on: pro/01, intermediate/04)
  05-system-design              (depends on: all tiers)
```

---

## Content Source Mapping

### Beginner Tier

| Module | Source Files |
|--------|-------------|
| 01-computational-thinking | `prerequisites/computational-thinking.md`, `prerequisites/number-theory.md` |
| 02-arrays-and-strings | `prerequisites/arrays-and-strings.md` |
| 03-hash-tables | `prerequisites/hash-tables.md` |
| 04-two-pointers | `strategies/patterns/two-pointers.md` |
| 05-sliding-window | `strategies/patterns/sliding-window.md` |
| 06-basic-recursion | New content (derived from roadmap Phase 1 description) |

### Intermediate Tier

| Module | Source Files |
|--------|-------------|
| 01-linked-lists | `prerequisites/linked-lists.md` |
| 02-stacks-and-queues | `prerequisites/stacks-and-queues.md` |
| 03-trees-and-bst | `prerequisites/trees.md` |
| 04-heaps | `prerequisites/heaps.md` |
| 05-binary-search | `strategies/patterns/binary-search.md` |

### Advanced Tier

| Module | Source Files |
|--------|-------------|
| 01-backtracking | `strategies/patterns/backtracking.md` |
| 02-dynamic-programming-1d | `strategies/patterns/dynamic-programming.md` (DP section) |
| 03-dynamic-programming-2d | `strategies/patterns/dynamic-programming.md` (2D section) |
| 04-greedy | `strategies/patterns/greedy.md` |
| 05-divide-and-conquer | `strategies/patterns/divide-and-conquer.md` |

### Pro Tier

| Module | Source Files |
|--------|-------------|
| 01-graph-traversal | `prerequisites/graphs.md`, `strategies/patterns/graph-traversal.md` |
| 02-shortest-paths | `strategies/patterns/graph-traversal.md` (shortest path section) |
| 03-union-find | New content (derived from roadmap Phase 4) |
| 04-advanced-topics | `strategies/patterns/topological-sort.md`, `strategies/patterns/two-heaps.md`, `strategies/patterns/k-way-merge.md`, `strategies/patterns/bitwise-xor.md`, `prerequisites/tries.md` |
| 05-system-design | `system_design/` (reference only) |

---

## Practice Problem Distribution

### By Tier

| Tier | Foundation | Easy | Medium | Hard | Total |
|------|-----------|------|--------|------|-------|
| Beginner | 28 | 15 | 3 | 0 | 46 |
| Intermediate | 0 | 8 | 8 | 2 | 18 |
| Advanced | 0 | 3 | 6 | 2 | 11 |
| Pro | 0 | 2 | 9 | 0 | 11 |
| **Unassigned** | 0 | 242 | 549 | 113 | **904** |

> Note: 86 problems are directly assigned to modules. The remaining 904 problems are available in `practice/problems/` for self-directed practice and are NOT assigned to specific modules.

### Problem Reference Convention

Modules reference problems using relative paths:

```markdown
## Practice

| # | Problem | Difficulty | Time | Key Technique |
|---|---------|-----------|------|---------------|
| 1 | [Two Sum](../../practice/problems/easy/E001_two_sum.md) | Easy | 15min | Complement search |
| 2 | [Valid Parentheses](../../practice/problems/easy/E014_valid_parentheses.md) | Easy | 15min | Stack matching |
```

---

## Assessment Structure

| Assessment | Tier | Questions | Time | Pass Criteria |
|-----------|------|-----------|------|---------------|
| Entry Assessment | Placement | 12 | 90min | 7/12 (58%) |
| Beginner Assessment | Tier 1 | 7 | 75min | 5/7 (71%) |
| Intermediate Assessment | Tier 2 | 7 | 85min | 5/7 (71%) |
| Advanced Assessment | Tier 3 | 7 | 90min | 5/7 (71%) |
| Pro Assessment | Tier 4 | 6 | 100min | 4/6 (67%) |

---

## Files to Remove (Non-Learning Content)

| File/Folder | Reason |
|-------------|--------|
| `.github/` | GitHub issue templates — not learning content |
| `CONTRIBUTING.md` | Contributor guide — not learning content |
| `LICENSE` | License file — move to root or keep as metadata |
| `robots.txt` | SEO file — not learning content |
| `sitemap.txt` | SEO file — not learning content |
| `llms.txt` | LLM metadata — not learning content |
| `docs/superpowers/specs/` | Internal tooling spec — not learning content |
| `assets/` | Images — move relevant ones to `static/` |
| `README.md` (root) | Replaced by `Curriculum.md` |

---

## Files to Relocate

| From | To | Purpose |
|------|-----|---------|
| `prerequisites/*.md` | Tier module folders | Concept notes become module content |
| `strategies/patterns/*.md` | Tier module folders | Pattern guides become module content |
| `strategies/fundamentals/probability.md` | `01-beginner/01-computational-thinking/` | Math fundamentals |
| `problems/` | `practice/problems/` | Isolated practice bank |
| `examples/*.md` | Module `03-examples.md` files + keep originals in `examples/` | Walkthroughs embedded in modules |
| `practice/` | `practice/` (reorganize subfolders) | Already isolated |
| `assessments/` | `assessments/` (rename files for consistency) | Already isolated |
| `GLOSSARY.md` | `glossary.md` | Rename for consistency |
| `tracks/roadmap.md` | Content absorbed into `Curriculum.md` | Roadmap is now this file |

---

## Implementation Order

1. **Create tier directories** — `01-beginner/`, `02-intermediate/`, `03-advanced/`, `04-pro/`
2. **Create module directories** — All 21 module folders
3. **Write module index files** — `00-index.md` for each module
4. **Migrate concept notes** — Move and adapt `prerequisites/` and `strategies/patterns/` content into module `01-concept.md` and `02-techniques.md` files
5. **Migrate examples** — Embed walkthrough summaries into module `03-examples.md` files
6. **Write practice references** — Create `04-practice.md` or `03-practice.md` for each module with curated problem lists
7. **Reorganize practice/** — Move `problems/` into `practice/problems/`, consolidate drills
8. **Clean up** — Remove non-learning files, renameGLOSSARY.md
9. **Update links** — Fix all internal references to use new paths
10. **Verify** — Ensure every module has proper DigitalEdu-compatible front-matter

---

## DigitalEdu Front-Matter Standard

All note files in tier modules use this format:

```yaml
---
type: note
id: {tier}-{module}-{sequence}-{topic}
title: "Descriptive Title"
prerequisites: [previous-module-id, ...]
---
```

### ID Convention

```
{tier}-{module_number}-{sequence}-{topic}

Examples:
  beginner-01-01-concept
  beginner-01-02-number-theory
  beginner-04-01-concept
  intermediate-03-02-techniques
  advanced-02-01-concept
  pro-01-03-examples
```

### Prerequisite Format

```yaml
prerequisites: [beginner-02-arrays-and-strings, beginner-03-hash-tables]
```

References use the module `00-index.md` ID as the prerequisite target.

---

*Curriculum version 1.0 — Based on StructWeave open-source content (MIT License)*
