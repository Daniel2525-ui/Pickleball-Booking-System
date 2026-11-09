import { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Choose a New Password",
};

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
