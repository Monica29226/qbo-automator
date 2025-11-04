import { cn } from "@/lib/utils";
import { Mail, FileSearch, Database, CheckCircle, ArrowRight } from "lucide-react";

const steps = [
  {
    icon: Mail,
    label: "Recibir Correo",
    description: "Gmail/Outlook",
    status: "active",
  },
  {
    icon: FileSearch,
    label: "Extraer XML",
    description: "Parser CR v4.x",
    status: "active",
  },
  {
    icon: Database,
    label: "Clasificar",
    description: "Catálogo proveedores",
    status: "active",
  },
  {
    icon: CheckCircle,
    label: "Publicar QBO",
    description: "Bill/VendorCredit",
    status: "active",
  },
];

export const ProcessingFlow = () => {
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      {steps.map((step, index) => (
        <div key={step.label} className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-3">
            <div
              className={cn(
                "h-16 w-16 rounded-xl flex items-center justify-center transition-all",
                step.status === "active" 
                  ? "bg-primary text-primary-foreground shadow-lg" 
                  : "bg-muted text-muted-foreground"
              )}
            >
              <step.icon className="h-8 w-8" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-sm text-foreground">{step.label}</p>
              <p className="text-xs text-muted-foreground">{step.description}</p>
            </div>
          </div>
          {index < steps.length - 1 && (
            <ArrowRight className="h-6 w-6 text-muted-foreground flex-shrink-0 mt-[-30px]" />
          )}
        </div>
      ))}
    </div>
  );
};
