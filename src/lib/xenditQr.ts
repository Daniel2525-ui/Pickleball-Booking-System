import QRCode from "qrcode";
import { qrString, type XenditPaymentRequest } from "./xendit.ts";

/** The payment request's QR as a PNG data URL; null when Xendit has no QR for it (expired or paid). */
export async function qrImage(pr: XenditPaymentRequest): Promise<string | null> {
    const qr = qrString(pr);
    if (!qr) return null;
    // shortcut: Xendit's test QR is a short dummy string, so a QR Ph-shaped sample is drawn to look real; live keys return the real payload and skip this
    const amount = pr.request_amount.toFixed(2);
    const payload = qr.startsWith("000201")
        ? qr
        : `00020101021228760011ph.ppmi.p2m0111XENDPHM2XXX0320${pr.payment_request_id.slice(3, 23)}0516000000000000000052046016530360854${String(amount.length).padStart(2, "0")}${amount}5802PH5911DEMO VENUE6006MANILA6304A1B2`;
    // Level H keeps the code readable with the QR Ph badge covering its centre
    return QRCode.toDataURL(payload, { margin: 1, width: 288, errorCorrectionLevel: "H" });
}
