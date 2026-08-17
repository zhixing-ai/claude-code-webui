import {
  ChevronDownIcon,
  CheckIcon,
  CpuChipIcon,
  InformationCircleIcon,
  LightBulbIcon,
} from "@heroicons/react/24/outline";
import { useState } from "react";
import type { ClaudeTask } from "../../utils/taskProjection";
import type { AgentRun } from "../../utils/agentProjection";
import type {
  SimulationCase,
  SimulationCaseResult,
  SimulationScenario,
} from "../../types";
import { SimulationPanel, type SimulationPanelState } from "./SimulationPanel";

interface TaskSidebarProps {
  tasks: ClaudeTask[];
  agents: AgentRun[];
  isLoading: boolean;
  simulation: SimulationPanelState;
  onGenerateScenarios: () => void;
  onRunScenario: (scenario: SimulationScenario) => void;
  onRunAllScenarios: (scenarios: SimulationScenario[]) => void;
  onEscalateCase?: (
    scenario: SimulationScenario,
    testCase: SimulationCase,
    result: SimulationCaseResult,
  ) => void;
}

export function TaskSidebar({
  tasks,
  agents,
  isLoading,
  simulation,
  onGenerateScenarios,
  onRunScenario,
  onRunAllScenarios,
  onEscalateCase,
}: TaskSidebarProps) {
  const [view, setView] = useState<"tasks" | "agents" | "simulation">("tasks");
  const completed = tasks.filter((task) => task.status === "completed").length;
  const percent = tasks.length
    ? Math.round((completed / tasks.length) * 100)
    : 0;
  const current = tasks.find((task) => task.status === "in_progress");
  const activeAgents = agents.filter((agent) =>
    ["queued", "running", "waiting"].includes(agent.status),
  ).length;
  const completedAgents = agents.filter(
    (agent) => agent.status === "completed",
  ).length;

  return (
    <aside
      aria-label="Build control"
      className="hidden min-h-0 w-[320px] shrink-0 flex-col overflow-hidden rounded-2xl bg-[var(--surface-panel)] shadow-[0_2px_12px_rgba(15,23,42,0.08)] ring-1 ring-[var(--border-subtle)] lg:flex 2xl:w-[360px]"
    >
      <div className="shrink-0 border-b border-[var(--border-subtle)] px-5 pt-5 pb-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[13px] font-semibold">Build control</h2>
          {isLoading && tasks.length === 0 && (
            <span
              className="size-3.5 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--text-primary)] motion-reduce:animate-none"
              aria-label="Preparing tasks"
            />
          )}
        </div>
        <div
          className="mt-3 grid grid-cols-3 rounded-lg bg-[var(--surface-muted)] p-1"
          aria-label="Build control view"
        >
          <SidebarTab
            active={view === "tasks"}
            label="流程"
            count={tasks.length}
            onClick={() => setView("tasks")}
          />
          <SidebarTab
            active={view === "agents"}
            label="Agents"
            count={activeAgents || agents.length}
            pulse={activeAgents > 0}
            onClick={() => setView("agents")}
          />
          <SidebarTab
            active={view === "simulation"}
            label="模拟测试"
            count={simulation.scenarios.length}
            pulse={
              simulation.status === "designing" ||
              simulation.status === "running"
            }
            onClick={() => setView("simulation")}
          />
        </div>
        {view === "tasks" && tasks.length > 0 ? (
          <>
            <p className="mt-3 flex items-baseline gap-1">
              <span className="text-2xl leading-none font-semibold tabular-nums">
                {completed}
              </span>
              <span className="text-sm text-[var(--text-tertiary)]">
                / {tasks.length}
              </span>
            </p>
            {current && (
              <p className="mt-1.5 truncate text-[11px] text-[var(--text-secondary)]">
                Current: {current.subject}
              </p>
            )}
            <div
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--surface-hover)]"
              role="progressbar"
              aria-label="Task completion"
              aria-valuemin={0}
              aria-valuemax={tasks.length || 1}
              aria-valuenow={completed}
            >
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${percent}%` }}
              />
            </div>
          </>
        ) : view === "agents" ? (
          <div className="mt-3 flex items-baseline justify-between gap-3">
            <p className="flex items-baseline gap-1">
              <span className="text-2xl leading-none font-semibold tabular-nums">
                {activeAgents}
              </span>
              <span className="text-sm text-[var(--text-tertiary)]">
                active
              </span>
            </p>
            <p className="text-[11px] text-[var(--text-tertiary)]">
              {completedAgents} completed
            </p>
          </div>
        ) : view === "simulation" ? (
          <p className="mt-3 text-[11px] text-[var(--text-tertiary)]">
            {simulation.status === "designing"
              ? "场景设计 Agent 正在工作"
              : simulation.status === "running"
                ? `${simulation.runningScenarioIds.length} 个场景正在并行测试`
                : simulation.scenarios.length
                  ? `${simulation.scenarios.length} 个场景可测试`
                  : "从业务资料生成测试场景"}
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {view === "tasks" && tasks.length > 0 ? (
          <ol className="flex flex-col">
            {tasks.map((task, index) => (
              <TaskStep
                key={task.id}
                task={task}
                last={index === tasks.length - 1}
              />
            ))}
          </ol>
        ) : view === "agents" && agents.length > 0 ? (
          <ol className="space-y-2.5">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </ol>
        ) : view === "simulation" ? (
          <SimulationPanel
            state={simulation}
            disabled={isLoading}
            onGenerate={onGenerateScenarios}
            onRun={onRunScenario}
            onRunAll={onRunAllScenarios}
            onEscalateCase={onEscalateCase}
          />
        ) : isLoading ? (
          <TaskSkeleton />
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-5 text-center">
            <InformationCircleIcon className="size-5 text-[var(--text-tertiary)]" />
            <p className="mt-2 text-xs leading-5 text-[var(--text-tertiary)]">
              {view === "tasks"
                ? "搭建流程会在工作开始后显示。"
                : "Agent 注册或启动后会显示在这里。"}
            </p>
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 pb-4">
        <div className="flex items-start gap-2 rounded-lg bg-[var(--accent-soft)]/70 p-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
          <LightBulbIcon className="mt-0.5 size-3.5 shrink-0 text-[var(--accent-strong)]" />
          {view === "tasks"
            ? "任务表示要做什么，状态会自动更新。"
            : view === "agents"
              ? "Agent 表示谁在执行；输入仅显示安全摘要。"
              : "每个场景独立运行；失败不会中断其他场景。"}
        </div>
      </div>
    </aside>
  );
}

function SidebarTab({
  active,
  label,
  count,
  pulse = false,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  pulse?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-[background-color,color] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] ${
        active
          ? "bg-[var(--surface-panel)] text-[var(--text-primary)] shadow-sm"
          : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
      }`}
    >
      {pulse && (
        <span className="size-1.5 animate-pulse rounded-full bg-[var(--success)] motion-reduce:animate-none" />
      )}
      {label}
      {count > 0 && <span className="tabular-nums opacity-65">{count}</span>}
    </button>
  );
}

const AGENT_LABELS: Record<string, string> = {
  "fde-scenario-designer": "场景设计",
  "fde-l1-examiner": "L1 组卷",
  "fde-customer-simulator": "终端用户",
  "fde-business-agent": "业务 Agent",
  "fde-evaluator": "考官",
  "fde-document-auditor": "文档审计",
};

const STATUS_LABELS: Record<AgentRun["status"], string> = {
  registered: "Ready",
  queued: "Queued",
  running: "Working",
  waiting: "Waiting",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
};

function AgentCard({ agent }: { agent: AgentRun }) {
  const expandable = Boolean(
    agent.description ||
      agent.summary ||
      agent.lastTool ||
      agent.usage ||
      agent.outputProtected,
  );
  const names = agent.agentType.split(":");
  const shortName = names[names.length - 1] ?? agent.agentType;
  const title = AGENT_LABELS[shortName] ?? agent.agentType;

  return (
    <li className="builder-enter">
      <details
        className={`group rounded-xl border px-3.5 py-3 ${agentBorder(agent.status)}`}
      >
        <summary
          className={`flex list-none items-start gap-3 [&::-webkit-details-marker]:hidden ${
            expandable ? "cursor-pointer" : "cursor-default"
          }`}
        >
          <span className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-muted)] text-[var(--text-secondary)]">
            <CpuChipIcon className="size-4" />
            <span
              className={`absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-[var(--surface-panel)] ${agentDot(agent.status)}`}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-[12px] font-semibold">
                {title}
              </span>
              <span className="text-[9px] font-medium tracking-wide text-[var(--text-tertiary)] uppercase">
                {STATUS_LABELS[agent.status]}
              </span>
            </span>
            <span className="mt-1 block truncate text-[10px] text-[var(--text-tertiary)]">
              {agent.lastTool
                ? `Using ${agent.lastTool}`
                : agent.description || "Registered and available"}
            </span>
          </span>
          {expandable && (
            <ChevronDownIcon className="mt-1 size-3.5 shrink-0 text-[var(--text-tertiary)] transition-transform group-open:rotate-180 motion-reduce:transition-none" />
          )}
        </summary>
        {expandable && (
          <div className="mt-3 border-t border-[var(--border-subtle)] pt-3 text-[10px] leading-relaxed text-[var(--text-secondary)]">
            {agent.description && <p>{agent.description}</p>}
            {agent.summary && (
              <p className="mt-2 whitespace-pre-wrap text-[var(--text-primary)]">
                {agent.summary}
              </p>
            )}
            {agent.outputProtected && (
              <p className="mt-2 rounded-md bg-[var(--surface-muted)] px-2.5 py-2 text-[var(--text-tertiary)]">
                输出已按角色隔离，仅用于后续受控评测。
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9px] text-[var(--text-tertiary)]">
              {agent.lastTool && <span>tool: {agent.lastTool}</span>}
              {agent.usage?.totalTokens !== undefined && (
                <span>{agent.usage.totalTokens.toLocaleString()} tokens</span>
              )}
              {agent.usage?.toolUses !== undefined && (
                <span>{agent.usage.toolUses} calls</span>
              )}
              {agent.usage?.durationMs !== undefined && (
                <span>{formatDuration(agent.usage.durationMs)}</span>
              )}
            </div>
          </div>
        )}
      </details>
    </li>
  );
}

function agentBorder(status: AgentRun["status"]): string {
  if (status === "running") return "border-green-500/35 bg-green-500/[0.04]";
  if (status === "failed") return "border-red-500/35 bg-red-500/[0.04]";
  if (status === "waiting") return "border-amber-500/35 bg-amber-500/[0.04]";
  return "border-[var(--border-subtle)] bg-[var(--surface-panel)]";
}

function agentDot(status: AgentRun["status"]): string {
  if (status === "running")
    return "animate-pulse bg-green-500 motion-reduce:animate-none";
  if (status === "completed") return "bg-green-500";
  if (status === "failed") return "bg-red-500";
  if (status === "waiting") return "bg-amber-500";
  if (status === "queued") return "bg-sky-500";
  return "bg-[var(--border-strong)]";
}

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function TaskStep({ task, last }: { task: ClaudeTask; last: boolean }) {
  return (
    <li className={`builder-enter relative flex gap-3 ${last ? "" : "pb-5"}`}>
      {!last && (
        <span
          aria-hidden="true"
          className="absolute top-5 left-[7.5px] h-[calc(100%-20px)] w-px bg-[var(--border-subtle)]"
        />
      )}
      <TaskMarker status={task.status} />
      <div className="min-w-0 flex-1">
        <p
          className={`text-[13px] leading-4 ${
            task.status === "in_progress"
              ? "font-semibold"
              : "font-medium text-[var(--text-secondary)]"
          }`}
        >
          {task.subject}
        </p>
        {task.status === "in_progress" && task.activeForm ? (
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--success)]">
            {task.activeForm}
          </p>
        ) : task.owner || task.blockedBy.length > 0 ? (
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            {[
              task.owner,
              task.blockedBy.length
                ? `Blocked by ${task.blockedBy.join(", ")}`
                : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function TaskMarker({ status }: { status: ClaudeTask["status"] }) {
  if (status === "completed") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-green-600 text-white">
        <CheckIcon className="size-2.5" strokeWidth={3.5} />
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-green-600/15">
        <span className="size-2 animate-pulse rounded-full bg-green-600 motion-reduce:animate-none" />
      </span>
    );
  }
  return (
    <span className="size-4 shrink-0 rounded-full border border-[var(--border-strong)]" />
  );
}

function TaskSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col">
      {[0, 1, 2, 3].map((index) => (
        <div className="flex gap-3 pb-5" key={index}>
          <span className="size-4 shrink-0 animate-pulse rounded-full bg-[var(--surface-hover)] motion-reduce:animate-none" />
          <div className="min-w-0 flex-1 space-y-2">
            <span className="block h-3 w-3/5 animate-pulse rounded bg-[var(--surface-hover)] motion-reduce:animate-none" />
            <span className="block h-2 w-full animate-pulse rounded bg-[var(--surface-hover)] motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  );
}
