import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import type { JSX } from "react";
import { useState, useEffect, useCallback } from "react";

// Helper function to extract command name from pattern like "Bash(ls:*)" -> "ls"
function extractCommandName(pattern: string): string {
  if (!pattern) return "Unknown";
  const match = pattern.match(/Bash\(([^:]+):/);
  return match ? match[1] : pattern;
}

// Helper function to render permission content based on patterns
function renderPermissionContent(patterns: string[]): JSX.Element {
  // Handle empty patterns array
  if (patterns.length === 0) {
    return (
      <p className="mb-3 text-[var(--text-secondary)]">
        Claude wants to use bash commands, but the specific commands could not
        be determined.
      </p>
    );
  }

  const isMultipleCommands = patterns.length > 1;

  if (isMultipleCommands) {
    // Extract command names from patterns like "Bash(ls:*)" -> "ls"
    const commandNames = patterns.map(extractCommandName);

    return (
      <>
        <p className="mb-2 text-[var(--text-secondary)]">
          Claude wants to use the following commands:
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {commandNames.map((cmd, index) => (
            <span
              key={index}
              className="rounded bg-[var(--surface-hover)] px-2 py-1 font-mono text-sm"
            >
              {cmd}
            </span>
          ))}
        </div>
      </>
    );
  } else {
    const commandName = extractCommandName(patterns[0]);
    return (
      <p className="mb-3 text-[var(--text-secondary)]">
        Claude wants to use the{" "}
        <span className="rounded bg-[var(--surface-hover)] px-2 py-1 font-mono text-sm">
          {commandName}
        </span>{" "}
        command.
      </p>
    );
  }
}

// Helper function to render button text for permanent permission
function renderPermanentButtonText(patterns: string[]): string {
  // Handle empty patterns array
  if (patterns.length === 0) {
    return "Yes, and don't ask again for bash commands";
  }

  const isMultipleCommands = patterns.length > 1;
  const commandNames = patterns.map(extractCommandName);

  if (isMultipleCommands) {
    return `Yes, and don't ask again for ${commandNames.join(" and ")} commands`;
  } else {
    return `Yes, and don't ask again for ${commandNames[0]} command`;
  }
}

interface PermissionInputPanelProps {
  patterns: string[];
  title?: string;
  description?: string;
  canRemember?: boolean;
  onAllow: () => void;
  onAllowPermanent: () => void;
  onDeny: () => void;
  // Optional extension point for custom button styling (e.g., demo effects)
  getButtonClassName?: (
    buttonType: "allow" | "allowPermanent" | "deny",
    defaultClassName: string,
  ) => string;
  // Optional callback for demo automation to control selection state
  onSelectionChange?: (selection: "allow" | "allowPermanent" | "deny") => void;
  // Optional external control for demo automation (overrides internal state)
  externalSelectedOption?: "allow" | "allowPermanent" | "deny" | null;
}

export function PermissionInputPanel({
  patterns,
  title,
  description,
  canRemember = true,
  onAllow,
  onAllowPermanent,
  onDeny,
  getButtonClassName = (_, defaultClassName) => defaultClassName, // Default: no modification
  onSelectionChange, // Optional callback for demo automation
  externalSelectedOption, // Optional external control for demo automation
}: PermissionInputPanelProps) {
  const [selectedOption, setSelectedOption] = useState<
    "allow" | "allowPermanent" | "deny" | null
  >("allow");

  // Check if component is externally controlled (for demo mode)
  const isExternallyControlled = externalSelectedOption !== undefined;

  // Use external selection if provided (for demo), otherwise use internal state
  const effectiveSelectedOption = externalSelectedOption ?? selectedOption;

  // Update selection state based on external changes (for demo automation)
  const updateSelectedOption = useCallback(
    (option: "allow" | "allowPermanent" | "deny") => {
      // Only update internal state if not controlled externally
      if (externalSelectedOption === undefined) {
        setSelectedOption(option);
      }
      onSelectionChange?.(option);
    },
    [onSelectionChange, externalSelectedOption],
  );

  // Handle keyboard navigation
  useEffect(() => {
    // Skip keyboard navigation if controlled externally (demo mode)
    if (externalSelectedOption !== undefined) return;

    // Define options array inside useEffect to avoid unnecessary re-renders
    const options: ("allow" | "allowPermanent" | "deny")[] = canRemember
      ? ["allow", "allowPermanent", "deny"]
      : ["allow", "deny"];

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const currentIndex = options.indexOf(effectiveSelectedOption!);
        const nextIndex = (currentIndex + 1) % options.length;
        updateSelectedOption(options[nextIndex]);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const currentIndex = options.indexOf(effectiveSelectedOption!);
        const prevIndex = (currentIndex - 1 + options.length) % options.length;
        updateSelectedOption(options[prevIndex]);
      } else if (e.key === "Enter" && effectiveSelectedOption) {
        e.preventDefault();
        // Execute the currently selected option
        if (effectiveSelectedOption === "allow") {
          onAllow();
        } else if (effectiveSelectedOption === "allowPermanent") {
          onAllowPermanent();
        } else if (effectiveSelectedOption === "deny") {
          onDeny();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onDeny(); // "Deny" option when ESC is pressed
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    effectiveSelectedOption,
    onAllow,
    onAllowPermanent,
    onDeny,
    updateSelectedOption,
    externalSelectedOption,
    canRemember,
  ]);

  return (
    <div className="builder-enter flex-shrink-0 rounded-xl bg-[var(--surface-panel)] px-4 py-4 ring-1 ring-[var(--border-subtle)]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="rounded-lg bg-[var(--accent-soft)] p-2">
          <ExclamationTriangleIcon className="h-5 w-5 text-[var(--accent-strong)]" />
        </div>
        <h3 className="text-base font-semibold">Permission Required</h3>
      </div>

      {/* Content */}
      <div className="mb-4">
        {title ? (
          <p className="mb-2 text-[var(--text-secondary)]">{title}</p>
        ) : (
          renderPermissionContent(patterns)
        )}
        {description && (
          <p className="mb-3 text-sm text-[var(--text-tertiary)]">
            {description}
          </p>
        )}
        <p className="text-sm text-[var(--text-tertiary)]">
          Do you want to proceed? (Press ESC to deny)
        </p>
      </div>

      {/* Direct-click permission options with selection state */}
      <div className="space-y-2">
        <button
          onClick={() => {
            updateSelectedOption("allow");
            onAllow();
          }}
          onFocus={() => updateSelectedOption("allow")}
          onBlur={() => {
            if (!isExternallyControlled) {
              setSelectedOption(null);
            }
          }}
          onMouseEnter={() => updateSelectedOption("allow")}
          onMouseLeave={() => {
            if (!isExternallyControlled) {
              setSelectedOption(null);
            }
          }}
          className={getButtonClassName(
            "allow",
            `w-full p-3 rounded-lg cursor-pointer transition-[background-color,box-shadow] duration-200 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
              effectiveSelectedOption === "allow"
                ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]/40"
                : "hover:bg-[var(--surface-hover)] ring-1 ring-transparent"
            }`,
          )}
        >
          <span
            className={`text-sm font-medium ${
              effectiveSelectedOption === "allow"
                ? "text-[var(--accent-strong)]"
                : "text-[var(--text-secondary)]"
            }`}
          >
            Yes
          </span>
        </button>

        {canRemember && (
          <button
            onClick={() => {
              updateSelectedOption("allowPermanent");
              onAllowPermanent();
            }}
            onFocus={() => updateSelectedOption("allowPermanent")}
            onBlur={() => {
              if (!isExternallyControlled) {
                setSelectedOption(null);
              }
            }}
            onMouseEnter={() => updateSelectedOption("allowPermanent")}
            onMouseLeave={() => {
              if (!isExternallyControlled) {
                setSelectedOption(null);
              }
            }}
            className={getButtonClassName(
              "allowPermanent",
              `w-full p-3 rounded-lg cursor-pointer transition-[background-color,box-shadow] duration-200 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
                effectiveSelectedOption === "allowPermanent"
                  ? "bg-[var(--success-soft)] ring-1 ring-[var(--success)]/40"
                  : "hover:bg-[var(--surface-hover)] ring-1 ring-transparent"
              }`,
            )}
          >
            <span
              className={`text-sm font-medium ${
                effectiveSelectedOption === "allowPermanent"
                  ? "text-[var(--success)]"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              {renderPermanentButtonText(patterns)}
            </span>
          </button>
        )}

        <button
          onClick={() => {
            updateSelectedOption("deny");
            onDeny();
          }}
          onFocus={() => updateSelectedOption("deny")}
          onBlur={() => {
            if (!isExternallyControlled) {
              setSelectedOption(null);
            }
          }}
          onMouseEnter={() => updateSelectedOption("deny")}
          onMouseLeave={() => {
            if (!isExternallyControlled) {
              setSelectedOption(null);
            }
          }}
          className={getButtonClassName(
            "deny",
            `w-full p-3 rounded-lg cursor-pointer transition-[background-color,box-shadow] duration-200 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
              effectiveSelectedOption === "deny"
                ? "bg-[var(--surface-hover)] ring-1 ring-[var(--border-strong)]"
                : "hover:bg-[var(--surface-hover)] ring-1 ring-transparent"
            }`,
          )}
        >
          <span
            className={`text-sm font-medium ${
              effectiveSelectedOption === "deny"
                ? "text-[var(--text-primary)]"
                : "text-[var(--text-secondary)]"
            }`}
          >
            No
          </span>
        </button>
      </div>
    </div>
  );
}
