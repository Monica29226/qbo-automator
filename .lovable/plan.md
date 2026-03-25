

# Plan: Fix Tax Handling - Bills Must Match XML Exactly

## Problem Identified

Two code paths create bills with wrong amounts and "Out of Scope" tax:

1. **`force-publish-document`** (CONFIRMED BUG): Uses `totalAmount = Math.abs(doc.total_amount)` (the FULL ₡1,750,000) as a single line with `GlobalTaxCalculation: "NotApplicable"`. This always creates "Out of Scope" bills regardless of whether the invoice has tax.

2. **`publish-to-quickbooks` tax retry** (LIKELY BUG): When QBO rejects the TxnTaxDetail, the retry removes it entirely and keeps `TaxExcluded` mode. If QBO can't resolve the TaxCodeRef on the line, the bill ends up with no tax. The retry should instead switch to `TaxInclusive` with tax baked into line amounts.

For invoice 000572 (Inmobiliaria Madrigal):
- XML: subtotal=₡1,548,672.57, tax=₡201,327.43, total=₡1,750,000
- QBO result: 1 line ₡1,750,000 "Fuera del ámbito" (Out of Scope) — WRONG

## Changes

### 1. Fix `force-publish-document/index.ts` — Use XML line items with proper tax

Instead of sending a single line with the full total and `NotApplicable`:
- Parse `xml_data.detalle` to extract `subtotal`/`baseImponible` per line (same as main publish function)
- Set `GlobalTaxCalculation: "TaxExcluded"` 
- Add `TxnTaxDetail` with the IVA amount and rate from XML
- Add `TaxCodeRef` to each line based on the tax rate
- Fallback: if no detail lines, use `total_amount - total_tax` as line amount + TxnTaxDetail for tax
- On tax error retry: switch to `TaxInclusive` with `subtotal + tax` as line amount (so QBO backs out the tax correctly)

### 2. Fix `publish-to-quickbooks/index.ts` — Improve tax retry logic

Current retry (lines 2367-2403): removes `TxnTaxDetail`, keeps `TaxExcluded`.

Fix the retry to:
- Switch `GlobalTaxCalculation` to `"TaxInclusive"` 
- Redistribute: each line amount becomes `subtotal + proportional_tax` (i.e. the `montoTotalLinea` from XML)
- This way QBO backs out the tax from the inclusive amount, showing the correct tax rate and keeping the total identical to the XML
- Keep `TaxCodeRef` on each line so QBO knows which rate to apply

### 3. Fix `publish-to-quickbooks/index.ts` — Store montoTotalLinea per line for retry

During the initial line-building loop (line 1883-1979), also store `montoTotalLinea` alongside each line so the retry can use it to switch to TaxInclusive amounts without recalculating.

## Technical Detail

```text
CURRENT (broken retry):
  Line: subtotal=1,548,672.57  TaxCodeRef=IVA13%
  GlobalTaxCalculation: TaxExcluded
  TxnTaxDetail: REMOVED
  → QBO can't calculate tax → "Out of Scope" ₡1,548,672.57
    OR if TaxCodeRef wrong → ₡1,750,000 "Out of Scope"

FIXED (retry):
  Line: amount=1,750,000.00  TaxCodeRef=IVA13%
  GlobalTaxCalculation: TaxInclusive
  TxnTaxDetail: REMOVED
  → QBO backs out 13% → Subtotal ₡1,548,672.57 + IVA ₡201,327.43 = ₡1,750,000 ✓
```

## Files to Edit
- `supabase/functions/publish-to-quickbooks/index.ts` — Fix tax retry logic
- `supabase/functions/force-publish-document/index.ts` — Rewrite to use XML detail lines with proper tax

