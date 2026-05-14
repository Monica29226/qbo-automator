// Tests for the QBO tax-error retry flow in force-publish-document.
//
// We can't easily import the handler (it's wrapped in Deno.serve), so we
// replicate the exact body-consumption pattern from index.ts (lines ~325-376)
// and validate two invariants:
//   1. response.text() is never called twice on the same Response (would throw
//      "Body already consumed").
//   2. On a tax error, the retry path runs and the second response's body is
//      consumed correctly (either as JSON on success, or as text on failure).
//
// Run with: deno test --allow-net --allow-env

import {
  assertEquals,
  assert,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// --- Helpers ----------------------------------------------------------------

/** Wrap a Response so we can detect double-consumption of its body. */
function trackBodyReads(res: Response): { res: Response; reads: () => number } {
  let reads = 0;
  const origText = res.text.bind(res);
  const origJson = res.json.bind(res);
  res.text = async () => {
    reads++;
    return await origText();
  };
  res.json = async () => {
    reads++;
    return await origJson();
  };
  return { res, reads: () => reads };
}

/** Replicates the retry logic from force-publish-document/index.ts. */
async function runPublishWithRetry(opts: {
  hasTax: boolean;
  fetchImpl: typeof fetch;
}): Promise<{ ok: true; entityId: string } | { ok: false; error: string }> {
  const { hasTax, fetchImpl } = opts;

  const billPayload: any = {
    Line: [
      {
        Amount: 100,
        _montoTotalLinea: 113,
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: "1" },
          TaxCodeRef: { value: "TAX" },
        },
      },
    ],
    TxnTaxDetail: { TotalTax: 13 },
  };

  let response = await fetchImpl("https://quickbooks.api.intuit.com/v3/company/X/bill", {
    method: "POST",
    body: JSON.stringify(billPayload),
  });

  let initialErrorText: string | null = null;
  if (!response.ok && hasTax) {
    initialErrorText = await response.text();
    if (
      initialErrorText.includes("impuesto") ||
      initialErrorText.includes("tax") ||
      initialErrorText.includes("TaxCodeRef")
    ) {
      delete billPayload.TxnTaxDetail;
      billPayload.GlobalTaxCalculation = "NotApplicable";
      for (const line of billPayload.Line) {
        if (line.AccountBasedExpenseLineDetail?.TaxCodeRef) {
          delete line.AccountBasedExpenseLineDetail.TaxCodeRef;
        }
        if (line._montoTotalLinea && line._montoTotalLinea > line.Amount) {
          line.Amount = parseFloat(line._montoTotalLinea.toFixed(2));
        }
      }
      response = await fetchImpl(
        "https://quickbooks.api.intuit.com/v3/company/X/bill",
        { method: "POST", body: JSON.stringify(billPayload) },
      );
      initialErrorText = null; // new response, body not yet consumed
    }
  }

  if (!response.ok) {
    const errorText = initialErrorText ?? (await response.text());
    return { ok: false, error: errorText };
  }

  const data = await response.json();
  return { ok: true, entityId: data.Bill.Id };
}

// --- Tests ------------------------------------------------------------------

Deno.test("retry succeeds after tax error and never double-reads any response", async () => {
  const trackers: Array<() => number> = [];
  let call = 0;

  const fetchImpl = (async (_url: string | URL, _init?: RequestInit) => {
    call++;
    if (call === 1) {
      const r = new Response(
        JSON.stringify({ Fault: { Error: [{ Message: "Invalid tax code TaxCodeRef" }] } }),
        { status: 400 },
      );
      const t = trackBodyReads(r);
      trackers.push(t.reads);
      return t.res;
    }
    const r = new Response(JSON.stringify({ Bill: { Id: "999" } }), { status: 200 });
    const t = trackBodyReads(r);
    trackers.push(t.reads);
    return t.res;
  }) as typeof fetch;

  const result = await runPublishWithRetry({ hasTax: true, fetchImpl });

  assertEquals(call, 2, "should retry exactly once");
  assert(result.ok, `expected success, got: ${JSON.stringify(result)}`);
  if (result.ok) assertEquals(result.entityId, "999");

  for (const reads of trackers) {
    assert(reads() <= 1, `Response body consumed ${reads()} times (must be ≤1)`);
  }
});

Deno.test("retry that also fails surfaces the second error without double-reading", async () => {
  const trackers: Array<() => number> = [];
  let call = 0;

  const fetchImpl = (async () => {
    call++;
    const body = call === 1
      ? JSON.stringify({ Fault: { Error: [{ Message: "tax error" }] } })
      : JSON.stringify({ Fault: { Error: [{ Message: "account invalid" }] } });
    const r = new Response(body, { status: 400 });
    const t = trackBodyReads(r);
    trackers.push(t.reads);
    return t.res;
  }) as typeof fetch;

  const result = await runPublishWithRetry({ hasTax: true, fetchImpl });

  assertEquals(call, 2);
  assert(!result.ok);
  if (!result.ok) assert(result.error.includes("account invalid"));

  for (const reads of trackers) {
    assert(reads() <= 1, `Response body consumed ${reads()} times (must be ≤1)`);
  }
});

Deno.test("non-tax error on first call: no retry, body read exactly once", async () => {
  const trackers: Array<() => number> = [];
  let call = 0;

  const fetchImpl = (async () => {
    call++;
    const r = new Response(
      JSON.stringify({ Fault: { Error: [{ Message: "vendor not found" }] } }),
      { status: 400 },
    );
    const t = trackBodyReads(r);
    trackers.push(t.reads);
    return t.res;
  }) as typeof fetch;

  const result = await runPublishWithRetry({ hasTax: true, fetchImpl });

  assertEquals(call, 1, "must not retry on non-tax errors");
  assert(!result.ok);
  assertEquals(trackers[0](), 1);
});

Deno.test("regression: original buggy pattern would throw 'Body already consumed'", async () => {
  // Demonstrates the bug the fix addresses: calling response.text() twice on
  // the same Response object throws. This guards against future regressions.
  const r = new Response("error body", { status: 400 });
  await r.text();
  await assertRejects(
    async () => {
      await r.text();
    },
    TypeError,
  );
});
