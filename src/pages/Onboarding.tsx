import { useParams, Navigate } from "react-router-dom";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { useAuth } from "@/hooks/useAuth";

export default function OnboardingPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/auth" replace />;
  if (!orgId) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen bg-background">
      <OnboardingWizard organizationId={orgId} />
    </div>
  );
}
