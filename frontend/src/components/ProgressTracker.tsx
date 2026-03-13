import { PipelineStatus } from "@/lib/mockApi";
import { Check, Loader2, Circle, AlertCircle } from "lucide-react";

interface ProgressTrackerProps {
  status: PipelineStatus;
}

export default function ProgressTracker({ status }: ProgressTrackerProps) {
  const completedCount = status.steps.filter((s) => s.status === "completed").length;
  const progress = Math.round((completedCount / status.steps.length) * 100);

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm font-mono">
          <span className="text-muted-foreground">Progress</span>
          <span className="text-primary neon-text">{progress}%</span>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500 neon-glow"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-1">
        {status.steps.map((step, i) => (
          <div
            key={step.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-md font-mono text-sm transition-all duration-300 ${
              step.status === "in_progress"
                ? "bg-primary/10 neon-border border"
                : step.status === "completed"
                ? "bg-secondary/50"
                : step.status === "error"
                ? "bg-destructive/10 border border-destructive/30"
                : "opacity-50"
            }`}
          >
            <StepIcon status={step.status} />
            <span className={step.status === "in_progress" ? "text-primary" : step.status === "completed" ? "text-foreground" : step.status === "error" ? "text-destructive" : "text-muted-foreground"}>
              {step.label}
            </span>
            {step.message && step.status === "in_progress" && (
              <span className="ml-auto text-xs text-muted-foreground hidden sm:block">{step.message}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StepIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <Check className="h-4 w-4 text-primary shrink-0" />;
    case "in_progress":
      return <Loader2 className="h-4 w-4 text-primary shrink-0 animate-spin" />;
    case "error":
      return <AlertCircle className="h-4 w-4 text-destructive shrink-0" />;
    default:
      return <Circle className="h-4 w-4 text-step-pending shrink-0" />;
  }
}
