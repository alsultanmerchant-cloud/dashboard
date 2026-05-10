"use client";

import { Brain } from "lucide-react";

interface AIChatFABProps {
  onClick: () => void;
  hasUnread?: boolean;
}

export function AIChatFAB({ onClick, hasUnread }: AIChatFABProps) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-cyan to-cc-purple shadow-lg shadow-cyan/25 transition-transform hover:scale-110 active:scale-95 rtl:right-6 ltr:left-6"
    >
      <Brain className="w-6 h-6 text-white" />
      {hasUnread && (
        <span className="absolute -top-1 h-4 w-4 rounded-full bg-cc-red border-2 border-background rtl:-left-1 ltr:-right-1" />
      )}
    </button>
  );
}
