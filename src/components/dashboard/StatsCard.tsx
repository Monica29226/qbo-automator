import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatsCardProps {
  title: string;
  value: string;
  change: string;
  icon: LucideIcon;
  variant?: "default" | "primary" | "success" | "warning";
  onActionClick?: () => void;
  actionLabel?: string;
}

export const StatsCard = ({ 
  title, 
  value, 
  change, 
  icon: Icon, 
  variant = "default",
  onActionClick,
  actionLabel 
}: StatsCardProps) => {
  const isPositive = change.startsWith("+");
  
  const variantStyles = {
    default: "bg-card",
    primary: "bg-primary/5 border-primary/20",
    success: "bg-success/5 border-success/20",
    warning: "bg-warning/5 border-warning/20",
  };

  const iconStyles = {
    default: "text-muted-foreground",
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
  };

  return (
    <Card className={cn(
      "p-6 transition-all duration-300 hover:shadow-lg hover:-translate-y-1 animate-fade-in-subtle",
      variantStyles[variant]
    )}>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <Icon className={cn("h-5 w-5 transition-transform duration-300 group-hover:scale-110", iconStyles[variant])} />
      </div>
      <div className="space-y-1">
        <p className="text-3xl font-bold text-foreground font-heading">{value}</p>
        <p className={cn(
          "text-xs font-medium",
          isPositive ? "text-success" : "text-muted-foreground"
        )}>
          {change} vs ayer
        </p>
      </div>
      {onActionClick && actionLabel && (
        <Button 
          onClick={onActionClick}
          variant="outline"
          size="sm"
          className="mt-4 w-full transition-all duration-200 hover:scale-[1.02]"
        >
          {actionLabel}
        </Button>
      )}
    </Card>
  );
};
