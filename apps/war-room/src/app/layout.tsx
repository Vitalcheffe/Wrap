import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'WRAP NEBULA - War Room',
  description: 'Command center for the WRAP NEBULA AI Agent Framework',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} antialiased`}>
        <div className="min-h-screen grid-pattern">
          {children}
        </div>
      </body>
    </html>
  )
}
