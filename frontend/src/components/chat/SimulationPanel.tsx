import {
  ArrowPathIcon,
  BeakerIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ExclamationTriangleIcon,
  PlayIcon,
} from "@heroicons/react/24/outline";
import type {
  SimulationCaseResult,
  SimulationRunResult,
  SimulationScenario,
  SimulationVerdict,
} from "../../types";

export interface SimulationPanelState {
  status: "idle" | "designing" | "ready" | "running" | "error";
  scenarios: SimulationScenario[];
  results: Record<string, SimulationRunResult>;
  activeScenarioId?: string;
  error?: string;
}

interface SimulationPanelProps {
  state: SimulationPanelState;
  disabled: boolean;
  onGenerate: () => void;
  onRun: (scenario: SimulationScenario) => void;
}

export function SimulationPanel({
  state,
  disabled,
  onGenerate,
  onRun,
}: SimulationPanelProps) {
  if (state.status === "designing") {
    return (
      <PanelStatus
        title="正在设计测试场景"
        detail="场景设计 Agent 正在读取授权业务资料，并生成场景与 Case。"
      />
    );
  }

  if (state.scenarios.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-2 text-center">
        <span className="flex size-11 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
          <BeakerIcon className="size-5" />
        </span>
        <h3 className="mt-3 text-[13px] font-semibold">从真实业务生成考场</h3>
        <p className="mt-1.5 max-w-60 text-[10px] leading-5 text-[var(--text-tertiary)]">
          先生成销售阶段、客户问题和通过标准，再逐个场景启动客户、销售与考官
          Agent。
        </p>
        {state.error && <ErrorNotice message={state.error} />}
        <ActionButton disabled={disabled} onClick={onGenerate}>
          <BeakerIcon className="size-3.5" />
          生成测试场景
        </ActionButton>
      </div>
    );
  }

  const completed = Object.keys(state.results).length;

  return (
    <div aria-live="polite">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] text-[var(--text-tertiary)]">
            已生成 {state.scenarios.length} 个场景
          </p>
          <p className="mt-0.5 text-[11px] font-medium">
            {completed} / {state.scenarios.length} 已模拟
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={onGenerate}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] text-[var(--text-secondary)] transition-[background-color,color] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          <ArrowPathIcon className="size-3" />
          重新生成
        </button>
      </div>

      {state.error && <ErrorNotice message={state.error} />}

      <ol className="space-y-2.5">
        {state.scenarios.map((scenario, index) => (
          <ScenarioCard
            key={scenario.id}
            index={index}
            scenario={scenario}
            result={state.results[scenario.id]}
            running={
              state.status === "running" &&
              state.activeScenarioId === scenario.id
            }
            disabled={disabled}
            onRun={() => onRun(scenario)}
          />
        ))}
      </ol>
    </div>
  );
}

function PanelStatus({ title, detail }: { title: string; detail: string }) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center px-4 text-center"
      aria-live="polite"
    >
      <span className="relative flex size-11 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
        <BeakerIcon className="size-5" />
        <span className="absolute -right-1 -bottom-1 size-3 animate-pulse rounded-full border-2 border-[var(--surface-panel)] bg-green-500 motion-reduce:animate-none" />
      </span>
      <h3 className="mt-3 text-[13px] font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-60 text-[10px] leading-5 text-[var(--text-tertiary)]">
        {detail}
      </p>
    </div>
  );
}

function ScenarioCard({
  index,
  scenario,
  result,
  running,
  disabled,
  onRun,
}: {
  index: number;
  scenario: SimulationScenario;
  result?: SimulationRunResult;
  running: boolean;
  disabled: boolean;
  onRun: () => void;
}) {
  const passed = result?.cases.filter(
    (item) => item.verdict === "passed",
  ).length;

  return (
    <li className="builder-enter">
      <details className="group rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-panel)]">
        <summary className="flex cursor-pointer list-none items-start gap-3 px-3.5 py-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] [&::-webkit-details-marker]:hidden">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-muted)] font-mono text-[10px] text-[var(--text-secondary)]">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-[12px] font-semibold">
                {scenario.title}
              </span>
              {result && (
                <CheckCircleIcon className="size-3.5 shrink-0 text-green-500" />
              )}
            </span>
            <span className="mt-1 flex items-center gap-1.5 text-[9px] text-[var(--text-tertiary)]">
              <span>{scenario.stage}</span>
              <span aria-hidden="true">·</span>
              <span>{scenario.cases.length} Cases</span>
              {result && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    {passed}/{result.cases.length} 通过
                  </span>
                </>
              )}
            </span>
          </span>
          <ChevronDownIcon className="mt-1 size-3.5 shrink-0 text-[var(--text-tertiary)] transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </summary>

        <div className="border-t border-[var(--border-subtle)] px-3.5 py-3">
          <p className="text-[10px] leading-4 text-[var(--text-secondary)]">
            {scenario.description}
          </p>
          <dl className="mt-2 grid gap-1.5 rounded-lg bg-[var(--surface-muted)] px-2.5 py-2 text-[9px] leading-4">
            <div>
              <dt className="inline text-[var(--text-tertiary)]">客户：</dt>
              <dd className="inline text-[var(--text-secondary)]">
                {scenario.persona}
              </dd>
            </div>
            <div>
              <dt className="inline text-[var(--text-tertiary)]">目标：</dt>
              <dd className="inline text-[var(--text-secondary)]">
                {scenario.objective}
              </dd>
            </div>
          </dl>

          {result && (
            <p className="mt-2 text-[9px] leading-4 text-[var(--text-secondary)]">
              {result.summary}
            </p>
          )}

          <ol className="mt-3 space-y-2">
            {scenario.cases.map((testCase, caseIndex) => (
              <CaseRow
                key={testCase.id}
                index={caseIndex}
                title={testCase.title}
                question={testCase.openingMessage}
                result={result?.cases.find(
                  (item) => item.caseId === testCase.id,
                )}
              />
            ))}
          </ol>

          <button
            type="button"
            disabled={disabled}
            onClick={onRun}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--text-primary)] px-3 py-2 text-[10px] font-semibold text-[var(--bg-app)] transition-[opacity,transform] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none"
          >
            {running ? (
              <>
                <span className="size-3 animate-spin rounded-full border border-current border-t-transparent motion-reduce:animate-none" />
                正在模拟 {scenario.cases.length} 个 Case
              </>
            ) : (
              <>
                <PlayIcon className="size-3.5" />
                {result ? "重新模拟" : "开始模拟"}
              </>
            )}
          </button>
        </div>
      </details>
    </li>
  );
}

function CaseRow({
  index,
  title,
  question,
  result,
}: {
  index: number;
  title: string;
  question: string;
  result?: SimulationCaseResult;
}) {
  return (
    <li className="rounded-lg border border-[var(--border-subtle)] px-2.5 py-2">
      <details className="group/case">
        <summary className="flex cursor-pointer list-none items-start gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] [&::-webkit-details-marker]:hidden">
          <span className="mt-0.5 font-mono text-[8px] text-[var(--text-tertiary)]">
            C{index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className="truncate text-[10px] font-medium">{title}</span>
              {result && <VerdictBadge verdict={result.verdict} />}
            </span>
            <span className="mt-1 block line-clamp-2 text-[9px] leading-4 text-[var(--text-tertiary)]">
              “{question}”
            </span>
          </span>
        </summary>
        {result && (
          <div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
            <div className="space-y-1.5">
              {result.transcript.map((turn, turnIndex) => (
                <p
                  key={`${turn.role}-${turnIndex}`}
                  className="text-[9px] leading-4 text-[var(--text-secondary)]"
                >
                  <span className="font-semibold text-[var(--text-primary)]">
                    {turn.role === "customer" ? "客户" : "销售"}：
                  </span>
                  {turn.content}
                </p>
              ))}
            </div>
            <p className="mt-2 rounded-md bg-[var(--surface-muted)] px-2 py-1.5 text-[9px] leading-4 text-[var(--text-secondary)]">
              考官 · {result.score} 分：{result.evaluation}
            </p>
          </div>
        )}
      </details>
    </li>
  );
}

function VerdictBadge({ verdict }: { verdict: SimulationVerdict }) {
  const label =
    verdict === "passed" ? "通过" : verdict === "partial" ? "部分" : "未通过";
  const color =
    verdict === "passed"
      ? "bg-green-500/10 text-green-500"
      : verdict === "partial"
        ? "bg-amber-500/10 text-amber-500"
        : "bg-red-500/10 text-red-500";
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[8px] ${color}`}>
      {label}
    </span>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-red-500/[0.08] px-2.5 py-2 text-left text-[9px] leading-4 text-red-500">
      <ExclamationTriangleIcon className="mt-0.5 size-3 shrink-0" />
      {message}
    </p>
  );
}

function ActionButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="mt-4 flex items-center justify-center gap-1.5 rounded-lg bg-[var(--text-primary)] px-3.5 py-2 text-[10px] font-semibold text-[var(--bg-app)] transition-[opacity,transform] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none"
    >
      {children}
    </button>
  );
}
