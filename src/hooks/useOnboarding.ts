import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface OnboardingState {
  id?: string;
  organization_id: string;
  current_step: number;
  completed_steps: number[];
  step_data: Record<string, any>;
  completed_at: string | null;
}

const EMPTY: OnboardingState = {
  organization_id: "",
  current_step: 1,
  completed_steps: [],
  step_data: {},
  completed_at: null,
};

export function useOnboarding(organizationId: string | null) {
  const [state, setState] = useState<OnboardingState>(EMPTY);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("onboarding_progress")
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (data) {
      setState({
        id: data.id,
        organization_id: data.organization_id,
        current_step: data.current_step,
        completed_steps: data.completed_steps ?? [],
        step_data: data.step_data ?? {},
        completed_at: data.completed_at,
      });
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: ins } = await (supabase as any)
        .from("onboarding_progress")
        .insert({ organization_id: organizationId, current_step: 1, created_by: user?.id })
        .select()
        .maybeSingle();
      if (ins) {
        setState({
          id: ins.id,
          organization_id: ins.organization_id,
          current_step: ins.current_step,
          completed_steps: ins.completed_steps ?? [],
          step_data: ins.step_data ?? {},
          completed_at: ins.completed_at,
        });
      }
    }
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const save = useCallback(
    async (patch: Partial<OnboardingState>) => {
      if (!organizationId) return;
      const next = { ...state, ...patch };
      setState(next);
      await (supabase as any)
        .from("onboarding_progress")
        .update({
          current_step: next.current_step,
          completed_steps: next.completed_steps,
          step_data: next.step_data,
          completed_at: next.completed_at,
        })
        .eq("organization_id", organizationId);
    },
    [organizationId, state],
  );

  const goToStep = (step: number) => save({ current_step: Math.max(1, Math.min(7, step)) });

  const completeStep = (step: number, data?: Record<string, any>) => {
    const completed = Array.from(new Set([...(state.completed_steps ?? []), step]));
    const stepData = { ...(state.step_data ?? {}), ...(data ? { [`step${step}`]: data } : {}) };
    return save({
      completed_steps: completed,
      step_data: stepData,
      current_step: Math.min(7, step + 1),
    });
  };

  const finish = () => save({ completed_at: new Date().toISOString(), current_step: 7 });

  return { state, loading, save, goToStep, completeStep, finish, reload };
}
