import { useRef, useEffect } from "react";
import {
  ClipboardDocumentListIcon,
  ListBulletIcon,
  SparklesIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import type { AllMessage } from "../../types";
import {
  isChatMessage,
  isSystemMessage,
  isToolMessage,
  isToolResultMessage,
  isPlanMessage,
  isThinkingMessage,
  isTodoMessage,
} from "../../types";
import {
  ChatMessageComponent,
  SystemMessageComponent,
  ToolMessageComponent,
  ToolResultMessageComponent,
  PlanMessageComponent,
  ThinkingMessageComponent,
  TodoMessageComponent,
  LoadingComponent,
} from "../MessageComponents";
// import { UI_CONSTANTS } from "../../utils/constants"; // Unused for now

interface ChatMessagesProps {
  messages: AllMessage[];
  isLoading: boolean;
}

export function ChatMessages({ messages, isLoading }: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const visibleMessages = messages.filter((message) => {
    if (message.type === "system") {
      return "subtype" in message && message.subtype === "abort";
    }
    return message.type !== "result";
  });

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    if (messagesEndRef.current && messagesEndRef.current.scrollIntoView) {
      const reduceMotion = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      messagesEndRef.current.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
      });
    }
  };

  // Check if user is near bottom of messages (unused but kept for future use)
  // const isNearBottom = () => {
  //   const container = messagesContainerRef.current;
  //   if (!container) return true;

  //   const { scrollTop, scrollHeight, clientHeight } = container;
  //   return (
  //     scrollHeight - scrollTop - clientHeight <
  //     UI_CONSTANTS.NEAR_BOTTOM_THRESHOLD_PX
  //   );
  // };

  // Auto-scroll when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const renderMessage = (message: AllMessage, index: number) => {
    // Use timestamp as key for stable rendering, fallback to index if needed
    const key = `${message.timestamp}-${index}`;

    if (isSystemMessage(message)) {
      return <SystemMessageComponent key={key} message={message} />;
    } else if (isToolMessage(message)) {
      return <ToolMessageComponent key={key} message={message} />;
    } else if (isToolResultMessage(message)) {
      return <ToolResultMessageComponent key={key} message={message} />;
    } else if (isPlanMessage(message)) {
      return <PlanMessageComponent key={key} message={message} />;
    } else if (isThinkingMessage(message)) {
      return <ThinkingMessageComponent key={key} message={message} />;
    } else if (isTodoMessage(message)) {
      return <TodoMessageComponent key={key} message={message} />;
    } else if (isChatMessage(message)) {
      return <ChatMessageComponent key={key} message={message} />;
    }
    return null;
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-[var(--surface-panel)]">
      <header className="flex shrink-0 items-center gap-2.5 px-4 py-3 sm:px-5">
        <h1 className="truncate text-[15px] font-semibold">
          Build with Claude
        </h1>
        <span
          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
            isLoading
              ? "bg-[var(--success-soft)] text-[var(--success)]"
              : "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
          }`}
        >
          {isLoading ? "Working" : "Ready"}
        </span>
      </header>
      <div
        ref={messagesContainerRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8 sm:px-6"
        aria-label="Builder conversation"
        role="region"
      >
        {visibleMessages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mx-auto flex w-full max-w-[800px] flex-col pt-2">
            {visibleMessages.map(renderMessage)}
            {isLoading && <LoadingComponent />}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>
    </section>
  );
}

function EmptyState() {
  const steps = [
    { icon: ClipboardDocumentListIcon, label: "Share context" },
    { icon: ListBulletIcon, label: "Review the plan" },
    { icon: WrenchScrewdriverIcon, label: "Build and verify" },
  ];

  return (
    <div className="builder-enter flex min-h-full items-center justify-center py-10 text-center">
      <div className="w-full max-w-lg">
        <div className="relative mx-auto mb-6 flex size-16 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)] shadow-[0_14px_36px_rgba(255,171,51,0.18)] ring-1 ring-[var(--accent)]/20">
          <SparklesIcon className="size-7" />
          <span className="absolute -right-1.5 -bottom-1.5 flex size-7 items-center justify-center rounded-lg border-2 border-[var(--surface-panel)] bg-[var(--accent)] text-[var(--accent-text)] shadow-sm">
            <span className="text-xs font-bold">AI</span>
          </span>
        </div>
        <h2 className="text-balance text-2xl font-semibold tracking-tight">
          Turn an idea into a working build
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--text-secondary)]">
          Describe what you want to create. Claude will collect the context,
          make a plan, use tools, and keep the build progress visible.
        </p>
        <div className="mt-7 grid gap-2 sm:grid-cols-3">
          {steps.map(({ icon: Icon, label }) => (
            <div
              className="flex flex-col items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-3 py-4"
              key={label}
            >
              <Icon className="size-4 text-[var(--text-secondary)]" />
              <span className="text-xs font-medium">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
