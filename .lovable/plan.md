

## Problem Analysis

The invoice ending in 3598 has **mixed tax rates** (1% and 13% across 6 lines), total_amount = ₡44,465 (subtotal ₡42,070.67 + tax ₡2,394.33). But QuickBooks shows Total = ₡42,070.66 — only the subtotal, with "Fuera del ámbito del impuesto" (no tax applied).

**Root cause: substring matching bug in `getTaxCodeRef`**

The function uses `name.includes(\`${rate}%\`)` to match tax codes. When `rate = 1`:
- The string `"13%"` **contains** `"1%"` as a substring → matches incorrectly
- Lines with 1% tax get assigned a 13% TaxCodeRef
- QBO receives conflicting information: TxnTaxDetail says ₡2,394.33 total tax, but the TaxCodeRef on lines implies a different calculation
- QBO either errors (triggering retry WITHOUT tax redistribution working properly) or silently drops the tax

**Secondary issue**: After bill creation, the system never verifies that QBO's `TotalAmt` matches the expected total. If QBO silently drops tax, no one catches it.

## Plan

### 1. Fix `getTaxCodeRef` substring matching bug
**File**: `supabase/functions/publish-to-quickbooks/index.ts` (lines ~1519-1523)

Change the rate matching from substring to word-boundary matching:
```typescript
// BEFORE (buggy):
if (name.includes(`${rate}%`))

// AFTER (fixed):
const ratePattern = new RegExp(`(^|[^0-9])${rate}%`);
if (ratePattern.test(name))
```
This ensures "1%" won't match "13%" because the `1` in `13%` is preceded by another digit.

### 2. Add post-creation verification step
After creating a Bill/VendorCredit, read the returned `TotalAmt` and compare to expected total. If there's a discrepancy > 1.0:
- Delete the bill from QBO
- Recreate it with `GlobalTaxCalculation: "NotApplicable"` and tax redistributed into line amounts (the proven fallback approach)

This catches cases where QBO silently applies wrong tax calculations.

### 3. Redeploy the edge function
The fix will be deployed automatically.

## Technical Details

- **Bug location**: `getTaxCodeRef` function, STEP 1 name matching (line ~1519)
- **Impact**: Any invoice with 1%, 2%, or 4% tax rates could be mismatched to higher rates (13%, 12%, etc.)
- **Verification**: The post-creation check ensures no future silent mismatches slip through
- **Files modified**: `supabase/functions/publish-to-quickbooks/index.ts`

