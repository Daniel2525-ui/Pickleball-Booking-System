"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

// Replaces the root layout when it crashes, so it brings its own html/body and inline styles (globals.css may not load)
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 16, textAlign: "center", background: "#0d131f", color: "#f5f7fa", fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Something went wrong</h1>
        <p style={{ maxWidth: 360, fontSize: 14, opacity: 0.75, margin: 0 }}>Please try again. If it keeps happening, contact the front desk.</p>
        <button onClick={() => retry()} style={{ minHeight: 44, padding: "0 24px", borderRadius: 8, border: 0, background: "#c6f432", color: "#0d131f", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
