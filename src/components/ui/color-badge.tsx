import { cn } from "@/lib/utils";

interface ColorBadgeProps {
  text: string;
  color: "cyan" | "green" | "amber" | "red" | "purple" | "blue" | "pink";
  size?: "sm" | "md";
}

const COLOR_CLASSES = {
  cyan: "bg-cyan-dim text-cyan",
  green: "bg-green-dim text-cc-green",
  amber: "bg-amber-dim text-amber",
  red: "bg-red-dim text-cc-red",
  purple: "bg-purple-dim text-cc-purple",
  blue: "bg-blue-dim text-cc-blue",
  pink: "bg-pink/15 text-pink",
};

export function ColorBadge({ text, color, size = "sm" }: ColorBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium",
        COLOR_CLASSES[color],
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-xs"
      )}
    >
      {text}
    </span>
  );
}
