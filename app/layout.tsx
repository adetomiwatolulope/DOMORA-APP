import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../index.css";

// Generated design tokens (index.css) are imported exactly once, at the root
// (DS-1). Fonts load via Google Fonts <link> per DS-7 — next/font is not used.
export const metadata: Metadata = {
  title: "Domora",
  description: "Verified property listings — trusted agents, agencies, and landlords.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Lora:wght@600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}