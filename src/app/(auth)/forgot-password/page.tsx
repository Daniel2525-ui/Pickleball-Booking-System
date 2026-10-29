import { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Reset Password | Crosshair Dinkers",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
