import { useEffect, useState } from "react";
import {
  ChatBubbleLeftRightIcon,
  PlusIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import type { SessionSummary, SessionsResponse } from "../../../shared/types";
import { getSessionsUrl } from "../config/api";

interface HistoryViewProps {
  workingDirectory?: string;
  currentSessionId: string | null;
  disabled: boolean;
  refreshToken: number;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
  onClose: () => void;
}

export function HistoryView({
  workingDirectory,
  currentSessionId,
  disabled,
  refreshToken,
  onSelect,
  onNew,
  onClose,
}: HistoryViewProps) {
  const [conversations, setConversations] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workingDirectory) return;

    const loadConversations = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(getSessionsUrl(workingDirectory));
        if (!response.ok) {
          throw new Error(`Failed to load conversations: ${response.status}`);
        }
        const data = (await response.json()) as SessionsResponse;
        setConversations(data.sessions || []);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load conversations",
        );
      } finally {
        setLoading(false);
      }
    };

    loadConversations();
  }, [refreshToken, workingDirectory]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-[var(--surface-panel)] shadow-[0_2px_12px_rgba(15,23,42,0.08)] ring-1 ring-[var(--border-subtle)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Conversations</h2>
          <p className="text-xs text-[var(--text-tertiary)]">This project</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] xl:hidden"
          aria-label="Close conversation list"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
      </div>

      <div className="p-3">
        <button
          type="button"
          onClick={onNew}
          disabled={disabled}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--text-primary)] px-3 py-2.5 text-sm font-medium text-[var(--surface-panel)] transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" />
          New conversation
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading || !workingDirectory ? (
          <p className="px-3 py-6 text-center text-sm text-[var(--text-tertiary)]">
            Loading conversations...
          </p>
        ) : error ? (
          <p className="px-3 py-6 text-center text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : conversations.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <ChatBubbleLeftRightIcon className="mx-auto h-7 w-7 text-[var(--text-tertiary)]" />
            <p className="mt-2 text-sm font-medium text-[var(--text-secondary)]">
              No conversations yet
            </p>
            <p className="mt-1 text-xs text-[var(--text-tertiary)]">
              Start one above.
            </p>
          </div>
        ) : (
          <ul className="space-y-1">
            {conversations.map((conversation) => {
              const selected = conversation.sessionId === currentSessionId;
              const title =
                conversation.customTitle ||
                conversation.summary ||
                conversation.firstPrompt ||
                `Session ${conversation.sessionId.slice(0, 8)}`;
              return (
                <li key={conversation.sessionId}>
                  <button
                    type="button"
                    onClick={() => onSelect(conversation.sessionId)}
                    disabled={disabled}
                    aria-current={selected ? "page" : undefined}
                    className={`w-full rounded-xl px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      selected
                        ? "bg-[var(--accent-soft)] text-[var(--text-primary)] ring-1 ring-[var(--accent)]/25"
                        : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                    }`}
                  >
                    <span className="block truncate text-sm font-medium">
                      {title}
                    </span>
                    {conversation.customTitle &&
                      conversation.summary &&
                      conversation.summary !== conversation.customTitle && (
                        <span className="mt-1 block truncate text-xs text-[var(--text-secondary)]">
                          {conversation.summary}
                        </span>
                      )}
                    <span className="mt-1 block text-xs text-[var(--text-tertiary)]">
                      {new Date(conversation.lastModified).toLocaleString()}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
