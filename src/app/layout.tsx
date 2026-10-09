import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClauseGuard — Legal Contract Analyzer",
  description: "Upload legal contracts, ask questions, and get AI-powered answers backed by verified quotes from the document.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="app-layout">
          {children}
        </div>
      </body>
    </html>
  );
}
