import * as Sentry from "@sentry/nextjs";
import { sentryPrivacy } from "@/lib/sentryPrivacy";

/**
 * Server error monitoring (Sentry). Off until SENTRY_DSN is set for this deployment.
 * Most errors here are caught and logged, so every console.error is reported too, not only uncaught ones.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" && process.env.NEXT_RUNTIME !== "edge") return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    enabled: !!process.env.SENTRY_DSN,
    dataCollection: sentryPrivacy,
    tracesSampleRate: 0, // errors only, no performance tracing
    integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
  });
}

export const onRequestError = Sentry.captureRequestError;
