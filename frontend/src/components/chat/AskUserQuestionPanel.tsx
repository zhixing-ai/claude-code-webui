import { QuestionMarkCircleIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import type { AskUserQuestionItem } from "../../types";

const OTHER = "__other__";

interface AskUserQuestionPanelProps {
  questions: AskUserQuestionItem[];
  onSubmit: (answers: Record<string, string>) => Promise<void>;
  onCancel: () => Promise<void>;
}

export function AskUserQuestionPanel({
  questions,
  onSubmit,
  onCancel,
}: AskUserQuestionPanelProps) {
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [otherText, setOtherText] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const toggleOption = (
    questionIndex: number,
    value: string,
    multiSelect: boolean,
  ) => {
    setSelected((current) => {
      const values = current[questionIndex] ?? [];
      return {
        ...current,
        [questionIndex]: multiSelect
          ? values.includes(value)
            ? values.filter((item) => item !== value)
            : [...values, value]
          : [value],
      };
    });
  };

  const getAnswers = () =>
    Object.fromEntries(
      questions.flatMap((question, questionIndex) => {
        const values = (selected[questionIndex] ?? [])
          .map((value) =>
            value === OTHER ? otherText[questionIndex]?.trim() : value,
          )
          .filter(Boolean);
        const answer = question.multiSelect ? values.join(", ") : values[0];
        return answer ? [[question.question, answer]] : [];
      }),
    );

  const canSubmit = Object.keys(getAnswers()).length === questions.length;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(getAnswers());
    } catch {
      setError("Could not submit answers. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onCancel();
    } catch {
      setError("Could not cancel. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white/90 shadow-sm backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/90">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-blue-50 p-2 dark:bg-blue-900/30">
            <QuestionMarkCircleIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">
              Claude needs your input
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Answer to continue the current task.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 px-4 py-4">
        {questions.map((question, questionIndex) => {
          const values = selected[questionIndex] ?? [];
          return (
            <fieldset key={question.question} className="space-y-2">
              <legend className="mb-2 w-full text-sm font-medium text-slate-800 dark:text-slate-100">
                <span className="mr-2 inline-block rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                  {question.header}
                </span>
                {question.question}
              </legend>

              {question.options.map((option) => {
                const checked = values.includes(option.label);
                return (
                  <label
                    key={option.label}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                      checked
                        ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/20"
                        : "border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-700/40"
                    }`}
                  >
                    <input
                      type={question.multiSelect ? "checkbox" : "radio"}
                      name={`question-${questionIndex}`}
                      aria-label={option.label}
                      checked={checked}
                      onChange={() =>
                        toggleOption(
                          questionIndex,
                          option.label,
                          question.multiSelect,
                        )
                      }
                      className="mt-1 h-4 w-4 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
                        {option.label}
                      </span>
                      <span className="block text-sm text-slate-500 dark:text-slate-400">
                        {option.description}
                      </span>
                      {option.preview && (
                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-slate-100 p-2 text-xs text-slate-600 dark:bg-slate-900/70 dark:text-slate-300">
                          {option.preview}
                        </pre>
                      )}
                    </span>
                  </label>
                );
              })}

              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                  values.includes(OTHER)
                    ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/20"
                    : "border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-700/40"
                }`}
              >
                <input
                  type={question.multiSelect ? "checkbox" : "radio"}
                  name={`question-${questionIndex}`}
                  aria-label="Other"
                  checked={values.includes(OTHER)}
                  onChange={() =>
                    toggleOption(questionIndex, OTHER, question.multiSelect)
                  }
                  className="mt-1 h-4 w-4 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                />
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  Other
                </span>
              </label>

              {values.includes(OTHER) && (
                <div>
                  <label htmlFor={`other-${questionIndex}`} className="sr-only">
                    Other answer for {question.question}
                  </label>
                  <input
                    id={`other-${questionIndex}`}
                    value={otherText[questionIndex] ?? ""}
                    onChange={(event) =>
                      setOtherText((current) => ({
                        ...current,
                        [questionIndex]: event.target.value,
                      }))
                    }
                    placeholder="Type your answer"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    autoFocus
                  />
                </div>
              )}
            </fieldset>
          );
        })}

        <p
          aria-live="polite"
          className="min-h-5 text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={handleCancel}
            disabled={submitting}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit || submitting}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:bg-slate-400 disabled:opacity-60"
          >
            {submitting ? "Submitting…" : "Submit answers"}
          </button>
        </div>
      </form>
    </div>
  );
}
