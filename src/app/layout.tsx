import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/shell/Header";
import { Footer } from "@/components/shell/Footer";
import { TrialBanner } from "@/components/shell/TrialBanner";

export const metadata: Metadata = {
  title: {
    default: "Lucid Interpret · 중요한 대화를 위한 통역",
    template: "%s · Lucid Interpret",
  },
  description:
    "발표·설교·회의·진료에서 정확하고 검토 가능한 통역을 제공합니다. 게스트 10분 무료 체험.",
  applicationName: "Lucid Interpret",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAFAFB" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0D12" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        <TrialBanner />
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
