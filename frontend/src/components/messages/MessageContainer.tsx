import React from "react";

interface MessageContainerProps {
  alignment: "left" | "right" | "center";
  colorScheme: string;
  children: React.ReactNode;
}

export function MessageContainer({
  alignment,
  colorScheme,
  children,
}: MessageContainerProps) {
  const justifyClass =
    alignment === "right"
      ? "justify-end"
      : alignment === "center"
        ? "justify-center"
        : "justify-start";

  return (
    <div className={`builder-enter mb-8 flex ${justifyClass}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 sm:max-w-[90%] ${colorScheme}`}
      >
        {children}
      </div>
    </div>
  );
}
