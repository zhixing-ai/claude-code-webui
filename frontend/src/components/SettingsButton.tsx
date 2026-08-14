import { CogIcon } from "@heroicons/react/24/outline";

interface SettingsButtonProps {
  onClick: () => void;
}

export function SettingsButton({ onClick }: SettingsButtonProps) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl p-2.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      aria-label="Open settings"
    >
      <CogIcon className="size-5" />
    </button>
  );
}
