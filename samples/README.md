# /samples/

Deterministic sample dataset for the Loan Data Verification Copilot.

## Regenerate

```powershell
npm --workspace backend run gen:samples
```

Reruns produce byte-identical files (seeded PRNG anchored to 2026-08-30).

## Files

| File | Purpose |
|---|---|
| `loan_tape.csv` | 60 rows. 45 clean + 15 intentionally broken. Fires most validation rules. |
| `servicer_update.csv` | 20 rows. 15 create cross-source conflicts, 3 fix loan-tape issues, 2 orphans. |
| `document_manifest.csv` | Doc coverage for the first 20 loans. 5 of them have a missing doc. 2 orphan rows. |
| `validation_rules.json` | 15 rules the engine seeds and runs (Prompt 7 interprets these). |
| `expected_exceptions.csv` | Ground truth for the smoke script. Counts per rule are the minimum the engine must produce. |

## Loans intentionally broken

| Loan ID | Reason | Expected rule |
|---|---|---|
| (row 46, blank) | Missing loan_id | MISSING_LOAN_ID |
| (row 47, blank) | Missing loan_id | MISSING_LOAN_ID |
| LN-0001 (row 48) | Duplicate loan_id of row 1 | DUPLICATE_LOAN_ID |
| LN-0002 (row 49) | Duplicate loan_id of row 2 | DUPLICATE_LOAN_ID |
| LN-0050, LN-0051 | Same borrower_id + principal + origination_date | DUPLICATE_BORROWER_TRIPLE |
| LN-0052 | maturity_date < origination_date | MATURITY_BEFORE_ORIGINATION |
| LN-0053 | current_balance 110000 > 100000 * 1.05 | BALANCE_EXCEEDS_PRINCIPAL |
| LN-0054 | current_balance = -5000 | NEGATIVE_BALANCE |
| LN-0055 | interest_rate = 45 | INTEREST_RATE_OUT_OF_RANGE |
| LN-0056 | payment_status=current, dpd=90 | STATUS_DPD_MISMATCH |
| LN-0057 | paid_off + balance=12000 | CLOSED_BUT_POSITIVE_BALANCE |
| LN-0058 | state=ZZ | INVALID_STATE_CODE |
| LN-0059 | last_updated_at 420 days ago | STALE_LAST_UPDATED |
| LN-0060 | document_status=missing | MISSING_DOCUMENTS |
| LN-9001, LN-9002 | servicer_update refs unknown loan | ORPHAN_SERVICER_UPDATE |
| LN-9101, LN-9102 | document_manifest refs unknown loan | ORPHAN_DOCUMENT |
| LN-0001..LN-0015 | Fresher servicer balance | CROSS_SOURCE_CONFLICT |
| LN-0003, LN-0007, LN-0012, LN-0015, LN-0019 | Missing manifest doc | MISSING_DOCUMENTS |
