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
      className="fixed bottom-6 left-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-cyan to-cc-purple shadow-lg shadow-cyan/25 flex items-center justify-center transition-transform hover:scale-110 active:scale-95"
    >
      <Brain className="w-6 h-6 text-white" />
      {hasUnread && (
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-cc-red rounded-full border-2 border-background" />
      )}
    </button>
  );
}
