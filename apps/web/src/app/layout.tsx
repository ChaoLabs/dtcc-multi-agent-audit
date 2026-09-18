import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title:
    "Multi-Agent AI for Smart Contract Audit and Cybersecurity Risk Assessment | DTCC",
  description:
    "Analyze Solidity smart contracts with on-device static checks and AWS Bedrock model review.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
