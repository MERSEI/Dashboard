import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Wallet Analytics',
  description:
    'Read-only analytics for any Ethereum address: token balance, transfer flows and balance history.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* Fonts are self-hosted from /public/fonts via @font-face in globals.css —
          no third-party font request, and one less origin to trust. */}
      <body>{children}</body>
    </html>
  )
}
