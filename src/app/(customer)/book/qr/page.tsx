import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { PublicHeader } from "@/components/customers/public-header";
import { XenditQrPoller } from "@/components/customers/xendit-qr-poller";
import { getPaymentRequest, qrExpiresAt } from "@/lib/xendit";
import { qrImage } from "@/lib/xenditQr";
import { QrPhImage } from "@/components/customers/qr-ph-image";

export default async function QrPaymentPage({ searchParams }: { searchParams: Promise<{ pr?: string }> }) {
  const { pr: prId } = await searchParams;
  const pr = prId?.startsWith("pr-") ? await getPaymentRequest(prId).catch((err) => (console.error("QR page: Xendit lookup failed:", err), null)) : null;
  // Already paid (page reopened or refreshed): the success page confirms the booking
  if (pr?.status === "SUCCEEDED") redirect(`/book/success?session_id=${encodeURIComponent(pr.payment_request_id)}`);
  const expired = pr !== null && ["EXPIRED", "CANCELED", "FAILED"].includes(pr.status);
  const src = pr ? await qrImage(pr) : null;

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <PublicHeader />
      <main className="flex-1 flex flex-col items-center px-4 py-8 sm:py-12">
        <div className="max-w-lg w-full flex flex-col gap-4">
          <div className="bg-card border rounded-2xl shadow-xs p-6 sm:p-8 flex flex-col gap-5 text-center">
            <h1 className="text-2xl sm:text-3xl font-bold">Scan to pay</h1>
            {pr && src ? (
              <>
                <p className="text-sm text-muted-foreground">Open GCash, Maya or your bank app and scan this QR Ph code.</p>
                <QrPhImage src={src} />
                <p className="font-display text-4xl font-bold tabular-nums">₱{pr.request_amount.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</p>
                <XenditQrPoller prId={pr.payment_request_id} expiresAt={qrExpiresAt(pr)} testMode={Boolean(process.env.XENDIT_SECRET_KEY?.startsWith("xnd_development_"))} />
                {/* Paying on this same phone: save the code, then upload it inside the wallet app */}
                <a href={src} download="qr-ph-payment.png" className={buttonVariants({ variant: "outline", className: "w-full h-11 font-semibold" })}>
                  Save QR to photos
                </a>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {expired ? "This QR code has expired and your court hold was released. No payment was taken." : "This payment could not be loaded. Check My Bookings for your reservation."}
                </p>
                <Link href={expired ? "/#booking" : "/my-bookings"} className={buttonVariants({ className: "w-full h-11 font-semibold" })}>{expired ? "Book again" : "My Bookings"}</Link>
              </>
            )}
          </div>
          {pr && src && (
            <ol className="bg-card border rounded-2xl p-5 text-sm flex flex-col gap-2 list-decimal pl-9 text-muted-foreground">
              <li>Open GCash, Maya or your bank app and choose <b className="text-foreground">Scan QR</b>.</li>
              <li>On this phone? Tap <b className="text-foreground">Save QR to photos</b>, then upload it from your gallery in the app.</li>
              <li>Approve the exact amount. Keep this page open: we confirm your booking automatically.</li>
            </ol>
          )}
        </div>
      </main>
    </div>
  );
}
