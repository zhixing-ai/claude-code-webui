import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AskUserQuestionPanel } from "./AskUserQuestionPanel";

const questions = [
  {
    question: "Which format?",
    header: "Format",
    options: [
      {
        label: "Short",
        description: "Summary",
        preview: "A compact answer",
      },
      { label: "Long", description: "Details" },
    ],
    multiSelect: false,
  },
  {
    question: "Which checks?",
    header: "Checks",
    options: [
      { label: "Tests", description: "Run tests" },
      { label: "Lint", description: "Run lint" },
    ],
    multiSelect: true,
  },
];

describe("AskUserQuestionPanel", () => {
  it("submits single, multi-select, and Other answers by question text", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <AskUserQuestionPanel
        questions={questions}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("A compact answer")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Short"));
    fireEvent.click(screen.getByLabelText("Tests"));
    fireEvent.click(screen.getAllByLabelText("Other")[1]);
    fireEvent.change(screen.getByLabelText("Other answer for Which checks?"), {
      target: { value: "Typecheck" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        "Which format?": "Short",
        "Which checks?": "Tests, Typecheck",
      }),
    );
  });

  it("disables submit until every question has an answer", () => {
    render(
      <AskUserQuestionPanel
        questions={questions}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const submit = screen.getByRole("button", { name: "Submit answers" });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Short"));
    fireEvent.click(screen.getByLabelText("Tests"));

    expect(submit).toBeEnabled();
  });

  it("keeps selections and allows retry after submit fails", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    render(
      <AskUserQuestionPanel
        questions={[questions[0]]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const longOption = screen.getByLabelText("Long");
    fireEvent.click(longOption);
    fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));

    expect(
      await screen.findByText("Could not submit answers. Try again."),
    ).toBeInTheDocument();
    expect(longOption).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  });

  it("calls onCancel once", async () => {
    const onCancel = vi.fn().mockResolvedValue(undefined);
    render(
      <AskUserQuestionPanel
        questions={[questions[0]]}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
  });
});
