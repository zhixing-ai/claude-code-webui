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
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white/80 shadow-sm backdrop-blur-sm dark:border-slate-700/70 dark:bg-slate-800/80">
      <div className="flex items-center justify-between border-b border-slate-200/70 px-4 py-3 dark:border-slate-700/70">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Conversations
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            This project
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 xl:hidden dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
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
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" />
          New conversation
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading || !workingDirectory ? (
          <p className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Loading conversations...
          </p>
        ) : error ? (
          <p className="px-3 py-6 text-center text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : conversations.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <ChatBubbleLeftRightIcon className="mx-auto h-7 w-7 text-slate-400" />
            <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              No conversations yet
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
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
                        ? "bg-blue-50 text-blue-900 ring-1 ring-blue-200 dark:bg-blue-950/50 dark:text-blue-100 dark:ring-blue-800"
                        : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700/70"
                    }`}
                  >
                    <span className="block truncate text-sm font-medium">
                      {title}
                    </span>
                    {conversation.customTitle &&
                      conversation.summary &&
                      conversation.summary !== conversation.customTitle && (
                        <span className="mt-1 block truncate text-xs text-slate-600 dark:text-slate-300">
                          {conversation.summary}
                        </span>
                      )}
                    <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
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
