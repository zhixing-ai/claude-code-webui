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
      className="p-3 rounded-xl bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 transition-all duration-200 backdrop-blur-sm shadow-sm hover:shadow-md"
      aria-label="Toggle conversation list"
      aria-controls="conversation-list"
      aria-expanded={expanded}
    >
      <ChatBubbleLeftRightIcon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
    </button>
  );
}
