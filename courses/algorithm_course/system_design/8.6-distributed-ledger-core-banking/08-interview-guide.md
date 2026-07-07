# Interview Guide

## 45-Minute Interview Pacing

| Phase | Time | Focus | Candidate Should Demonstrate |
|-------|------|-------|------------------------------|
| **1. Clarification** | 0-5 min | Scope the problem, identify core requirements | Asks about scale (accounts, TPS), product types (deposits vs. loans vs. both), multi-currency, regulatory jurisdiction |
| **2. High-Level Design** | 5-18 min | Architecture, key components, data flow | Draws GL/SL architecture, identifies ledger as core primitive, shows CQRS separation, explains double-entry |
| **3. Deep Dive** | 18-35 min | Ledger consistency, cross-shard, interest engine | Explains atomic balance-check-and-debit, saga pattern, interest accrual batch, hot account mitigation |
| **4. Scalability & Trade-offs** | 35-42 min | Scaling, reliability, compliance | Discusses sharding strategy, DR with RPO=0, regulatory reporting, EOD batch constraints |
| **5. Wrap-Up** | 42-45 min | Edge cases, monitoring, future evolution | Mentions reconciliation dashboards, legacy migration, multi-entity tenancy |

---

## Phase 1: Clarification Questions

**Strong candidates ask these questions before designing:**

| Question | Why It Matters | Good vs. Great Answer |
|----------|---------------|----------------------|
| "What types of accounts? Deposits only or also loans and credit lines?" | Loans require interest accrual, amortization schedules, provisioning---fundamentally different from deposit accounts | **Good**: Deposits + loans. **Great**: Asks about loan lifecycle (disbursement, repayment, prepayment, write-off) and how each creates ledger entries |
| "What's the consistency requirement for the ledger?" | This should be the candidate's first instinct---financial systems require strong consistency | **Good**: Strong consistency. **Great**: Specifies the exact Rule that never changes: "debits must equal credits at all times, and no account should go below zero unless it's a credit account" |
| "Single currency or multi-currency?" | Multi-currency introduces FX complexity, nostro/vostro accounts, and position management | **Good**: Multi-currency. **Great**: Asks about day-count conventions for interest accrual and how FX rates are locked (at transaction time vs. settlement) |
| "What regulatory framework?" | Basel III, SOX, PSD2 each impose specific data requirements | **Good**: Mentions compliance. **Great**: Asks about specific regulations and their impact on data retention, audit trails, and capital calculations |
| "Is this a greenfield build or legacy modernization?" | Legacy modernization via strangler fig is the reality for most core banking projects | **Good**: Assumes greenfield. **Great**: Asks about co-existence with legacy systems, dual-write strategies, and anti-corruption layers |

---

## Phase 2: High-Level Design Evaluation

### Must-Have Components (Minimum Bar)

| Component | What to Look For |
|-----------|-----------------|
| **Double-entry ledger** | Candidate must identify double-entry bookkeeping as the core primitive. Every transaction produces debit + credit entries. This is non-negotiable. |
| **GL/SL hierarchy** | Should describe sub-ledgers rolling up to general ledger control accounts. Mentions Chart of Accounts. |
| **CQRS separation** | Separates write path (posting) from read path (balance queries, reporting). Materialized balance to avoid summing entries. |
| **Saga for cross-shard** | Identifies that transfers between sharded accounts require distributed coordination. Chooses saga over 2PC. |
| **Immutable entries** | Ledger entries are never updated or deleted. Corrections via reversing entries. This is both an accounting requirement and an audit requirement. |

### Differentiators (Strong Signal)

| Component | What It Signals |
|-----------|----------------|
| **Product catalog as configuration** | Candidate understands that core banking products are data-driven, not hard-coded |
| **Interest accrual engine** | Understands day-count conventions (30/360 vs. Actual/365), tiered rates, compounding |
| **Nostro/vostro account design** | Understands correspondent banking and multi-currency settlement |
| **Event sourcing** | Recognizes that the ledger is naturally an event store; derives state from events |
| **Reconciliation as first-class** | Designs reconciliation into the architecture (not an afterthought) |

---

## Phase 3: Deep Dive Questions

### Question 1: "How do you prevent double-spend?"

**Evaluating**: Understanding of concurrency control in financial systems

| Level | Expected Answer |
|-------|----------------|
| **Junior** | "Check balance before debit" (misses the race condition entirely) |
| **Mid** | "Use a database lock" (correct direction but vague) |
| **Senior** | "SELECT FOR UPDATE within a transaction: lock the account row, check balance, debit, update materialized balance, all atomically. The lock serializes concurrent operations on the same account." |
| **Staff** | All of the above plus: "This creates a Slowest part of the process for hot accounts. For merchant accounts with high throughput, use sub-account sharding: split the balance across N sub-accounts, each independently lockable, reducing contention N-fold. Debits are more complex---may need to check multiple sub-accounts." |

### Question 2: "How does a transfer work when sender and receiver are on different shards?"

**Evaluating**: Distributed transaction design

| Level | Expected Answer |
|-------|----------------|
| **Junior** | "Use a distributed transaction" (doesn't know the implications) |
| **Mid** | "Use 2PC" (technically correct but fragile) |
| **Senior** | "Use a saga: debit first, then credit. If credit fails, compensate by reversing the debit. Write saga state to a durable log. Each step is idempotent." |
| **Staff** | All of the above plus: "Debit-first ordering matters---crediting first temporarily creates money. The saga log must survive coordinator crashes. Use a dedicated saga store, not the same shard DB. Monitor saga completion latency and compensation rate. Also consider co-locating frequently interacting accounts on the same shard to reduce cross-shard rate." |

### Question 3: "How do you calculate interest for 80 million accounts overnight?"

**Evaluating**: Batch processing design, domain knowledge

| Level | Expected Answer |
|-------|----------------|
| **Mid** | "Run a cron job that loops through accounts" (no parallelism concept) |
| **Senior** | "Parallel processing: each shard's accounts processed by an independent worker. Batch accounts in groups of 1000. Each batch creates a journal entry for all accruals in that batch." |
| **Staff** | All of the above plus: "Handle day-count conventions correctly (30/360, Actual/365, Actual/Actual). Tiered rates require calculating interest per bracket. Backdated transactions trigger retroactive recalculation. Use accrual_state table to track where each account left off---enables restart from checkpoint. Distinguish accrual (memo posting) from capitalization (actual balance impact). The batch must be idempotent: if it crashes and restarts, don't double-accrue." |

### Question 4: "How do you handle a reconciliation break?"

**Evaluating**: Operational maturity, financial domain understanding

| Level | Expected Answer |
|-------|----------------|
| **Mid** | "Log an error" (no operational response) |
| **Senior** | "Alert immediately (P1). Freeze the affected GL account. Investigate by tracing journal entries. Post a correcting entry with dual authorization." |
| **Staff** | All of the above plus: "Reconciliation should be continuous, not just EOD. Maintain running GL totals updated atomically with each posting. Hourly snapshot comparison catches breaks early. A break is almost always a timing issue (in-flight postings captured in SL but not yet in GL snapshot) or a bug in the posting service. True breaks (data corruption) require forensic investigation with the audit trail. Every reconciliation run produces an immutable report for regulators." |

---

## Trap Questions

### Trap 1: "Why not use a NoSQL database for the ledger?"

**The trap**: Candidate might agree because "NoSQL scales better."

**Strong answer**: "The ledger requires ACID transactions: the balance check + debit + credit must happen atomically within a single transaction. NoSQL databases typically provide eventual consistency and don't support multi-row ACID transactions. The ledger's fundamental Rule that never changes (debits = credits) cannot tolerate eventual consistency. However, NoSQL is appropriate for the event store (append-only, high throughput), balance cache (fast reads), and reporting data warehouse (columnar queries)."

### Trap 2: "Just use event sourcing---you don't need a traditional database."

**The trap**: Over-applying event sourcing.

**Strong answer**: "The ledger IS naturally event-sourced (immutable entries are events). But you still need materialized state for balance queries---you can't replay millions of events for every balance check. The materialized balance in the account table is the read model, updated in the same transaction as the ledger entry write. Event sourcing gives you the audit trail and replay capability, but the materialized view is what makes it performant."

### Trap 3: "Can't you just use a blockchain for the ledger?"

**The trap**: Conflating distributed ledger (banking term) with blockchain (DLT).

**Strong answer**: "A core banking ledger is a 'distributed ledger' in the traditional accounting sense---the ledger is distributed across sub-ledgers and reconciled. This is fundamentally different from blockchain. A blockchain's consensus mechanism (proof-of-work, proof-of-stake) adds latency incompatible with real-time payments. Banks don't need trustless consensus---they ARE the trusted party. The immutability guarantee is better achieved with append-only databases and cryptographic hash chains, which offer the same tamper-evidence without the consensus overhead."

### Trap 4: "Why not calculate interest in real-time on every transaction?"

**The trap**: Seems intuitive but creates massive complexity.

**Strong answer**: "Real-time accrual means every deposit, withdrawal, and transfer would trigger an interest recalculation and additional ledger entries. For an account with 50 transactions per month, this creates 50 accrual adjustments instead of 30 daily batch entries. It also makes rate changes mid-period extremely complex. Daily batch accrual is the banking industry standard because it's simpler, auditable, and the interest difference between daily and per-transaction accrual is negligible for retail accounts."

---

## Trade-Off Discussions

### Trade-off 1: Row Locking vs. Optimistic Concurrency

| Approach | Pros | Cons | When to Use |
|----------|------|------|-------------|
| **SELECT FOR UPDATE** (pessimistic) | Simple, guaranteed correctness, no retries | Serializes operations, limits throughput per account | Default for all accounts |
| **CAS with version** (optimistic) | Higher throughput under low contention | Retry storms under high contention; more complex | Batch operations with low collision rate |

**Decision framework**: Use pessimistic locking as the default (correctness over throughput). Switch to optimistic only for specific hot account sub-wallets where contention is predictable and retry cost is low.

### Trade-off 2: Synchronous vs. Asynchronous DR Replication

| Approach | Pros | Cons | When to Use |
|----------|------|------|-------------|
| **Synchronous** | RPO = 0 (zero data loss) | Adds 2-50ms latency per write | Ledger posting, account state |
| **Asynchronous** | No latency impact | RPO > 0 (possible data loss on failure) | Event store, audit logs, reporting |

### Trade-off 3: Monolithic Ledger vs. Per-Product Sub-Ledgers

| Approach | Pros | Cons | When to Use |
|----------|------|------|-------------|
| **Single unified ledger** | Simpler reconciliation, single source of truth | Schema must accommodate all product types | Smaller banks, greenfield builds |
| **Per-product sub-ledgers** | Optimized schemas per product, independent scaling | Complex GL reconciliation, multiple databases | Large banks with diverse product lines |

---

## Scoring Rubric

| Dimension | Below Bar | Bar | Above Bar |
|-----------|-----------|-----|-----------|
| **Problem Decomposition** | Jumps to implementation without understanding requirements | Identifies core components (ledger, accounts, payments) and their relationships | Maps the full GL/SL hierarchy, identifies Chart of Accounts, separates concerns cleanly |
| **Consistency & Correctness** | Ignores or hand-waves the double-entry Rule that never changes | Identifies double-entry requirement; implements atomic balance check + debit | Designs multi-layer enforcement (API validation → DB constraint → reconciliation → audit) |
| **Distributed Systems** | Uses 2PC without understanding failure modes | Implements saga for cross-shard; understands compensation | Designs saga log for durability, handles timeout and stuck sagas, monitors compensation rate |
| **Domain Knowledge** | No financial domain understanding | Understands basic accounting (debits/credits, balance types) | Demonstrates knowledge of interest accrual, day-count conventions, nostro/vostro, regulatory reporting |
| **Scalability** | Single-database design | Shards by account_id; uses CQRS for read/write separation | Addresses hot accounts (sub-sharding), EOD batch scaling, multi-region for global banks |
| **Operational Maturity** | No monitoring or recovery discussion | Identifies key metrics, basic alerting | Designs continuous reconciliation, runbooks for breaks, compliance calendar, DR testing |
| **Communication** | Disorganized, skips between topics | Structured approach with clear rationale | Acknowledges trade-offs explicitly, discusses alternatives, justifies choices with constraints |

---

## Common Mistakes

| Mistake | Why It's Wrong | Correct Approach |
|---------|---------------|-----------------|
| Storing balance as a single mutable field without ledger | Cannot audit, cannot reconcile, cannot detect errors | Balance is a materialized cache of the immutable ledger entries |
| Using UPDATE to correct ledger entries | Destroys audit trail, violates accounting standards | Post a reversing entry (same amounts, opposite debit/credit) |
| Ignoring the GL/SL reconciliation | Misses the core architectural pattern of banking | Sub-ledger totals must reconcile to GL control accounts; automated verification |
| Calculating balance by summing all ledger entries on every read | O(n) per query where n grows forever | Maintain materialized balance updated atomically with each posting |
| Using 2PC for cross-shard transfers | Fragile, lock-holding, single point of failure | Saga pattern with compensating transactions and durable saga log |
| Treating interest accrual as trivial | Missing day-count conventions, tiered rates, compounding, backdating | Dedicated accrual engine with product-driven configuration |
| No idempotency for financial operations | Network retries create duplicate ledger entries (real money impact) | Client-generated idempotency key with server-side dedup (cache + DB unique constraint) |

---

## Extension Questions (Senior / Staff Level)

### "How would you handle a legacy migration from a 40-year-old mainframe?"

**Strong answer**: "Strangler fig pattern. Route one product line at a time. Phase 0: shadow mode where new system gets copies of all transactions, results compared daily. Phase 1: new products only on the new core. Phase 2: migrate existing customers by segment. Anti-corruption layer translates between mainframe's flat-file model and the new relational/event-sourced model. Dual-write reconciliation catches any divergence. Critical: regulatory reporting must work throughout---often requires aggregating data from both systems during transition."

### "What happens at month-end / quarter-end / year-end?"

**Strong answer**: "Month-end triggers: (1) monthly fee postings for all accounts, (2) interest capitalization for monthly-compounding products, (3) GL closing entries, (4) monthly statement generation, (5) regulatory snapshot for Basel III capital reporting. Quarter-end adds: provisioning review for loan portfolio, LCR/NSFR recalculation. Year-end adds: annual interest capitalization, tax withholding entries, annual statements, GL year-close (carry forward balances to new fiscal year). The system must handle the compounding effect: quarter-end processing generates ~3× normal batch volume, year-end ~5×. Pre-scaling and extended batch windows are standard."

### "How do you design for multi-entity / white-label?"

**Strong answer**: "Each banking entity gets: separate Chart of Accounts, separate GL control accounts, separate encryption keys, and separate regulatory reporting. Shared: infrastructure (compute, storage), posting engine code, product catalog engine. Entity isolation at the data layer via entity_id column on every table with row-level security policies. Cross-entity transfers use the saga pattern with additional AML checks. The posting service is entity-aware: it validates that all entries in a journal belong to the same entity (or the transfer is explicitly cross-entity)."

---

## Scaling Discussion Framework

### Scale Axes

| Axis | Current | 10× | 100× | Key Architecture Change |
|------|---------|-----|------|------------------------|
| **Accounts** | 100M | 1B | 10B | Shard splitting; global routing; tiered account storage |
| **TPS** | 46K | 460K | 4.6M | Sub-account sharding for all accounts; async posting with guaranteed delivery |
| **Ledger size** | 137 TB/yr | 1.37 PB/yr | 13.7 PB/yr | Columnar compression; aggressive tiering; summary-only for cold tier |
| **Entities** | 5-20 | 200 | 2000 | Per-entity shard assignment; entity-level auto-scaling |
| **Currencies** | 30+ | 100+ | 200+ | Dedicated FX engine; per-currency position management |

### Slowest part of the process Sequence Under Growth

```
First to break (10× scale):
  1. Hot accounts → sub-account sharding mandatory for top 1000 accounts
  2. EOD batch window → parallel accrual must halve per-account processing time
  3. Saga orchestrator → partition across more coordinator instances

Next to break (100× scale):
  4. Shard management overhead → automated shard splitting / merging
  5. Event store throughput → dedicated high-throughput log infrastructure
  6. Balance cache → distributed cache per region, cross-region invalidation
  7. Network bandwidth → dedicated posting network, separate from read traffic
```

---

## Whiteboard Walkthrough

### Drawing Order (Recommended)

1. **Start with the double-entry primitive**: Draw two boxes (Account A, Account B), show debit/credit arrows. This establishes you understand the domain.
2. **Add the GL/SL hierarchy**: Show sub-ledgers rolling up to GL control accounts. Draw the reconciliation check.
3. **Show the posting path**: Client → Gateway → Posting Service → DB (atomic write). Emphasize idempotency.
4. **Add CQRS split**: Separate write path from read path. Show balance cache and read replicas.
5. **Introduce sharding**: Shard the ledger by account_id. Show saga for cross-shard transfers.
6. **Show the batch pipeline**: EOD processing: accrual → reconciliation → reporting.

### Time Allocation

| Component | Drawing Time | Discussion Time |
|-----------|-------------|-----------------|
| Double-entry + GL/SL | 2 min | 3 min |
| Posting path + idempotency | 3 min | 5 min |
| CQRS + balance cache | 2 min | 3 min |
| Sharding + saga | 3 min | 5 min |
| Interest accrual batch | 2 min | 4 min |
| Deep dive (chosen topic) | - | 10 min |

---

## Quick Reference Numbers

| Metric | Value | How to Remember |
|--------|-------|-----------------|
| **Accounts** | 100M | "Large bank, not the largest" |
| **Daily transactions** | 500M | "5× accounts daily" |
| **Peak TPS** | ~46K | "500M / 86400 × 8 (peak factor)" |
| **Ledger entries per tx** | 3 avg | "Double-entry + fees" |
| **Peak ledger writes/sec** | ~139K | "46K × 3 entries" |
| **Balance reads/sec** | 100K | "2× posting TPS" |
| **Cross-shard %** | 30% | "Nearly 1 in 3" |
| **Interest accounts** | 80M | "Most deposit + loan accounts" |
| **EOD batch window** | 6 hours | "Midnight to 6 AM" |
| **Shard count** | 16 | "< 10K writes/sec per shard" |
| **Daily ledger growth** | 375 GB | "1.5B entries × 250 bytes" |
| **Annual ledger** | 137 TB | "375 GB × 365" |
| **Posting latency p99** | 500ms | "Real-time payment SLO" |
| **Balance latency p99** | 50ms | "Payment authorization SLO" |
| **RPO** | 0 | "Zero data loss, always" |

---

## Comparison Cheat Sheet

| Aspect | Core Banking (This) | Digital Wallet (8.4) | Stock Exchange (8.3) | Payment Gateway (5.5) |
|--------|---------------------|---------------------|---------------------|----------------------|
| **Primary Rule that never changes** | GL balances (A = L + E) | Debits = Credits per wallet | Order book price-time priority | At-least-once with recon |
| **Consistency** | Strong ACID per shard | Strong per wallet | Strong per order book | Eventual with settlement |
| **Cross-entity txn** | Saga with compensation | Saga or 2PC | Clearing house netting | Card network settlement |
| **Batch processing** | EOD: interest, fees, GL recon | Minimal batch | EOD: settlement, margin | EOD: settlement files |
| **Regulatory** | Basel III, SOX, PSD2 | Money transmitter | Securities (SEBI/SEC) | PCI-DSS, card network |
| **Product catalog** | DSL driving all behavior | Fixed product types | Fixed instrument types | Fixed payment flows |
| **Hot account pattern** | Sub-account sharding | Per-wallet throughput limit | Market maker priority queue | Merchant rate limiting |
| **Audit** | Full hash-chained ledger | Transaction-level logging | Trade audit trail | Transaction-level logging |

---

## Senior-Level Discussion Points

### 1. Smart Contracts vs. Procedural Posting

Thought Machine's Vault uses smart contracts (Python-like) to define posting behavior, while traditional platforms use procedural code. Discuss: When does encoding posting logic as smart contracts provide value vs. complexity?

**Key insight**: Smart contracts shine when the posting logic varies significantly between products (e.g., Islamic banking profit-sharing vs. standard interest). Procedural approaches work better when posting logic is standard but product configuration varies.

### 2. Real-Time vs. Batch Interest Accrual

Why do all major banks still use batch accrual? When might real-time accrual become viable?

**Key insight**: Batch is simpler, auditable, and the interest difference is negligible for retail. Real-time might emerge with instant-settlement banking where value-dating becomes irrelevant.

### 3. Event Sourcing Purity vs. Practicality

Should the ledger be purely event-sourced (derive all state from events) or use event sourcing + materialized state?

**Key insight**: Pure event sourcing would require replaying millions of events per balance query. The materialized balance is a pragmatic compromise: the events are authoritative, but the materialized view is what makes the system performant. The discipline is ensuring the materialized view is *always* updated in the same transaction as the event write.

### 4. Global vs. Regional Deployment

When should a global bank use a single global ledger vs. regional ledgers with cross-region settlement?

**Key insight**: Regional ledgers with settlement are the standard because: (1) data residency laws (GDPR) prevent centralizing European data, (2) latency for cross-region sync writes is prohibitive for real-time payments, (3) regulatory reporting is per-jurisdiction. The global GL is aggregated, not replicated.
