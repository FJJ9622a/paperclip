import { AlertTriangle } from "lucide-react";
import type { PipelineHealthWarning } from "@paperclipai/shared";
import { cn } from "../lib/utils";

/**
 * Setup-health warnings for pipelines, rendered in the same plain-language
 * prosumer voice as the rest of the pipelines UI. The copy comes straight from
 * `computePipelineHealth` — these components only handle layout.
 */

function warningCount(count: number) {
  return `${count} thing${count === 1 ? "" : "s"} to fix`;
}

/**
 * Board-header bar: a single amber strip summarising every stage that won't run,
 * with each warning optionally clickable to jump to that stage's settings.
 */
export function PipelineHealthBar({
  warnings,
  onSelectStage,
  className,
}: {
  warnings: PipelineHealthWarning[];
  onSelectStage?: (stageId: string) => void;
  className?: string;
}) {
  if (warnings.length === 0) return null;
  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-900 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-200",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>Some steps won't run yet — {warningCount(warnings.length)}</span>
      </div>
      <ul className="mt-1.5 space-y-1 pl-6 text-sm">
        {warnings.map((warning, index) => {
          const body = (
            <>
              <span className="font-medium">{warning.stageName}:</span> {warning.message}
            </>
          );
          return (
            <li key={`${warning.stageId}-${warning.code}-${index}`} className="list-disc">
              {onSelectStage ? (
                <button
                  type="button"
                  className="text-left underline-offset-2 hover:underline"
                  onClick={() => onSelectStage(warning.stageId)}
                >
                  {body}
                </button>
              ) : (
                <span>{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Compact per-stage warning list, shown inside a stage's settings panel.
 */
export function StageHealthWarnings({
  warnings,
  className,
}: {
  warnings: PipelineHealthWarning[];
  className?: string;
}) {
  if (warnings.length === 0) return null;
  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-200",
        className,
      )}
    >
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>{warnings.length === 1 ? "This step won't run yet" : "This step won't run yet"}</span>
      </div>
      <ul className="mt-1.5 space-y-1 pl-6">
        {warnings.map((warning, index) => (
          <li key={`${warning.code}-${index}`} className="list-disc">
            {warning.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
