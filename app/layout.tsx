import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '商家经营分析 Copilot',
  description: '商家经营分析智能助手',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
