import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { ArrowLeft, ArrowRight, SkipForward, Loader2 } from "lucide-react";
import { useOnboarding } from "@/hooks/useOnboarding";
import Step1Basic from "./steps/Step1Basic";
import Step2QBO from "./steps/Step2QBO";
import Step3Email from "./steps/Step3Email";
import Step4DefaultAccount from "./steps/Step4DefaultAccount";
import Step5IVAMode from "./steps/Step5IVAMode";
import Step6Rules from "./steps/Step6Rules";
import Step7Summary from "./steps/Step7Summary";

const STEPS = [
  { n: 1, title: "Datos básicos", skippable: false },
  { n: 2, title: "QuickBooks", skippable: true },
  { n: 3, title: "Correo", skippable: true },
  { n: 4, title: "Cuenta default", skippable: true },
  { n: 5, title: "Modo IVA", skippable: true },
  { n: 6, title: "Reglas", skippable: true },
  { n: 7, title: "Listo", skippable: false },
];

interface Props {
  organizationId: string;
}

export function OnboardingWizard({ organizationId }: Props) {
  const { state, loading, save, completeStep, finish, goToStep } = useOnboarding(organizationId);
  const [busy, setBusy] = useState(false);
  const actionsRef = useRef<{ onNext: () => any; disableNext?: boolean }>({ onNext: () => {} });

  const bindActions = useCallback((a: typeof actionsRef.current) => {
    actionsRef.current = a;
  }, []);

  const handleSaved = useCallback((data: any) => {
    completeStep(state.current_step, data);
  }, [completeStep, state.current_step]);

  const handleNext = async () => {
    setBusy(true);
    try { await actionsRef.current.onNext(); } finally { setBusy(false); }
  };

  const handleSkip = async () => {
    await save({
      current_step: Math.min(7, state.current_step + 1),
      completed_steps: state.completed_steps,
    });
  };

  const handleBack = async () => {
    await goToStep(state.current_step - 1);
  };

  if (loading) return <div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const step = STEPS[state.current_step - 1];
  const progress = (state.completed_steps.length / 7) * 100;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-2xl font-bold">Configuración inicial</h2>
          <span className="text-sm text-muted-foreground">Paso {state.current_step} de 7</span>
        </div>
        <Progress value={progress} />
        <div className="grid grid-cols-7 gap-1 mt-2 text-[10px] text-center text-muted-foreground">
          {STEPS.map((s) => (
            <div key={s.n} className={s.n === state.current_step ? "font-semibold text-foreground" : ""}>{s.title}</div>
          ))}
        </div>
      </div>

      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">{step.title}</h3>
        {state.current_step === 1 && <Step1Basic organizationId={organizationId} initial={state.step_data?.step1} onSaved={handleSaved} bindActions={bindActions} />}
        {state.current_step === 2 && <Step2QBO organizationId={organizationId} initial={state.step_data?.step2} onSaved={handleSaved} bindActions={bindActions} />}
        {state.current_step === 3 && <Step3Email organizationId={organizationId} initial={state.step_data?.step3} onSaved={handleSaved} bindActions={bindActions} />}
        {state.current_step === 4 && <Step4DefaultAccount organizationId={organizationId} initial={state.step_data?.step4} onSaved={handleSaved} bindActions={bindActions} />}
        {state.current_step === 5 && <Step5IVAMode organizationId={organizationId} initial={state.step_data?.step5} onSaved={handleSaved} bindActions={bindActions} />}
        {state.current_step === 6 && <Step6Rules organizationId={organizationId} initial={state.step_data?.step6} onSaved={handleSaved} bindActions={bindActions} />}
        {state.current_step === 7 && <Step7Summary organizationId={organizationId} stepData={state.step_data} onFinish={finish} />}
      </Card>

      {state.current_step < 7 && (
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={handleBack} disabled={state.current_step === 1 || busy}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Atrás
          </Button>
          <div className="flex gap-2">
            {step.skippable && (
              <Button variant="outline" onClick={handleSkip} disabled={busy}>
                <SkipForward className="h-4 w-4 mr-1" /> Saltar
              </Button>
            )}
            <Button onClick={handleNext} disabled={busy || actionsRef.current.disableNext}>
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ArrowRight className="h-4 w-4 mr-1" />}
              Continuar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
