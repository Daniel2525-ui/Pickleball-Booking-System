/** Transactional email through Resend's REST API (https://resend.com/docs/api-reference/emails/send-email). */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Resend drops a repeat with the same key for 24 hours, so a retried send never arrives twice */
  idempotencyKey: string;
}

/** sent; rejected = Resend refused this message for good (bad address...), do not retry; retry = try again later */
export type SendResult = "sent" | "rejected" | "retry";
export type SendEmail = (message: EmailMessage) => Promise<SendResult>;

type Deps = { fetch?: typeof fetch; apiKey?: string; from?: string };

/** True when this deployment has a sender set up (RESEND_API_KEY and EMAIL_FROM). */
export const emailConfigured = () => !!(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());

export const sendEmail = async (message: EmailMessage, deps: Deps = {}): Promise<SendResult> => {
  const f = deps.fetch ?? globalThis.fetch;
  const { idempotencyKey, ...email } = message;
  try {
    const res = await f("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deps.apiKey ?? process.env.RESEND_API_KEY?.trim() ?? ""}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ from: deps.from ?? process.env.EMAIL_FROM?.trim(), ...email }),
    });
    if (res.ok) return "sent";
    console.error(`Resend refused an email (${res.status}):`, await res.text().catch(() => ""));
    // 429 (rate limit) and 5xx are temporary; any other 4xx will fail the same way every time
    return res.status === 429 || res.status >= 500 ? "retry" : "rejected";
  } catch (err) {
    console.error("Resend request failed:", err);
    return "retry";
  }
};
