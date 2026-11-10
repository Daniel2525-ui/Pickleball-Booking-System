"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { describeSettingsChange, type SettingsChange } from "@/lib/services/settings/settingsChanges";
import { StaffCard } from "./staff-card";
import { PolicyCard } from "./policy-card";
import { ContactCard } from "./contact-card";

export function SettingsContainer() {
  const [history, setHistory] = useState<SettingsChange[] | null>(null);

  const loadHistory = () =>
    supabase
      .from("settings_changes")
      .select("id, changed_at, area, before, after, profiles(full_name)")
      .order("changed_at", { ascending: false })
      .limit(5)
      .then(({ data }) => setHistory((data ?? []) as unknown as SettingsChange[]));

  useEffect(() => {
    loadHistory();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <ContactCard onChanged={loadHistory} />

      <PolicyCard onChanged={loadHistory} />

      <StaffCard onChanged={loadHistory} />

      {history && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl font-bold">Recent Changes</CardTitle>
            <CardDescription>Who changed the contact details, booking rules or staff access, and when. The last five changes, newest first.</CardDescription>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes recorded yet. Changes are recorded from when this feature went live.</p>
            ) : (
              <ol className="space-y-3">
                {history.map((h) => (
                  <li key={h.id} className="border-l-2 border-border pl-3 text-sm">
                    <p>
                      <span className="font-semibold text-foreground">{h.profiles?.full_name?.trim() || "Staff"}</span>
                      <span className="text-muted-foreground">
                        {" · "}
                        {new Date(h.changed_at).toLocaleString("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </span>
                    </p>
                    <ul className="text-xs text-muted-foreground">
                      {describeSettingsChange(h).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
