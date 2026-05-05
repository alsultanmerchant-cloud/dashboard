"use client";

import DOMPurify from "isomorphic-dompurify";

// Renders a task description that may be HTML (Odoo chatter / rich-text editor)
// or plain text. Odoo's editor outputs <p>, <a href>, <br>, <ul>, etc — we
// sanitize and render those rather than displaying the raw markup as text.
export function TaskDescription({ html }: { html: string | null | undefined }) {
  const value = (html ?? "").trim();
  if (!value) {
    return <span className="text-sm text-muted-foreground">لا يوجد وصف لهذه المهمة.</span>;
  }
  const looksHtml = /<\/?(p|a|br|div|span|ul|ol|li|h[1-6]|img|strong|em|b|i|table)\b/i.test(value);
  if (!looksHtml) {
    return <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{value}</p>;
  }
  const safe = DOMPurify.sanitize(value, {
    ALLOWED_TAGS: [
      "p","a","br","div","span","ul","ol","li","strong","em","b","i",
      "h1","h2","h3","h4","h5","h6","blockquote","code","pre","hr","table","thead","tbody","tr","td","th","img",
    ],
    ALLOWED_ATTR: ["href","target","rel","title","src","alt"],
  });
  return (
    <div
      className="text-sm leading-relaxed break-words [&_a]:text-primary [&_a]:underline [&_p]:mt-2 [&_p:first-child]:mt-0 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ms-5 [&_ol]:ms-5"
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
