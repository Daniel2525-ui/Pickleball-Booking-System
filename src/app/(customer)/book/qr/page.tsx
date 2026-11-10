import QRCode from "qrcode";
import { PublicHeader } from "@/components/customers/public-header";
import { XenditQrPoller } from "@/components/customers/xendit-qr-poller";
import { getPaymentRequest, qrString } from "@/lib/xendit";

export default async function QrPaymentPage({ searchParams }: { searchParams: Promise<{ pr?: string }> }) {
  const { pr: prId } = await searchParams;
  const pr = prId?.startsWith("pr-") ? await getPaymentRequest(prId).catch(() => null) : null;
  const qr = pr && qrString(pr);
  const src = qr ? await QRCode.toDataURL(qr, { margin: 1, width: 288 }) : null;

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <PublicHeader />
      <main className="flex-1 flex flex-col items-center p-4 py-8 sm:py-12">
        <div className="max-w-lg w-full bg-card border border-border rounded-2xl shadow-md p-6 sm:p-8 space-y-5 text-center">
          <h1 className="text-2xl font-extrabold tracking-tight">Scan to pay</h1>
          {pr && src ? (
            <>
              <p className="text-sm text-muted-foreground">Open GCash, Maya or your bank app and scan this QR Ph code.</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="QR Ph payment code" width={288} height={288} className="mx-auto rounded-lg bg-white p-2" />
              <p className="text-3xl font-extrabold">₱{pr.request_amount.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</p>
              <XenditQrPoller prId={pr.payment_request_id} testMode={Boolean(process.env.XENDIT_SECRET_KEY?.startsWith("xnd_development_"))} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">This payment could not be loaded. Check My Bookings for your reservation.</p>
          )}
        </div>
      </main>
    </div>
  );
}
