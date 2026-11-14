import type { APIRoute } from 'astro';
import { BASE } from '../lib/site';

/**
 * Service Worker 端点：返回纯 JS 文本。
 * 这里的字符串里不能出现反引号与模板插值 —— 浏览器拿到的是原样脚本，不能 import 任何模块。
 */
const SOURCE = `const CACHE_PREFIX = 'ship-';
const CACHE_NAME = CACHE_PREFIX + 'v1';
const BASE = '__BASE__';

const PRECACHE = Array.from(new Set([
  BASE + '',
  BASE + '404.html',
  BASE + 'manifest.webmanifest',
]));

const OFFLINE_HTML =
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>暂时离线</title></head><body style="font-family:system-ui,sans-serif;margin:0;padding:3rem 1.25rem;color:#191817;background:#faf9f7">' +
  '<p style="font-size:13px;letter-spacing:.08em;color:#6b6862">offline</p>' +
  '<h1 style="font-size:20px;margin:.5rem 0 0">现在没有网络连接</h1>' +
  '<p style="color:#6b6862;margin:.75rem 0 0">已缓存的页面仍然可以打开，稍后再试一次。</p>' +
  '</body></html>';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

const isStaticAsset = (pathname) =>
  pathname.startsWith(BASE + '_astro/') ||
  pathname.startsWith(BASE + 'icons/') ||
  pathname.startsWith(BASE + 'uploads/') ||
  pathname.startsWith(BASE + 'favicon.svg');

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone()).catch(() => undefined);
      return response;
    })
    .catch(() => cached || Response.error());

  return cached || network;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => undefined);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;

    const root = await cache.match(BASE);
    if (root) return root;

    return new Response(OFFLINE_HTML, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
`;

export const GET: APIRoute = () => {
  const body = SOURCE.replaceAll('__BASE__', BASE);

  return new Response(body, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'public, max-age=0, must-revalidate',
    },
  });
};
