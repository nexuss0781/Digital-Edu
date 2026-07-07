# Low-Level Design

## Data Models

### Block Header

```
BlockHeader:
  parentHash:       bytes32       // Hash of parent block header
  ommersHash:       bytes32       // Hash of ommers (uncle) list
  beneficiary:      address       // Fee recipient (proposer)
  stateRoot:        bytes32       // Root of world state trie after execution
  transactionsRoot: bytes32       // Root of transaction trie
  receiptsRoot:     bytes32       // Root of receipt trie
  logsBloom:        bytes256      // Bloom filter for log entries
  difficulty:       uint256       // Legacy (0 in PoS)
  number:           uint64        // Block height
  gasLimit:         uint64        // Maximum gas for this block
  gasUsed:          uint64        // Total gas consumed by transactions
  timestamp:        uint64        // Unix timestamp
  extraData:        bytes[0..32]  // Arbitrary data (max 32 bytes)
  baseFeePerGas:    uint256       // EIP-1559 base fee
  withdrawalsRoot:  bytes32       // Root of validator withdrawals trie
  blobGasUsed:      uint64        // EIP-4844 blob gas consumed
  excessBlobGas:    uint64        // Running excess for blob fee calculation
  parentBeaconRoot: bytes32       // Beacon chain parent root
```

### Transaction (EIP-1559 Type 2)

```
Transaction:
  type:                 uint8       // 0x02 for EIP-1559
  chainId:              uint256     // Network identifier (prevents replay)
  nonce:                uint64      // Sender's transaction count
  maxPriorityFeePerGas: uint256     // Tip to block proposer
  maxFeePerGas:         uint256     // Maximum total fee willing to pay
  gasLimit:             uint64      // Maximum gas units for execution
  to:                   address     // Recipient (null for contract creation)
  value:                uint256     // Native currency to transfer (in wei)
  data:                 bytes       // Calldata (function selector + arguments)
  accessList:           []AccessTuple // EIP-2930 storage access hints
  v, r, s:              uint256     // ECDSA signature components

AccessTuple:
  address:    address
  storageKeys: []bytes32
```

### Account State

```
Account:
  nonce:       uint64    // Number of transactions sent (EOA) or contracts created (contract)
  balance:     uint256   // Native currency balance in wei
  storageRoot: bytes32   // Root hash of the account's storage trie (empty for EOAs)
  codeHash:    bytes32   // Hash of the contract bytecode (empty hash for EOAs)

// Account key in state trie = Keccak256(address)
// Storage key in storage trie = Keccak256(slot_number)
```

### Transaction Receipt

```
Receipt:
  status:            uint8       // 1 = success, 0 = revert
  cumulativeGasUsed: uint64      // Total gas used up to this tx in the block
  logsBloom:         bytes256    // Bloom filter for this receipt's logs
  logs:              []LogEntry  // Event logs emitted during execution
  effectiveGasPrice: uint256     // Actual gas price paid (base + priority)
  gasUsed:           uint64      // Gas consumed by this transaction

LogEntry:
  address: address               // Contract that emitted the event
  topics:  []bytes32 (max 4)     // Indexed event parameters
  data:    bytes                 // Non-indexed event parameters
```

### Validator Record (Beacon State)

```
Validator:
  pubkey:                   BLSPubKey   // BLS12-381 public key
  withdrawalCredentials:    bytes32     // Withdrawal address commitment
  effectiveBalance:         uint64      // Effective stake (max 32 ETH, in Gwei)
  slashed:                  bool        // Whether validator has been slashed
  activationEligibilityEpoch: uint64   // When eligible for activation
  activationEpoch:          uint64      // When activated
  exitEpoch:                uint64      // When exited (FAR_FUTURE if active)
  withdrawableEpoch:        uint64      // When stake can be withdrawn
```

### Mempool Entry

```
MempoolEntry:
  txHash:          bytes32
  transaction:     Transaction
  sender:          address       // Recovered from signature
  effectiveGasPrice: uint256     // min(maxFee, baseFee + maxPriorityFee)
  receivedAt:      timestamp
  localOrigin:     bool          // true if submitted directly to this node
  promotable:      bool          // true if nonce == account.nonce (executable)
```

---

## API Design

### JSON-RPC Endpoints (Client-Facing)

#### Transaction Submission

```
Method: eth_sendRawTransaction
Input:
  signedTxBytes: bytes           // RLP-encoded signed transaction

Output:
  txHash: bytes32                // Transaction hash

Errors:
  - NONCE_TOO_LOW: nonce < account.nonce
  - INSUFFICIENT_FUNDS: balance < value + gasLimit * maxFeePerGas
  - GAS_LIMIT_EXCEEDED: gasLimit > block.gasLimit
  - ALREADY_KNOWN: transaction already in mempool

Validation Steps:
  1. Decode RLP and verify transaction structure
  2. Recover sender address from ECDSA signature
  3. Verify chainId matches network
  4. Check nonce >= account.nonce
  5. Check balance >= value + gasLimit * maxFeePerGas
  6. Check gasLimit >= intrinsic gas (21000 + calldata cost)
  7. Insert into mempool priority queue
  8. Gossip to connected peers
```

#### State Queries

```
Method: eth_getBalance
Input:
  address: address
  blockTag: "latest" | "finalized" | "safe" | uint64
Output:
  balance: uint256 (in wei)

Method: eth_call
Input:
  from:     address (optional)
  to:       address
  data:     bytes (calldata)
  value:    uint256 (optional)
  gas:      uint64 (optional)
  blockTag: "latest" | uint64
Output:
  result: bytes (return data from EVM execution)
Note: Executes against state without creating a transaction

Method: eth_getTransactionReceipt
Input:
  txHash: bytes32
Output:
  receipt: Receipt | null (null if not yet included)

Method: eth_getLogs
Input:
  fromBlock: uint64
  toBlock:   uint64
  address:   address (optional filter)
  topics:    []bytes32 (optional indexed parameter filters)
Output:
  logs: []LogEntry
```

#### Chain Information

```
Method: eth_blockNumber
Output: uint64 (latest block number)

Method: eth_getBlockByNumber
Input:
  blockNumber: uint64 | "latest" | "finalized"
  fullTxs:     bool (true = include full txns, false = only hashes)
Output: Block

Method: eth_gasPrice
Output: uint256 (suggested gas price based on recent blocks)

Method: eth_feeHistory
Input:
  blockCount:        uint64
  newestBlock:       uint64 | "latest"
  rewardPercentiles: []float
Output:
  baseFeePerGas:  []uint256
  gasUsedRatio:   []float
  reward:         [][]uint256 (priority fees at each percentile)
```

### Engine API (Consensus → Execution Internal)

```
Method: engine_newPayloadV3
Input:
  executionPayload: ExecutionPayload   // Block to validate and execute
  expectedBlobVersionedHashes: []bytes32
  parentBeaconBlockRoot: bytes32
Output:
  status: "VALID" | "INVALID" | "SYNCING"
  latestValidHash: bytes32

Method: engine_forkchoiceUpdatedV3
Input:
  forkchoiceState:
    headBlockHash:      bytes32
    safeBlockHash:      bytes32
    finalizedBlockHash: bytes32
  payloadAttributes: (optional, for block building)
    timestamp:    uint64
    prevRandao:   bytes32
    feeRecipient: address
    withdrawals:  []Withdrawal
Output:
  status: "VALID" | "INVALID" | "SYNCING"
  payloadId: bytes8 (if building a new block)
```

---

## Core Algorithms

### EIP-1559 Base Fee Adjustment

```
FUNCTION calculateBaseFee(parentBlock):
    parentGasTarget = parentBlock.gasLimit / 2

    IF parentBlock.gasUsed == parentGasTarget:
        RETURN parentBlock.baseFeePerGas   // No change

    IF parentBlock.gasUsed > parentGasTarget:
        // Block was more than half full → increase base fee
        gasUsedDelta = parentBlock.gasUsed - parentGasTarget
        feeDelta = parentBlock.baseFeePerGas * gasUsedDelta / parentGasTarget / 8
        RETURN parentBlock.baseFeePerGas + max(feeDelta, 1)

    ELSE:
        // Block was less than half full → decrease base fee
        gasUsedDelta = parentGasTarget - parentBlock.gasUsed
        feeDelta = parentBlock.baseFeePerGas * gasUsedDelta / parentGasTarget / 8
        RETURN max(parentBlock.baseFeePerGas - feeDelta, 0)
```

### LMD-GHOST Fork Choice

```
FUNCTION getHead(store):
    // Start from the latest justified checkpoint
    head = store.justifiedCheckpoint.root
    justified_slot = store.justifiedCheckpoint.epoch * SLOTS_PER_EPOCH

    WHILE true:
        children = getChildren(store, head)
        IF children is EMPTY:
            RETURN head

        // Weight each child by total attesting stake
        best = null
        bestWeight = -1
        FOR child IN children:
            weight = getLatestAttestingBalance(store, child)
            IF weight > bestWeight OR
               (weight == bestWeight AND child > best):  // Tiebreak by hash
                best = child
                bestWeight = weight

        head = best

FUNCTION getLatestAttestingBalance(store, root):
    // Sum effective balance of all validators whose latest
    // attestation supports this block or its descendants
    total = 0
    FOR validator IN store.validators:
        IF validator.latestAttestation is descendant of root:
            total += validator.effectiveBalance
    RETURN total
```

### Transaction Pool Ordering

```
FUNCTION insertTransaction(mempool, tx, sender):
    // Validate transaction
    account = getAccountState(sender)
    IF tx.nonce < account.nonce:
        REJECT "nonce too low"
    IF account.balance < tx.value + tx.gasLimit * tx.maxFeePerGas:
        REJECT "insufficient funds"

    // Calculate effective gas price
    currentBaseFee = getLatestBaseFee()
    effectivePrice = min(tx.maxFeePerGas, currentBaseFee + tx.maxPriorityFeePerGas)

    // Check for replacement (same sender + nonce)
    existing = mempool.getBySenderAndNonce(sender, tx.nonce)
    IF existing is NOT null:
        IF effectivePrice < existing.effectivePrice * 1.1:
            REJECT "replacement fee too low (need 10% bump)"
        mempool.remove(existing)

    // Classify as pending (executable) or queued (future nonce)
    IF tx.nonce == account.nonce:
        mempool.pending.insert(tx, effectivePrice)  // Priority queue by price
    ELSE:
        mempool.queued.insert(sender, tx)  // Per-sender nonce-ordered queue

    // Promote queued transactions if gap filled
    promoteQueuedTransactions(mempool, sender)

FUNCTION selectTransactionsForBlock(mempool, gasLimit, baseFee):
    selected = []
    gasUsed = 0
    senderNonces = {}  // Track nonces within this block

    // Iterate mempool by descending effective gas price
    FOR tx IN mempool.pending.descendingIterator():
        expectedNonce = senderNonces.getOrDefault(tx.sender, getAccountNonce(tx.sender))
        IF tx.nonce != expectedNonce:
            CONTINUE  // Nonce gap, skip
        IF gasUsed + tx.gasLimit > gasLimit:
            CONTINUE  // Would exceed block gas limit
        IF tx.maxFeePerGas < baseFee:
            BREAK     // All remaining txns also below base fee

        selected.append(tx)
        gasUsed += tx.gasLimit
        senderNonces[tx.sender] = expectedNonce + 1

    RETURN selected
```

### Merkle Patricia Trie Operations

```
FUNCTION trieGet(root, key):
    // key is the Keccak256 hash, treated as a nibble path
    node = db.get(root)
    keyNibbles = toNibbles(key)
    offset = 0

    WHILE offset < len(keyNibbles):
        IF node.type == BRANCH:
            nibble = keyNibbles[offset]
            child = node.children[nibble]
            IF child is EMPTY:
                RETURN null
            node = db.get(child)
            offset += 1

        ELSE IF node.type == EXTENSION:
            sharedNibbles = node.path
            IF keyNibbles[offset:offset+len(sharedNibbles)] != sharedNibbles:
                RETURN null
            node = db.get(node.child)
            offset += len(sharedNibbles)

        ELSE IF node.type == LEAF:
            remainingNibbles = node.path
            IF keyNibbles[offset:] == remainingNibbles:
                RETURN node.value
            RETURN null

    RETURN node.value

FUNCTION trieUpdate(root, key, value):
    // Returns new root hash (trie is immutable)
    keyNibbles = toNibbles(key)
    newRoot = recursiveUpdate(root, keyNibbles, 0, value)
    RETURN hash(newRoot)
```

### EVM Execution Loop

```
FUNCTION executeTransaction(state, tx, blockContext):
    // 1. Pre-execution validation
    sender = recoverAddress(tx)
    intrinsicGas = 21000 + calldataCost(tx.data) + accessListCost(tx.accessList)
    IF tx.gasLimit < intrinsicGas:
        FAIL "intrinsic gas too low"

    // 2. Deduct upfront cost
    upfrontCost = tx.value + tx.gasLimit * tx.effectiveGasPrice
    state[sender].balance -= upfrontCost
    state[sender].nonce += 1

    // 3. Create EVM context
    evm = createEVM(state, blockContext, tx)
    gasRemaining = tx.gasLimit - intrinsicGas

    // 4. Execute
    IF tx.to is null:
        // Contract creation
        contractAddr = deriveAddress(sender, tx.nonce)
        result = evm.create(sender, tx.value, tx.data, gasRemaining)
    ELSE:
        // Message call
        result = evm.call(sender, tx.to, tx.value, tx.data, gasRemaining)

    // 5. Post-execution
    gasUsed = tx.gasLimit - result.gasRemaining
    gasRefund = min(result.refund, gasUsed / 5)  // Cap refund at 20%
    effectiveGasUsed = gasUsed - gasRefund

    // 6. Refund unused gas
    state[sender].balance += (tx.gasLimit - effectiveGasUsed) * tx.effectiveGasPrice

    // 7. Pay proposer priority fee
    priorityFee = min(tx.maxPriorityFeePerGas, tx.maxFeePerGas - blockContext.baseFee)
    state[blockContext.coinbase].balance += effectiveGasUsed * priorityFee

    // 8. Burn base fee (removed from circulation)
    // baseFee * gasUsed is simply not credited to anyone

    RETURN Receipt(status=result.success, gasUsed=effectiveGasUsed, logs=result.logs)
```

### Kademlia Peer Discovery

```
FUNCTION findNode(targetId):
    // Find the k closest nodes to targetId using XOR distance
    k = 16  // Bucket size
    alpha = 3  // Concurrency factor

    closestKnown = routingTable.getClosest(targetId, k)
    queried = {}
    results = SortedSet(byXorDistance(targetId))
    results.addAll(closestKnown)

    WHILE true:
        // Select alpha unqueried nodes closest to target
        toQuery = results.filter(n -> n NOT IN queried).take(alpha)
        IF toQuery is EMPTY:
            BREAK

        // Query concurrently
        FOR node IN toQuery (parallel):
            queried.add(node)
            response = node.findNode(targetId)  // RPC
            IF response is SUCCESS:
                FOR peer IN response.nodes:
                    IF peer NOT IN results:
                        results.add(peer)
                        routingTable.update(peer)  // Refresh routing table

        // Terminate when closest k nodes have all been queried
        IF queried.containsAll(results.take(k)):
            BREAK

    RETURN results.take(k)
```

---

## State Trie Structure

```
World State Trie (per block):
  Key: Keccak256(account_address)  → 20-byte address → 32-byte hash → nibble path
  Value: RLP(nonce, balance, storageRoot, codeHash)

Storage Trie (per contract):
  Key: Keccak256(storage_slot)  → 32-byte slot → 32-byte hash → nibble path
  Value: RLP(storage_value)

Transaction Trie (per block):
  Key: RLP(transaction_index)
  Value: RLP(signed_transaction)

Receipt Trie (per block):
  Key: RLP(transaction_index)
  Value: RLP(receipt)

All four tries produce a 32-byte root hash stored in the block header.
```

---

## Blob Transaction Model (EIP-4844)

```
BlobTransaction (Type 0x03):
  chainId:              uint256
  nonce:                uint64
  maxPriorityFeePerGas: uint256
  maxFeePerGas:         uint256
  gasLimit:             uint64
  to:                   address
  value:                uint256
  data:                 bytes
  accessList:           []AccessTuple
  maxFeePerBlobGas:     uint256     // Max fee per blob gas unit
  blobVersionedHashes:  []bytes32   // Commitments to blobs
  v, r, s:              uint256     // Signature

Blob:
  data:      [4096]FieldElement     // 4096 field elements × 32 bytes = ~128 KB
  commitment: KZGCommitment         // Polynomial commitment to blob data
  proof:      KZGProof              // Proof for point evaluation

// Blobs are NOT stored in the execution layer
// They are propagated via separate gossip topics and pruned after ~18 days
// The block header only contains blob commitments (32 bytes each)
```

---

## Beacon State Model

```
BeaconState:
  // Versioning
  genesisTime:              uint64
  genesisValidatorsRoot:    bytes32
  slot:                     uint64
  fork:                     Fork

  // History
  latestBlockHeader:        BeaconBlockHeader
  blockRoots:               [8192]bytes32    // Circular buffer
  stateRoots:               [8192]bytes32    // Circular buffer
  historicalRoots:           []bytes32        // Frozen roots

  // Registry
  validators:               []Validator       // All validators
  balances:                 []uint64          // Validator balances (Gwei)

  // Randomness
  randaoMixes:              [65536]bytes32   // RANDAO accumulator

  // Slashings
  slashings:                [8192]uint64     // Per-epoch slashing totals

  // Participation
  previousEpochParticipation: []ParticipationFlags
  currentEpochParticipation:  []ParticipationFlags

  // Finality
  justificationBits:        Bitvector[4]
  previousJustifiedCheckpoint: Checkpoint
  currentJustifiedCheckpoint:  Checkpoint
  finalizedCheckpoint:        Checkpoint

  // Sync
  currentSyncCommittee:     SyncCommittee
  nextSyncCommittee:        SyncCommittee

  // Withdrawals
  nextWithdrawalIndex:      uint64
  nextWithdrawalValidatorIndex: uint64

Checkpoint:
  epoch: uint64
  root:  bytes32

SyncCommittee:
  pubkeys:          [512]BLSPubKey
  aggregatePubkey:  BLSPubKey
```

---

## Slashing Detection Algorithm

```
FUNCTION detect_and_process_slashing(attestation_pool):

    -- Check all attestation pairs for slashing conditions
    FOR EACH pair (att_1, att_2) IN attestation_pool WHERE att_1.validator == att_2.validator:

        -- Condition 1: Double Vote
        -- Same target epoch, different attestation data
        IF att_1.data.target.epoch == att_2.data.target.epoch
           AND att_1.data != att_2.data:

            evidence = SlashingEvidence(
                type: "double_vote",
                attestation_1: att_1,
                attestation_2: att_2,
                validator_index: att_1.validator
            )
            process_slashing(evidence)

        -- Condition 2: Surround Vote
        -- att_1 surrounds att_2 or vice versa
        IF att_1.data.source.epoch < att_2.data.source.epoch
           AND att_2.data.target.epoch < att_1.data.target.epoch:

            evidence = SlashingEvidence(
                type: "surround_vote",
                attestation_1: att_1,
                attestation_2: att_2,
                validator_index: att_1.validator
            )
            process_slashing(evidence)

FUNCTION process_slashing(evidence):
    validator = state.validators[evidence.validator_index]

    IF validator.slashed:
        RETURN  -- Already slashed

    -- Mark as slashed
    validator.slashed = true
    validator.withdrawableEpoch = current_epoch + 8192  -- ~36 days

    -- Calculate initial penalty (1/32 of effective balance)
    initial_penalty = validator.effectiveBalance / 32

    -- Whistleblower reward
    whistleblower_reward = validator.effectiveBalance / 512
    proposer_reward = whistleblower_reward

    -- Deduct penalty
    state.balances[evidence.validator_index] -= initial_penalty
    state.balances[block_proposer] += proposer_reward

    -- Record for correlation penalty (applied at epoch N + EPOCHS_PER_SLASHINGS_VECTOR / 2)
    state.slashings[current_epoch % 8192] += validator.effectiveBalance

    -- Correlation penalty applied later:
    -- penalty = (slashed_balance_in_period × 3 / total_balance) × validator.effectiveBalance
    -- If 1 validator slashed: penalty ≈ minimal
    -- If 1/3 validators slashed: penalty ≈ full stake (32 ETH)
```

---

## Block Building Algorithm (for Proposer/Builder)

```
FUNCTION buildBlock(mempool, parentState, slotContext):
    gasLimit = parentState.gasLimit
    baseFee = calculateBaseFee(parentState)
    blobBaseFee = calculateBlobBaseFee(parentState)

    -- Select transactions from mempool
    selected = []
    gasUsed = 0
    blobsUsed = 0
    maxBlobs = 6

    -- Sort mempool by effective priority fee (descending)
    candidates = mempool.pending.sortByEffectivePriorityFee(baseFee)

    FOR tx IN candidates:
        -- Check gas budget
        IF gasUsed + tx.gasLimit > gasLimit:
            CONTINUE

        -- Check blob budget
        IF tx.type == BLOB_TX:
            IF blobsUsed + tx.blobCount > maxBlobs:
                CONTINUE
            IF tx.maxFeePerBlobGas < blobBaseFee:
                CONTINUE

        -- Check fee adequacy
        IF tx.maxFeePerGas < baseFee:
            BREAK  -- All remaining have lower fees

        -- Execute transaction against state
        receipt = executeTransaction(parentState, tx, slotContext)

        IF receipt.success OR receipt.revert:
            selected.append(tx)
            gasUsed += receipt.gasUsed
            IF tx.type == BLOB_TX:
                blobsUsed += tx.blobCount

    -- Construct block
    block = Block(
        parentHash:   parentState.latestBlockHash,
        stateRoot:    computeStateRoot(parentState),
        transactions: selected,
        gasUsed:      gasUsed,
        baseFee:      baseFee,
        blobGasUsed:  blobsUsed * 131072,
        timestamp:    slotContext.timestamp,
        prevRandao:   slotContext.randao,
        withdrawals:  getWithdrawals(parentState)
    )

    RETURN block
```

---

## Snap Sync Protocol Detail

```
Protocol: eth/snap

FUNCTION snapSync(trustedStateRoot):
    -- Phase 1: Download account trie leaves in parallel
    accounts = []
    ranges = divideAddressSpace(256)  -- 256 parallel ranges

    FOR range IN ranges (parallel):
        startKey = range.start
        endKey = range.end

        WHILE startKey < endKey:
            response = requestAccountRange(peer, trustedStateRoot, startKey, endKey, 4096)
            accounts.addAll(response.accounts)
            proofs = response.proofs

            -- Verify accounts belong to the claimed state root
            IF NOT verifyRangeProof(trustedStateRoot, startKey, response.accounts, proofs):
                banPeer(peer)
                RETRY with different peer

            startKey = response.accounts.last().key + 1

    -- Phase 2: Download storage tries for contracts
    FOR account IN accounts WHERE account.storageRoot != EMPTY_ROOT:
        downloadStorageTrie(account.address, account.storageRoot)

    -- Phase 3: Download contract bytecode
    FOR account IN accounts WHERE account.codeHash != EMPTY_CODE_HASH:
        code = requestBytecodes(peer, [account.codeHash])
        storeCode(account.codeHash, code)

    -- Phase 4: Healing (state changed during download)
    dirtyPaths = compareLocalStateRoot(trustedStateRoot)
    FOR path IN dirtyPaths:
        downloadAndUpdateTrieNode(path)

    -- Phase 5: Backfill historical blocks (parallel, lower priority)
    downloadBlockHeaders(genesis, latestBlock)
    downloadBlockBodies(genesis, latestBlock)

    RETURN syncComplete
```

---

## EIP-1559 Base Fee Computation

```
FUNCTION computeBaseFee(parentBlock):
    -- EIP-1559 base fee adjustment algorithm
    -- Target: 50% gas utilization per block

    parentGasTarget = parentBlock.gasLimit / 2
    parentGasUsed = parentBlock.gasUsed
    parentBaseFee = parentBlock.baseFee

    IF parentGasUsed == parentGasTarget:
        -- Exactly at target, no adjustment
        RETURN parentBaseFee

    IF parentGasUsed > parentGasTarget:
        -- Block was more than half full → increase base fee
        gasUsedDelta = parentGasUsed - parentGasTarget
        baseFeeDelta = max(
            1,  -- minimum 1 wei increase
            parentBaseFee × gasUsedDelta / parentGasTarget / BASE_FEE_CHANGE_DENOMINATOR
        )
        RETURN parentBaseFee + baseFeeDelta

    ELSE:
        -- Block was less than half full → decrease base fee
        gasUsedDelta = parentGasTarget - parentGasUsed
        baseFeeDelta = parentBaseFee × gasUsedDelta / parentGasTarget / BASE_FEE_CHANGE_DENOMINATOR
        RETURN max(0, parentBaseFee - baseFeeDelta)

CONSTANTS:
    BASE_FEE_CHANGE_DENOMINATOR = 8  -- max +/- 12.5% per block

FUNCTION computeEffectiveGasPrice(tx, baseFee):
    -- What the user actually pays per gas unit
    priorityFee = min(tx.maxPriorityFeePerGas, tx.maxFeePerGas - baseFee)
    RETURN baseFee + priorityFee

FUNCTION computeTransactionFees(tx, baseFee, gasUsed):
    effectivePrice = computeEffectiveGasPrice(tx, baseFee)
    totalFee = effectivePrice × gasUsed
    burnedFee = baseFee × gasUsed           -- destroyed (deflationary)
    proposerTip = (effectivePrice - baseFee) × gasUsed  -- proposer revenue
    refund = (tx.maxFeePerGas - effectivePrice) × gasUsed  -- returned to sender

    RETURN {total: totalFee, burned: burnedFee, tip: proposerTip, refund: refund}
```
