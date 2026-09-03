/* Apollo PWA Service Worker (MC外 / Keita 2026-09-04 指示)
 * 目的: インストール適格性のみ。SPAの鮮度を壊さない。
 * 方針: /api/*(端末/チャット/ボード/SSE等リアルタイム)と非GETは一切キャッシュしない=常にネットワーク。
 *       画面遷移(navigate)はネットワーク優先で、オフライン時のみキャッシュのシェルへフォールバック。
 *       401(ログインフォーム)はネットワーク成功として素通し=キャッシュで隠さない。
 */
'use strict';
var CACHE = 'apollo-shell-v1';
var ASSET = /\.(?:js|css|woff2?|ttf|png|svg|ico|webmanifest|json)$/;

self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  // 非GET・別オリジンは素通し（キャッシュしない）
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // API/リアルタイム系（端末・チャット・ボード・SSE）は絶対キャッシュしない
  if (url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/sse') === 0 || url.pathname.indexOf('/events') === 0) return;

  // 画面遷移: ネットワーク優先。200のみシェルとして保存。オフライン時だけキャッシュへ。
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (r) {
        if (r && r.status === 200) { var c = r.clone(); caches.open(CACHE).then(function (ca) { ca.put('/', c); }); }
        return r; // 401等もそのまま返す（ログインフォームを隠さない）
      }).catch(function () {
        return caches.match('/').then(function (m) { return m || caches.match(req); });
      })
    );
    return;
  }

  // 静的アセット: ネットワーク優先＋キャッシュフォールバック（ハッシュ付き=鮮度問題なし）
  if (ASSET.test(url.pathname)) {
    e.respondWith(
      fetch(req).then(function (r) {
        if (r && r.status === 200) { var c = r.clone(); caches.open(CACHE).then(function (ca) { ca.put(req, c); }); }
        return r;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }
  // それ以外は素通し
});
