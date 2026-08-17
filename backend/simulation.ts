import {
  createSdkMcpServer,
  tool,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
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

export const SIMULATION_REPORT_TOOL_NAME =
  "mcp__webui__publish_simulation_state";

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

const scenariosOutputSchema = {
  type: "array",
  minItems: 3,
  maxItems: 8,
  items: scenarioSchema,
};

const DESIGN_OUTPUT_FORMAT: NonNullable<Options["outputFormat"]> = {
  type: "json_schema",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["scenarios"],
    properties: {
      scenarios: {
        ...scenariosOutputSchema,
      },
    },
  },
};

const runResultSchema = {
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
};

const RUN_OUTPUT_FORMAT: NonNullable<Options["outputFormat"]> = {
  type: "json_schema",
  schema: runResultSchema,
};

const resultsOutputSchema = {
  type: "array",
  minItems: 1,
  maxItems: 8,
  items: runResultSchema,
};

const RUN_ALL_OUTPUT_FORMAT: NonNullable<Options["outputFormat"]> = {
  type: "json_schema",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        ...resultsOutputSchema,
      },
    },
  },
};

const DESIGN_AND_RUN_OUTPUT_FORMAT: NonNullable<Options["outputFormat"]> = {
  type: "json_schema",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["scenarios", "results"],
    properties: {
      scenarios: scenariosOutputSchema,
      results: resultsOutputSchema,
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
      result.transcript.length < 2
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

export function readSimulationLifecycleEvent(
  value: unknown,
): SimulationLifecycleEvent | undefined {
  const record = asRecord(value);
  if (record?.kind === "design_started") {
    return {
      kind: "design_started",
      ...(typeof record.runAfterDesign === "boolean"
        ? { runAfterDesign: record.runAfterDesign }
        : {}),
    };
  }

  if (record?.kind === "scenarios_generated") {
    if (
      !Array.isArray(record.scenarios) ||
      record.scenarios.length === 0 ||
      record.scenarios.length > 8
    ) {
      return;
    }
    const scenarios = record.scenarios.map(readScenario);
    return scenarios.every(Boolean) &&
      new Set(scenarios.map((scenario) => scenario?.id)).size ===
        scenarios.length
      ? {
          kind: "scenarios_generated",
          scenarios: scenarios as SimulationScenario[],
        }
      : undefined;
  }

  if (record?.kind === "run_started") {
    const scenarioIds = readStrings(record.scenarioIds);
    return scenarioIds && new Set(scenarioIds).size === scenarioIds.length
      ? { kind: "run_started", scenarioIds }
      : undefined;
  }

  if (record?.kind === "simulation_completed") {
    const result = readRunResult(record.result);
    return result ? { kind: "simulation_completed", result } : undefined;
  }

  if (record?.kind === "simulation_failed") {
    const error = readString(record, "error");
    return error ? { kind: "simulation_failed", error } : undefined;
  }
}

function describeSimulationLifecycleError(value: unknown): string {
  const record = asRecord(value);
  if (!record) return "root: expected an object";

  const kind = record.kind;
  if (typeof kind !== "string" || !kind.trim()) {
    return "kind: required non-empty string is missing";
  }

  if (kind === "design_started") {
    return typeof record.runAfterDesign === "undefined" ||
      typeof record.runAfterDesign === "boolean"
      ? "design_started payload is valid"
      : "runAfterDesign: expected boolean";
  }

  if (kind === "scenarios_generated") {
    if (!Array.isArray(record.scenarios)) {
      return "scenarios: required array is missing";
    }
    if (record.scenarios.length === 0) return "scenarios: must not be empty";
    if (record.scenarios.length > 8) {
      return "scenarios: must contain at most 8 items";
    }
    for (const [scenarioIndex, scenarioValue] of record.scenarios.entries()) {
      const scenario = asRecord(scenarioValue);
      if (!scenario) return `scenarios.${scenarioIndex}: expected an object`;
      for (const field of [
        "id",
        "title",
        "stage",
        "description",
        "persona",
        "objective",
      ]) {
        if (!readString(scenario, field)) {
          return `scenarios.${scenarioIndex}.${field}: required non-empty string is missing or exceeds 4000 characters`;
        }
      }
      if (!Array.isArray(scenario.cases)) {
        return `scenarios.${scenarioIndex}.cases: required array is missing`;
      }
      if (scenario.cases.length === 0 || scenario.cases.length > 8) {
        return `scenarios.${scenarioIndex}.cases: must contain between 1 and 8 items`;
      }
      for (const [caseIndex, caseValue] of scenario.cases.entries()) {
        const item = asRecord(caseValue);
        if (!item) {
          return `scenarios.${scenarioIndex}.cases.${caseIndex}: expected an object`;
        }
        for (const field of ["id", "title", "customerGoal", "openingMessage"]) {
          if (!readString(item, field)) {
            return `scenarios.${scenarioIndex}.cases.${caseIndex}.${field}: required non-empty string is missing or exceeds 4000 characters`;
          }
        }
        for (const field of ["expectedBehaviors", "passCriteria"]) {
          if (!readStrings(item[field])) {
            return `scenarios.${scenarioIndex}.cases.${caseIndex}.${field}: expected 1 to 8 non-empty strings`;
          }
        }
      }
    }
    return "scenarios_generated payload contains duplicate scenario or case IDs";
  }

  if (kind === "run_started") {
    if (!Array.isArray(record.scenarioIds)) {
      return "scenarioIds: required array is missing";
    }
    if (!readStrings(record.scenarioIds)) {
      return "scenarioIds: expected 1 to 8 non-empty strings";
    }
    return "scenarioIds: duplicate IDs are not allowed";
  }

  if (kind === "simulation_completed") {
    const result = asRecord(record.result);
    if (!result) return "result: required object is missing";
    for (const field of ["scenarioId", "summary"]) {
      if (!readString(result, field)) {
        return `result.${field}: required non-empty string is missing or exceeds 4000 characters`;
      }
    }
    if (!Array.isArray(result.cases)) {
      return "result.cases: required array is missing";
    }
    if (result.cases.length === 0 || result.cases.length > 8) {
      return "result.cases: must contain between 1 and 8 items";
    }
    for (const [caseIndex, caseValue] of result.cases.entries()) {
      const item = asRecord(caseValue);
      if (!item) return `result.cases.${caseIndex}: expected an object`;
      if (!readString(item, "caseId")) {
        return `result.cases.${caseIndex}.caseId: required non-empty string is missing or exceeds 4000 characters`;
      }
      if (!["passed", "partial", "failed"].includes(String(item.verdict))) {
        return `result.cases.${caseIndex}.verdict: expected one of passed, partial, failed`;
      }
      if (
        typeof item.score !== "number" ||
        item.score < 0 ||
        item.score > 100
      ) {
        return `result.cases.${caseIndex}.score: expected a number between 0 and 100`;
      }
      if (!readString(item, "evaluation")) {
        return `result.cases.${caseIndex}.evaluation: required non-empty string is missing or exceeds 4000 characters`;
      }
      if (!Array.isArray(item.transcript)) {
        return `result.cases.${caseIndex}.transcript: required array is missing`;
      }
      if (item.transcript.length < 2) {
        return `result.cases.${caseIndex}.transcript: must contain at least 2 turns`;
      }
      for (const [turnIndex, turnValue] of item.transcript.entries()) {
        const turn = asRecord(turnValue);
        if (!turn) {
          return `result.cases.${caseIndex}.transcript.${turnIndex}: expected an object`;
        }
        if (turn.role !== "customer" && turn.role !== "sales") {
          return `result.cases.${caseIndex}.transcript.${turnIndex}.role: expected customer or sales`;
        }
        if (!readString(turn, "content")) {
          return `result.cases.${caseIndex}.transcript.${turnIndex}.content: required non-empty string is missing or exceeds 4000 characters`;
        }
      }
      for (const field of ["strengths", "issues"]) {
        if (!readStrings(item[field], true)) {
          return `result.cases.${caseIndex}.${field}: expected at most 8 non-empty strings`;
        }
      }
    }
    return "result: invalid simulation result";
  }

  return `kind: unsupported simulation lifecycle event ${JSON.stringify(kind)}`;
}

export function validateSimulationLifecycleEvent(
  value: unknown,
):
  { ok: true; event: SimulationLifecycleEvent } | { ok: false; error: string } {
  const event = readSimulationLifecycleEvent(value);
  return event
    ? { ok: true, event }
    : { ok: false, error: describeSimulationLifecycleError(value) };
}

export function createSimulationReporter(
  onEvent: (event: SimulationLifecycleEvent) => string | undefined,
) {
  return createSdkMcpServer({
    name: "webui",
    version: "1.0.0",
    alwaysLoad: true,
    tools: [
      tool(
        "publish_simulation_state",
        "Publish live simulation UI state. Call design_started before design; scenarios_generated with scenarios containing id, title, stage, description, persona, objective and cases (id, title, customerGoal, openingMessage, expectedBehaviors, passCriteria); run_started with all scenarioIds before execution; and simulation_completed per scenario with result containing scenarioId, summary and cases (caseId, verdict, score, transcript, evaluation, strengths, issues).",
        {
          kind: z.enum([
            "design_started",
            "scenarios_generated",
            "run_started",
            "simulation_completed",
          ]),
          runAfterDesign: z.boolean().optional(),
          scenarios: z.array(z.unknown()).optional(),
          scenarioIds: z.array(z.string()).optional(),
          result: z.unknown().optional(),
        },
        async (input) => {
          const validation = validateSimulationLifecycleEvent(input);
          if (!validation.ok) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `Invalid simulation state: ${validation.error}. Correct this field and call publish_simulation_state again with the same lifecycle event.`,
                },
              ],
            };
          }
          const rejection = onEvent(validation.event);
          if (rejection) {
            return {
              isError: true,
              content: [{ type: "text", text: rejection }],
            };
          }
          return {
            content: [{ type: "text", text: "Simulation state published" }],
          };
        },
        { alwaysLoad: true },
      ),
    ],
  });
}

const SIMULATION_REQUEST =
  /(?:生成|设计|重新设计|开始(?:进行)?|启动|执行|并行|跑(?:一下|一遍|这些|全部)?|重新模拟|重新测试|重考|重测|generate|design|start|run|execute|rerun|retest)/i;
const SIMULATION_SUBJECT =
  /(?:模拟测试|模拟场景|测试场景|场景|case|cases|用例|陪练|重考|重测|simulation|scenario|test)/i;
const EXPLANATION_REQUEST =
  /^(?:请)?(?:解释|说明|介绍|告诉我|为什么|为何|怎么|如何|能否|是否|可以吗|有没有)/i;
const DESIGN_REQUEST = /(?:生成|设计|generate|design)/i;
const DESIGN_ONLY_REQUEST =
  /(?:只(?:要|需|生成|设计)|仅(?:生成|设计)|不(?:要|用|必|再)?(?:开始|启动|执行|运行|跑)(?:模拟)?测试|先(?:生成|设计)(?:场景|测试))/i;
const RUN_AFTER_DESIGN_REQUEST =
  /(?:并(?:且|马上|直接|行)?(?:开始|启动|执行|运行|跑|测试|模拟|重考|重测)|然后(?:开始|启动|执行|运行|跑|测试|模拟|重考|重测)|生成[\s\S]{0,30}(?:开始|启动|执行|运行|跑|测试|模拟|重考|重测)|设计[\s\S]{0,30}(?:开始|启动|执行|运行|跑|测试|模拟|重考|重测))/i;
const NEGATED_DESIGN_REQUEST =
  /不(?:要|用|必|想|再)?(?:生成|设计)(?:模拟测试|模拟场景|测试场景|场景|case|cases|用例)/i;
const QUESTION_REQUEST =
  /(?:为什么|为何|怎么回事|如何实现|能否|是否|可以吗|有没有|是什么|啥是|研究一下|检查一下|确认一下)/i;

export function inferSimulationCommand(
  message: string,
): SimulationCommand | undefined {
  const normalized = message.trim();
  if (
    !normalized ||
    EXPLANATION_REQUEST.test(normalized) ||
    QUESTION_REQUEST.test(normalized) ||
    NEGATED_DESIGN_REQUEST.test(normalized) ||
    !SIMULATION_REQUEST.test(normalized) ||
    !SIMULATION_SUBJECT.test(normalized)
  ) {
    return;
  }
  const startsWith = DESIGN_REQUEST.test(normalized) ? "design" : "run";
  return {
    action: "orchestrate",
    startsWith,
    runAfterDesign:
      startsWith === "run" ||
      (!DESIGN_ONLY_REQUEST.test(normalized) &&
        RUN_AFTER_DESIGN_REQUEST.test(normalized)),
  };
}

export function readSimulationCommand(
  value: unknown,
): SimulationCommand | undefined {
  const record = asRecord(value);
  if (
    record?.action === "orchestrate" &&
    (record.startsWith === "design" || record.startsWith === "run") &&
    typeof record.runAfterDesign === "boolean"
  ) {
    return {
      action: "orchestrate",
      startsWith: record.startsWith,
      runAfterDesign: record.runAfterDesign,
    };
  }
  if (record?.action === "design") return { action: "design" };
  if (record?.action === "run") {
    const scenario = readScenario(record.scenario);
    return scenario ? { action: "run", scenario } : undefined;
  }
  if (
    record?.action !== "run_all" ||
    !Array.isArray(record.scenarios) ||
    record.scenarios.length === 0 ||
    record.scenarios.length > 8
  ) {
    return;
  }
  const scenarios = record.scenarios.map(readScenario);
  return scenarios.every(Boolean) &&
    new Set(scenarios.map((scenario) => scenario?.id)).size === scenarios.length
    ? { action: "run_all", scenarios: scenarios as SimulationScenario[] }
    : undefined;
}

export function simulationOutputFormat(
  command: SimulationCommand,
): NonNullable<Options["outputFormat"]> {
  if (command.action === "orchestrate") {
    if (command.startsWith === "design") {
      return command.runAfterDesign
        ? DESIGN_AND_RUN_OUTPUT_FORMAT
        : DESIGN_OUTPUT_FORMAT;
    }
    return RUN_ALL_OUTPUT_FORMAT;
  }
  return command.action === "design"
    ? DESIGN_OUTPUT_FORMAT
    : command.action === "run_all"
      ? RUN_ALL_OUTPUT_FORMAT
      : RUN_OUTPUT_FORMAT;
}

export function simulationSystemPrompt(command: SimulationCommand): string {
  if (command.action === "orchestrate") {
    return `你正在当前 Builder 主会话中执行用户刚刚要求的模拟测试工作流。平台已把本句解析为：起始阶段=${command.startsWith === "design" ? "设计场景" : "测试已有场景"}，生成后继续测试=${command.runAfterDesign ? "是" : "否"}。这是确定的执行参数，不要重新解释用户意图。禁止调用 Skill、Bash，禁止改走 training-ground，也禁止创建新的顶层会话。只能按以下协议工作：
1. 如果起始阶段是设计场景，第一步必须调用 mcp__webui__publish_simulation_state 上报 design_started，并带 runAfterDesign=${command.runAfterDesign}；然后只调用 fde-suite:fde-scenario-designer 生成 3-6 个场景、每场景 2-5 个 Case；返回后立即调用上报工具发送 scenarios_generated 和完整 scenarios。
2. ${command.runAfterDesign ? "必须继续测试：场景生成后立即在本次主会话中执行；如果起始阶段是测试已有场景，则采用当前会话最近一次完整场景列表。测试开始前调用上报工具发送 run_started 和全部 scenarioIds。" : "场景上报完成后结束本次工作，不得开始测试。"}
3. 每个 Case 都新建 fde-suite:fde-customer-simulator、fde-suite:fde-business-agent、fde-suite:fde-evaluator 三个隔离角色。客户不可见评分标准；业务 Agent 不可见 expectedBehaviors、passCriteria 或考官信息；考官只在对话结束后判分。测试阶段必须跨全部场景按角色波次并行：先在同一条 assistant 消息中同时启动所有场景、所有 Case 的客户 Agent；收齐后再在同一条消息中同时启动全部业务 Agent；最后同样并行启动全部考官 Agent。禁止完成一个场景后再开始下一个场景。
4. 每完成一个场景，立即调用上报工具发送 simulation_completed 和该场景完整 result；不得只把场景或结果写在聊天正文中。所有失败与改进项留在当前 Builder 会话，供下一轮完善 Skill。
最终必须严格按 outputFormat 返回完整结构；主 Agent 只调度、转递和汇总，不自行扮演客户、销售或考官。`;
  }
  if (command.action === "design") {
    return `你正在执行“模拟测试/生成场景”平台工作流。先调用 mcp__webui__publish_simulation_state 上报 design_started。主 Agent 只负责调度和整理结构，禁止使用 Bash、Read、Glob、Grep、Skill 或任何非 Agent 工具。必须同步调用且只调用 fde-suite:fde-scenario-designer，不得由主 Agent 自己设计，也不得回退到 general-purpose；无需预先探查目录，把当前工作目录和“只读当前角色挂载的商家业务资料”的边界直接交给该子 Agent。让它设计 3-6 个覆盖售前咨询、需求澄清、方案推荐、异议处理、讨价还价、成交收口、售后边界等阶段的场景；每个场景包含 2-5 个具体 Case。不要虚构业务承诺。子 Agent 返回后，只做结构校验与字段整理，调用 mcp__webui__publish_simulation_state 上报 scenarios_generated 和完整场景列表，最终严格按 outputFormat 返回。场景内容将展示给当前搭建者。`;
  }

  const scenarios =
    command.action === "run_all" ? command.scenarios : [command.scenario];
  const parallel = command.action === "run_all";
  return `你正在当前 Builder 主会话中执行“模拟测试”工作流。场景数据如下：\n${JSON.stringify(scenarios)}\n先调用 mcp__webui__publish_simulation_state 上报 run_started 和全部 scenarioIds。任何角色不可回退到 general-purpose。${parallel ? "所有场景必须并行推进：每一波的全部 Agent 调用必须在同一条 assistant 消息中同时发出，不得逐个等待。" : "同一场景的 Case 也按波次并行推进。"}\n第一波：为每个 Case 新建 fde-suite:fde-customer-simulator，只给 persona、customerGoal 和 openingMessage，让它输出自然客户问题；不得给评分规则。\n第二波：取得第一波结果后，为每个 Case 新建 fde-suite:fde-business-agent，只给客户原话，让它依据当前角色挂载的商家业务 Skill 和授权资料回答；绝对不得给 expectedBehaviors、passCriteria 或考官信息。\n第三波：取得第二波结果后，为每个 Case 新建 fde-suite:fde-evaluator，给它该 Case、客户与销售的纯对话，让它独立判断。\n每个 Case 必须使用全新的三名 Agent。主 Agent 不得代替任何角色发言或判分，只负责原样转递和汇总。每完成一个场景就调用 mcp__webui__publish_simulation_state 上报一次 simulation_completed。最终严格按 outputFormat 返回 transcript、verdict、score、evaluation、strengths、issues；${parallel ? "results 必须逐一覆盖输入的全部 scenarioId，不能遗漏或新增。" : `scenarioId 必须为 ${JSON.stringify(scenarios[0]?.id)}。`}所有不合格项会保留在当前 Builder 会话中，供下一轮完善业务 Skill。`;
}

export function projectSimulationEvents(
  command: SimulationCommand,
  message: SDKMessage,
): SimulationLifecycleEvent[] {
  const record = asRecord(message);
  if (
    record?.type !== "result" ||
    record.subtype !== "success" ||
    record.structured_output === undefined
  ) {
    return [];
  }

  if (
    command.action === "design" ||
    (command.action === "orchestrate" &&
      command.startsWith === "design" &&
      !command.runAfterDesign)
  ) {
    const scenarios = readScenariosOutput(record.structured_output);
    return scenarios ? [{ kind: "scenarios_generated", scenarios }] : [];
  }

  if (
    command.action === "orchestrate" &&
    command.startsWith === "design" &&
    command.runAfterDesign
  ) {
    const output = asRecord(record.structured_output);
    const scenarios = readScenariosOutput(record.structured_output);
    const results = readResultsOutput(output?.results);
    if (!scenarios || !results || !resultsMatchScenarios(results, scenarios)) {
      return [];
    }
    return [
      { kind: "scenarios_generated", scenarios },
      { kind: "run_started", scenarioIds: scenarios.map(({ id }) => id) },
      { kind: "simulation_batch_completed", results },
    ];
  }

  if (
    command.action === "run_all" ||
    (command.action === "orchestrate" && command.startsWith === "run")
  ) {
    const output = asRecord(record.structured_output);
    const results = readResultsOutput(output?.results);
    if (!results) return [];
    if (
      command.action === "run_all" &&
      !resultsMatchScenarios(results, command.scenarios)
    ) {
      return [];
    }
    return [
      {
        kind: "run_started",
        scenarioIds: results.map((result) => result.scenarioId),
      },
      { kind: "simulation_batch_completed", results },
    ];
  }

  if (command.action !== "run") return [];
  const result = readRunResult(record.structured_output);
  return result && resultsMatchScenarios([result], [command.scenario])
    ? [{ kind: "simulation_completed", result }]
    : [];
}

export function projectSimulationEvent(
  command: SimulationCommand,
  message: SDKMessage,
): SimulationLifecycleEvent | undefined {
  return projectSimulationEvents(command, message)[0];
}

export class SimulationLifecycleTracker {
  private scenarios = new Map<string, SimulationScenario>();
  private runIds = new Set<string>();
  private completedIds = new Set<string>();

  constructor(private readonly command: SimulationCommand) {}

  accept(event: SimulationLifecycleEvent): string | undefined {
    if (event.kind === "simulation_failed" || event.kind === "design_started") {
      return;
    }
    if (event.kind === "scenarios_generated") {
      this.scenarios = new Map(
        event.scenarios.map((scenario) => [scenario.id, scenario]),
      );
      return;
    }
    if (event.kind === "run_started") {
      const expected = this.expectedScenarioIds();
      if (expected && !sameIds(expected, event.scenarioIds)) {
        return "run_started 的场景列表与本次模拟请求不一致";
      }
      this.runIds = new Set(event.scenarioIds);
      return;
    }

    const results =
      event.kind === "simulation_batch_completed"
        ? event.results
        : [event.result];
    for (const result of results) {
      if (!this.runIds.has(result.scenarioId)) {
        return `场景 ${result.scenarioId} 尚未上报 run_started`;
      }
      const scenario =
        this.scenarios.get(result.scenarioId) ??
        this.explicitScenario(result.scenarioId);
      if (scenario && !resultsMatchScenarios([result], [scenario])) {
        return `场景 ${result.scenarioId} 的 Case 结果不完整`;
      }
      this.completedIds.add(result.scenarioId);
    }
  }

  incompleteReason(): string | undefined {
    const needsDesign =
      this.command.action === "design" ||
      (this.command.action === "orchestrate" &&
        this.command.startsWith === "design");
    if (needsDesign && !this.scenarios.size) {
      return "Agent 未上报生成的模拟测试场景";
    }

    const needsRun =
      this.command.action === "run" ||
      this.command.action === "run_all" ||
      (this.command.action === "orchestrate" && this.command.runAfterDesign);
    if (!needsRun) return;
    if (!this.runIds.size) return "Agent 未上报模拟测试开始状态";
    const missing = [...this.runIds].filter((id) => !this.completedIds.has(id));
    return missing.length
      ? `Agent 未返回完整模拟结果：${missing.join(", ")}`
      : undefined;
  }

  private expectedScenarioIds(): string[] | undefined {
    if (this.command.action === "run") return [this.command.scenario.id];
    if (this.command.action === "run_all") {
      return this.command.scenarios.map(({ id }) => id);
    }
    if (this.scenarios.size) return [...this.scenarios.keys()];
  }

  private explicitScenario(id: string): SimulationScenario | undefined {
    if (this.command.action === "run") {
      return this.command.scenario.id === id
        ? this.command.scenario
        : undefined;
    }
    if (this.command.action === "run_all") {
      return this.command.scenarios.find((scenario) => scenario.id === id);
    }
  }
}

function readScenariosOutput(value: unknown): SimulationScenario[] | undefined {
  const output = asRecord(value);
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
    new Set(scenarios.map((scenario) => scenario?.id)).size === scenarios.length
    ? (scenarios as SimulationScenario[])
    : undefined;
}

function readResultsOutput(value: unknown): SimulationRunResult[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) return;
  const results = value.map(readRunResult);
  return results.every(Boolean) &&
    new Set(results.map((result) => result?.scenarioId)).size === results.length
    ? (results as SimulationRunResult[])
    : undefined;
}

function resultsMatchScenarios(
  results: SimulationRunResult[],
  scenarios: SimulationScenario[],
): boolean {
  if (results.length !== scenarios.length) return false;
  const expected = new Map(
    scenarios.map((scenario) => [scenario.id, scenario]),
  );
  for (const result of results) {
    const scenario = expected.get(result.scenarioId);
    if (!scenario) return false;
    const caseIds = new Set(scenario.cases.map((item) => item.id));
    if (
      result.cases.length !== caseIds.size ||
      !result.cases.every((item) => caseIds.delete(item.caseId)) ||
      caseIds.size !== 0
    ) {
      return false;
    }
    expected.delete(result.scenarioId);
  }
  return expected.size === 0;
}

function sameIds(expected: string[], actual: string[]): boolean {
  return (
    expected.length === actual.length &&
    expected.every((id) => actual.includes(id))
  );
}
