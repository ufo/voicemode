import "@livekit/components-styles";
import { Metadata } from "next";
import { Public_Sans, Wallpoet } from "next/font/google";
import "./globals.css";

const publicSans400 = Public_Sans({
  weight: "400",
  subsets: ["latin"],
});

// Free, OFL-licensed retro-computer display face — the closest open analog to the
// blocky 70s "Data 70"/"Westminster" look, without their murky licensing. Exposed as
// a CSS variable so globals.css can stack it ahead of generic mono fallbacks.
const retroMono = Wallpoet({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-retro-mono",
});

export const metadata: Metadata = {
  title: "Voice Assistant",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full ${publicSans400.className} ${retroMono.variable}`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
