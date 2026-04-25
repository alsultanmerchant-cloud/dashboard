// /dev — bare layout used for the design-system showcase. No sidebar/topbar.
export default function DevLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <div className="command-grid pointer-events-none fixed inset-0 opacity-[0.18]" aria-hidden />
      <div className="relative">{children}</div>
    </div>
  );
}
