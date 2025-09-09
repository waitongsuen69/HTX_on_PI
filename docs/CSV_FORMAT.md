# CSV Format for Cost Basis Lots

Header (exact column names, case-sensitive):

id,date,asset,action,qty,unit_cost_usd,note

- id: 6-digit zero-padded string; if blank on import, a new id is assigned.
- date: ISO 8601 (UTC recommended), e.g., 2025-01-01T00:00:00Z.
- asset: symbol such as TRX, BTC, USDT.
- action: buy | sell | deposit | withdraw.
- qty: number; positive for buy/deposit, negative for sell/withdraw.
- unit_cost_usd: required for buy; ignored for sell; may be empty for deposit; must be empty for withdraw.
- note: optional free text; commas allowed (standard CSV quoting).

Matching: LOFO (Lowest unit cost out first). Deposits with no cost are matched last.

Examples

id,date,asset,action,qty,unit_cost_usd,note
000001,2025-01-01,TRX,buy,2000,0.10,seed lot
,2025-01-05,TRX,buy,1000,0.08,
,2025-01-10,TRX,sell,-500,,rebalance

Validation Errors

- Bad date or unsupported action.
- Sign/action mismatch.
- Withdraw with non-empty unit_cost_usd.
- Negative inventory after reconciliation.
