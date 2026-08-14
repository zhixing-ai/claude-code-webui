import React, { useRef, useEffect, useState } from "react";
import { StopIcon } from "@heroicons/react/24/solid";
import { ArrowUpIcon } from "@heroicons/react/24/outline";
import { UI_CONSTANTS, KEYBOARD_SHORTCUTS } from "../../utils/constants";
import { useEnterBehavior } from "../../hooks/useSettings";
import { PermissionInputPanel } from "./PermissionInputPanel";
import { PlanPermissionInputPanel } from "./PlanPermissionInputPanel";
import { AskUserQuestionPanel } from "./AskUserQuestionPanel";
import type { AskUserQuestionItem, PermissionMode } from "../../types";

interface PermissionData {
  patterns: string[];
  title?: string;
  description?: string;
  canRemember?: boolean;
  onAllow: () => void;
  onAllowPermanent: () => void;
  onDeny: () => void;
  getButtonClassName?: (
    buttonType: "allow" | "allowPermanent" | "deny",
    defaultClassName: string,
  ) => string;
  onSelectionChange?: (selection: "allow" | "allowPermanent" | "deny") => void;
  externalSelectedOption?: "allow" | "allowPermanent" | "deny" | null;
}

interface PlanPermissionData {
  onAcceptWithEdits: () => void;
  onAcceptDefault: () => void;
  onKeepPlanning: () => void;
  getButtonClassName?: (
    buttonType: "acceptWithEdits" | "acceptDefault" | "keepPlanning",
    defaultClassName: string,
  ) => string;
  onSelectionChange?: (
    selection: "acceptWithEdits" | "acceptDefault" | "keepPlanning",
  ) => void;
  externalSelectedOption?:
    | "acceptWithEdits"
    | "acceptDefault"
    | "keepPlanning"
    | null;
}

export interface AskUserQuestionData {
  questions: AskUserQuestionItem[];
  onSubmit: (answers: Record<string, string>) => Promise<void>;
  onCancel: () => Promise<void>;
}

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  currentRequestId: string | null;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onAbort: () => void;
  // Permission mode props
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
  showPermissions?: boolean;
  permissionData?: PermissionData;
  planPermissionData?: PlanPermissionData;
  askUserQuestionData?: AskUserQuestionData;
}

export function ChatInput({
  input,
  isLoading,
  currentRequestId,
  onInputChange,
  onSubmit,
  onAbort,
  permissionMode,
  onPermissionModeChange,
  showPermissions = false,
  permissionData,
  planPermissionData,
  askUserQuestionData,
}: ChatInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isComposing, setIsComposing] = useState(false);
  const { enterBehavior } = useEnterBehavior();

  // Focus input when not loading and not in permission mode
  useEffect(() => {
    if (
      !isLoading &&
      !showPermissions &&
      !askUserQuestionData &&
      inputRef.current
    ) {
      inputRef.current.focus();
    }
  }, [isLoading, showPermissions, askUserQuestionData]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = inputRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const computedStyle = getComputedStyle(textarea);
      const maxHeight =
        parseInt(computedStyle.maxHeight, 10) ||
        UI_CONSTANTS.TEXTAREA_MAX_HEIGHT;
      const scrollHeight = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = `${scrollHeight}px`;
    }
  }, [input]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Permission mode toggle: Ctrl+Shift+M (all platforms)
    if (
      e.key === KEYBOARD_SHORTCUTS.PERMISSION_MODE_TOGGLE &&
      e.shiftKey &&
      e.ctrlKey &&
      !e.metaKey && // Avoid conflicts with browser shortcuts on macOS
      !isComposing
    ) {
      e.preventDefault();
      onPermissionModeChange(getNextPermissionMode(permissionMode));
      return;
    }

    if (e.key === KEYBOARD_SHORTCUTS.SUBMIT && !isComposing) {
      if (enterBehavior === "newline") {
        handleNewlineModeKeyDown(e);
      } else {
        handleSendModeKeyDown(e);
      }
    }
  };

  const handleNewlineModeKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    // Newline mode: Enter adds newline, Shift+Enter sends
    if (e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
    // Enter is handled naturally by textarea (adds newline)
  };

  const handleSendModeKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    // Send mode: Enter sends, Shift+Enter adds newline
    if (!e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
    // Shift+Enter is handled naturally by textarea (adds newline)
  };
  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  const handleCompositionEnd = () => {
    // Add small delay to handle race condition between composition and keydown events
    setTimeout(() => setIsComposing(false), 0);
  };

  // Get clean permission mode name (without emoji)
  const getPermissionModeName = (mode: PermissionMode): string => {
    switch (mode) {
      case "default":
        return "normal mode";
      case "plan":
        return "plan mode";
      case "acceptEdits":
        return "accept edits";
    }
  };

  // Get next permission mode for cycling
  const getNextPermissionMode = (current: PermissionMode): PermissionMode => {
    const modes: PermissionMode[] = ["default", "plan", "acceptEdits"];
    const currentIndex = modes.indexOf(current);
    return modes[(currentIndex + 1) % modes.length];
  };

  if (askUserQuestionData) {
    return (
      <div className="shrink-0 px-4 pb-3 sm:px-6">
        <div className="mx-auto w-full max-w-[800px]">
          <AskUserQuestionPanel {...askUserQuestionData} />
        </div>
      </div>
    );
  }

  // If we're in plan permission mode, show the plan permission panel instead
  if (showPermissions && planPermissionData) {
    return (
      <div className="shrink-0 px-4 pb-3 sm:px-6">
        <div className="mx-auto w-full max-w-[800px]">
          <PlanPermissionInputPanel
            onAcceptWithEdits={planPermissionData.onAcceptWithEdits}
            onAcceptDefault={planPermissionData.onAcceptDefault}
            onKeepPlanning={planPermissionData.onKeepPlanning}
            getButtonClassName={planPermissionData.getButtonClassName}
            onSelectionChange={planPermissionData.onSelectionChange}
            externalSelectedOption={planPermissionData.externalSelectedOption}
          />
        </div>
      </div>
    );
  }

  // If we're in regular permission mode, show the permission panel instead
  if (showPermissions && permissionData) {
    return (
      <div className="shrink-0 px-4 pb-3 sm:px-6">
        <div className="mx-auto w-full max-w-[800px]">
          <PermissionInputPanel
            patterns={permissionData.patterns}
            title={permissionData.title}
            description={permissionData.description}
            canRemember={permissionData.canRemember}
            onAllow={permissionData.onAllow}
            onAllowPermanent={permissionData.onAllowPermanent}
            onDeny={permissionData.onDeny}
            getButtonClassName={permissionData.getButtonClassName}
            onSelectionChange={permissionData.onSelectionChange}
            externalSelectedOption={permissionData.externalSelectedOption}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 px-4 pt-2 pb-3 sm:px-6">
      <form
        onSubmit={handleSubmit}
        className="mx-auto w-full max-w-[800px] rounded-[24px] bg-[var(--surface-panel)] px-3 pt-1.5 pb-3 shadow-[0_3px_16px_rgba(15,23,42,0.06)] ring-1 ring-[var(--border-subtle)] transition-shadow focus-within:shadow-[0_6px_24px_rgba(15,23,42,0.09)]"
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          placeholder={
            isLoading && currentRequestId
              ? "Claude is working…"
              : "Type message..."
          }
          rows={1}
          style={{ maxHeight: UI_CONSTANTS.TEXTAREA_MAX_HEIGHT }}
          className="min-h-14 w-full resize-none overflow-y-auto border-0 bg-transparent px-4 py-3 text-base leading-6 text-[var(--text-primary)] outline-none placeholder:text-[13px] placeholder:text-[var(--text-tertiary)] disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
          disabled={isLoading}
        />
        <div className="flex items-center justify-between px-0.5">
          <button
            type="button"
            onClick={() =>
              onPermissionModeChange(getNextPermissionMode(permissionMode))
            }
            className="rounded-full px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            title={`Current: ${getPermissionModeName(permissionMode)} · Ctrl+Shift+M`}
          >
            {getPermissionModeName(permissionMode)}
          </button>
          {isLoading && currentRequestId && (
            <button
              type="button"
              onClick={onAbort}
              className="flex size-8 items-center justify-center rounded-full bg-[var(--text-primary)] text-[var(--surface-panel)] transition-[opacity,transform] hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] active:scale-95"
              title="Stop (ESC)"
              aria-label="Stop"
            >
              <StopIcon className="size-3.5" />
            </button>
          )}
          {!isLoading && (
            <button
              type="submit"
              aria-label={permissionMode === "plan" ? "Plan" : "Send"}
              disabled={!input.trim()}
              className="flex size-8 items-center justify-center rounded-full bg-[var(--text-primary)] text-[var(--surface-panel)] transition-[opacity,transform] hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] active:scale-95 disabled:cursor-not-allowed disabled:bg-[var(--surface-hover)] disabled:text-[var(--text-tertiary)] disabled:opacity-100"
            >
              <ArrowUpIcon className="size-4" strokeWidth={2.5} />
              <span className="sr-only">
                {permissionMode === "plan" ? "Plan" : "Send"}
              </span>
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
