/* 只管理本项目的静态外壳。发布时同时更新HTML的app-version与此版本。 */
'use strict';
const APP_VERSION = '1.0.1';
const BASE = new URL('./', self.location.href);
const CACHE_PREFIX = 'us-market-board-test-shell:' + BASE.pathname + ':';
const CACHE_NAME = CACHE_PREFIX + APP_VERSION;
const INDEX = new URL('index.html', BASE).href;
const ASSETS = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon-180.png'].map(p => new URL(p, BASE).href);
const htmlVersion = text => text.match(/<meta name="app-version" content="([^"]+)">/)?.[1];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // 全部资源先下载并验证，再写入本版本缓存；失败的worker不能激活。
    const urls = [INDEX, ...ASSETS];
    const responses = await Promise.all(urls.map(async url => {
      const response = await fetch(url, {cache: 'reload'});
      if (!response.ok || response.type === 'opaque' || response.redirected) throw new Error('静态资源下载失败');
      return response;
    }));
    if (htmlVersion(await responses[0].clone().text()) !== APP_VERSION) throw new Error('应用版本不一致，等待下一次更新检查');
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(urls.map((url, i) => cache.put(url, responses[i])));
    // 不在安装时skipWaiting；已有页面继续使用当前版本，等待用户确认。
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function navigation(request) {
  const cache = await caches.open(CACHE_NAME);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(request, {cache: 'no-store', signal: controller.signal});
    if (response.ok && !response.redirected && htmlVersion(await response.clone().text()) === APP_VERSION) {
      await cache.put(INDEX, response.clone());
      return response;
    }
    // 服务器版本比当前worker新时，不提前混用新版HTML；由更新提示切换整份内嵌程序。
  } catch (_) {
    // 离线仅返回程序外壳；外壳内的行情仍经过原有localStorage和日期校验。
  } finally {
    clearTimeout(timer);
  }
  return (await cache.match(INDEX)) || new Response('离线界面尚未准备好，请联网后重新打开。', {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
}

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
  if (request.mode === 'navigate' && (url.pathname === BASE.pathname || url.pathname === new URL(INDEX).pathname)) {
    event.respondWith(navigation(request));
  } else if (ASSETS.includes(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(url.href)) || fetch(request);
    })());
  }
  // 不处理第三方接口、其他Pages项目、sw.js、POST及非白名单资源。
});

self.addEventListener('message', event => {
  const sourceURL = event.source && event.source.url;
  if (!sourceURL) return;
  const url = new URL(sourceURL);
  if (url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
  if (event.data?.type === 'GET_VERSION') event.ports[0]?.postMessage({version: APP_VERSION});
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});
