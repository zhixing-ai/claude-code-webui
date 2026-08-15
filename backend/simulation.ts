import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  SimulationCase,
  SimulationCommand,
  SimulationLifecycleEvent,
  SimulationRunResult,
  SimulationScenario,
  SimulationTurn,
  SimulationVerdict,
} from "../shared/types.ts";

type UnknownRecord = Record<string, unknown>;

const stringArraySchema = {
  type: "array",
  minItems: 1,
  maxItems: 8,
  items: { type: "string" },
};

const caseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "title",
    "customerGoal",
    "openingMessage",
    "expectedBehaviors",
    "passCriteria",
  ],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    customerGoal: { type: "string" },
    openingMessage: { type: "string" },
    expectedBehaviors: stringArraySchema,
    passCriteria: stringArraySchema,
  },
};

const scenarioSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "title",
    "stage",
    "description",
    "persona",
    "objective",
    "cases",
  ],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    stage: { type: "string" },
    description: { type: "string" },
    persona: { type: "string" },
    objective: { type: "string" },
    cases: {
      type: "array",
      minItems: 2,
      maxItems: 8,
      items: caseSchema,
    },
  },
};

const DESIGN_OUTPUT_FORMAT: NonNullable<Options["outputFormat"]> = {
  type: "json_schema",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["scenarios"],
    properties: {
      scenarios: {
        type: "array",
        minItems: 3,
        maxItems: 8,
        items: scenarioSchema,
      },
    },
  },
};

const RUN_OUTPUT_FORMAT: NonNullable<Options["outputFormat"]> = {
  type: "json_schema",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["scenarioId", "summary", "cases"],
    properties: {
      scenarioId: { type: "string" },
      summary: { type: "string" },
      cases: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "caseId",
            "verdict",
            "score",
            "transcript",
            "evaluation",
            "strengths",
            "issues",
          ],
          properties: {
            caseId: { type: "string" },
            verdict: { enum: ["passed", "partial", "failed"] },
            score: { type: "integer", minimum: 0, maximum: 100 },
            transcript: {
              type: "array",
              minItems: 2,
              maxItems: 8,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["role", "content"],
                properties: {
                  role: { enum: ["customer", "sales"] },
                  content: { type: "string" },
                },
              },
            },
            evaluation: { type: "string" },
            strengths: { type: "array", items: { type: "string" } },
            issues: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  },
};

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function readString(record: UnknownRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() && value.length <= 4_000
    ? value
    : undefined;
}

function readStrings(value: unknown, allowEmpty = false): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length > 8 ||
    (!allowEmpty && value.length === 0)
  ) {
    return;
  }
  return value.every(
    (item) => typeof item === "string" && item.trim() && item.length <= 4_000,
  )
    ? value
    : undefined;
}

function readCase(value: unknown): SimulationCase | undefined {
  const record = asRecord(value);
  if (!record) return;
  const id = readString(record, "id");
  const title = readString(record, "title");
  const customerGoal = readString(record, "customerGoal");
  const openingMessage = readString(record, "openingMessage");
  const expectedBehaviors = readStrings(record.expectedBehaviors);
  const passCriteria = readStrings(record.passCriteria);
  if (
    !id ||
    !title ||
    !customerGoal ||
    !openingMessage ||
    !expectedBehaviors ||
    !passCriteria
  ) {
    return;
  }
  return {
    id,
    title,
    customerGoal,
    openingMessage,
    expectedBehaviors,
    passCriteria,
  };
}

function readScenario(value: unknown): SimulationScenario | undefined {
  const record = asRecord(value);
  if (
    !record ||
    !Array.isArray(record.cases) ||
    record.cases.length === 0 ||
    record.cases.length > 8
  ) {
    return;
  }
  const id = readString(record, "id");
  const title = readString(record, "title");
  const stage = readString(record, "stage");
  const description = readString(record, "description");
  const persona = readString(record, "persona");
  const objective = readString(record, "objective");
  const cases = record.cases.map(readCase);
  if (
    !id ||
    !title ||
    !stage ||
    !description ||
    !persona ||
    !objective ||
    cases.some((item) => !item) ||
    new Set(cases.map((item) => item?.id)).size !== cases.length
  ) {
    return;
  }
  return {
    id,
    title,
    stage,
    description,
    persona,
    objective,
    cases: cases as SimulationCase[],
  };
}

function readTurn(value: unknown): SimulationTurn | undefined {
  const record = asRecord(value);
  if (!record) return;
  const role = record.role;
  const content = readString(record, "content");
  return (role === "customer" || role === "sales") && content
    ? { role, content }
    : undefined;
}

function readRunResult(value: unknown): SimulationRunResult | undefined {
  const record = asRecord(value);
  if (
    !record ||
    !Array.isArray(record.cases) ||
    record.cases.length === 0 ||
    record.cases.length > 8
  ) {
    return;
  }
  const scenarioId = readString(record, "scenarioId");
  const summary = readString(record, "summary");
  const cases = record.cases.map((item) => {
    const result = asRecord(item);
    if (
      !result ||
      !Array.isArray(result.transcript) ||
      result.transcript.length < 2 ||
      result.transcript.length > 8
    ) {
      return;
    }
    const caseId = readString(result, "caseId");
    const verdict = result.verdict as SimulationVerdict;
    const score = result.score;
    const evaluation = readString(result, "evaluation");
    const transcript = result.transcript.map(readTurn);
    const strengths = readStrings(result.strengths, true);
    const issues = readStrings(result.issues, true);
    if (
      !caseId ||
      !["passed", "partial", "failed"].includes(verdict) ||
      typeof score !== "number" ||
      score < 0 ||
      score > 100 ||
      !evaluation ||
      transcript.some((turn) => !turn) ||
      !strengths ||
      !issues
    ) {
      return;
    }
    return {
      caseId,
      verdict,
      score,
      evaluation,
      transcript: transcript as SimulationTurn[],
      strengths,
      issues,
    };
  });
  return scenarioId && summary && cases.every(Boolean)
    ? { scenarioId, summary, cases: cases as SimulationRunResult["cases"] }
    : undefined;
}

export function readSimulationCommand(
  value: unknown,
): SimulationCommand | undefined {
  const record = asRecord(value);
  if (record?.action === "design") return { action: "design" };
  if (record?.action !== "run") return;
  const scenario = readScenario(record.scenario);
  return scenario ? { action: "run", scenario } : undefined;
}

export function simulationOutputFormat(
  command: SimulationCommand,
): NonNullable<Options["outputFormat"]> {
  return command.action === "design" ? DESIGN_OUTPUT_FORMAT : RUN_OUTPUT_FORMAT;
}

export function simulationSystemPrompt(command: SimulationCommand): string {
  if (command.action === "design") {
    return `你正在执行“模拟测试/生成场景”平台工作流。主 Agent 只负责调度和整理结构，禁止使用 Bash、Read、Glob、Grep、Skill 或任何非 Agent 工具。必须同步调用且只调用 fde-scenario-designer，不得由主 Agent 自己设计，也不得回退到 general-purpose；无需预先探查目录，把当前工作目录和“只读获授权商家业务资料”的边界直接交给该子 Agent。让它设计 3-6 个覆盖售前咨询、需求澄清、方案推荐、异议处理、讨价还价、成交收口、售后边界等阶段的场景；每个场景包含 2-5 个具体 Case。不要读取其他商家的资料，不要虚构业务承诺。子 Agent 返回后，只做结构校验与字段整理，最终严格按 outputFormat 返回。场景内容将展示给当前搭建者。`;
  }

  return `你正在执行“模拟测试/运行场景”平台工作流。所选场景数据如下：\n${JSON.stringify(command.scenario)}\n逐个 Case 串行执行，任何角色不可回退到 general-purpose：\n1. 新建 fde-customer-simulator，同步运行，只给它 persona、customerGoal 和 openingMessage，让它输出自然客户问题；不得给评分规则。\n2. 新建 fde-business-agent，同步运行，只给它客户原话，并让它依据当前工作目录中的商家业务 Skill 和授权资料回答；绝对不得给 expectedBehaviors、passCriteria 或考官信息。\n3. 新建 fde-evaluator，同步运行，给它该 Case、客户与销售的纯对话，让它独立判断。\n每个 Case 必须使用全新的三名 Agent。主 Agent 不得代替任何角色发言或判分，只负责原样转递和汇总。最终严格按 outputFormat 返回所有 Case 的 transcript、verdict、score、evaluation、strengths、issues；scenarioId 必须为 ${JSON.stringify(command.scenario.id)}。`;
}

export function projectSimulationEvent(
  command: SimulationCommand,
  message: SDKMessage,
): SimulationLifecycleEvent | undefined {
  const record = asRecord(message);
  if (
    record?.type !== "result" ||
    record.subtype !== "success" ||
    record.structured_output === undefined
  ) {
    return;
  }
  if (command.action === "design") {
    const output = asRecord(record.structured_output);
    if (
      !output ||
      !Array.isArray(output.scenarios) ||
      output.scenarios.length === 0 ||
      output.scenarios.length > 8
    ) {
      return;
    }
    const scenarios = output.scenarios.map(readScenario);
    return scenarios.every(Boolean) &&
      new Set(scenarios.map((scenario) => scenario?.id)).size ===
        scenarios.length
      ? {
          kind: "scenarios_generated",
          scenarios: scenarios as SimulationScenario[],
        }
      : undefined;
  }
  const result = readRunResult(record.structured_output);
  const expectedCases = new Set(command.scenario.cases.map((item) => item.id));
  return result &&
    result.scenarioId === command.scenario.id &&
    result.cases.length === expectedCases.size &&
    result.cases.every((item) => expectedCases.delete(item.caseId)) &&
    expectedCases.size === 0
    ? { kind: "simulation_completed", result }
    : undefined;
}
