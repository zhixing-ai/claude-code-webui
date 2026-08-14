import {
  CheckIcon,
  InformationCircleIcon,
  LightBulbIcon,
} from "@heroicons/react/24/outline";
import type { ClaudeTask } from "../../utils/taskProjection";

interface TaskSidebarProps {
  tasks: ClaudeTask[];
  isLoading: boolean;
}

export function TaskSidebar({ tasks, isLoading }: TaskSidebarProps) {
  const completed = tasks.filter((task) => task.status === "completed").length;
  const percent = tasks.length
    ? Math.round((completed / tasks.length) * 100)
    : 0;
  const current = tasks.find((task) => task.status === "in_progress");

  return (
    <aside
      aria-label="Claude task progress"
      className="hidden min-h-0 w-[320px] shrink-0 flex-col overflow-hidden rounded-2xl bg-[var(--surface-panel)] shadow-[0_2px_12px_rgba(15,23,42,0.08)] ring-1 ring-[var(--border-subtle)] lg:flex 2xl:w-[360px]"
    >
      <div className="shrink-0 border-b border-[var(--border-subtle)] px-5 pt-5 pb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold">Build progress</h2>
          {isLoading && tasks.length === 0 && (
            <span
              className="size-3.5 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--text-primary)] motion-reduce:animate-none"
              aria-label="Preparing tasks"
            />
          )}
        </div>
        {tasks.length > 0 ? (
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
          </>
        ) : null}
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tasks.length > 0 ? (
          <ol className="flex flex-col">
            {tasks.map((task, index) => (
              <TaskStep
                key={task.id}
                task={task}
                last={index === tasks.length - 1}
              />
            ))}
          </ol>
        ) : isLoading ? (
          <TaskSkeleton />
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-5 text-center">
            <InformationCircleIcon className="size-5 text-[var(--text-tertiary)]" />
            <p className="mt-2 text-xs leading-5 text-[var(--text-tertiary)]">
              Claude&apos;s checklist will appear here when the build starts.
            </p>
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 pb-4">
        <div className="flex items-start gap-2 rounded-lg bg-[var(--accent-soft)]/70 p-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
          <LightBulbIcon className="mt-0.5 size-3.5 shrink-0 text-[var(--accent-strong)]" />
          Tasks update automatically as Claude plans and works.
        </div>
      </div>
    </aside>
  );
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
