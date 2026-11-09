import type { BrowserOptions } from "@sentry/nextjs";

/**
 * What Sentry may send: the error and its stack, nothing about the player. Sentry's defaults collect cookies,
 * headers, query strings (search terms, phone numbers) and request bodies, so each is switched off here.
 */
export const sentryPrivacy: NonNullable<BrowserOptions["dataCollection"]> = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  stackFrameVariables: false,
};
