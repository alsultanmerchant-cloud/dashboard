// Print surface layout — no sidebar/chrome, forced LIGHT theme (dark wastes
// ink and prints badly), A4-friendly rules. Lives outside the (dashboard)
// group on purpose; the root layout still provides fonts/i18n/demo-mode.

// Undo the root theme bootstrap (which may have applied `dark` from
// localStorage) BEFORE first paint, so the print page is always light.
const forceLight = `(function(){try{document.documentElement.classList.remove('dark');document.documentElement.style.colorScheme='light';}catch(e){}})();`;

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="print-root min-h-screen bg-background text-foreground">
      <script dangerouslySetInnerHTML={{ __html: forceLight }} />
      <style>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          .print-hide { display: none !important; }
          .print-root { min-height: 0; }
          .report-section { break-inside: avoid; }
          a { text-decoration: none; color: inherit; }
        }
        .print-root .report-document table { font-size: 11px; }
      `}</style>
      <div className="mx-auto max-w-[210mm] px-6 py-8 print:max-w-none print:px-0 print:py-0">
        {children}
      </div>
    </div>
  );
}
