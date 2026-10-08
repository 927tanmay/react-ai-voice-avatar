import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Next.js Voice — React AI Voice Avatar',
  description: 'Voice mode in a Next.js app: speech recognition and the voice in the browser, replies from your own route.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0B0D12', color: '#E2E8F0', fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }}>
        <style>{`
          @media (prefers-reduced-motion: no-preference) {
            .orb-thinking { animation: orb-think 2.4s linear infinite; }
          }
          @keyframes orb-think { from { filter: hue-rotate(0deg); } to { filter: hue-rotate(360deg); } }
        `}</style>
        {children}
      </body>
    </html>
  );
}
