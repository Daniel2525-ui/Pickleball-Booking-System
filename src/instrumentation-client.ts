import * as Sentry from "@sentry/nextjs";
import { sentryPrivacy } from "@/lib/sentryPrivacy";

// Browser error monitoring (Sentry). Off until NEXT_PUBLIC_SENTRY_DSN is set for this deployment.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  dataCollection: sentryPrivacy,
  tracesSampleRate: 0,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
