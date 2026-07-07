# 16.8 Design a Change Data Capture (CDC) System

## Overview

A Change Data Capture (CDC) system is a data integration pattern that detects and captures row-level changes — inserts, updates, and deletes — from a database's transaction log and delivers them as an ordered stream of events to downstream consumers. Rather than polling tables for differences or relying on application-level dual writes, CDC tails the database's own write-ahead log (WAL in PostgreSQL) or binary log (binlog in MySQL), the same mechanism the database uses for crash recovery and replication. This approach adds zero query load to the source, preserves the exact transaction ordering, captures changes that bypass application code (schema migrations, manual fixes), and makes every downstream system — search indexes, caches, data warehouses, materialized views — a deterministic function of the source of truth. CDC has become the backbone of event-driven microservice architectures, powering the outbox pattern, CQRS projections, real-time analytics, and cross-system consistency without distributed transactions.

## Key Characteristics

| Characteristic | Description |
|----------------|-------------|
| **Write-driven, read-propagating** | The system is activated by source database writes; its output feeds read-optimized downstream stores |
| **Low-latency streaming** | End-to-end change propagation typically achieves sub-second latency (50-500ms from commit to downstream delivery) |
| **Exactly-once semantic goal** | The pipeline must guarantee that each source change appears exactly once in every downstream consumer, despite at-least-once transport |
| **Schema-aware** | Change events carry both data and schema metadata; the system must handle DDL changes (column adds, renames, type changes) without data loss |
| **Ordered and transactional** | Events must preserve per-table ordering and, ideally, transaction boundaries so downstream consumers can reconstruct consistent database states |
| **Stateful with checkpoint** | Connectors maintain offset positions (log sequence numbers) enabling exactly-once restart after crash or rebalancing |
| **Heterogeneous source/sink** | A single CDC platform typically captures from multiple database engines and delivers to multiple sink types (message brokers, search engines, caches, lakes) |

## Complexity Rating: **High**

Designing a production CDC system requires deep understanding of database internals (WAL structure, logical decoding, binlog formats), distributed offset management, schema evolution across decoupled producers and consumers, the snapshot-to-streaming handoff problem (ensuring no duplicates or gaps when transitioning from initial load to live streaming), and exactly-once delivery semantics in the face of connector restarts and rebalancing. The system sits at the intersection of database replication, distributed streaming, and schema governance.

## Quick Links

| # | Section | Description |
|---|---------|-------------|
| 01 | [Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity planning, SLOs |
| 02 | [High-Level Design](./02-high-level-design.md) | Architecture diagrams, data flow, key decisions |
| 03 | [Low-Level Design](./03-low-level-design.md) | Data model, API design, core algorithms (Step-by-step plan in plain English) |
| 04 | [Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | WAL retention, schema evolution, snapshot-to-streaming handoff |
| 05 | [Scalability & Reliability](./05-scalability-and-reliability.md) | Horizontal scaling, connector failover, disaster recovery |
| 06 | [Security & Compliance](./06-security-and-compliance.md) | WAL access control, PII masking, GDPR considerations |
| 07 | [Observability](./07-observability.md) | Replication lag, connector health, dashboards, alerting |
| 08 | [Interview Guide](./08-interview-guide.md) | 45-min pacing, trap questions, trade-off frameworks |
| 09 | [Insights](./09-insights.md) | Key architectural insights and non-obvious lessons |

## Technology Landscape

| Category | Representative Systems | Approach |
|----------|----------------------|----------|
| Log-Based CDC Platform | Debezium, Maxwell, Canal | Tail database transaction logs via logical decoding / binlog; emit structured change events |
| Managed CDC Service | Cloud-native DMS, Fivetran, Airbyte | Fully managed connectors with auto-scaling and monitoring |
| Watermark-Based CDC | Netflix DBLog | Interleave WAL events with table selects using watermark tokens for non-blocking snapshots |
| Embedded CDC Library | Debezium Engine, pg_logical | In-process CDC without external infrastructure (no message broker dependency) |
| Streaming Platform | Apache Kafka, Redpanda, Apache Pulsar | Durable, partitioned log that stores and distributes CDC events to consumers |
| Schema Registry | Confluent Schema Registry, Apicurio | Centralized schema versioning, compatibility enforcement (Avro, Protobuf, JSON Schema) |
| CDC-Native Databases | CockroachDB Changefeeds, TiDB TiCDC, Spanner Change Streams | Built-in CDC as a first-class database feature |

## Key Concepts Referenced

- **Write-Ahead Log (WAL)** — Database durability mechanism that logs every mutation before applying it; CDC reads this log instead of querying tables
- **Logical Decoding** — PostgreSQL feature that decodes WAL entries into human-readable change events via output plugins
- **Binary Log (binlog)** — MySQL's row-based replication log that records every row-level mutation
- **Outbox Pattern** — Application writes domain events to an outbox table within the same transaction as business data; CDC captures the outbox table for reliable event publishing
- **Offset / Log Sequence Number (LSN)** — Position marker in the transaction log used to track CDC progress and enable restart without data loss
- **Schema Registry** — Centralized service that stores and validates event schemas, enforcing compatibility rules across versions
- **Snapshot** — Point-in-time full table read used for initial load before streaming begins; must be consistent with the streaming start position
- **Exactly-Once Semantics** — Guarantee that each source change is delivered and processed exactly once, achieved through idempotent writes and transactional offset commits

---

## Core Architectural Challenges

| Challenge | Why It's Hard | Key Trade-off |
|-----------|---------------|---------------|
| **Snapshot-to-streaming handoff** | Merging two data sources (table scan + WAL) into one consistent stream without gaps or duplicates | Long transaction consistency vs. non-blocking watermark complexity |
| **WAL retention management** | Stalled connector prevents WAL recycling, threatening source DB disk exhaustion | Data completeness (retain WAL) vs. source safety (drop WAL) |
| **Schema evolution propagation** | DDL changes must be detected in the WAL and propagated to all consumers without breaking deserialization | Schema flexibility vs. compatibility enforcement |
| **Exactly-once delivery** | Requires coordination across producer, platform, and every consumer — not a single-component property | Throughput (batched commits) vs. duplicate window (frequent commits) |
| **Large transaction handling** | Multi-million-row transactions block the pipeline; buffering requires unbounded memory | Transactional atomicity (buffer entire txn) vs. memory safety (stream events) |
| **Cross-source ordering** | Independent connectors on independent databases have no shared clock | Global ordering (complex, high latency) vs. per-source ordering (simple, eventual) |
| **Multi-engine support** | WAL format, logical decoding, replication protocol all differ across PostgreSQL, MySQL, MongoDB | Engine-specific depth vs. cross-engine abstraction |
| **Consumer heterogeneity** | Same event stream feeds search indexes, caches, warehouses — each with different consistency needs | Single delivery semantic vs. per-consumer configuration |

## Emerging Trends (2025-2026)

| Trend | Description | Impact |
|-------|-------------|--------|
| **CDC-native databases** | CockroachDB Changefeeds, TiDB TiCDC, Spanner Change Streams integrate CDC as a first-class database feature | Eliminates external connector infrastructure; simplifies operations |
| **Serverless CDC** | Fully managed CDC services with per-event pricing and auto-scaling, no infrastructure to manage | Reduces ops burden; shifts cost model from capacity-based to usage-based |
| **AI-augmented schema evolution** | ML models predict schema change impact and auto-generate consumer migration code | Reduces human coordination overhead for breaking schema changes |
| **Incremental watermark snapshots** | DBLog-style non-blocking snapshots becoming standard in all major CDC platforms | Eliminates long-running snapshot transactions; reduces source DB impact |
| **CDC for real-time ML feature stores** | CDC feeds feature pipelines that power real-time ML inference with sub-second feature freshness | Replaces batch ETL for ML; enables real-time fraud detection, recommendations |
| **Unified batch-streaming CDC** | Platforms that unify historical replay (batch) and live streaming (CDC) in a single API | Simplifies consumer logic; eliminates lambda architecture |
| **CDC + CBDC integration** | Central bank digital currencies requiring real-time ledger change propagation across financial institutions | New regulatory-driven CDC use case for digital currency settlement |

## System Characteristics Summary

| Characteristic | Value |
|----------------|-------|
| Primary data flow | Write-driven, read-propagating |
| Consistency model | Eventual (exactly-once via idempotency) |
| Latency target | < 500 ms p50, < 2s p99 |
| Throughput ceiling | 100K+ events/sec per connector |
| Key SLO | Replication lag (ms and bytes) |
| Failure blast radius | Stalled connector → WAL disk exhaustion → full DB outage |
| Primary Slowest part of the process | WAL logical decoding CPU on source |
| Schema management | Centralized registry with compatibility enforcement |
| Serialization format | Avro (binary, compact, evolvable) |
| Partitioning strategy | Primary key hash → topic partition |
| Ordering guarantee | Per-key total order; cross-key eventual |
| Recovery mechanism | Offset-based restart from last committed LSN |

## When to Choose This Architecture

| Scenario | Choose CDC | Choose Alternative |
|----------|-----------|-------------------|
| Need real-time downstream sync | CDC (sub-second from WAL) | Batch ETL if minutes/hours acceptable |
| Must capture deletes | CDC captures all DML | Polling-based approaches miss deletes |
| Source DB is performance-sensitive | CDC adds zero query load | Query-based polling adds read load |
| Need transaction ordering | CDC preserves commit order | Message-based approaches lose ordering |
| Schema changes frequently | CDC + schema registry handles evolution | Manual schema management if changes rare |
| Want to eliminate dual writes | CDC + outbox pattern | Distributed transactions if strong consistency required |
| Single-service, low volume | Embedded CDC library (no infra) | Full platform is overhead for simple cases |
| Cross-database migration | CDC as real-time replication bridge | pg_dump/restore for offline migration |
