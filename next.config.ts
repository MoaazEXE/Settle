import type { NextConfig } from 'next'

// Content-Security-Policy. The app loads from Supabase (REST over https + realtime
// over WSS), Google avatar images, and Vercel Analytics/Speed-Insights. Tailwind
// injects inline <style>, and Next/React need 'unsafe-inline' (and 'unsafe-eval'
// in dev) for hydration/runtime. Because a too-strict CSP silently breaks the app,
// we ship this in Report-Only mode (see headers() below) so violations are logged
// without blocking — flip to enforcing only after verifying the report stream.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // Vercel Analytics / Speed Insights inject small inline + external scripts.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
  // Tailwind + Next inline styles.
  "style-src 'self' 'unsafe-inline'",
  // Google avatars + Supabase storage; data:/blob: for cropper previews.
  "img-src 'self' data: blob: https://lh3.googleusercontent.com https://*.supabase.co",
  "font-src 'self' data:",
  // Supabase REST + realtime (WSS), Vercel telemetry.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://vitals.vercel-insights.com https://va.vercel-scripts.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join('; ')

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      '@base-ui/react',
      'sonner',
      'cmdk',
    ],
    staleTimes: { dynamic: 60, static: 300 },
  },
  // Trim Prisma's bundle and avoid bundling its query engine into the client
  serverExternalPackages: ['@prisma/client', 'prisma'],
  images: {
    remotePatterns: [
      // Google OAuth profile avatars
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      // Supabase Storage (uploaded avatars) — any project subdomain
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
  async headers() {
    return [
      {
        // Apply to every route.
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
          },
          // Report-Only: log violations without breaking the app. Promote to
          // 'Content-Security-Policy' once the report stream is clean.
          { key: 'Content-Security-Policy-Report-Only', value: csp },
        ],
      },
    ]
  },
}

export default nextConfig
