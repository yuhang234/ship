import type { APIRoute } from 'astro';
import { BASE, SITE, url } from '../lib/site';

export const GET: APIRoute = () => {
  const manifest = {
    name: SITE.title,
    short_name: SITE.title,
    description: SITE.description,
    lang: SITE.language,
    id: BASE,
    start_url: BASE,
    scope: BASE,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#faf9f7',
    theme_color: '#faf9f7',
    icons: [
      {
        src: url('icons/icon-192.png'),
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: url('icons/icon-512.png'),
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: url('icons/icon-512.png'),
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      'content-type': 'application/manifest+json; charset=utf-8',
    },
  });
};
