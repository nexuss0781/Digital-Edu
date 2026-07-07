# Low-Level Design

## Data Model

```mermaid
erDiagram
    Users ||--|| Wallets : "owns"
    Users ||--o{ PaymentInstruments : "links"
    Users ||--o{ KYCRecords : "verifies"
    Wallets ||--o{ LedgerEntries : "records"
    Wallets ||--o{ WalletBalances : "holds"
    Transactions ||--|{ LedgerEntries : "produces"
    Transactions ||--o| Transactions : "reverses"

    Users {
        uuid id PK
        string phone UK "primary identifier"
        string email
        string display_name
        enum kyc_tier "TIER_0|TIER_1|TIER_2|TIER_3"
        string device_fingerprint
        timestamp last_login_at
        timestamp created_at
        timestamp updated_at
    }

    Wallets {
        uuid id PK
        uuid user_id FK UK
        enum type "CONSUMER|MERCHANT|ESCROW|FEE|PROMOTIONAL"
        enum status "ACTIVE|SUSPENDED|CLOSED"
        string currency "USD|INR|EUR|etc"
        bigint balance_cents "materialized balance in smallest unit"
        int version "optimistic concurrency version"
        bigint daily_spent_cents "rolling 24h spend tracking"
        bigint monthly_spent_cents "rolling 30d spend tracking"
        timestamp created_at
        timestamp updated_at
    }

    WalletBalances {
        uuid id PK
        uuid wallet_id FK
        string currency
        bigint available_cents "spendable balance"
        bigint held_cents "reserved for pending transactions"
        bigint promotional_cents "non-withdrawable cashback"
        int version
        timestamp updated_at
    }

    Transactions {
        uuid id PK
        string idempotency_key UK
        uuid journal_id "groups related ledger entries"
        enum type "P2P_TRANSFER|MERCHANT_PAYMENT|TOP_UP|WITHDRAWAL|BILL_PAYMENT|REFUND|FEE|CASHBACK"
        enum status "INITIATED|FRAUD_CHECK|APPROVED|PROCESSING|COMPLETED|FAILED|DECLINED|REVERSED"
        uuid source_wallet_id FK
        uuid destination_wallet_id FK
        bigint amount_cents
        string currency
        bigint fee_cents
        string description
        json metadata "device_info, ip, location, merchant_order_ref"
        int fraud_score
        uuid reversed_by FK "points to reversal transaction"
        timestamp created_at
        timestamp completed_at
    }

    LedgerEntries {
        uuid id PK
        uuid journal_id "all entries in a journal must balance"
        uuid transaction_id FK
        uuid wallet_id FK
        enum entry_type "DEBIT|CREDIT"
        bigint amount_cents "always positive"
        string currency
        bigint running_balance_cents "wallet balance after this entry"
        timestamp created_at
    }

    PaymentInstruments {
        uuid id PK
        uuid user_id FK
        enum type "BANK_ACCOUNT|CREDIT_CARD|DEBIT_CARD|UPI_ID"
        string token_encrypted "tokenized instrument reference"
        string display_label "****1234 or bank name"
        enum status "ACTIVE|EXPIRED|REMOVED"
        boolean is_default
        json metadata "bank_name, card_network, expiry"
        timestamp verified_at
        timestamp created_at
    }

    KYCRecords {
        uuid id PK
        uuid user_id FK
        enum tier "TIER_1|TIER_2|TIER_3"
        enum status "PENDING|APPROVED|REJECTED|EXPIRED"
        string document_type "NATIONAL_ID|PASSPORT|DRIVERS_LICENSE|ADDRESS_PROOF"
        string document_ref_encrypted
        string document_storage_path
        string rejection_reason
        uuid reviewed_by
        timestamp submitted_at
        timestamp reviewed_at
        timestamp expires_at
    }
```

---

## Indexing Strategy

| Table | Index | Type | Purpose |
|-------|-------|------|---------|
| **Wallets** | `(user_id)` | Unique | Wallet lookup by user |
| **Wallets** | `(id)` with partitioning by `id` hash | Hash partition | Shard key for ledger co-location |
| **WalletBalances** | `(wallet_id, currency)` | Unique composite | Balance lookup per currency |
| **Transactions** | `(idempotency_key)` | Unique | Deduplication check |
| **Transactions** | `(source_wallet_id, created_at DESC)` | Composite B-tree | User's sent transaction history |
| **Transactions** | `(destination_wallet_id, created_at DESC)` | Composite B-tree | User's received transaction history |
| **Transactions** | `(status)` partial where status IN ('INITIATED','PROCESSING') | Partial | Pending transaction monitoring |
| **Transactions** | `(journal_id)` | B-tree | Group entries by journal |
| **LedgerEntries** | `(wallet_id, created_at DESC)` | Composite B-tree | Ledger history per wallet |
| **LedgerEntries** | `(journal_id)` | B-tree | All entries in a journal (for balance verification) |
| **LedgerEntries** | `(transaction_id)` | B-tree | Entries per transaction |
| **PaymentInstruments** | `(user_id, status)` where status = 'ACTIVE' | Partial composite | User's active instruments |
| **KYCRecords** | `(user_id, tier)` | Composite | Latest KYC per tier |
| **KYCRecords** | `(status, submitted_at)` where status = 'PENDING' | Partial | Pending KYC review queue |

---

## API Design

### P2P Transfer

```
POST /api/v1/transfers
Headers:
  Idempotency-Key: "client-generated-uuid"
  Authorization: Bearer <jwt>

Request:
{
  "receiver": "+1234567890",          // phone number or wallet_id
  "amount": 5000,                      // in cents ($50.00)
  "currency": "USD",
  "description": "Dinner split",
  "pin": "encrypted_transaction_pin"   // 4-6 digit PIN or biometric token
}

Response (200 OK):
{
  "transaction_id": "TXN-abc123",
  "status": "COMPLETED",
  "amount": 5000,
  "currency": "USD",
  "fee": 0,
  "sender_balance": 15000,            // $150.00
  "receiver_name": "Jane D.",
  "created_at": "2025-03-09T10:30:00Z"
}

Response (409 Conflict - Idempotent replay):
{
  "transaction_id": "TXN-abc123",      // same as original
  "status": "COMPLETED",
  "idempotent_replay": true
}

Response (402 - Insufficient Balance):
{
  "error": "INSUFFICIENT_BALANCE",
  "available_balance": 3000,
  "requested_amount": 5000
}
```

### Merchant Payment

```
POST /api/v1/payments/merchant
Headers:
  Idempotency-Key: "client-generated-uuid"

Request:
{
  "merchant_id": "MERCH-456",
  "amount": 2500,                      // $25.00
  "currency": "USD",
  "qr_nonce": "nonce-from-qr-code",
  "order_reference": "ORD-789",
  "pin": "encrypted_transaction_pin"
}

Response (200 OK):
{
  "transaction_id": "TXN-def456",
  "status": "COMPLETED",
  "amount": 2500,
  "fee": 0,                           // consumer pays no fee
  "sender_balance": 12500,
  "merchant_name": "Coffee Shop",
  "created_at": "2025-03-09T10:35:00Z"
}
```

### Wallet Top-Up

```
POST /api/v1/topup
Headers:
  Idempotency-Key: "client-generated-uuid"

Request:
{
  "amount": 50000,                     // $500.00
  "currency": "USD",
  "instrument_id": "INST-bank-001"     // linked bank account
}

Response (202 Accepted):
{
  "topup_id": "TOPUP-ghi789",
  "status": "PROCESSING",
  "amount": 50000,
  "estimated_completion": "2025-03-09T10:32:00Z"
}

--- Webhook callback (when bank confirms) ---
POST /internal/topup/callback
{
  "topup_id": "TOPUP-ghi789",
  "bank_reference": "BANK-REF-001",
  "status": "SUCCESS"
}
```

### Balance & Transaction History

```
GET /api/v1/wallet/balance
Response:
{
  "wallet_id": "WAL-001",
  "balances": [
    {"currency": "USD", "available": 62500, "held": 0, "promotional": 500}
  ],
  "kyc_tier": "TIER_2",
  "daily_limit_remaining": 195000,
  "monthly_limit_remaining": 450000
}

---

GET /api/v1/transactions?limit=20&cursor=eyJ0...&type=P2P_TRANSFER
Response:
{
  "transactions": [
    {
      "id": "TXN-abc123",
      "type": "P2P_TRANSFER",
      "direction": "OUTGOING",
      "amount": 5000,
      "currency": "USD",
      "counterparty": "Jane D.",
      "description": "Dinner split",
      "status": "COMPLETED",
      "created_at": "2025-03-09T10:30:00Z"
    },
    ...
  ],
  "cursor": "eyJ0...",
  "has_more": true
}
```

### Other APIs

```
POST /api/v1/wallet/withdraw            // Withdraw to bank
POST /api/v1/payments/bill               // Bill payment
POST /api/v1/kyc/submit                  // Submit KYC documents
GET  /api/v1/kyc/status                  // Check KYC status
POST /api/v1/instruments                 // Link bank account or card
DELETE /api/v1/instruments/:id           // Remove linked instrument
POST /api/v1/transfers/request           // Request money (split bill)
GET  /api/v1/transfers/requests          // List pending money requests
POST /api/v1/scheduled-payments          // Create recurring payment
GET  /api/v1/wallet/statement            // Download monthly statement
```

---

## Core Algorithms

### 1. Atomic Balance-Check-and-Debit (Pessimistic Locking)

```
FUNCTION executeDebit(walletId, amountCents, journalId, transactionId):
    // Acquire exclusive lock on wallet row
    wallet = db.query(
        "SELECT id, balance_cents, version, status
         FROM wallets
         WHERE id = ?
         FOR UPDATE",
        walletId
    )

    IF wallet.status != "ACTIVE":
        RETURN {error: "WALLET_NOT_ACTIVE"}

    IF wallet.balance_cents < amountCents:
        RETURN {error: "INSUFFICIENT_BALANCE",
                available: wallet.balance_cents,
                requested: amountCents}

    // Debit: reduce balance and create ledger entry
    newBalance = wallet.balance_cents - amountCents

    db.execute(
        "UPDATE wallets SET balance_cents = ?, version = version + 1,
         updated_at = NOW() WHERE id = ? AND version = ?",
        newBalance, walletId, wallet.version
    )

    db.execute(
        "INSERT INTO ledger_entries
         (id, journal_id, transaction_id, wallet_id, entry_type, amount_cents,
          currency, running_balance_cents, created_at)
         VALUES (?, ?, ?, ?, 'DEBIT', ?, ?, ?, NOW())",
        generateId(), journalId, transactionId, walletId,
        amountCents, wallet.currency, newBalance
    )

    RETURN {success: true, new_balance: newBalance}
```

### 2. P2P Transfer (Same Shard --- Single Transaction)

```
FUNCTION executeSameShardTransfer(senderId, receiverId, amountCents, idempotencyKey):
    // Step 0: Idempotency check
    existing = redis.get("idem:" + idempotencyKey)
    IF existing:
        RETURN deserialize(existing)  // return cached response

    journalId = generateId()
    transactionId = generateId()

    BEGIN TRANSACTION
        // Step 1: Lock BOTH wallets (always lock in ID order to prevent deadlock)
        walletIds = sort([senderId, receiverId])
        wallets = db.query(
            "SELECT * FROM wallets WHERE id IN (?, ?)
             ORDER BY id FOR UPDATE",
            walletIds[0], walletIds[1]
        )
        sender = wallets.find(w -> w.id == senderId)
        receiver = wallets.find(w -> w.id == receiverId)

        // Step 2: Validate
        IF sender.balance_cents < amountCents:
            ROLLBACK
            RETURN {error: "INSUFFICIENT_BALANCE"}

        IF receiver.status != "ACTIVE":
            ROLLBACK
            RETURN {error: "RECEIVER_WALLET_INACTIVE"}

        // Step 3: Debit sender
        senderNewBalance = sender.balance_cents - amountCents
        db.execute(
            "UPDATE wallets SET balance_cents = ?, version = version + 1
             WHERE id = ?",
            senderNewBalance, senderId
        )
        db.execute(
            "INSERT INTO ledger_entries (id, journal_id, transaction_id, wallet_id,
             entry_type, amount_cents, currency, running_balance_cents, created_at)
             VALUES (?, ?, ?, ?, 'DEBIT', ?, ?, ?, NOW())",
            generateId(), journalId, transactionId, senderId,
            amountCents, sender.currency, senderNewBalance
        )

        // Step 4: Credit receiver
        receiverNewBalance = receiver.balance_cents + amountCents
        db.execute(
            "UPDATE wallets SET balance_cents = ?, version = version + 1
             WHERE id = ?",
            receiverNewBalance, receiverId
        )
        db.execute(
            "INSERT INTO ledger_entries (id, journal_id, transaction_id, wallet_id,
             entry_type, amount_cents, currency, running_balance_cents, created_at)
             VALUES (?, ?, ?, ?, 'CREDIT', ?, ?, ?, NOW())",
            generateId(), journalId, transactionId, receiverId,
            amountCents, receiver.currency, receiverNewBalance
        )

        // Step 5: Create transaction record
        db.execute(
            "INSERT INTO transactions (id, idempotency_key, journal_id, type, status,
             source_wallet_id, destination_wallet_id, amount_cents, currency,
             fee_cents, created_at, completed_at)
             VALUES (?, ?, ?, 'P2P_TRANSFER', 'COMPLETED', ?, ?, ?, ?, 0, NOW(), NOW())",
            transactionId, idempotencyKey, journalId,
            senderId, receiverId, amountCents, sender.currency
        )
    COMMIT

    // Step 6: Cache for idempotency
    response = {transaction_id: transactionId, status: "COMPLETED",
                sender_balance: senderNewBalance}
    redis.setex("idem:" + idempotencyKey, 86400, serialize(response))

    // Step 7: Publish event (async)
    kafka.publish("transactions", {
        type: "TRANSFER_COMPLETED",
        transaction_id: transactionId,
        sender_id: senderId,
        receiver_id: receiverId,
        amount_cents: amountCents
    })

    RETURN response
```

### 3. P2P Transfer (Cross-Shard --- Saga Pattern)

```
FUNCTION executeCrossShardTransfer(senderId, receiverId, amountCents, idempotencyKey):
    // Sender and receiver are on different database shards
    // Cannot use a single DB transaction --- use saga with transfer ledger

    sagaId = generateId()
    journalId = generateId()

    // Step 1: Debit sender (on sender's shard)
    TRY:
        debitResult = senderShard.executeInTransaction(() -> {
            wallet = db.query("SELECT * FROM wallets WHERE id = ? FOR UPDATE", senderId)
            IF wallet.balance_cents < amountCents:
                THROW InsufficientBalanceError()

            newBalance = wallet.balance_cents - amountCents
            db.execute("UPDATE wallets SET balance_cents = ? WHERE id = ?",
                       newBalance, senderId)
            db.execute("INSERT INTO ledger_entries (...) VALUES (...)",
                       journalId, senderId, "DEBIT", amountCents, newBalance)
            db.execute("INSERT INTO saga_log (saga_id, step, status) VALUES (?, 'DEBIT_SENDER', 'COMPLETED')",
                       sagaId)
            RETURN newBalance
        })
    CATCH InsufficientBalanceError:
        RETURN {error: "INSUFFICIENT_BALANCE"}
    CATCH Exception:
        // Debit failed --- no compensation needed (nothing happened yet)
        RETURN {error: "TRANSFER_FAILED"}

    // Step 2: Credit receiver (on receiver's shard)
    TRY:
        creditResult = receiverShard.executeInTransaction(() -> {
            wallet = db.query("SELECT * FROM wallets WHERE id = ? FOR UPDATE", receiverId)
            IF wallet.status != "ACTIVE":
                THROW WalletInactiveError()

            newBalance = wallet.balance_cents + amountCents
            db.execute("UPDATE wallets SET balance_cents = ? WHERE id = ?",
                       newBalance, receiverId)
            db.execute("INSERT INTO ledger_entries (...) VALUES (...)",
                       journalId, receiverId, "CREDIT", amountCents, newBalance)
            db.execute("INSERT INTO saga_log (saga_id, step, status) VALUES (?, 'CREDIT_RECEIVER', 'COMPLETED')",
                       sagaId)
            RETURN newBalance
        })
    CATCH Exception:
        // Credit failed --- MUST compensate: re-credit sender
        compensateSenderDebit(senderId, amountCents, sagaId, journalId)
        RETURN {error: "TRANSFER_FAILED", compensated: true}

    RETURN {transaction_id: sagaId, status: "COMPLETED",
            sender_balance: debitResult}


FUNCTION compensateSenderDebit(senderId, amountCents, sagaId, journalId):
    // Compensating transaction: reverse the sender debit
    senderShard.executeInTransaction(() -> {
        wallet = db.query("SELECT * FROM wallets WHERE id = ? FOR UPDATE", senderId)
        newBalance = wallet.balance_cents + amountCents
        db.execute("UPDATE wallets SET balance_cents = ? WHERE id = ?",
                   newBalance, senderId)
        db.execute("INSERT INTO ledger_entries (...) VALUES (...)",
                   journalId + "-COMP", senderId, "CREDIT", amountCents, newBalance)
        db.execute("UPDATE saga_log SET status = 'COMPENSATED' WHERE saga_id = ? AND step = 'DEBIT_SENDER'",
                   sagaId)
    })
```

### 4. Ledger Reconciliation

```
FUNCTION reconcileLedger():
    // Runs periodically (every hour) to verify ledger integrity

    // Check 1: Global balance --- sum of all debits must equal sum of all credits
    globalCheck = db.query(
        "SELECT
           SUM(CASE WHEN entry_type = 'DEBIT' THEN amount_cents ELSE 0 END) as total_debits,
           SUM(CASE WHEN entry_type = 'CREDIT' THEN amount_cents ELSE 0 END) as total_credits
         FROM ledger_entries
         WHERE created_at > NOW() - INTERVAL '24 hours'"
    )
    IF globalCheck.total_debits != globalCheck.total_credits:
        ALERT("CRITICAL: Ledger imbalance detected!",
              diff: globalCheck.total_debits - globalCheck.total_credits)

    // Check 2: Per-journal balance --- each journal entry must balance
    unbalancedJournals = db.query(
        "SELECT journal_id,
           SUM(CASE WHEN entry_type = 'DEBIT' THEN amount_cents ELSE 0 END) as debits,
           SUM(CASE WHEN entry_type = 'CREDIT' THEN amount_cents ELSE 0 END) as credits
         FROM ledger_entries
         WHERE created_at > NOW() - INTERVAL '24 hours'
         GROUP BY journal_id
         HAVING SUM(CASE WHEN entry_type = 'DEBIT' THEN amount_cents ELSE 0 END) !=
                SUM(CASE WHEN entry_type = 'CREDIT' THEN amount_cents ELSE 0 END)"
    )
    IF unbalancedJournals.isNotEmpty():
        FOR EACH journal IN unbalancedJournals:
            ALERT("Unbalanced journal entry", journal_id: journal.journal_id)

    // Check 3: Wallet balance drift --- materialized balance vs computed from ledger
    driftedWallets = db.query(
        "SELECT w.id, w.balance_cents as materialized,
           COALESCE(SUM(CASE WHEN le.entry_type = 'CREDIT' THEN le.amount_cents
                             WHEN le.entry_type = 'DEBIT' THEN -le.amount_cents END), 0) as computed
         FROM wallets w
         LEFT JOIN ledger_entries le ON le.wallet_id = w.id
         GROUP BY w.id, w.balance_cents
         HAVING w.balance_cents !=
           COALESCE(SUM(CASE WHEN le.entry_type = 'CREDIT' THEN le.amount_cents
                             WHEN le.entry_type = 'DEBIT' THEN -le.amount_cents END), 0)
         LIMIT 100"
    )
    IF driftedWallets.isNotEmpty():
        FOR EACH wallet IN driftedWallets:
            ALERT("Balance drift detected",
                  wallet_id: wallet.id,
                  materialized: wallet.materialized,
                  computed: wallet.computed)

    // Check 4: Escrow reconciliation --- user balances vs bank escrow
    totalUserBalances = db.query(
        "SELECT SUM(balance_cents) FROM wallets WHERE type IN ('CONSUMER', 'MERCHANT')"
    )
    escrowBalance = bankAPI.getEscrowBalance()
    IF abs(totalUserBalances - escrowBalance) > THRESHOLD:
        ALERT("Escrow mismatch",
              user_balances: totalUserBalances,
              escrow: escrowBalance)

    RETURN {
        global_balanced: globalCheck.total_debits == globalCheck.total_credits,
        unbalanced_journals: unbalancedJournals.count(),
        drifted_wallets: driftedWallets.count()
    }
```

### 5. Sub-Wallet Management for Hot Wallets

```
FUNCTION createSubWallets(merchantWalletId, numSubWallets):
    // Called when a merchant wallet is detected as "hot" (> 500 TPS)
    // or during merchant onboarding for known high-volume merchants

    FOR i = 0 TO numSubWallets - 1:
        subWalletId = merchantWalletId + ":sub:" + i
        db.execute(
            "INSERT INTO sub_wallets (id, parent_wallet_id, shard_index,
             balance_cents, currency, created_at)
             VALUES (?, ?, ?, 0, ?, NOW())",
            subWalletId, merchantWalletId, i, wallet.currency
        )

    // Mark parent wallet as sharded
    db.execute(
        "UPDATE wallets SET is_sharded = true, sub_wallet_count = ?
         WHERE id = ?",
        numSubWallets, merchantWalletId
    )


FUNCTION creditHotWallet(merchantWalletId, amountCents, journalId, txnId):
    // Route credit to a random sub-wallet → distributes lock contention
    wallet = db.getWallet(merchantWalletId)

    IF wallet.is_sharded:
        subIndex = random(0, wallet.sub_wallet_count - 1)
        subWalletId = merchantWalletId + ":sub:" + subIndex

        db.executeInTransaction(() -> {
            subWallet = db.query(
                "SELECT * FROM sub_wallets WHERE id = ? FOR UPDATE",
                subWalletId
            )
            newBalance = subWallet.balance_cents + amountCents
            db.execute(
                "UPDATE sub_wallets SET balance_cents = ? WHERE id = ?",
                newBalance, subWalletId
            )
            db.execute(
                "INSERT INTO ledger_entries (...) VALUES (...)",
                journalId, txnId, subWalletId, "CREDIT", amountCents, newBalance
            )
        })
    ELSE:
        // Standard single-wallet credit
        executeCredit(merchantWalletId, amountCents, journalId, txnId)


FUNCTION getMerchantBalance(merchantWalletId):
    wallet = db.getWallet(merchantWalletId)
    IF wallet.is_sharded:
        totalBalance = db.query(
            "SELECT SUM(balance_cents) FROM sub_wallets
             WHERE parent_wallet_id = ?",
            merchantWalletId
        )
        RETURN totalBalance
    ELSE:
        RETURN wallet.balance_cents
```

### 6. Saga Log Schema and Recovery

```
SagaLog Table:
  saga_id           UUID PK
  idempotency_key   STRING UK
  type              ENUM (P2P_TRANSFER, WITHDRAWAL, SETTLEMENT)
  status            ENUM (STARTED, DEBIT_COMPLETED, CREDIT_COMPLETED,
                          COMPENSATING, COMPENSATED, FAILED)
  sender_shard      INT
  receiver_shard    INT
  sender_wallet_id  UUID
  receiver_wallet_id UUID
  amount_cents      BIGINT
  currency          STRING
  journal_id        UUID
  step_details      JSON    // per-step timestamps and results
  created_at        TIMESTAMP
  updated_at        TIMESTAMP
  expires_at        TIMESTAMP  // saga must complete before this


FUNCTION recoverStaleSagas():
    // Runs every 30 seconds to find and recover stuck sagas
    staleSagas = db.query(
        "SELECT * FROM saga_log
         WHERE status IN ('STARTED', 'DEBIT_COMPLETED')
         AND updated_at < NOW() - INTERVAL '30 seconds'
         AND expires_at > NOW()
         ORDER BY created_at ASC
         LIMIT 100"
    )

    FOR EACH saga IN staleSagas:
        IF saga.status == 'STARTED':
            // Debit never completed → safe to mark as FAILED
            db.execute(
                "UPDATE saga_log SET status = 'FAILED' WHERE saga_id = ?",
                saga.saga_id
            )

        ELSE IF saga.status == 'DEBIT_COMPLETED':
            // Sender debited but receiver not credited → retry credit
            TRY:
                creditReceiver(saga.receiver_wallet_id, saga.amount_cents,
                               saga.journal_id, saga.saga_id)
                db.execute(
                    "UPDATE saga_log SET status = 'CREDIT_COMPLETED'
                     WHERE saga_id = ?",
                    saga.saga_id
                )
            CATCH Exception:
                // Credit failed even after retry → compensate sender
                compensateSenderDebit(saga.sender_wallet_id, saga.amount_cents,
                                      saga.saga_id, saga.journal_id)
                db.execute(
                    "UPDATE saga_log SET status = 'COMPENSATED'
                     WHERE saga_id = ?",
                    saga.saga_id
                )
```

### 7. Multi-Currency FX Conversion

```
FUNCTION convertCurrency(walletId, fromCurrency, toCurrency, amountCents):
    // Fetch locked FX rate (rate locked for 30 seconds after display to user)
    fxRate = fxService.getLockedRate(fromCurrency, toCurrency)
    IF fxRate.expired:
        RETURN {error: "FX_RATE_EXPIRED", message: "Please retry for fresh rate"}

    // Calculate converted amount with transparent markup
    rawConvertedAmount = amountCents * fxRate.mid_rate
    markup = rawConvertedAmount * FX_MARKUP_RATE  // e.g., 1.5%
    convertedAmount = rawConvertedAmount - markup

    journalId = generateId()

    BEGIN TRANSACTION
        // Debit source currency balance
        sourceBalance = db.query(
            "SELECT * FROM wallet_balances
             WHERE wallet_id = ? AND currency = ? FOR UPDATE",
            walletId, fromCurrency
        )
        IF sourceBalance.available_cents < amountCents:
            ROLLBACK
            RETURN {error: "INSUFFICIENT_BALANCE"}

        db.execute(
            "UPDATE wallet_balances SET available_cents = available_cents - ?
             WHERE wallet_id = ? AND currency = ?",
            amountCents, walletId, fromCurrency
        )

        // Credit target currency balance
        db.execute(
            "INSERT INTO wallet_balances (wallet_id, currency, available_cents)
             VALUES (?, ?, ?)
             ON CONFLICT (wallet_id, currency) DO UPDATE
             SET available_cents = available_cents + ?",
            walletId, toCurrency, convertedAmount, convertedAmount
        )

        // Ledger entries (4 entries: debit source, credit target, markup fee)
        db.execute("INSERT INTO ledger_entries (...) VALUES (...)",
                   journalId, walletId, "DEBIT", amountCents, fromCurrency)
        db.execute("INSERT INTO ledger_entries (...) VALUES (...)",
                   journalId, walletId, "CREDIT", convertedAmount, toCurrency)
        db.execute("INSERT INTO ledger_entries (...) VALUES (...)",
                   journalId, "PLATFORM_FX_REVENUE", "CREDIT", markup, fromCurrency)
    COMMIT

    RETURN {
        from: {currency: fromCurrency, amount: amountCents},
        to: {currency: toCurrency, amount: convertedAmount},
        rate: fxRate.mid_rate,
        markup_pct: FX_MARKUP_RATE * 100,
        markup_amount: markup
    }
```

---

### 8. KYC Tier Limit Enforcement

```
FUNCTION enforceKYCLimits(walletId, transactionType, amountCents):
    wallet = db.getWallet(walletId)
    user = db.getUser(wallet.user_id)
    limits = getKYCTierLimits(user.kyc_tier)

    // Check per-transaction limit
    IF amountCents > limits.max_per_transaction:
        RETURN {error: "EXCEEDS_TRANSACTION_LIMIT",
                limit: limits.max_per_transaction,
                tier: user.kyc_tier,
                upgrade_url: "/kyc/upgrade"}

    // Check daily limit
    dailySpent = db.query(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM transactions
         WHERE source_wallet_id = ? AND status = 'COMPLETED'
         AND created_at > NOW() - INTERVAL '24 hours'",
        walletId
    )
    IF dailySpent + amountCents > limits.max_daily:
        RETURN {error: "EXCEEDS_DAILY_LIMIT",
                remaining: limits.max_daily - dailySpent}

    // Check monthly limit
    monthlySpent = db.query(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM transactions
         WHERE source_wallet_id = ? AND status = 'COMPLETED'
         AND created_at > DATE_TRUNC('month', NOW())",
        walletId
    )
    IF monthlySpent + amountCents > limits.max_monthly:
        RETURN {error: "EXCEEDS_MONTHLY_LIMIT",
                remaining: limits.max_monthly - monthlySpent}

    RETURN {allowed: true}


FUNCTION getKYCTierLimits(tier):
    MATCH tier:
        TIER_0: RETURN {max_per_transaction: 0, max_daily: 0, max_monthly: 0}
        TIER_1: RETURN {max_per_transaction: 50000, max_daily: 100000, max_monthly: 1000000}
            // $500 per txn, $1,000/day, $10,000/month
        TIER_2: RETURN {max_per_transaction: 200000, max_daily: 500000, max_monthly: 5000000}
            // $2,000 per txn, $5,000/day, $50,000/month
        TIER_3: RETURN {max_per_transaction: 1000000, max_daily: 2000000, max_monthly: 20000000}
            // $10,000 per txn, $20,000/day, $200,000/month
```
