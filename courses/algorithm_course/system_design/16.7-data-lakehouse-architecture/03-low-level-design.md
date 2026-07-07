# Low-Level Design — Data Lakehouse Architecture

## Data Model

### Metadata Hierarchy

The lakehouse's metadata forms a tree rooted at the catalog pointer. Each level adds specificity, enabling progressive Cutting off unnecessary steps during query planning.

```
Catalog Pointer
  └── metadata.json  (table schema, partition spec, sort order, snapshot list)
        └── Snapshot S43
              └── manifest-list-S43.avro  (list of manifest files + partition summaries)
                    ├── manifest-001.avro  (file entries + per-file column stats)
                    │     ├── data-file-aaa.parquet
                    │     ├── data-file-aab.parquet
                    │     └── data-file-aac.parquet
                    ├── manifest-002.avro
                    │     ├── data-file-bba.parquet
                    │     └── delete-file-bb1.parquet  (MoR: position deletes)
                    └── manifest-003.avro
                          └── data-file-cca.parquet
```

### Snapshot Structure

```
Snapshot {
    snapshot_id        : int64        // unique, monotonically increasing
    parent_id          : int64        // previous snapshot (null for first)
    timestamp_ms       : int64        // commit wall-clock time
    operation          : enum         // append | overwrite | replace | delete
    manifest_list      : string       // path to manifest-list Avro file
    summary            : map<string, string>  // added-files, deleted-files, total-rows, etc.
    schema_id          : int32        // schema version in effect
    partition_spec_id  : int32        // partition spec in effect
}
```

### Manifest Entry (per data file)

```
ManifestEntry {
    status             : enum         // 0 = existing, 1 = added, 2 = deleted
    file_path          : string       // object-storage path to Parquet/ORC file
    file_format        : enum         // PARQUET | ORC | AVRO
    partition_values   : map<int, bytes>  // partition field ID → value
    record_count       : int64
    file_size_bytes    : int64
    column_sizes       : map<int, int64>  // column ID → size in bytes
    value_counts       : map<int, int64>  // column ID → non-null count
    null_counts        : map<int, int64>
    lower_bounds       : map<int, bytes>  // column ID → min value (serialized)
    upper_bounds       : map<int, bytes>  // column ID → max value (serialized)
    sort_order_id      : int32
}
```

### Delete File Entry (Merge-on-Read)

```
DeleteFile {
    file_path          : string
    delete_type        : enum         // POSITION_DELETE | EQUALITY_DELETE
    // Position delete: Parquet file with (file_path, row_position) pairs
    // Equality delete: Parquet file with column values that identify deleted rows
    record_count       : int64
    referenced_file    : string       // data file this delete applies to (optional)
}
```

### Deletion Vector (Bitmap-Based Delete)

```
DeletionVector {
    storage_type       : enum         // INLINE | ON_DISK | UUID_NAMED
    path_or_inline     : bytes        // bitmap data or path to bitmap file
    offset             : int64        // offset within file (for multi-DV files)
    size_in_bytes      : int32
    cardinality        : int64        // number of deleted rows

    // Bitmap format: RoaringBitmap where set bits indicate deleted row positions
    // Advantages over position-delete files:
    //   - O(1) row-level lookup (vs. O(log N) binary search on delete file)
    //   - Can be stored inline in manifest entries (< 2 KB typical)
    //   - No separate file I/O for small deletes
}
```

### Puffin Statistics File

```
PuffinFile {
    file_path          : string       // sidecar statistics file
    snapshot_id        : int64        // snapshot this statistics set applies to
    blobs              : list<StatisticsBlob>
}

StatisticsBlob {
    type               : string       // "apache-datasketches-theta-v1", "bloom-filter-v1"
    column_ids         : list<int32>  // columns this statistic covers
    properties         : map<string, string>  // e.g., ndv_estimate, fpp
    blob_data          : bytes        // serialized sketch or filter
}

// Usage: query engine loads Puffin file alongside manifests.
// - Theta sketches → estimate NDV for cardinality-aware join planning.
// - Bloom filters → eliminate files where a specific value cannot exist
//   (more selective than min/max for high-cardinality columns).
```

### Schema Evolution Tracking

```
SchemaEntry {
    schema_id          : int32        // monotonically increasing
    columns            : list<Column>
}

Column {
    column_id          : int32        // stable, never reused
    name               : string       // can change via rename
    type               : DataType     // promotions allowed (int32 → int64, float → double)
    required           : boolean      // can transition required → optional, not reverse
    doc                : string       // optional documentation
}

// Evolution rules:
// - Add column: assign new column_id; historical files return NULL for this column
// - Drop column: remove from active schema; files retain data under old column_id (ignored)
// - Rename column: change name, keep column_id; transparent to file reads
// - Reorder: change column positions in schema; column_id mapping handles file reads
// - Type promotion: widen type (e.g., int32 → int64); reader promotes on the fly
```

### Physical File Layout (Parquet)

```
data-file-aaa.parquet
├── Row Group 0  (typically 64–256 MB uncompressed)
│     ├── Column Chunk: event_time   (SNAPPY compressed)
│     ├── Column Chunk: user_id      (ZSTD compressed)
│     ├── Column Chunk: event_type   (DICT + RLE encoded)
│     └── Column Chunk: payload      (SNAPPY compressed)
├── Row Group 1
│     └── ...
├── Footer
│     ├── Schema
│     ├── Row group metadata (offsets, sizes, encodings)
│     └── Column statistics (min, max, null_count per chunk)
└── Footer length (4 bytes) + magic bytes
```

## API Design

### Catalog API (REST Protocol)

| Method | Endpoint | Description |
|:---|:---|:---|
| GET | `/v1/namespaces/{ns}/tables/{table}` | Load table metadata (schema, partition spec, current snapshot) |
| POST | `/v1/namespaces/{ns}/tables` | Create table with schema and partition spec |
| POST | `/v1/namespaces/{ns}/tables/{table}/commits` | Atomic commit: new snapshot with list of added/deleted files |
| GET | `/v1/namespaces/{ns}/tables/{table}/snapshots` | List snapshots for time-travel queries |
| POST | `/v1/namespaces/{ns}/tables/{table}/snapshots/{id}/cherrypick` | Cherry-pick a snapshot for WAP workflow |
| DELETE | `/v1/namespaces/{ns}/tables/{table}/snapshots` | Expire snapshots older than retention |
| POST | `/v1/namespaces/{ns}/tables/{table}/metrics` | Report scan metrics (files scanned, rows read, skipped) |
| GET | `/v1/config` | Retrieve catalog configuration and credential vending endpoints |

### Commit Request Structure

```
CommitRequest {
    table_id           : string
    base_snapshot_id   : int64        // snapshot the writer started from
    new_snapshot       : Snapshot     // proposed new snapshot
    added_files        : list<ManifestEntry>
    deleted_files      : list<ManifestEntry>
    schema_update      : SchemaUpdate   // optional: column adds/drops/renames
    partition_update   : PartitionUpdate // optional: partition spec change
    idempotency_key    : string         // prevents duplicate commits on retry
}
```

### Branching & Tagging API

| Method | Endpoint | Description |
|:---|:---|:---|
| POST | `/v1/namespaces/{ns}/tables/{table}/branches` | Create a named branch from a snapshot (isolated write context) |
| POST | `/v1/namespaces/{ns}/tables/{table}/tags` | Create a named tag (immutable snapshot label for reproducibility) |
| POST | `/v1/namespaces/{ns}/tables/{table}/branches/{branch}/cherrypick` | Merge a branch snapshot into the main line via cherry-pick |
| DELETE | `/v1/namespaces/{ns}/tables/{table}/branches/{branch}` | Delete a branch (orphan files cleaned by vacuum) |

### Multi-Table Commit API

| Method | Endpoint | Description |
|:---|:---|:---|
| POST | `/v1/namespaces/{ns}/transactions` | Begin a multi-table transaction context |
| POST | `/v1/namespaces/{ns}/transactions/{txn_id}/commits` | Add table commit to transaction |
| POST | `/v1/namespaces/{ns}/transactions/{txn_id}/finalize` | Atomically commit all tables in one CAS |

### Rate Limiting & Versioning

- API versioned via URL prefix (`/v1/`, `/v2/`).
- Commits rate-limited per table: 100 commits/min default (tunable).
- Read endpoints rate-limited per client: 1 000 requests/min.
- Idempotency key on commits prevents duplicate writes during retry.
- Retry policy: exponential backoff with jitter (base 200 ms, max 10 s, max retries 5).

## Core Algorithms

### Algorithm 1: Optimistic Concurrency Control for ACID Commits

**Purpose**: Guarantee atomic, serializable writes on object storage that has no native locking.

```
FUNCTION commit_transaction(catalog, table_id, base_snapshot, changes):
    // Phase 1: Write data files to object storage
    new_files = []
    FOR EACH batch IN changes.data_batches:
        file_path = generate_unique_path(table_id, batch.partition)
        write_parquet(object_storage, file_path, batch.data)
        stats = collect_column_statistics(batch.data)
        new_files.APPEND(ManifestEntry(file_path, stats, ADDED))

    // Phase 2: Build new metadata
    new_manifest = create_manifest(new_files + changes.deleted_files)
    write_avro(object_storage, new_manifest.path, new_manifest)

    new_manifest_list = create_manifest_list(
        base_snapshot.surviving_manifests + [new_manifest]
    )
    write_avro(object_storage, new_manifest_list.path, new_manifest_list)

    new_snapshot = Snapshot(
        id = base_snapshot.id + 1,
        parent = base_snapshot.id,
        manifest_list = new_manifest_list.path,
        operation = changes.operation_type
    )
    write_json(object_storage, new_snapshot.path, new_snapshot)

    // Phase 3: Atomic compare-and-swap
    success = catalog.compare_and_swap(
        table_id,
        expected = base_snapshot.id,
        desired  = new_snapshot
    )

    IF NOT success:
        // Conflict: another writer committed first
        latest_snapshot = catalog.load_current_snapshot(table_id)
        IF can_rebase(changes, base_snapshot, latest_snapshot):
            RETURN commit_transaction(catalog, table_id, latest_snapshot, changes)
        ELSE:
            cleanup_orphan_files(new_files)
            RAISE ConflictException("Unresolvable conflict")

    RETURN new_snapshot
```

**Complexity**: O(F) where F = number of new files for manifest construction; CAS is O(1). Retry adds another full pass. **Space**: O(F) for manifest entries.

**Conflict resolution**: Two commits conflict if they both delete the same file or if schema changes are incompatible. Non-overlapping appends to different partitions can be automatically rebased.

### Algorithm 2: Snapshot Isolation via Manifest Tracking

**Purpose**: Enable readers to see a consistent view of the table regardless of concurrent writes.

```
FUNCTION read_table(catalog, table_id, query, snapshot_id=null):
    // Step 1: Pin snapshot
    IF snapshot_id IS NOT null:
        snapshot = catalog.load_snapshot(table_id, snapshot_id)  // time travel
    ELSE:
        snapshot = catalog.load_current_snapshot(table_id)

    // Step 2: Load manifest list (partition-level summaries)
    manifest_list = load_avro(snapshot.manifest_list)

    // Step 3: Partition Cutting off unnecessary steps
    surviving_manifests = []
    FOR EACH manifest_ref IN manifest_list.entries:
        IF partition_overlaps(manifest_ref.partition_bounds, query.predicates):
            surviving_manifests.APPEND(manifest_ref)

    // Step 4: File-level data skipping
    scan_files = []
    delete_files = []
    FOR EACH manifest_ref IN surviving_manifests:
        manifest = load_avro(manifest_ref.path)
        FOR EACH entry IN manifest.entries:
            IF entry.status == DELETED:
                CONTINUE  // skip tombstoned files
            IF entry.is_delete_file:
                delete_files.APPEND(entry)
                CONTINUE
            IF column_stats_overlap(entry.lower_bounds, entry.upper_bounds,
                                     query.predicates):
                scan_files.APPEND(entry)

    // Step 5: Apply delete files (MoR)
    FOR EACH data_file IN scan_files:
        applicable_deletes = find_deletes_for(data_file, delete_files)
        data_file.pending_deletes = applicable_deletes

    RETURN ScanPlan(files=scan_files, projection=query.columns)
```

**Complexity**: O(M + F) where M = manifests, F = file entries. With partition Cutting off unnecessary steps, effective cost is O(M_surviving + F_surviving) which can be orders of magnitude smaller.

### Algorithm 3: Z-Order Clustering (Space-Filling Curve)

**Purpose**: Co-locate data across multiple sort dimensions so that multi-column predicates skip more files.

```
FUNCTION z_order_compact(table, partition, z_columns, target_file_size):
    // Step 1: Read all files in partition
    files = list_data_files(table, partition)
    all_rows = []
    FOR EACH file IN files:
        all_rows.EXTEND(read_parquet(file))

    // Step 2: Compute Z-value for each row
    FOR EACH row IN all_rows:
        z_bits = []
        FOR EACH col IN z_columns:
            normalized = normalize_to_range(row[col], col.min, col.max, bits=16)
            z_bits.APPEND(normalized)
        row.z_value = interleave_bits(z_bits)
        // interleave_bits: takes N bit-strings of length B,
        // produces one bit-string of length N*B by round-robin bit selection
        // e.g., A=0b1010, B=0b1100 → 0b11010100

    // Step 3: Sort by Z-value
    all_rows.SORT(key = row.z_value)

    // Step 4: Write new files at target size
    new_files = []
    current_batch = []
    current_size = 0
    FOR EACH row IN all_rows:
        current_batch.APPEND(row)
        current_size += estimate_size(row)
        IF current_size >= target_file_size:
            path = write_parquet(object_storage, current_batch)
            new_files.APPEND(ManifestEntry(path, collect_stats(current_batch)))
            current_batch = []
            current_size = 0
    IF current_batch IS NOT EMPTY:
        path = write_parquet(object_storage, current_batch)
        new_files.APPEND(ManifestEntry(path, collect_stats(current_batch)))

    // Step 5: Atomic commit replacing old files with new
    commit_replacement(table, partition, old_files=files, new_files=new_files)

    RETURN new_files
```

**Complexity**: O(N log N) for sorting N rows by Z-value. **Space**: O(N) — all rows must be in memory or spilled. **Benefit**: min-max ranges per file become tightly bounded, enabling 10x–100x fewer files scanned for multi-dimensional queries.

### Algorithm 4: Bin-Packing Compaction (Small File Merging)

**Purpose**: Merge many small files into fewer optimally-sized files to reduce metadata overhead and improve scan performance.

```
FUNCTION compact_partition(table, partition, target_size, min_files_to_compact):
    files = list_data_files(table, partition)

    // Step 1: Identify small files
    small_files = [f FOR f IN files IF f.file_size < target_size * 0.75]

    IF LENGTH(small_files) < min_files_to_compact:
        RETURN  // not enough small files to justify compaction

    // Step 2: Bin-packing — group small files into bins ≈ target_size
    bins = []
    current_bin = []
    current_bin_size = 0

    // Sort descending to improve packing efficiency (first-fit decreasing)
    small_files.SORT(key = file_size, descending = true)

    FOR EACH file IN small_files:
        IF current_bin_size + file.file_size > target_size * 1.1:
            bins.APPEND(current_bin)
            current_bin = [file]
            current_bin_size = file.file_size
        ELSE:
            current_bin.APPEND(file)
            current_bin_size += file.file_size

    IF current_bin IS NOT EMPTY:
        bins.APPEND(current_bin)

    // Step 3: Rewrite each bin as a single file
    new_files = []
    FOR EACH bin IN bins:
        combined_rows = []
        FOR EACH file IN bin:
            combined_rows.EXTEND(read_parquet(file))
            // Apply any pending delete files
            combined_rows = apply_deletes(combined_rows, file)

        IF table.sort_order IS NOT null:
            combined_rows.SORT(key = table.sort_order)

        path = write_parquet(object_storage, combined_rows)
        new_files.APPEND(ManifestEntry(path, collect_stats(combined_rows)))

    // Step 4: Atomic replacement commit
    old_files = FLATTEN(bins)
    commit_replacement(table, partition, old_files, new_files)

    RETURN CompactionResult(
        files_compacted = LENGTH(old_files),
        files_created   = LENGTH(new_files),
        bytes_rewritten = SUM(f.file_size FOR f IN old_files)
    )
```

**Complexity**: O(N log N) for sort-based bin packing; O(R) for reading R total rows. **Space**: O(R_bin) for the largest single bin's rows in memory.

### Algorithm 5: Deletion Vector Application (Bitmap-Based MoR)

**Purpose**: Apply row-level deletes without rewriting data files, using inline bitmaps for O(1) per-row filtering.

```
FUNCTION apply_deletion_vectors(scan_plan):
    FOR EACH file_entry IN scan_plan.files:
        IF file_entry.deletion_vector IS null:
            CONTINUE  // no deletes for this file

        dv = load_deletion_vector(file_entry.deletion_vector)
        // dv is a RoaringBitmap where set bits = deleted row positions

        file_entry.row_filter = FUNCTION(row_position):
            RETURN NOT dv.contains(row_position)

    RETURN scan_plan
```

**Complexity**: O(1) per row lookup via RoaringBitmap. **Space**: O(D / 8) bytes for D deleted rows (compressed). **Advantage over position-delete files**: No file I/O for the delete file; bitmap loaded from manifest entry or a small sidecar.

### Algorithm 6: Liquid Clustering (Adaptive Incremental Re-Clustering)

**Purpose**: Replace static Z-ordering and explicit partitioning with an incremental, adaptive clustering strategy that re-clusters only newly written data.

```
FUNCTION liquid_cluster(table, clustering_columns):
    // Step 1: Identify files needing clustering
    // Only newly written files since last clustering, plus files
    // whose clustering quality has degraded
    unclustered_files = []
    FOR EACH file IN table.current_snapshot.files:
        IF file.clustering_score < THRESHOLD:
            unclustered_files.APPEND(file)

    IF LENGTH(unclustered_files) < MIN_FILES_TO_CLUSTER:
        RETURN  // not enough work to justify clustering

    // Step 2: Read and sort by clustering key
    // Unlike Z-ordering, liquid clustering uses a HILBERT curve
    // which provides better locality than Z-order for > 2 dimensions
    all_rows = read_files(unclustered_files)

    FOR EACH row IN all_rows:
        row.cluster_key = hilbert_curve_value(
            row, clustering_columns, bits_per_dimension=10
        )

    all_rows.SORT(key = row.cluster_key)

    // Step 3: Write optimally-sized output files
    new_files = write_partitioned(all_rows, target_size=256MB)

    // Step 4: Compute clustering quality score for new files
    FOR EACH file IN new_files:
        file.clustering_score = compute_overlap_ratio(
            file, new_files, clustering_columns
        )
        // Score = 1.0 means perfect clustering (no overlap with other files)
        // Score = 0.0 means random distribution

    // Step 5: Atomic replacement commit
    commit_replacement(table, old_files=unclustered_files, new_files=new_files)

    RETURN ClusteringResult(
        files_reclustered = LENGTH(unclustered_files),
        files_created     = LENGTH(new_files),
        avg_quality_score = MEAN(f.clustering_score FOR f IN new_files)
    )
```

**Complexity**: O(N log N) for sorting. **Key advantage over Z-ordering**: incremental — only re-clusters new or degraded files rather than rewriting entire partitions. This reduces the write amplification from O(total_data) to O(new_data).

### Algorithm 7: Conflict Resolution with Automatic Rebase

**Purpose**: Automatically resolve non-conflicting concurrent commits without user intervention.

```
FUNCTION resolve_conflict(base_snapshot, latest_snapshot, pending_changes):
    // Determine what changed between base and latest
    concurrent_changes = diff_snapshots(base_snapshot, latest_snapshot)

    // Check for true conflicts (overlapping file modifications)
    conflicts = []
    FOR EACH pending_file IN pending_changes.deleted_files:
        IF pending_file IN concurrent_changes.deleted_files:
            conflicts.APPEND(("double-delete", pending_file))
        IF pending_file IN concurrent_changes.added_files:
            // File was replaced by concurrent compaction
            conflicts.APPEND(("delete-after-replace", pending_file))

    FOR EACH pending_file IN pending_changes.added_files:
        IF pending_file.partition IN concurrent_changes.schema_changes:
            conflicts.APPEND(("schema-conflict", pending_file))

    IF LENGTH(conflicts) > 0:
        RAISE UnresolvableConflict(conflicts)

    // No true conflicts — rebase pending changes onto latest snapshot
    rebased_changes = Changes(
        added_files   = pending_changes.added_files,
        deleted_files = pending_changes.deleted_files,
        base_snapshot = latest_snapshot  // rebase onto new base
    )

    RETURN rebased_changes

// Rebase-safe operations (always auto-resolvable):
//   - Appends to different partitions
//   - Concurrent appends to the same partition (different files)
//   - Schema evolution (additive) + data append
//
// Non-rebaseable operations (always conflict):
//   - Both writers delete the same file
//   - Incompatible schema changes (e.g., one drops a column the other adds data to)
//   - Compaction replaces files that another writer modifies
```

## Partition Evolution

Unlike traditional Hive-style partitioning where the partition column and granularity are fixed at table creation, the lakehouse supports **hidden partitioning** with evolution.

```
FUNCTION evolve_partition(table, new_spec):
    // Metadata-only operation — no data rewrite
    current_spec = table.current_partition_spec

    // Validate: new spec must cover existing data
    new_spec.spec_id = current_spec.spec_id + 1

    // Update table metadata
    updated_metadata = table.metadata.copy()
    updated_metadata.partition_specs.APPEND(new_spec)
    updated_metadata.default_spec_id = new_spec.spec_id

    // Existing manifest entries retain their original spec_id
    // New writes use the new spec
    // Query engine resolves both specs during planning:
    //   - manifests with old spec: apply old transform to predicates
    //   - manifests with new spec: apply new transform to predicates

    catalog.commit_metadata_update(table, updated_metadata)
```

**Example**: Evolving from `partition_by(month(event_time))` to `partition_by(day(event_time))` requires zero data movement. Old files remain in monthly partitions; new files write to daily partitions. The query engine transparently handles both layouts.

## Format Interoperability Layer

### UniForm / XTable Translation

When organizations use multiple table formats (e.g., Delta Lake for Spark workloads, Iceberg for Trino), a translation layer can generate compatible metadata for both formats from a single set of data files.

```
FUNCTION generate_interop_metadata(table, source_format, target_format):
    // Step 1: Read the source format's metadata
    source_snapshot = load_snapshot(table, source_format)
    source_files = list_data_files(source_snapshot)

    // Step 2: Translate metadata to target format
    IF target_format == ICEBERG AND source_format == DELTA:
        // Delta → Iceberg translation
        iceberg_schema = translate_schema(source_snapshot.schema, assign_column_ids=true)
        iceberg_manifests = []
        FOR EACH file IN source_files:
            entry = ManifestEntry(
                file_path = file.path,       // same physical files!
                partition_values = translate_partition(file, source_snapshot.partition_spec),
                column_stats = translate_stats(file.stats, iceberg_schema),
                status = EXISTING
            )
            iceberg_manifests.APPEND(entry)

        // Write Iceberg metadata files alongside Delta log
        write_iceberg_metadata(table, iceberg_schema, iceberg_manifests)

    // Step 3: Register both metadata pointers in catalog
    catalog.register_format(table, target_format, metadata_location)

    // Result: Both Delta and Iceberg engines read the SAME Parquet files
    // through their respective metadata paths. Zero data duplication.
```

**Key constraint**: The translation is metadata-only — no data files are copied or rewritten. Both formats point to the same physical Parquet files. The cost is maintaining two sets of metadata files (a few hundred MB for a petabyte-scale table).

## Write-Audit-Publish (WAP) Workflow

```
FUNCTION write_audit_publish(table, changes, validation_rules):
    // Step 1: Write to a staging branch
    staging_branch = create_branch(table, "staging-" + uuid())
    commit_to_branch(staging_branch, changes)

    // Step 2: Audit — run validation on staging branch
    staging_data = read_table(table, branch=staging_branch)
    validation_results = []
    FOR EACH rule IN validation_rules:
        result = rule.validate(staging_data)
        validation_results.APPEND(result)

    IF ANY(r.failed FOR r IN validation_results):
        drop_branch(staging_branch)
        RAISE ValidationError(validation_results)

    // Step 3: Publish — cherry-pick staging snapshot to main
    cherry_pick(table, from_branch=staging_branch, to_branch="main")
    drop_branch(staging_branch)

    // The main branch now contains the validated data.
    // Downstream consumers see only validated commits.
```

**Use cases**: Production data quality gates, ML data validation, regulatory compliance checks before data becomes queryable.

## Incremental Processing (Change Data Feed)

### Change Data Feed Schema

```
ChangeRecord {
    _change_type       : enum         // INSERT | UPDATE_BEFORE | UPDATE_AFTER | DELETE
    _commit_version    : int64        // snapshot ID that produced this change
    _commit_timestamp  : int64        // wall-clock time of the commit
    // ... all table columns follow
}
```

### Algorithm 8: Incremental Read Between Snapshots

**Purpose**: Enable downstream consumers to process only the changes between two snapshots, avoiding full-table rescans.

```
FUNCTION read_changes(table, start_snapshot, end_snapshot):
    // Step 1: Diff the two snapshots' manifest lists
    start_manifests = load_manifests(start_snapshot)
    end_manifests = load_manifests(end_snapshot)

    added_files = end_manifests.files - start_manifests.files
    deleted_files = start_manifests.files - end_manifests.files

    // Step 2: Classify changes
    changes = []

    // New files → INSERT records
    FOR EACH file IN added_files:
        IF file.is_data_file:
            FOR EACH row IN read_parquet(file):
                changes.APPEND(ChangeRecord(INSERT, end_snapshot.id, row))

    // Removed files → DELETE records (unless replaced by compaction)
    FOR EACH file IN deleted_files:
        IF file was replaced by compaction:
            CONTINUE  // compaction is not a logical change
        FOR EACH row IN read_parquet(file):
            changes.APPEND(ChangeRecord(DELETE, end_snapshot.id, row))

    // Delete files → mark specific rows as deleted
    FOR EACH delete_file IN added_files WHERE is_delete_file:
        FOR EACH (file_path, row_pos) IN read_delete_file(delete_file):
            row = read_row(file_path, row_pos)
            changes.APPEND(ChangeRecord(DELETE, end_snapshot.id, row))

    RETURN changes
```

**Complexity**: O(changed_files) — only reads files that differ between snapshots, not the entire table. For a table with 1 M files where 1 000 changed, this reads 0.1% of the data.

## Indexing Strategy

### Manifest-Level Indexes

| Index Type | Purpose | Storage | Query Benefit |
|:---|:---|:---|:---|
| Partition value bounds (per manifest) | Partition Cutting off unnecessary steps | Manifest list entry | Eliminates entire manifests without reading them |
| Column min/max (per file) | Data skipping | Manifest entry | Eliminates files for range predicates |
| Null count (per column per file) | Null-aware Cutting off unnecessary steps | Manifest entry | Skips files where column is all-null or never-null |
| Bloom filter (per column per file) | Point-lookup Cutting off unnecessary steps | Puffin sidecar file | Eliminates files for equality predicates on high-cardinality columns |
| NDV sketch (per column per file) | Join cardinality estimation | Puffin sidecar file | Accurate cost estimates for join ordering |

### Row-Group-Level Indexes (Parquet Internal)

| Index Type | Purpose | Storage | Query Benefit |
|:---|:---|:---|:---|
| Column chunk min/max | Intra-file data skipping | Parquet footer | Skips row groups within a file |
| Page-level offsets | Column projection | Parquet footer | Reads only projected columns' pages |
| Dictionary encoding | Value lookup | Parquet column chunk | Efficient filtering for low-cardinality columns |
| Bloom filter (Parquet) | Point-lookup within file | Parquet column chunk | Eliminates row groups for equality predicates |

## Parquet Write Optimization

### Writer Configuration Impact

| Parameter | Value Range | Impact on Reads | Impact on Writes |
|:---|:---|:---|:---|
| **Target file size** | 64 – 512 MB | Larger = fewer files, better Cutting off unnecessary steps; smaller = finer granularity | Larger = more memory per writer |
| **Row group size** | 64 – 256 MB | Larger = better compression; smaller = finer row-group Cutting off unnecessary steps | Larger = more memory buffering |
| **Page size** | 8 KB – 1 MB | Smaller = finer column-chunk stats; larger = better compression | Minimal impact |
| **Compression** | SNAPPY, ZSTD, LZ4 | ZSTD: best ratio (~30% smaller); SNAPPY: faster decompress | ZSTD: ~2x slower than SNAPPY |
| **Dictionary encoding** | Auto, PLAIN | Dictionary: excellent for low-cardinality (< 100 K values) | Dictionary: slight overhead for high-cardinality |
| **Sort order** | None, single-column, multi-column | Sorted: tight min/max stats per row group; unsorted: random stats | Sorted: O(N log N) overhead |

### Recommended Writer Settings by Workload

| Workload | File Size | Row Group | Compression | Sort Order |
|:---|:---|:---|:---|:---|
| Batch ETL | 256 MB | 128 MB | ZSTD (level 3) | Sort by partition key + time |
| Streaming micro-batch | 64 – 128 MB | 64 MB | SNAPPY | Sort by time (natural order) |
| Compaction output | 256 MB | 128 MB | ZSTD (level 3) | Sort by clustering key / Z-order |
| ML feature store | 256 – 512 MB | 256 MB | ZSTD (level 6) | Sort by entity key for row-group Cutting off unnecessary steps |

## Commit Protocol Variations by Format

| Aspect | Iceberg (CAS) | Delta Lake (Log Append) | Hudi (Timeline) |
|:---|:---|:---|:---|
| **Atomicity mechanism** | Compare-and-swap on catalog pointer | Append numbered JSON/Parquet log entries to `_delta_log/` | Append commit files to `.hoodie/` timeline |
| **Conflict detection** | CAS fails if pointer changed since read | Log append fails if expected sequence number already exists | Timeline action conflict detection |
| **Metadata location** | External catalog (REST, Hive, etc.) | Co-located with data in `_delta_log/` directory | Co-located with data in `.hoodie/` directory |
| **Multi-table atomicity** | Supported via catalog transactions | Not natively supported | Not natively supported |
| **Catalog dependency** | Required (the CAS target) | Optional (file-system-level commit) | Optional (file-system-level commit) |
| **Strength** | Clean separation; catalog-enforced governance | Self-contained; no external dependency | Self-contained; rich timeline for audit |
| **Weakness** | Catalog is SPOF and Slowest part of the process | Directory listing for log discovery (eventual consistency risk) | Complex conflict resolution |
