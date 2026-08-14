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
    <div className="builder-enter flex-shrink-0 overflow-hidden rounded-xl bg-[var(--surface-panel)] ring-1 ring-[var(--border-subtle)]">
      <div className="border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-[var(--accent-soft)] p-2">
            <QuestionMarkCircleIcon className="h-5 w-5 text-[var(--accent-strong)]" />
          </div>
          <div>
            <h3 className="font-semibold">Claude needs your input</h3>
            <p className="text-sm text-[var(--text-tertiary)]">
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
              <legend className="mb-2 w-full text-sm font-medium">
                <span className="mr-2 inline-block rounded bg-[var(--surface-hover)] px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
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
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                        : "border-[var(--border-subtle)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]/50"
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
                      className="mt-1 h-4 w-4 accent-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {option.label}
                      </span>
                      <span className="block text-sm text-[var(--text-secondary)]">
                        {option.description}
                      </span>
                      {option.preview && (
                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-[var(--surface-hover)] p-2 text-xs text-[var(--text-secondary)]">
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
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--border-subtle)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]/50"
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
                  className="mt-1 h-4 w-4 accent-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                />
                <span className="text-sm font-medium">Other</span>
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
                    className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-panel)] px-3 py-2 text-sm outline-none transition-colors placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
                    autoFocus
                  />
                </div>
              )}
            </fieldset>
          );
        })}

        <p aria-live="polite" className="min-h-5 text-sm text-[var(--danger)]">
          {error}
        </p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={handleCancel}
            disabled={submitting}
            className="rounded-full px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit || submitting}
            className="rounded-full bg-[var(--text-primary)] px-5 py-2 text-sm font-medium text-[var(--surface-panel)] transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Submitting…" : "Submit answers"}
          </button>
        </div>
      </form>
    </div>
  );
}
