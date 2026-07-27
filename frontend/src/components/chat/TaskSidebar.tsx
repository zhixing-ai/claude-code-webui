import {
  CheckIcon,
  ChevronDownIcon,
  ListBulletIcon,
} from "@heroicons/react/24/outline";
import type { ClaudeTask } from "../../utils/taskProjection";

interface TaskSidebarProps {
  tasks: ClaudeTask[];
}

export function TaskSidebar({ tasks }: TaskSidebarProps) {
  if (tasks.length === 0) return null;

  return (
    <>
      <details className="group rounded-2xl border border-slate-200/70 bg-white/80 shadow-sm backdrop-blur-sm dark:border-slate-700/70 dark:bg-slate-800/80 lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500">
          <TaskSummary tasks={tasks} compact />
          <ChevronDownIcon className="h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="max-h-64 overflow-y-auto border-t border-slate-200/70 px-3 py-2 dark:border-slate-700/70">
          <TaskList tasks={tasks} />
        </div>
      </details>

      <aside
        aria-label="Claude task progress"
        className="hidden min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white/80 shadow-sm backdrop-blur-sm dark:border-slate-700/70 dark:bg-slate-800/80 lg:flex"
      >
        <div className="border-b border-slate-200/70 px-4 py-4 dark:border-slate-700/70">
          <TaskSummary tasks={tasks} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <TaskList tasks={tasks} />
        </div>
      </aside>
    </>
  );
}

function TaskSummary({
  tasks,
  compact = false,
}: {
  tasks: ClaudeTask[];
  compact?: boolean;
}) {
  const completed = tasks.filter((task) => task.status === "completed").length;
  const percent = Math.round((completed / tasks.length) * 100);

  return (
    <div className={compact ? "min-w-0 flex-1" : undefined}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300">
            <ListBulletIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              Tasks
            </h2>
            {!compact && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Claude&apos;s current checklist
              </p>
            )}
          </div>
        </div>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300">
          {completed}/{tasks.length}
        </span>
      </div>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
        role="progressbar"
        aria-label="Task completion"
        aria-valuemin={0}
        aria-valuemax={tasks.length}
        aria-valuenow={completed}
      >
        <div
          className="h-full rounded-full bg-blue-500 transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function TaskList({ tasks }: { tasks: ClaudeTask[] }) {
  return (
    <ol className="space-y-1">
      {tasks.map((task) => (
        <li
          key={task.id}
          className={`flex gap-3 rounded-xl px-2.5 py-2.5 ${
            task.status === "in_progress"
              ? "bg-blue-50/90 dark:bg-blue-950/40"
              : ""
          }`}
        >
          <TaskStatusIcon status={task.status} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p
                className={`text-sm leading-5 ${
                  task.status === "completed"
                    ? "text-slate-500 line-through decoration-slate-300 dark:text-slate-500 dark:decoration-slate-600"
                    : "font-medium text-slate-800 dark:text-slate-100"
                }`}
              >
                {task.subject}
              </p>
              <span className="mt-0.5 shrink-0 font-mono text-[10px] text-slate-400 dark:text-slate-500">
                #{task.id}
              </span>
            </div>
            {task.status === "in_progress" && task.activeForm && (
              <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-blue-600 dark:text-blue-300">
                {task.activeForm}
              </p>
            )}
            {(task.owner || task.blockedBy.length > 0) && (
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-medium">
                {task.owner && (
                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                    {task.owner}
                  </span>
                )}
                {task.blockedBy.length > 0 && (
                  <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                    Blocked by {task.blockedBy.map((id) => `#${id}`).join(", ")}
                  </span>
                )}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function TaskStatusIcon({ status }: { status: ClaudeTask["status"] }) {
  if (status === "completed") {
    return (
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
        <CheckIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
    );
  }

  if (status === "in_progress") {
    return (
      <span
        className="mt-1 h-4 w-4 shrink-0 rounded-full border-2 border-blue-200 border-t-blue-600 motion-safe:animate-spin dark:border-blue-900 dark:border-t-blue-300"
        aria-label="In progress"
      />
    );
  }

  return (
    <span
      className="mt-1 h-4 w-4 shrink-0 rounded-full border-2 border-slate-300 dark:border-slate-600"
      aria-label="Pending"
    />
  );
}
