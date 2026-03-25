
# Plan: Fix Tax Handling - COMPLETED

## Changes Made

### 1. `publish-to-quickbooks/index.ts` — Fixed tax retry logic
- **Stored `_montoTotalLinea`** on each line detail (line 1967-1969) so retry can use it
- **Bill retry** (line 2388-2402): Changed from removing TxnTaxDetail + keeping TaxExcluded → now switches to `TaxInclusive` and uses `montoTotalLinea` as line amounts. QBO backs out the tax correctly.
- **VendorCredit retry** (line 2242-2255): Same fix applied.

### 2. `force-publish-document/index.ts` — Rewrote tax handling
- **Before**: Single line with `total_amount` and `GlobalTaxCalculation: "NotApplicable"` → always "Out of Scope"
- **After**: Parses XML `detalle` lines, extracts subtotal per line, builds `TxnTaxDetail` with rate-specific tax lines, uses `GlobalTaxCalculation: "TaxExcluded"`
- **Tax retry**: If QBO rejects tax, switches to `TaxInclusive` with `montoTotalLinea` amounts
- **Fallback**: If no XML detail lines, uses `total_amount - total_tax` as line amount

## How it works now

```
STANDARD FLOW (TaxExcluded):
  Line: subtotal=1,548,672.57
  TxnTaxDetail: IVA 13% = 201,327.43
  GlobalTaxCalculation: TaxExcluded
  → QBO: Subtotal ₡1,548,672.57 + IVA ₡201,327.43 = ₡1,750,000 ✓

RETRY FALLBACK (TaxInclusive):
  Line: amount=1,750,000.00  TaxCodeRef=IVA13%
  GlobalTaxCalculation: TaxInclusive
  → QBO backs out 13% → Subtotal ₡1,548,672.57 + IVA ₡201,327.43 = ₡1,750,000 ✓
```
