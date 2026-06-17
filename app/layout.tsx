import type { Metadata, Viewport } from 'next';
import { DM_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  style: ['normal', 'italic'],
  variable: '--font-dm-mono',
  display: 'swap',
});

const ibmPlex = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex',
  display: 'swap',
});

export const viewport: Viewport = {
  themeColor: '#0a0a0c',
};

export const metadata: Metadata = {
  title: 'Mirro X',
  description: 'Share your screen with audio. No install, no account. Browser-native.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmMono.variable} ${ibmPlex.variable}`}>
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
