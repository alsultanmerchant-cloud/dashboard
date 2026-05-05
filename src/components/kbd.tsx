import { cn } from "@/lib/utils";

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-soft-2 bg-soft-1 px-1.5 font-mono text-[10px] font-medium text-muted-foreground shadow-[inset_0_-1px_0_rgba(0,0,0,0.15)] dark:shadow-[inset_0_-1px_0_rgba(0,0,0,0.3)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
