import { describe, expect, it } from "vitest";
import {
  buildPipelineMentionHref,
  computePipelineHealth,
  groupWarningsByStage,
  type PipelineHealthInput,
  type PipelineHealthStageInput,
} from "./index.js";

const AGENTS = {
  active: { id: "agent-active", name: "Casey", status: "active" },
  paused: { id: "agent-paused", name: "Robin", status: "paused" },
};

function baseInput(stages: PipelineHealthStageInput[], overrides: Partial<PipelineHealthInput> = {}): PipelineHealthInput {
  return {
    pipelineId: "pipeline-1",
    stages,
    agentsById: { [AGENTS.active.id]: AGENTS.active, [AGENTS.paused.id]: AGENTS.paused },
    pipelinesById: {
      "pipeline-1": { id: "pipeline-1", name: "Content", stages: [{ key: "drafting", name: "Drafting" }] },
      "pipeline-2": {
        id: "pipeline-2",
        name: "Content Production",
        stages: [{ key: "assets", name: "Assets" }],
      },
    },
    ...overrides,
  };
}

function stage(partial: Partial<PipelineHealthStageInput>): PipelineHealthStageInput {
  return {
    id: "stage-1",
    key: "intake",
    name: "Intake",
    kind: "open",
    config: {},
    instructionsBody: "",
    ...partial,
  };
}

describe("computePipelineHealth", () => {
  it("returns ok with no warnings for a clean stage", () => {
    const report = computePipelineHealth(
      baseInput([stage({ config: { assigneeAgentId: AGENTS.active.id }, instructionsBody: "Do the thing." })]),
    );
    expect(report.ok).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  it("warns when the assigned teammate is paused", () => {
    const report = computePipelineHealth(
      baseInput([stage({ config: { assigneeAgentId: AGENTS.paused.id }, instructionsBody: "Go." })]),
    );
    const codes = report.warnings.map((w) => w.code);
    expect(codes).toContain("paused_agent");
    expect(report.warnings[0]?.message).toContain("Robin");
    expect(report.warnings[0]?.message).not.toMatch(/routine|dispatch|JWT|invokable/i);
  });

  it("warns when the assigned teammate no longer exists", () => {
    const report = computePipelineHealth(
      baseInput([stage({ config: { assigneeAgentId: "ghost" }, instructionsBody: "Go." })]),
    );
    expect(report.warnings.map((w) => w.code)).toContain("paused_agent");
  });

  it("warns when a teammate is assigned but there are no instructions", () => {
    const report = computePipelineHealth(
      baseInput([stage({ config: { assigneeAgentId: AGENTS.active.id }, instructionsBody: "" })]),
    );
    expect(report.warnings.map((w) => w.code)).toContain("automation_no_instructions");
  });

  it("warns when a review stage has no approver set", () => {
    const report = computePipelineHealth(
      baseInput([
        stage({ kind: "review", config: { requireApproval: true, approver: { kind: "agent" } } }),
      ]),
    );
    expect(report.warnings.map((w) => w.code)).toContain("review_no_approver");
  });

  it("warns when the review approver agent is paused", () => {
    const report = computePipelineHealth(
      baseInput([
        stage({ kind: "review", config: { requireApproval: true, approver: { kind: "agent", id: AGENTS.paused.id } } }),
      ]),
    );
    const warning = report.warnings.find((w) => w.code === "review_no_approver");
    expect(warning?.message).toContain("Robin");
  });

  it("does not warn for an any_human review stage", () => {
    const report = computePipelineHealth(
      baseInput([stage({ kind: "review", config: { requireApproval: true, approver: { kind: "any_human" } } })]),
    );
    expect(report.warnings).toEqual([]);
  });

  it("warns when instructions reference a missing pipeline", () => {
    const href = buildPipelineMentionHref("pipeline-gone");
    const report = computePipelineHealth(
      baseInput([stage({ instructionsBody: `Create cases in [Gone](${href}).` })]),
    );
    expect(report.warnings.map((w) => w.code)).toContain("missing_pipeline_reference");
  });

  it("warns when instructions reference a missing stage of a real pipeline", () => {
    const href = buildPipelineMentionHref("pipeline-2", "no-such-stage");
    const report = computePipelineHealth(
      baseInput([stage({ instructionsBody: `Hand off to [Prod](${href}).` })]),
    );
    expect(report.warnings.map((w) => w.code)).toContain("missing_stage_reference");
  });

  it("does not warn for a valid pipeline + stage reference", () => {
    const href = buildPipelineMentionHref("pipeline-2", "assets");
    const report = computePipelineHealth(
      baseInput([stage({ instructionsBody: `Hand off to [Prod](${href}).` })]),
    );
    expect(report.warnings).toEqual([]);
  });

  it("warns when a required variable has no default value", () => {
    const report = computePipelineHealth(
      baseInput([
        stage({
          config: {
            variables: [
              { name: "release_notes", label: "Release notes", required: true, defaultValue: null },
              { name: "channel", label: "Channel", required: false },
            ],
          },
        }),
      ]),
    );
    const warning = report.warnings.find((w) => w.code === "unset_required_variable");
    expect(warning?.message).toContain("Release notes");
    // The optional variable does not warn.
    expect(report.warnings.filter((w) => w.code === "unset_required_variable")).toHaveLength(1);
  });

  it("accepts the legacy { key } variable shape", () => {
    const report = computePipelineHealth(
      baseInput([stage({ config: { variables: [{ key: "topic", required: true }] } })]),
    );
    expect(report.warnings.find((w) => w.code === "unset_required_variable")?.message).toContain("topic");
  });

  it("groups warnings by stage", () => {
    const report = computePipelineHealth(
      baseInput([
        stage({ id: "s1", config: { assigneeAgentId: AGENTS.paused.id }, instructionsBody: "Go." }),
        stage({ id: "s2", key: "review", kind: "review", config: { requireApproval: true, approver: { kind: "agent" } } }),
      ]),
    );
    const grouped = groupWarningsByStage(report.warnings);
    expect(Object.keys(grouped).sort()).toEqual(["s1", "s2"]);
  });
});
