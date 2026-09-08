/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel builds its own output; standalone is only for the Docker path.
  // Set BUILD_TARGET=docker to emit .next/standalone for the container image.
  ...(process.env.BUILD_TARGET === 'docker' ? { output: 'standalone' } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  // Native / Node-only packages must not be bundled by the compiler.
  serverExternalPackages: ['@node-rs/argon2', 'pino'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
