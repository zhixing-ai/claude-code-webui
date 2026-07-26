# AskUserQuestion Web Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pause an active Claude Agent SDK query when `AskUserQuestion` is called, render its options in the web chat input area, and resume the same query with the user's answers.

**Architecture:** Upgrade both packages to `@anthropic-ai/claude-agent-sdk@0.3.220`, then use its `canUseTool` callback as the pause point. A process-local pending-interaction store connects the open NDJSON response to a new response endpoint; the React page receives a custom stream event and renders one accessible form component.

**Tech Stack:** TypeScript, Hono, React 19, Tailwind CSS, Vitest, Testing Library, NDJSON, Claude Agent SDK 0.3.220 / Claude Code 2.1.220

## Global Constraints

- Keep using the explicitly detected `pathToClaudeCodeExecutable`; do not pass a `model` option.
- Pin `@anthropic-ai/claude-agent-sdk` to exactly `0.3.220` in Node and Deno manifests and locks.
- Support 1–4 questions, 2–4 options per question, single-select, multi-select, `preview`, and free-text Other answers.
- Do not migrate Bash/Edit approvals to the new interaction protocol.
- Do not add WebSocket, database, cross-process persistence, state queues, or a UI dependency.
- Keep pending interaction state in memory and clean it on answer, cancellation, abort, stream disconnect, success, and error.
- Render option previews as text, never as injected HTML.

---

### Task 1: Migrate SDK Package Without Changing Chat Behavior

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`
- Modify: `backend/deno.json`
- Modify: `backend/deno.lock`
- Modify: `backend/handlers/chat.ts`
- Modify: `backend/handlers/chat.test.ts`
- Modify: `backend/history/parser.ts`
- Modify: `backend/scripts/build-bundle.js`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/utils/mockResponseGenerator.ts`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: current `query({prompt, options})`, SDK message types, and `PermissionMode`.
- Produces: the same imports and runtime behavior sourced from `@anthropic-ai/claude-agent-sdk@0.3.220`.

- [ ] **Step 1: Switch the backend dependency and lockfile**

Run:

```bash
cd backend
npm uninstall @anthropic-ai/claude-code
npm install --save-exact @anthropic-ai/claude-agent-sdk@0.3.220
```

Then replace the peer dependency with:

```json
"peerDependencies": {
  "@anthropic-ai/claude-agent-sdk": "0.3.220"
}
```

- [ ] **Step 2: Switch the frontend type dependency and lockfile**

Run:

```bash
cd frontend
npm uninstall @anthropic-ai/claude-code
npm install --save-dev --save-exact @anthropic-ai/claude-agent-sdk@0.3.220
```

- [ ] **Step 3: Replace source, bundle, Deno, and contributor-document imports**

Use this import everywhere that currently imports the old package:

```ts
import {
  query,
  type PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";
```

Type-only consumers import from the same package. Change the esbuild external entry to:

```js
"@anthropic-ai/claude-agent-sdk",
```

Change the Deno mapping to:

```json
"@anthropic-ai/claude-agent-sdk": "npm:@anthropic-ai/claude-agent-sdk@0.3.220"
```

Update the two live `CLAUDE.md` SDK path/version examples to the new package name. Do not rewrite historical `CHANGELOG.md` entries.

- [ ] **Step 4: Refresh the Deno lock**

Run:

```bash
cd backend
deno check cli/deno.ts
```

Expected: Deno resolves `npm:@anthropic-ai/claude-agent-sdk@0.3.220` and exits 0.

- [ ] **Step 5: Verify unchanged behavior**

Run:

```bash
cd backend
npm test -- handlers/chat.test.ts
npm run typecheck
cd ../frontend
npm run test:run
npm run typecheck
```

Expected: all existing tests pass and both type checks exit 0.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/deno.json backend/deno.lock backend/handlers/chat.ts backend/handlers/chat.test.ts backend/history/parser.ts backend/scripts/build-bundle.js frontend/package.json frontend/package-lock.json frontend/src/types.ts frontend/src/utils/mockResponseGenerator.ts CLAUDE.md
git commit -m "chore: migrate to Claude Agent SDK"
```

---

### Task 2: Add the Pending Interaction Store and Response Endpoint

**Files:**
- Modify: `shared/types.ts`
- Create: `backend/handlers/interactions.ts`
- Create: `backend/handlers/interactions.test.ts`
- Modify: `backend/app.ts`

**Interfaces:**
- Produces: `AskUserQuestionItem`, `AskUserQuestionStreamResponse`, `InteractionResponse`.
- Produces: `PendingInteractions.create(requestId, questions, signal)`, `respond(interactionId, body)`, and `cancelRequest(requestId, message)`.
- Produces: `POST /api/interactions/:interactionId/respond`.

- [ ] **Step 1: Write failing tests for answer, cancellation, invalid input, and one-shot settlement**

Create `backend/handlers/interactions.test.ts` with real store tests:

```ts
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  handleInteractionResponse,
  PendingInteractions,
} from "./interactions";

const questions = [{
  question: "Which format?",
  header: "Format",
  options: [
    { label: "Short", description: "Summary" },
    { label: "Long", description: "Details" },
  ],
  multiSelect: false,
}];

describe("PendingInteractions", () => {
  it("resumes once with answers in the original AskUserQuestion input", async () => {
    const store = new PendingInteractions();
    const pending = store.create("request-1", questions, new AbortController().signal);

    expect(store.respond(pending.interactionId, {
      answers: { "Which format?": "Short" },
    })).toBe("ok");
    await expect(pending.response).resolves.toEqual({
      behavior: "allow",
      updatedInput: {
        questions,
        answers: { "Which format?": "Short" },
      },
    });
    expect(store.respond(pending.interactionId, {
      answers: { "Which format?": "Long" },
    })).toBe("not_found");
  });

  it("keeps the interaction pending when an answer is missing", () => {
    const store = new PendingInteractions();
    const pending = store.create("request-1", questions, new AbortController().signal);

    expect(store.respond(pending.interactionId, { answers: {} })).toBe("invalid");
    expect(store.respond(pending.interactionId, {
      answers: { "Which format?": "Short" },
    })).toBe("ok");
  });

  it("denies a cancelled interaction", async () => {
    const store = new PendingInteractions();
    const pending = store.create("request-1", questions, new AbortController().signal);

    expect(store.respond(pending.interactionId, { cancelled: true })).toBe("ok");
    await expect(pending.response).resolves.toEqual({
      behavior: "deny",
      message: "User cancelled the question",
    });
  });

  it("denies every interaction belonging to an aborted request", async () => {
    const store = new PendingInteractions();
    const controller = new AbortController();
    const pending = store.create("request-1", questions, controller.signal);

    controller.abort();
    await expect(pending.response).resolves.toEqual({
      behavior: "deny",
      message: "Request aborted",
    });
    expect(store.respond(pending.interactionId, { cancelled: true })).toBe("not_found");
  });

  it("returns 400 for incomplete answers and 404 for expired interactions", async () => {
    const store = new PendingInteractions();
    const app = new Hono();
    app.post("/api/interactions/:interactionId/respond", (c) =>
      handleInteractionResponse(c, store));
    const pending = store.create("request-1", questions, new AbortController().signal);

    const invalid = await app.request(
      `/api/interactions/${pending.interactionId}/respond`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: {} }),
      },
    );
    expect(invalid.status).toBe(400);

    store.cancelRequest("request-1", "Request ended");
    const expired = await app.request(
      `/api/interactions/${pending.interactionId}/respond`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelled: true }),
      },
    );
    expect(expired.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
cd backend
npm test -- handlers/interactions.test.ts
```

Expected: FAIL because `./interactions` does not exist.

- [ ] **Step 3: Add shared protocol types**

Change `StreamResponse` to a discriminated union and add:

```ts
export interface AskUserQuestionOption {
  label: string;
  description: string;
  preview?: string;
}

export interface AskUserQuestionItem {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
}

export interface AskUserQuestionStreamResponse {
  type: "ask_user_question";
  interactionId: string;
  questions: AskUserQuestionItem[];
}

export type InteractionResponse =
  | { answers: Record<string, string> }
  | { cancelled: true };

export type StreamResponse =
  | { type: "claude_json"; data: unknown }
  | AskUserQuestionStreamResponse
  | { type: "error"; error?: string }
  | { type: "done" }
  | { type: "aborted" };
```

- [ ] **Step 4: Implement the minimum in-memory store**

Create `backend/handlers/interactions.ts` with:

```ts
import type { Context } from "hono";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type {
  AskUserQuestionItem,
  InteractionResponse,
} from "../../shared/types.ts";

type PendingInteraction = {
  requestId: string;
  questions: AskUserQuestionItem[];
  resolve: (result: PermissionResult) => void;
  cleanup: () => void;
};

export class PendingInteractions {
  private readonly pending = new Map<string, PendingInteraction>();

  create(
    requestId: string,
    questions: AskUserQuestionItem[],
    signal: AbortSignal,
  ) {
    const interactionId = crypto.randomUUID();
    let resolveResponse!: (result: PermissionResult) => void;
    const response = new Promise<PermissionResult>((resolve) => {
      resolveResponse = resolve;
    });
    const onAbort = () => this.cancelRequest(requestId, "Request aborted");
    this.pending.set(interactionId, {
      requestId,
      questions,
      resolve: resolveResponse,
      cleanup: () => signal.removeEventListener("abort", onAbort),
    });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) this.cancelRequest(requestId, "Request aborted");
    return { interactionId, response };
  }

  respond(interactionId: string, body: unknown): "ok" | "invalid" | "not_found" {
    const pending = this.pending.get(interactionId);
    if (!pending) return "not_found";

    if (isCancelled(body)) {
      this.settle(interactionId, pending, {
        behavior: "deny",
        message: "User cancelled the question",
      });
      return "ok";
    }

    const answers = readAnswers(body, pending.questions);
    if (!answers) return "invalid";
    this.settle(interactionId, pending, {
      behavior: "allow",
      updatedInput: { questions: pending.questions, answers },
    });
    return "ok";
  }

  cancelRequest(requestId: string, message: string) {
    for (const [id, pending] of this.pending) {
      if (pending.requestId === requestId) {
        this.settle(id, pending, { behavior: "deny", message });
      }
    }
  }

  private settle(
    id: string,
    pending: PendingInteraction,
    result: PermissionResult,
  ) {
    this.pending.delete(id);
    pending.cleanup();
    pending.resolve(result);
  }
}
```

In the same file, accept only trimmed non-empty string answers for every exact
`question` key:

```ts
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCancelled(value: unknown): value is { cancelled: true } {
  return isObject(value) && value.cancelled === true;
}

function readAnswers(
  value: unknown,
  questions: AskUserQuestionItem[],
): Record<string, string> | null {
  if (!isObject(value) || !isObject(value.answers)) return null;
  const answers = Object.fromEntries(
    questions.map(({ question }) => {
      const answer = value.answers[question];
      return [question, typeof answer === "string" ? answer.trim() : ""];
    }),
  );
  return Object.values(answers).every(Boolean) ? answers : null;
}
```

Export:

```ts
export async function handleInteractionResponse(
  c: Context,
  interactions: PendingInteractions,
) {
  let body: InteractionResponse;
  try {
    body = await c.req.json<InteractionResponse>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const result = interactions.respond(c.req.param("interactionId"), body);
  if (result === "not_found") return c.json({ error: "Interaction not found" }, 404);
  if (result === "invalid") return c.json({ error: "Every question requires an answer" }, 400);
  return c.json({ ok: true });
}
```

- [ ] **Step 5: Register the shared store and route**

In `createApp`, instantiate one store beside `requestAbortControllers`:

```ts
const interactions = new PendingInteractions();
```

Register:

```ts
app.post("/api/interactions/:interactionId/respond", (c) =>
  handleInteractionResponse(c, interactions),
);
```

Keep the existing two-argument `handleChatRequest` call in this task so the
store and response route are independently testable. Task 3 passes the store
into chat when the handler signature changes.

- [ ] **Step 6: Run the interaction tests to verify GREEN**

Run:

```bash
cd backend
npm test -- handlers/interactions.test.ts
npm run typecheck
```

Expected: interaction tests pass and typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add shared/types.ts backend/handlers/interactions.ts backend/handlers/interactions.test.ts backend/app.ts
git commit -m "feat: add pending question interactions"
```

---

### Task 3: Pause and Resume the Original Chat Stream

**Files:**
- Modify: `backend/handlers/chat.ts`
- Modify: `backend/handlers/chat.test.ts`
- Modify: `backend/app.ts`

**Interfaces:**
- Consumes: `PendingInteractions` from Task 2.
- Produces: `handleChatRequest(c, requestAbortControllers, interactions)`.
- Emits: `{type:"ask_user_question", interactionId, questions}` before awaiting the browser response.

- [ ] **Step 1: Write a failing stream-resume test**

Update the SDK mock import to the new package. Add a test that invokes the
actual `canUseTool` callback from the mocked query:

```ts
it("emits AskUserQuestion and resumes the same stream with submitted answers", async () => {
  const interactions = new PendingInteractions();
  let permissionResult: unknown;
  mockQuery.mockImplementation(({ options }: any) => ({
    [Symbol.asyncIterator]: async function* () {
      permissionResult = await options.canUseTool(
        "AskUserQuestion",
        {
          questions: [{
            question: "Which format?",
            header: "Format",
            options: [
              { label: "Short", description: "Summary" },
              { label: "Long", description: "Details" },
            ],
            multiSelect: false,
          }],
        },
        { signal: options.abortController.signal, toolUseID: "tool-1", requestId: "control-1" },
      );
      yield { type: "result", subtype: "success", session_id: "session-1" } as any;
    },
  }) as any);

  mockContext.req.json = vi.fn().mockResolvedValue({
    message: "Ask me",
    requestId: "request-1",
  });
  const response = await handleChatRequest(
    mockContext,
    requestAbortControllers,
    interactions,
  );
  const reader = response.body!.getReader();
  const first = JSON.parse(new TextDecoder().decode((await reader.read()).value));

  expect(first).toMatchObject({
    type: "ask_user_question",
    questions: [{ question: "Which format?" }],
  });
  expect(interactions.respond(first.interactionId, {
    answers: { "Which format?": "Short" },
  })).toBe("ok");

  while (!(await reader.read()).done) {}
  expect(permissionResult).toEqual({
    behavior: "allow",
    updatedInput: {
      questions: first.questions,
      answers: { "Which format?": "Short" },
    },
  });
});
```

Add a second test that calls `canUseTool("Bash", ...)` and expects:

```ts
{
  behavior: "deny",
  message: "Interactive approval is not supported for Bash",
}
```

Add a third test that reads the emitted question, cancels the response reader,
then verifies the interaction was removed:

```ts
const first = JSON.parse(new TextDecoder().decode((await reader.read()).value));
await reader.cancel();
expect(interactions.respond(first.interactionId, { cancelled: true }))
  .toBe("not_found");
```

Add a fourth test that passes `{questions: []}` to `canUseTool` and expects:

```ts
{
  behavior: "deny",
  message: "Invalid AskUserQuestion input",
}
```

- [ ] **Step 2: Run the tests to verify RED**

Run:

```bash
cd backend
npm test -- handlers/chat.test.ts
```

Expected: FAIL because `handleChatRequest` has no interaction store and sends no question event.

- [ ] **Step 3: Add strict AskUserQuestion input validation**

In `chat.ts`, add `readQuestions(input)` that returns
`AskUserQuestionItem[] | null`. It must require:

```ts
questions.length >= 1 && questions.length <= 4
question.question.trim().length > 0
question.header.trim().length > 0
typeof question.multiSelect === "boolean"
question.options.length >= 2 && question.options.length <= 4
option.label.trim().length > 0
option.description.trim().length > 0
option.preview === undefined || typeof option.preview === "string"
```

- [ ] **Step 4: Replace the async generator with direct guarded NDJSON writes**

Keep the public handler but write to the stream through:

```ts
let closed = false;
let requestAbortController: AbortController | undefined;
const encoder = new TextEncoder();
const send = (controller: ReadableStreamDefaultController, chunk: StreamResponse) => {
  if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
};
```

Register `canUseTool` in the existing query options:

```ts
canUseTool: async (toolName, input) => {
  if (toolName !== "AskUserQuestion") {
    return {
      behavior: "deny",
      message: `Interactive approval is not supported for ${toolName}`,
    };
  }
  const questions = readQuestions(input);
  if (!questions) {
    return { behavior: "deny", message: "Invalid AskUserQuestion input" };
  }
  const pending = interactions.create(
    chatRequest.requestId,
    questions,
    requestAbortController!.signal,
  );
  send(controller, {
    type: "ask_user_question",
    interactionId: pending.interactionId,
    questions,
  });
  return pending.response;
},
```

The `for await` loop sends each SDK message as `claude_json`, then `done`.
The `catch` sends `error`. The `finally` calls:

```ts
interactions.cancelRequest(chatRequest.requestId, "Request ended");
requestAbortControllers.delete(chatRequest.requestId);
if (!closed) {
  closed = true;
  controller.close();
}
```

Implement `ReadableStream.cancel()` as:

```ts
cancel() {
  closed = true;
  requestAbortController?.abort();
  interactions.cancelRequest(chatRequest.requestId, "Request aborted");
}
```

- [ ] **Step 5: Pass the shared store into chat**

Change the app route to:

```ts
app.post("/api/chat", (c) =>
  handleChatRequest(c, requestAbortControllers, interactions),
);
```

- [ ] **Step 6: Run backend tests to verify GREEN**

Run:

```bash
cd backend
npm test -- handlers/chat.test.ts handlers/interactions.test.ts
npm run typecheck
```

Expected: both files pass and typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add backend/handlers/chat.ts backend/handlers/chat.test.ts backend/app.ts
git commit -m "feat: stream AskUserQuestion interactions"
```

---

### Task 4: Parse Question Events in the Frontend

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/hooks/streaming/useMessageProcessor.ts`
- Modify: `frontend/src/hooks/streaming/useStreamParser.ts`
- Modify: `frontend/src/hooks/streaming/useStreamParser.test.ts`

**Interfaces:**
- Consumes: `AskUserQuestionStreamResponse` from `shared/types.ts`.
- Produces: optional `StreamingContext.onAskUserQuestion(event)`.

- [ ] **Step 1: Write a failing parser test**

Add `onAskUserQuestion: vi.fn()` to the test context and add:

```ts
it("forwards AskUserQuestion stream events without creating a chat message", () => {
  const { result } = renderHook(() => useStreamParser());
  const event = {
    type: "ask_user_question" as const,
    interactionId: "interaction-1",
    questions: [{
      question: "Which format?",
      header: "Format",
      options: [
        { label: "Short", description: "Summary" },
        { label: "Long", description: "Details" },
      ],
      multiSelect: false,
    }],
  };

  result.current.processStreamLine(JSON.stringify(event), mockContext);

  expect(mockContext.onAskUserQuestion).toHaveBeenCalledWith(event);
  expect(mockContext.addMessage).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the parser test to verify RED**

Run:

```bash
cd frontend
npm run test:run -- src/hooks/streaming/useStreamParser.test.ts
```

Expected: FAIL because `onAskUserQuestion` is never called.

- [ ] **Step 3: Add the streaming callback**

Re-export the new shared types from `frontend/src/types.ts`. Add:

```ts
onAskUserQuestion?: (event: AskUserQuestionStreamResponse) => void;
```

to `StreamingContext`. In `processStreamLine`, handle the event before SDK
message processing:

```ts
if (data.type === "ask_user_question") {
  context.onAskUserQuestion?.(data);
} else if (data.type === "claude_json") {
  processClaudeData(data.data as SDKMessage, context);
}
```

- [ ] **Step 4: Run the parser test to verify GREEN**

Run:

```bash
cd frontend
npm run test:run -- src/hooks/streaming/useStreamParser.test.ts
npm run typecheck
```

Expected: parser tests pass and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/hooks/streaming/useMessageProcessor.ts frontend/src/hooks/streaming/useStreamParser.ts frontend/src/hooks/streaming/useStreamParser.test.ts
git commit -m "feat: parse question interaction events"
```

---

### Task 5: Render the Accessible Question Form

**Files:**
- Create: `frontend/src/components/chat/AskUserQuestionPanel.tsx`
- Create: `frontend/src/components/chat/AskUserQuestionPanel.test.tsx`
- Modify: `frontend/src/components/chat/ChatInput.tsx`

**Interfaces:**
- Consumes: `questions: AskUserQuestionItem[]`.
- Consumes: `onSubmit(answers: Record<string,string>): Promise<void>` and `onCancel(): Promise<void>`.
- Produces: `AskUserQuestionData` prop on `ChatInput`, rendered before existing permission panels.

- [ ] **Step 1: Write failing component tests**

Create tests using `render`, `screen`, `fireEvent`, and `waitFor`:

```tsx
it("submits single, multi-select, and Other answers using question text keys", async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<AskUserQuestionPanel
    questions={[
      {
        question: "Which format?",
        header: "Format",
        options: [
          { label: "Short", description: "Summary" },
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
    ]}
    onSubmit={onSubmit}
    onCancel={vi.fn()}
  />);

  fireEvent.click(screen.getByLabelText("Short"));
  fireEvent.click(screen.getByLabelText("Tests"));
  fireEvent.click(screen.getAllByLabelText("Other")[1]);
  fireEvent.change(screen.getByLabelText("Other answer for Which checks?"), {
    target: { value: "Typecheck" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
    "Which format?": "Short",
    "Which checks?": "Tests, Typecheck",
  }));
});
```

Add tests proving:

```ts
expect(screen.getByRole("button", { name: "Submit answers" })).toBeDisabled();
```

when a question is unanswered, and proving a rejected `onSubmit` displays
`"Could not submit answers. Try again."` while the selected radio remains
checked. Add a cancel test expecting `onCancel` once.

- [ ] **Step 2: Run component tests to verify RED**

Run:

```bash
cd frontend
npm run test:run -- src/components/chat/AskUserQuestionPanel.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement form state and answer serialization**

Create the component with:

```ts
const OTHER = "__other__";
const [selected, setSelected] = useState<Record<number, string[]>>({});
const [otherText, setOtherText] = useState<Record<number, string>>({});
const [submitting, setSubmitting] = useState(false);
const [error, setError] = useState("");
```

For single-select, replace the question's selected array. For multi-select,
toggle labels. Convert `OTHER` to the trimmed `otherText[index]`, remove empty
values, and join multi-select values with `", "`. `canSubmit` is true only when
each question produces a non-empty answer.

Use:

```tsx
<form onSubmit={handleSubmit}>
  {questions.map((question, questionIndex) => (
    <fieldset key={question.question}>
      <legend>{question.question}</legend>
      {question.options.map((option) => (
        <label key={option.label}>
          <input
            type={question.multiSelect ? "checkbox" : "radio"}
            name={`question-${questionIndex}`}
            aria-label={option.label}
          />
          <span>{option.label}</span>
          <span>{option.description}</span>
          {option.preview && <pre>{option.preview}</pre>}
        </label>
      ))}
    </fieldset>
  ))}
  <p aria-live="polite">{error}</p>
  <button type="button" onClick={handleCancel}>Cancel</button>
  <button type="submit" disabled={!canSubmit || submitting}>Submit answers</button>
</form>
```

Apply the existing slate/blue Tailwind palette, rounded borders, dark classes,
visible `focus-visible` rings, and responsive vertical spacing. Do not use
`dangerouslySetInnerHTML`.

- [ ] **Step 4: Render the panel from ChatInput**

Add:

```ts
interface AskUserQuestionData {
  questions: AskUserQuestionItem[];
  onSubmit: (answers: Record<string, string>) => Promise<void>;
  onCancel: () => Promise<void>;
}
```

Add an optional `askUserQuestionData` prop and render it before plan and regular
permission checks:

```tsx
if (askUserQuestionData) {
  return <AskUserQuestionPanel {...askUserQuestionData} />;
}
```

- [ ] **Step 5: Run component tests to verify GREEN**

Run:

```bash
cd frontend
npm run test:run -- src/components/chat/AskUserQuestionPanel.test.tsx
npm run typecheck
```

Expected: component tests pass and typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/chat/AskUserQuestionPanel.tsx frontend/src/components/chat/AskUserQuestionPanel.test.tsx frontend/src/components/chat/ChatInput.tsx
git commit -m "feat: render AskUserQuestion form"
```

---

### Task 6: Connect the Page to the Response Endpoint

**Files:**
- Modify: `frontend/src/config/api.ts`
- Modify: `frontend/src/components/ChatPage.tsx`

**Interfaces:**
- Consumes: `StreamingContext.onAskUserQuestion`.
- Produces: `getInteractionResponseUrl(interactionId)`.
- Produces: submit/cancel callbacks passed to `ChatInput.askUserQuestionData`.

- [ ] **Step 1: Add the response URL**

Add the endpoint constant and encoder:

```ts
INTERACTIONS: "/api/interactions",

export const getInteractionResponseUrl = (interactionId: string) =>
  `${API_CONFIG.ENDPOINTS.INTERACTIONS}/${encodeURIComponent(interactionId)}/respond`;
```

- [ ] **Step 2: Store only the active streamed question**

In `ChatPage`, add:

```ts
const [askUserQuestion, setAskUserQuestion] =
  useState<AskUserQuestionStreamResponse | null>(null);
```

Set it from the request's `StreamingContext`:

```ts
onAskUserQuestion: setAskUserQuestion,
```

Clear it in the `sendMessage` `finally` block and in `handleAbort`.

- [ ] **Step 3: Submit and cancel through the new endpoint**

Add one request helper:

```ts
const respondToQuestion = useCallback(
  async (body: InteractionResponse) => {
    if (!askUserQuestion) throw new Error("Question is no longer active");
    const response = await fetch(
      getInteractionResponseUrl(askUserQuestion.interactionId),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || "Could not submit question response");
    }
    setAskUserQuestion(null);
  },
  [askUserQuestion],
);
```

Pass:

```tsx
askUserQuestionData={
  askUserQuestion
    ? {
        questions: askUserQuestion.questions,
        onSubmit: (answers) => respondToQuestion({ answers }),
        onCancel: () => respondToQuestion({ cancelled: true }),
      }
    : undefined
}
```

- [ ] **Step 4: Run the complete automated verification**

Run:

```bash
cd backend
npm test
npm run typecheck
npm run build
cd ../frontend
npm run test:run
npm run typecheck
npm run build
```

Expected: every command exits 0 with no failed tests.

- [ ] **Step 5: Manually verify against the configured local CLI**

Start the app with the explicit executable:

```bash
cd backend
npm run dev -- --claude-path /Users/shaobo/.local/bin/claude
```

Send a prompt that asks Claude to call `AskUserQuestion` with one single-select
and one multi-select question. Verify the panel appears, the network request
posts to `/api/interactions/:id/respond`, and Claude continues in the same
open chat stream after submission. Verify the init event still reports the
model chosen by the user's local Claude Code configuration because no model is
set by the web app.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/config/api.ts frontend/src/components/ChatPage.tsx
git commit -m "feat: answer Claude questions from chat"
```
