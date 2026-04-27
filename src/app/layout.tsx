import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Umpire AI — Cricket Ball Trajectory Analysis",
  description:
    "AI-powered cricket ball trajectory analysis system for LBW, No-ball, Wide, and more. Hawk-Eye style decision support.",
  keywords: [
    "Umpire AI",
    "Cricket",
    "Ball Trajectory",
    "LBW",
    "Hawk-Eye",
    "Sports Technology",
  ],
  authors: [{ name: "Umpire AI Team" }],
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "Umpire AI — Cricket Ball Trajectory Analysis",
    description:
      "AI-powered cricket ball trajectory analysis system for LBW, No-ball, Wide, and more.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased font-sans`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
