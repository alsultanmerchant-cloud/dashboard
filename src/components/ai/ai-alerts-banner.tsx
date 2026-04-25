"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, TrendingUp, ChevronDown, ChevronUp, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/supabase/db";

interface AlertItem {
  id: string;
  type: "critical" | "warning" | "opportunity";
  message: string;
}

const ALERT_STYLES = {
  critical:    { bg: "bg-cc-red/10",    border: "border-cc-red/30",    text: "text-cc-red",    icon: AlertTriangle },
  warning:     { bg: "bg-amber/10",     border: "border-amber/30",     text: "text-amber",     icon: AlertTriangle },
  opportunity: { bg: "bg-cc-green/10",  border: "border-cc-green/30",  text: "text-cc-green",  icon: TrendingUp },
};

export function AIAlertsBanner() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("alerts")
      .select("id, type, message")
      .eq("org_id", getOrgId())
      .eq("is_dismissed", false)
      .order("created_at", { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (data) setAlerts(data as AlertItem[]);
      });
  }, []);

  const visibleAlerts = alerts.filter((a) => !dismissed.has(a.id));

  if (visibleAlerts.length === 0) return null;

  const firstAlert = visibleAlerts[0];
  const style = ALERT_STYLES[firstAlert.type] ?? ALERT_STYLES.warning;
  const Icon = style.icon;

  return (
    <div className="mb-4">
      <div className={`${style.bg} border ${style.border} rounded-xl overflow-hidden`}>
        {/* Collapsed: show first alert */}
        <div className="flex items-center gap-3 px-4 py-2.5">
          <Icon className={`w-4 h-4 ${style.text} flex-shrink-0`} />
          <span className={`text-xs ${style.text} flex-1`}>{firstAlert.message}</span>
          {visibleAlerts.length > 1 && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              {visibleAlerts.length - 1} تنبيهات أخرى
              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>

        {/* Expanded: show all alerts */}
        {isExpanded && (
          <div className="border-t border-border/50 px-4 py-2 space-y-2">
            {visibleAlerts.slice(1).map((alert) => {
              const s = ALERT_STYLES[alert.type] ?? ALERT_STYLES.warning;
              const AlertIcon = s.icon;
              return (
                <div key={alert.id} className="flex items-center gap-3">
                  <AlertIcon className={`w-3.5 h-3.5 ${s.text} flex-shrink-0`} />
                  <span className={`text-xs ${s.text} flex-1`}>{alert.message}</span>
                  <button
                    onClick={() => setDismissed((prev) => new Set(prev).add(alert.id))}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
