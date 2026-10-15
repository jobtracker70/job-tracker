import type { MetadataRoute } from 'next'

// Lets owners add BrushBooks to their phone's home screen and open it like an app
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BrushBooks',
    short_name: 'BrushBooks',
    description: 'Know your profit on every job.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F5F8FC',
    theme_color: '#1D5FD8',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
