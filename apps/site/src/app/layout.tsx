import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["100", "200", "300", "400", "500", "600", "700"],
  variable: "--font-ibm-plex-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.rivanna.dev"),
  title: "rivanna.dev",
  description: "effortless GPU computing on UVA's Rivanna cluster",
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "rivanna.dev",
    description: "effortless GPU computing on UVA's Rivanna cluster",
    images: ["/api/og"],
  },
  twitter: {
    card: "summary_large_image",
    title: "rivanna.dev",
    description: "effortless GPU computing on UVA's Rivanna cluster",
    images: ["/api/og"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${ibmPlexMono.variable} font-mono antialiased`}>
        {children}
      </body>
    </html>
  );
}
