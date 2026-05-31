// =====================================================================
// Agente Planificador — audit-agent-planner
// Genera BORRADORES de: plan de auditoría, materialidad, matriz de
// riesgos y programa por área (NIA 300/315/320/330).
// Todo nace como borrador (agent_generated=true, status='borrador') y
// requiere aprobación humana. Cada corrida se registra en audit_agent_runs.
//
// Patrón basado en las edge functions existentes (gateway de Lovable AI).
// Entrada: { engagement_id, organization_id }
// =====================================================================
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PlannerRequest {
  engagement_id: string;
  organization_id: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let engagementId = "";
  let organizationId = "";

  try {
    const body: PlannerRequest = await req.json();
    engagementId = body.engagement_id;
    organizationId = body.organization_id;

    if (!engagementId || !organizationId) {
      throw new Error("engagement_id y organization_id son requeridos");
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no está configurada");

    // ---- 1. Cargar contexto del encargo --------------------------------
    const { data: engagement, error: engErr } = await supabase
      .from("audit_engagements")
      .select("*, client:audit_clients(*)")
      .eq("id", engagementId)
      .eq("organization_id", organizationId)
      .single();
    if (engErr || !engagement) throw new Error("Encargo no encontrado");

    if (engagement.archived_at) {
      throw new Error("El encargo está archivado: es de solo lectura");
    }

    // Balances actual y anterior con sus líneas
    const { data: balances } = await supabase
      .from("trial_balances")
      .select("id, period, total_debit, total_credit")
      .eq("engagement_id", engagementId);

    const balanceIds = (balances ?? []).map((b) => b.id);
    const { data: tbLines } = balanceIds.length
      ? await supabase
          .from("trial_balance_lines")
          .select("trial_balance_id, account_code, account_name, balance, fs_area, fs_caption")
          .in("trial_balance_id", balanceIds)
      : { data: [] as any[] };

    const periodOf = (tbId: string) =>
      (balances ?? []).find((b) => b.id === tbId)?.period ?? "actual";
    const linesForPrompt = (tbLines ?? []).map((l) => ({
      periodo: periodOf(l.trial_balance_id),
      cuenta: l.account_code,
      nombre: l.account_name,
      saldo: Number(l.balance ?? 0),
      area: l.fs_area,
    }));

    // ---- 2. Construir prompt -------------------------------------------
    const client = engagement.client;
    const systemPrompt = `Eres un auditor senior de una firma de contadores públicos en Costa Rica. Planificas auditorías de estados financieros conforme a las Normas Internacionales de Auditoría (NIA/ISA) y la normativa del Colegio de Contadores Públicos. Tu trabajo debe ser técnico, prudente y aplicar escepticismo profesional.

Devuelves SIEMPRE y ÚNICAMENTE un objeto JSON válido (sin texto extra, sin markdown) con esta forma exacta:
{
  "plan": {
    "understanding_entity": { "actividad": "", "entorno": "", "partes_relacionadas": "" },
    "internal_control": { "ambiente_control": "", "evaluacion_riesgos": "", "actividades_control": "" },
    "going_concern": { "evaluacion": "", "indicadores": "" },
    "fraud_assessment": { "factores_riesgo": "", "respuesta": "" },
    "overall_strategy": ""
  },
  "materiality": {
    "basis": "utilidad_antes_impuestos | activos_totales | ingresos | patrimonio",
    "benchmark_amount": 0,
    "percentage": 0,
    "rationale": ""
  },
  "risks": [
    {
      "fs_area": "<una de las áreas válidas>",
      "account_code": "",
      "assertion": "existencia|integridad|exactitud|valuacion|corte|derechos_obligaciones|presentacion",
      "risk_description": "",
      "risk_type": "inherente|control|fraude",
      "likelihood": "bajo|medio|alto",
      "magnitude": "bajo|medio|alto",
      "is_significant": false,
      "planned_response": ""
    }
  ],
  "programs": [
    {
      "fs_area": "<una de las áreas válidas>",
      "objective": "",
      "procedures": [
        { "assertion": "existencia", "procedure": "", "procedure_type": "inspeccion|observacion|confirmacion|recalculo|reejecucion|analiticos|indagacion" }
      ]
    }
  ]
}

Áreas válidas (fs_area): efectivo, inversiones, cuentas_por_cobrar, inventarios, gastos_anticipados, propiedad_planta_equipo, intangibles, otros_activos, cuentas_por_pagar, prestamos, impuestos_por_pagar, provisiones, otros_pasivos, patrimonio, ingresos, costos, gastos_operativos, gastos_financieros, otros.

Reglas:
- Propón materialidad con base y porcentaje razonables (ej. 5% utilidad antes de impuestos, 1-2% de activos o ingresos) y justifícalo.
- Marca is_significant=true en riesgos de fraude y en áreas materiales con alta probabilidad/magnitud.
- Genera programas SOLO para las áreas con saldo relevante en el balance.
- Cada riesgo significativo debe tener al menos un procedimiento que lo atienda.`;

    const userPrompt = `Planifica la auditoría con estos datos.

ENTIDAD: ${client?.name ?? "N/D"} | Cédula: ${client?.legal_id ?? "N/D"} | Sector: ${client?.industry ?? "N/D"} | Marco: ${engagement.framework ?? client?.reporting_framework ?? "N/D"}
PERÍODO: ${engagement.period_start ?? ""} a ${engagement.period_end ?? ""} (año fiscal ${engagement.fiscal_year})

BALANCE DE COMPROBACIÓN (saldos por cuenta y período):
${JSON.stringify(linesForPrompt)}`;

    // ---- 3. Llamar al modelo -------------------------------------------
    const model = "google/gemini-2.5-flash";
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!aiRes.ok) {
      throw new Error(`Gateway de IA respondió ${aiRes.status}: ${await aiRes.text()}`);
    }
    const aiJson = await aiRes.json();
    const raw = aiJson?.choices?.[0]?.message?.content ?? "";
    const tokens = aiJson?.usage?.total_tokens ?? null;

    const parsed = JSON.parse(stripFences(raw));

    // ---- 4. Materialidad: fijar aritmética en código -------------------
    const benchmark = Number(parsed?.materiality?.benchmark_amount ?? 0);
    const pct = Number(parsed?.materiality?.percentage ?? 0);
    const overall = Math.round(benchmark * (pct / 100) * 100) / 100;
    const performance = Math.round(overall * 0.75 * 100) / 100;     // 75% (juicio típico)
    const clearlyTrivial = Math.round(overall * 0.05 * 100) / 100;  // 5%

    // ---- 5. Escribir BORRADORES (idempotente por encargo) --------------
    await supabase.from("audit_plans").upsert({
      organization_id: organizationId,
      engagement_id: engagementId,
      understanding_entity: parsed?.plan?.understanding_entity ?? {},
      internal_control: parsed?.plan?.internal_control ?? {},
      going_concern: parsed?.plan?.going_concern ?? {},
      fraud_assessment: parsed?.plan?.fraud_assessment ?? {},
      overall_strategy: parsed?.plan?.overall_strategy ?? "",
      status: "borrador",
      agent_generated: true,
    }, { onConflict: "engagement_id" });

    await supabase.from("materiality").upsert({
      organization_id: organizationId,
      engagement_id: engagementId,
      basis: parsed?.materiality?.basis ?? null,
      benchmark_amount: benchmark,
      percentage: pct,
      overall_materiality: overall,
      performance_materiality: performance,
      clearly_trivial: clearlyTrivial,
      rationale: parsed?.materiality?.rationale ?? "",
      agent_generated: true,
    }, { onConflict: "engagement_id" });

    // Reemplazar riesgos/programas generados por IA en una nueva corrida
    await supabase.from("audit_risks")
      .delete().eq("engagement_id", engagementId).eq("agent_generated", true);

    const risks = Array.isArray(parsed?.risks) ? parsed.risks : [];
    if (risks.length) {
      await supabase.from("audit_risks").insert(
        risks.map((r: any) => ({
          organization_id: organizationId,
          engagement_id: engagementId,
          fs_area: r.fs_area ?? null,
          account_code: r.account_code ?? null,
          assertion: r.assertion ?? null,
          risk_description: r.risk_description ?? "",
          risk_type: r.risk_type ?? null,
          likelihood: r.likelihood ?? null,
          magnitude: r.magnitude ?? null,
          is_significant: !!r.is_significant,
          planned_response: r.planned_response ?? null,
          agent_generated: true,
        })),
      );
    }

    const programs = Array.isArray(parsed?.programs) ? parsed.programs : [];
    for (const p of programs) {
      const { data: prog } = await supabase.from("audit_programs").upsert({
        organization_id: organizationId,
        engagement_id: engagementId,
        fs_area: p.fs_area,
        objective: p.objective ?? "",
        agent_generated: true,
      }, { onConflict: "engagement_id,fs_area" }).select("id").single();

      const procs = Array.isArray(p?.procedures) ? p.procedures : [];
      if (prog && procs.length) {
        await supabase.from("audit_program_procedures").insert(
          procs.map((pr: any) => ({
            organization_id: organizationId,
            program_id: prog.id,
            assertion: pr.assertion ?? null,
            procedure: pr.procedure ?? "",
            procedure_type: pr.procedure_type ?? null,
            status: "pendiente",
          })),
        );
      }
    }

    // ---- 6. Trazabilidad ------------------------------------------------
    await supabase.from("audit_agent_runs").insert({
      organization_id: organizationId,
      engagement_id: engagementId,
      agent_type: "planificador",
      model,
      input_ref: { lines: linesForPrompt.length },
      output_ref: { risks: risks.length, programs: programs.length },
      status: "ok",
      tokens,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Plan, materialidad, riesgos y programa generados como borrador",
        counts: { risks: risks.length, programs: programs.length },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("audit-agent-planner error:", message);
    if (engagementId && organizationId) {
      await supabase.from("audit_agent_runs").insert({
        organization_id: organizationId,
        engagement_id: engagementId,
        agent_type: "planificador",
        status: "error",
        error: message,
      });
    }
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// Quita ```json ... ``` si el modelo envuelve la respuesta.
function stripFences(s: string): string {
  const trimmed = s.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fence ? fence[1] : trimmed).trim();
}
