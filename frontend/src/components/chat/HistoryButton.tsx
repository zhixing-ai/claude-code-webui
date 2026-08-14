import { ChatBubbleLeftRightIcon } from "@heroicons/react/24/outline";

interface HistoryButtonProps {
  onClick: () => void;
  expanded: boolean;
}

export function HistoryButton({ onClick, expanded }: HistoryButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl p-2.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      aria-label="Toggle conversation list"
      aria-controls="conversation-list"
      aria-expanded={expanded}
    >
      <ChatBubbleLeftRightIcon className="size-5" />
    </button>
  );
}
