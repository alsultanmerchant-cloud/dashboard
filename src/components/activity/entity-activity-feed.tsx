// Entity-agnostic activity feed (contracts & clients).
// Async server component adapted from the task comments feed: renders the
// unified EntityActivity[] union — local comments, imported sheet logs, and
// synthesized events — as a single avatar+name+timestamp+body timeline.

import { Paperclip } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { logTypeMeta } from "@/app/(dashboard)/contracts/log-type-meta";
import { SheetLogNote, SheetLogSnapshot } from "@/app/(dashboard)/contracts/sheet-log-note";
import type { EntityActivity } from "@/lib/data/entity-activity";

function formatDateTime(value: string, locale: string): string {
  return new Date(value).toLocaleString(locale === "ar" ? "ar-SA" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Known event types map onto Activity.events.<TYPE>; anything else falls back
// to Activity.events.default. messages.has() lets us probe without throwing.
const KNOWN_EVENT_TYPES = new Set([
  "ON_HOLD",
  "HOLD_LIFTED",
  "HOLD_UPDATED",
  "STATUS_CHANGE",
  "TARGET_CHANGE",
  "TYPE_CHANGE",
  "VALUE_CHANGE",
]);

export async function EntityActivityFeed({ items }: { items: EntityActivity[] }) {
  const t = await getTranslations("Activity");
  const tc = await getTranslations("ContractsPage");
  const locale = await getLocale();

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          {t("feed.empty")}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y divide-white/[0.04]">
          {items.map((item) => (
            <li key={`${item.kind}:${item.id}`} className="flex items-start gap-3 px-1 py-3">
              <Avatar size="sm">
                {item.actor?.avatar && (
                  <AvatarImage src={item.actor.avatar} alt={item.actor.name} />
                )}
                <AvatarFallback>{item.actor?.name?.[0] ?? "·"}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {item.actor?.name ?? t("feed.employeeFallback")}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDateTime(item.created_at, locale)}
                  </p>
                </div>

                {item.kind === "comment" && (
                  <>
                    <p className="mt-1 text-sm whitespace-pre-wrap leading-relaxed break-words [unicode-bidi:plaintext]">
                      {item.body}
                    </p>
                    {item.attachments.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {item.attachments.map((att) =>
                          att.url ? (
                            <a
                              key={att.id}
                              href={att.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-soft-2 bg-card/60 px-2 py-0.5 text-[11px] transition-colors hover:border-cyan/40 hover:text-cyan"
                              title={att.filename}
                            >
                              <Paperclip className="size-3 text-muted-foreground" />
                              <span className="max-w-[14rem] truncate">{att.filename}</span>
                            </a>
                          ) : (
                            <span
                              key={att.id}
                              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-soft-2 bg-card/60 px-2 py-0.5 text-[11px]"
                              title={att.filename}
                            >
                              <Paperclip className="size-3 text-muted-foreground" />
                              <span className="max-w-[14rem] truncate">{att.filename}</span>
                            </span>
                          ),
                        )}
                      </div>
                    )}
                  </>
                )}

                {item.kind === "sheet_log" && (
                  <div className="mt-1">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium",
                        logTypeMeta(item.log_type).badge,
                      )}
                    >
                      {tc.has(`logs.types.${logTypeMeta(item.log_type).key}`)
                        ? tc(`logs.types.${logTypeMeta(item.log_type).key}`)
                        : item.log_type}
                    </span>
                    <SheetLogNote
                      notes={item.notes}
                      wasLabel={tc("logs.note.was")}
                      locale={locale}
                      className="mt-1.5"
                    />
                    <SheetLogSnapshot
                      snapshot={item.snapshot}
                      title={
                        locale === "ar"
                          ? "تفاصيل العقد وقت الحدث"
                          : "Contract details at this event"
                      }
                      className="mt-2"
                    />
                  </div>
                )}

                {item.kind === "event" && (
                  <EventBody item={item} eventLabel={eventLabel(t, item.event_type)} />
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function eventLabel(
  t: Awaited<ReturnType<typeof getTranslations<"Activity">>>,
  eventType: string,
): string {
  return KNOWN_EVENT_TYPES.has(eventType)
    ? t(`events.${eventType}` as "events.default")
    : t("events.default");
}

function EventBody({
  item,
  eventLabel,
}: {
  item: Extract<EntityActivity, { kind: "event" }>;
  eventLabel: string;
}) {
  const note = typeof item.payload.note === "string" ? item.payload.note : null;
  const from = item.payload.from;
  const to = item.payload.to;
  const hasFromTo =
    (typeof from === "string" || typeof from === "number") &&
    (typeof to === "string" || typeof to === "number");

  return (
    <div className="mt-1 space-y-1">
      <p className="text-xs text-muted-foreground">{eventLabel}</p>
      {hasFromTo && (
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground [unicode-bidi:plaintext]">
          <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-200/90 line-through decoration-rose-400/40">
            {String(from) || "—"}
          </span>
          <span>→</span>
          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-200">
            {String(to) || "—"}
          </span>
        </p>
      )}
      {note && (
        <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground [unicode-bidi:plaintext]">
          {note}
        </p>
      )}
    </div>
  );
}
