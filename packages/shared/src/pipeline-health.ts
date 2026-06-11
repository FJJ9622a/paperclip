import { isAgentStatusInvokable } from "./agent-eligibility.js";
import { extractPipelineMentions } from "./project-mentions.js";

/**
 * Setup-health warnings for pipelines.
 *
 * The goal is to warn — in plain, Zapier-level language with zero technical
 * vocabulary — about any configuration that simply will not run, *before*
 * someone discovers it mid-workflow. The copy here intentionally avoids words
 * like "routine", "dispatch", or "JWT": a paused agent is "a paused teammate",
 * a routine is "the instructions for this step", and so on.
 *
 * This module is a pure function so it can be unit-tested and shared between the
 * server (which assembles the inputs from the database) and the UI.
 */

export type PipelineHealthWarningCode =
  | "paused_agent"
  | "automation_no_instructions"
  | "review_no_approver"
  | "missing_pipeline_reference"
  | "missing_stage_reference"
  | "unset_required_variable";

export interface PipelineHealthWarning {
  /** Machine-readable reason; UI keys icons/grouping off this. */
  code: PipelineHealthWarningCode;
  /** The stage the warning is anchored to. */
  stageId: string;
  stageKey: string;
  stageName: string;
  /** Plain-language, prosumer-safe message ready to render as-is. */
  message: string;
}

export interface PipelineHealthReport {
  pipelineId: string;
  warnings: PipelineHealthWarning[];
  /** Convenience: true when there are no warnings at all. */
  ok: boolean;
}

export interface PipelineHealthAgentRef {
  id: string;
  name?: string | null;
  status: string;
}

export interface PipelineHealthStageRef {
  key: string;
  name: string;
}

export interface PipelineHealthPipelineRef {
  id: string;
  name: string;
  stages: PipelineHealthStageRef[];
}

export interface PipelineHealthStageInput {
  id: string;
  key: string;
  name: string;
  kind: string;
  config: Record<string, unknown> | null | undefined;
  /** Latest instructions body for the stage ("" when there are none). */
  instructionsBody?: string | null;
}

export interface PipelineHealthInput {
  pipelineId: string;
  stages: PipelineHealthStageInput[];
  /** Every agent in the company, keyed by id, for invokability + name lookup. */
  agentsById: Record<string, PipelineHealthAgentRef>;
  /** Every pipeline in the company, keyed by id, for validating `/pipeline:` references. */
  pipelinesById: Record<string, PipelineHealthPipelineRef>;
}

type StageConfig = {
  assigneeAgentId?: unknown;
  requireApproval?: unknown;
  approver?: { kind?: unknown; id?: unknown } | null;
  variables?: unknown;
  [key: string]: unknown;
};

function asConfig(config: PipelineHealthStageInput["config"]): StageConfig {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  return config as StageConfig;
}

function agentLabel(agent: PipelineHealthAgentRef | undefined): string {
  const name = agent?.name?.trim();
  return name && name.length > 0 ? name : "a teammate";
}

/** A stage "runs instructions" when it has both an assigned teammate and an instructions body. */
function readVariableName(entry: Record<string, unknown>): string | null {
  const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : null;
  if (name) return name;
  const key = typeof entry.key === "string" && entry.key.trim() ? entry.key.trim() : null;
  return key;
}

function readVariableLabel(entry: Record<string, unknown>, fallback: string): string {
  const label = typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : null;
  return label ?? fallback;
}

function isRequired(entry: Record<string, unknown>): boolean {
  return entry.required === true;
}

function hasDefaultValue(entry: Record<string, unknown>): boolean {
  const value = entry.defaultValue;
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return typeof value === "number" || typeof value === "boolean";
}

export function computePipelineHealth(input: PipelineHealthInput): PipelineHealthReport {
  const warnings: PipelineHealthWarning[] = [];

  for (const stage of input.stages) {
    const config = asConfig(stage.config);
    const instructionsBody = (stage.instructionsBody ?? "").trim();
    const anchor = { stageId: stage.id, stageKey: stage.key, stageName: stage.name };

    const assigneeAgentId =
      typeof config.assigneeAgentId === "string" && config.assigneeAgentId.trim()
        ? config.assigneeAgentId.trim()
        : null;

    // 1. A teammate is assigned to run this step, but they're paused / gone.
    if (assigneeAgentId) {
      const agent = input.agentsById[assigneeAgentId];
      if (!agent) {
        warnings.push({
          ...anchor,
          code: "paused_agent",
          message: `This step is assigned to a teammate who's no longer here, so it won't run. Pick someone else to run it.`,
        });
      } else if (!isAgentStatusInvokable(agent.status)) {
        warnings.push({
          ...anchor,
          code: "paused_agent",
          message: `This step is assigned to ${agentLabel(agent)}, who's paused right now, so it won't run until they're active again.`,
        });
      }
    }

    // 2. A teammate is assigned but there's nothing for them to do (no instructions).
    if (assigneeAgentId && !instructionsBody) {
      warnings.push({
        ...anchor,
        code: "automation_no_instructions",
        message: `This step has a teammate assigned but no instructions to follow, so nothing will happen when work arrives here.`,
      });
    }

    // 3. A review step with no one who can actually approve.
    if (stage.kind === "review" || config.requireApproval === true) {
      const approver = config.approver && typeof config.approver === "object" ? config.approver : null;
      const kind = approver && typeof approver.kind === "string" ? approver.kind : "any_human";
      const approverId =
        approver && typeof approver.id === "string" && approver.id.trim() ? approver.id.trim() : null;
      if (kind === "agent") {
        const agent = approverId ? input.agentsById[approverId] : undefined;
        if (!approverId || !agent) {
          warnings.push({
            ...anchor,
            code: "review_no_approver",
            message: `This approval step doesn't have anyone set to approve, so work will pile up here. Choose who approves.`,
          });
        } else if (!isAgentStatusInvokable(agent.status)) {
          warnings.push({
            ...anchor,
            code: "review_no_approver",
            message: `The approver for this step, ${agentLabel(agent)}, is paused right now, so nothing can be approved until they're active again.`,
          });
        }
      } else if (kind === "user" && !approverId) {
        warnings.push({
          ...anchor,
          code: "review_no_approver",
          message: `This approval step doesn't have anyone set to approve, so work will pile up here. Choose who approves.`,
        });
      }
    }

    // 4. Instructions that hand off to a pipeline / step that no longer exists.
    if (instructionsBody) {
      for (const mention of extractPipelineMentions(instructionsBody)) {
        const target = input.pipelinesById[mention.pipelineId];
        if (!target) {
          warnings.push({
            ...anchor,
            code: "missing_pipeline_reference",
            message: `These instructions point to a workflow that's been deleted, so this hand-off won't work. Update the link to an existing workflow.`,
          });
          continue;
        }
        if (mention.stageKey && !target.stages.some((s) => s.key === mention.stageKey)) {
          warnings.push({
            ...anchor,
            code: "missing_stage_reference",
            message: `These instructions point to a step that no longer exists in "${target.name}", so this hand-off won't work. Update the link to an existing step.`,
          });
        }
      }
    }

    // 5. Required details that were never filled in, so the step can't run.
    const variables = Array.isArray(config.variables) ? config.variables : [];
    for (const raw of variables) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const entry = raw as Record<string, unknown>;
      const name = readVariableName(entry);
      if (!name) continue;
      if (isRequired(entry) && !hasDefaultValue(entry)) {
        warnings.push({
          ...anchor,
          code: "unset_required_variable",
          message: `This step needs "${readVariableLabel(entry, name)}" filled in before it can run.`,
        });
      }
    }
  }

  return { pipelineId: input.pipelineId, warnings, ok: warnings.length === 0 };
}

/** Group a flat warning list by stage id — handy for rendering per-stage badges. */
export function groupWarningsByStage(
  warnings: PipelineHealthWarning[],
): Record<string, PipelineHealthWarning[]> {
  const byStage: Record<string, PipelineHealthWarning[]> = {};
  for (const warning of warnings) {
    (byStage[warning.stageId] ??= []).push(warning);
  }
  return byStage;
}
