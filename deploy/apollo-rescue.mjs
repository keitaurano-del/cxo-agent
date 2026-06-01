#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Apollo Rescue Server (MC-96)
//
// 目的: Apollo 本体(:4317 / mission-control.service)が死んで開けなくなった時に、
//       本体に一切依存せず単独で開ける「レスキュー画面・修復ルート」を提供する。
//
// 設計の最重要原則:
//   - Apollo の server/web のビルド・node_modules・tsx に一切依存しない。
//     Node 標準ライブラリ（http, child_process, fs, os, crypto, url, path）のみ。
//     npm install 不要で `node apollo-rescue.mjs` だけで動くこと。
//   - Apollo 本体とは別プロセス・別 systemd（apollo-rescue.service）・別ポート(:4318)。
//
// 認証: Apollo と同じ MC_TOKEN。env / .mc.env / .mc_token から読む。
//   query ?token=... → Cookie(mc_token) 発行の1クリック方式（Apollo の流儀に合わせる）。
//   token は crypto.timingSafeEqual で時間一定比較。/restart /logs は厳格保護。
//
// watchdog(apollo-watchdog cron */3) との関係: レスキューは「手動 Web 版 restart」。
//   どちらも `systemctl restart mission-control.service` を呼ぶだけ。レスキュー側にも
//   cooldown を持たせ、多重 restart を回避する。
// ─────────────────────────────────────────────────────────────────────────────

import http from 'node:http';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { timingSafeEqual, createHash } from 'node:crypto';

// ─── 設定 ─────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.RESCUE_PORT || 4318);
const APOLLO_SERVICE = 'mission-control.service';
const APOLLO_HEALTHZ = 'http://127.0.0.1:4317/api/healthz';
const APOLLO_PORT = 4317;
const COOKIE_NAME = 'mc_token';
const RESTART_COOLDOWN_MS = 30_000; // 連打防止
const REPO_DIR = '/home/dev/projects/cxo-agent';

// restart の cooldown 状態（プロセス内）
let lastRestartAt = 0;

// ─── MC_TOKEN の解決（env → .mc.env → .mc_token） ──────────────────────────────
function resolveToken() {
  if (process.env.MC_TOKEN && process.env.MC_TOKEN.trim()) {
    return process.env.MC_TOKEN.trim();
  }
  // .mc.env（KEY=VALUE 形式）から MC_TOKEN を拾う
  try {
    const raw = fs.readFileSync(`${REPO_DIR}/.mc.env`, 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*MC_TOKEN\s*=\s*(.+?)\s*$/);
      if (m) return m[1].trim();
    }
  } catch { /* noop */ }
  // .mc_token（トークン1行のみ）
  try {
    const raw = fs.readFileSync(`${REPO_DIR}/.mc_token`, 'utf8').trim();
    if (raw) return raw;
  } catch { /* noop */ }
  return '';
}

const TOKEN = resolveToken();

// ─── timing-safe トークン比較（長さ違いでも安全。SHA-256 で固定長化してから比較）──
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// ─── 認証ヘルパ ───────────────────────────────────────────────────────────────
function tokenFromCookie(req) {
  const raw = req.headers.cookie;
  if (typeof raw !== 'string') return null;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === COOKIE_NAME) return decodeURIComponent(v);
  }
  return null;
}

function tokenFromBearer(req) {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * 認証判定。
 * - TOKEN 未設定なら認証無効（誤起動時のロックアウト回避。ただし起動ログで強く警告）。
 * - query ?token= が一致 → Cookie 発行して綺麗な URL へ 302（1クリック体験）。
 * - query ?token= が不一致 → 即 401。
 * - それ以外は Bearer / Cookie を timingSafe 比較。
 * 戻り値: { ok: true } | { ok: false } | { redirect: '/clean/url' }
 */
function authorize(req, urlObj) {
  if (!TOKEN) return { ok: true }; // token 未設定 = 認証なし（警告済み）

  const qToken = urlObj.searchParams.get('token');
  if (qToken !== null) {
    if (safeEqual(qToken, TOKEN)) {
      urlObj.searchParams.delete('token');
      const clean = urlObj.pathname + (urlObj.search === '?' ? '' : urlObj.search);
      return { redirect: clean || '/', setCookie: true };
    }
    return { ok: false };
  }

  const presented = tokenFromBearer(req) ?? tokenFromCookie(req);
  if (presented !== null && safeEqual(presented, TOKEN)) return { ok: true };
  return { ok: false };
}

// ─── 外部コマンド実行（Promise 化、タイムアウト付き） ─────────────────────────
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: opts.timeout || 8000, maxBuffer: 1024 * 1024 * 4 }, (err, stdout, stderr) => {
      resolve({
        code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        stdout: (stdout || '').toString(),
        stderr: (stderr || '').toString(),
        error: err ? String(err.message || err) : null,
      });
    });
  });
}

// ─── Apollo healthz の死活確認（本体に依存しない素の http リクエスト）───────────
function probeHealthz() {
  return new Promise((resolve) => {
    const req = http.get(APOLLO_HEALTHZ, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; if (body.length > 4096) body = body.slice(0, 4096); });
      res.on('end', () => {
        // 中身が JSON({"ok":true}) か HTML(SPAフォールバック) かも記録する。
        // stale ルート問題（reference_apollo_restart_stale_routes）の診断用。
        let kind = 'unknown';
        const t = body.trim();
        if (t.startsWith('{') || t.startsWith('[')) kind = 'json';
        else if (t.startsWith('<')) kind = 'html';
        resolve({ reachable: true, status: res.statusCode, kind, sample: t.slice(0, 200) });
      });
    });
    req.on('error', (e) => resolve({ reachable: false, status: null, error: String(e.message || e) }));
    req.on('timeout', () => { req.destroy(); resolve({ reachable: false, status: null, error: 'timeout' }); });
  });
}

// ─── status を組み立てる ───────────────────────────────────────────────────────
async function buildStatus() {
  const [healthz, isActive, ttyd, tmuxLs, dfRoot, freeMem, uptimeOut] = await Promise.all([
    probeHealthz(),
    run('systemctl', ['is-active', APOLLO_SERVICE]),
    run('pgrep', ['-x', 'ttyd']),
    run('tmux', ['ls']),
    run('df', ['-h', '/']),
    run('free', ['-h']),
    run('uptime'),
  ]);

  // df / の使用率を抜き出す
  let diskRootLine = null;
  for (const line of dfRoot.stdout.split('\n')) {
    const cols = line.trim().split(/\s+/);
    // "Mounted on" が "/" の行（最後の列が "/"）
    if (cols.length >= 6 && cols[cols.length - 1] === '/') { diskRootLine = line.trim(); break; }
  }
  if (!diskRootLine) {
    // ヘッダ以外の最初のデータ行をフォールバックで使う
    const lines = dfRoot.stdout.split('\n').filter((l) => l.trim());
    diskRootLine = lines.length > 1 ? lines[1].trim() : (lines[0] || '').trim();
  }

  return {
    now: new Date().toISOString(),
    rescue: { port: PORT, authEnabled: !!TOKEN },
    apollo: {
      service: APOLLO_SERVICE,
      port: APOLLO_PORT,
      systemd: isActive.stdout.trim() || isActive.error || 'unknown', // active / inactive / failed ...
      healthz, // { reachable, status, kind, sample }
      up: healthz.reachable && healthz.status === 200,
    },
    terminal: {
      ttydRunning: ttyd.code === 0 && !!ttyd.stdout.trim(),
      ttydPids: ttyd.stdout.trim().split('\n').filter(Boolean),
      tmuxMain: /(^|\n)main:/.test(tmuxLs.stdout),
      tmuxRaw: tmuxLs.stdout.trim() || tmuxLs.stderr.trim(),
    },
    resources: {
      diskRoot: diskRootLine,
      free: freeMem.stdout.trim(),
      uptime: uptimeOut.stdout.trim(),
      loadavg: os.loadavg(),
    },
    restart: {
      cooldownMs: RESTART_COOLDOWN_MS,
      lastRestartAt: lastRestartAt ? new Date(lastRestartAt).toISOString() : null,
      cooldownRemainingMs: Math.max(0, RESTART_COOLDOWN_MS - (Date.now() - lastRestartAt)),
    },
  };
}

// ─── HTML（自己完結・外部 asset なし・最小レスポンシブ）────────────────────────
function renderHtml() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Apollo Rescue</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
         background:#0c0e14; color:#e6e9ef; -webkit-text-size-adjust:100%; }
  header { padding:16px 18px; border-bottom:1px solid #232838; display:flex;
           align-items:center; gap:10px; flex-wrap:wrap; }
  header h1 { font-size:16px; margin:0; letter-spacing:.5px; }
  .pill { font-size:11px; padding:2px 8px; border-radius:999px; border:1px solid #333a4f; color:#9aa3b8; }
  main { padding:16px 18px; max-width:760px; margin:0 auto; }
  .card { background:#12141d; border:1px solid #232838; border-radius:10px; padding:14px 16px; margin-bottom:14px; }
  .card h2 { font-size:13px; margin:0 0 10px; color:#9aa3b8; text-transform:uppercase; letter-spacing:1px; }
  .row { display:flex; justify-content:space-between; gap:12px; padding:5px 0; border-bottom:1px solid #1a1d28; font-size:13px; }
  .row:last-child { border-bottom:none; }
  .k { color:#9aa3b8; }
  .v { text-align:right; word-break:break-all; }
  .ok { color:#46d39a; }
  .bad { color:#ff6b6b; }
  .warn { color:#ffcc66; }
  .btns { display:flex; gap:10px; flex-wrap:wrap; }
  button, a.btn { font:inherit; font-size:14px; padding:11px 16px; border-radius:8px; cursor:pointer;
                  border:1px solid #333a4f; background:#1b2030; color:#e6e9ef; text-decoration:none;
                  display:inline-block; min-height:44px; line-height:1.4; }
  button.danger { background:#3a1d22; border-color:#5a2a32; color:#ffb3b3; }
  button:active { transform:translateY(1px); }
  button:disabled { opacity:.5; cursor:not-allowed; }
  pre { background:#0a0c12; border:1px solid #232838; border-radius:8px; padding:12px; overflow:auto;
        font-size:12px; line-height:1.5; max-height:50vh; white-space:pre-wrap; word-break:break-word; }
  .muted { color:#6b7388; font-size:12px; }
  #toast { position:fixed; left:50%; bottom:18px; transform:translateX(-50%); background:#1b2030;
           border:1px solid #333a4f; padding:10px 16px; border-radius:8px; font-size:13px; display:none; }
  @media (max-width:520px){ main{padding:12px;} .v{font-size:12px;} }
</style>
</head>
<body>
<header>
  <h1>Apollo Rescue</h1>
  <span class="pill" id="portPill">:${PORT}</span>
  <span class="pill" id="authPill">auth…</span>
</header>
<main>
  <div class="card">
    <h2>Apollo 本体</h2>
    <div id="apolloRows"><div class="row"><span class="k">読み込み中…</span><span class="v"></span></div></div>
  </div>

  <div class="card">
    <h2>修復アクション</h2>
    <div class="btns">
      <button id="btnRefresh">状態を再取得</button>
      <button id="btnLogs">ログ取得 (journalctl)</button>
      <button id="btnRestart" class="danger">Apollo を restart</button>
      <a class="btn" id="lnkTerminal" href="http://127.0.0.1:4317/terminal/" target="_blank" rel="noopener">ターミナルを開く →</a>
    </div>
    <p class="muted" id="restartHint">restart は ${RESTART_COOLDOWN_MS/1000}s のクールダウンあり。本体が生きている時はターミナルから作業できます。</p>
  </div>

  <div class="card">
    <h2>システム</h2>
    <div id="sysRows"><div class="row"><span class="k">読み込み中…</span><span class="v"></span></div></div>
  </div>

  <div class="card" id="logCard" style="display:none">
    <h2>mission-control.service ログ（末尾）</h2>
    <pre id="logPre"></pre>
  </div>
</main>
<div id="toast"></div>

<script>
(function(){
  var $ = function(id){ return document.getElementById(id); };
  function toast(msg){ var t=$('toast'); t.textContent=msg; t.style.display='block';
    clearTimeout(t._t); t._t=setTimeout(function(){t.style.display='none';},3200); }
  function row(k,v,cls){ return '<div class="row"><span class="k">'+k+'</span><span class="v '+(cls||'')+'">'+v+'</span></div>'; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];}); }

  function render(s){
    $('authPill').textContent = s.rescue.authEnabled ? 'auth ✓' : 'auth OFF';
    $('authPill').className = 'pill ' + (s.rescue.authEnabled ? 'ok' : 'warn');

    var a = s.apollo;
    var up = a.up;
    var hz = a.healthz || {};
    var html = '';
    html += row('稼働判定', up ? 'UP' : 'DOWN', up ? 'ok' : 'bad');
    html += row('systemd', esc(a.systemd), a.systemd==='active'?'ok':'bad');
    html += row('healthz 到達', hz.reachable ? 'yes' : 'no', hz.reachable?'ok':'bad');
    html += row('healthz HTTP', hz.status==null ? esc(hz.error||'-') : hz.status, hz.status===200?'ok':'bad');
    if (hz.kind && hz.kind!=='unknown') html += row('レスポンス種別', esc(hz.kind), hz.kind==='json'?'ok':'warn');
    $('apolloRows').innerHTML = html;

    var t = s.terminal, r = s.resources;
    var sys = '';
    sys += row('ttyd', t.ttydRunning ? 'running' : 'なし', t.ttydRunning?'ok':'warn');
    sys += row('tmux main', t.tmuxMain ? 'あり' : 'なし', t.tmuxMain?'ok':'warn');
    sys += row('disk /', esc(r.diskRoot||'-'));
    sys += row('load avg', (r.loadavg||[]).map(function(n){return n.toFixed(2);}).join(' '));
    sys += row('uptime', esc(r.uptime||'-'));
    $('sysRows').innerHTML = sys;

    var rem = s.restart.cooldownRemainingMs;
    if (rem > 0){ $('btnRestart').disabled = true;
      $('restartHint').textContent = 'クールダウン中: あと ' + Math.ceil(rem/1000) + 's';
    } else { $('btnRestart').disabled = false; }
  }

  function load(){
    fetch('/status', { headers:{'accept':'application/json'} })
      .then(function(r){ if(!r.ok) throw new Error('status '+r.status); return r.json(); })
      .then(render)
      .catch(function(e){ toast('状態取得に失敗: '+e.message); });
  }

  $('btnRefresh').onclick = load;

  $('btnLogs').onclick = function(){
    toast('ログ取得中…');
    fetch('/logs', { headers:{'accept':'text/plain'} })
      .then(function(r){ if(!r.ok) throw new Error('logs '+r.status); return r.text(); })
      .then(function(txt){ $('logCard').style.display='block'; $('logPre').textContent = txt;
        $('logCard').scrollIntoView({behavior:'smooth'}); })
      .catch(function(e){ toast('ログ取得失敗: '+e.message); });
  };

  $('btnRestart').onclick = function(){
    if(!confirm('mission-control.service を restart します。Apollo が数秒ダウンします。よろしいですか？')) return;
    $('btnRestart').disabled = true;
    toast('restart 実行中…');
    fetch('/restart', { method:'POST', headers:{'accept':'application/json'} })
      .then(function(r){ return r.json().then(function(j){ return {status:r.status, body:j}; }); })
      .then(function(res){
        if(res.status===200 && res.body.ok){ toast('restart 完了。健全性を再確認します…'); }
        else if(res.status===429){ toast('クールダウン中。あと '+Math.ceil((res.body.cooldownRemainingMs||0)/1000)+'s'); }
        else { toast('restart 失敗: '+(res.body.message||res.status)); }
        setTimeout(load, 2500);
      })
      .catch(function(e){ toast('restart 失敗: '+e.message); setTimeout(load,2000); });
  };

  load();
  setInterval(load, 10000); // 10s ごとに自動更新
})();
</script>
</body>
</html>`;
}

// ─── レスポンスヘルパ ─────────────────────────────────────────────────────────
function sendJson(res, code, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders });
  res.end(body);
}
function sendText(res, code, text, extraHeaders = {}) {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders });
  res.end(text);
}
function send401(res) {
  sendJson(res, 401, { ok: false, error: 'unauthorized', hint: 'append ?token=<MC_TOKEN> once to set a cookie' });
}

// ─── サーバ本体 ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  let urlObj;
  try { urlObj = new URL(req.url, `http://127.0.0.1:${PORT}`); }
  catch { sendText(res, 400, 'bad request'); return; }
  const path = urlObj.pathname;

  // /healthz: レスキュー自身の死活（無認証・常に素通り）
  if (path === '/healthz') { sendJson(res, 200, { ok: true, service: 'apollo-rescue', port: PORT }); return; }

  // 認証
  const auth = authorize(req, urlObj);
  if (auth.redirect) {
    res.writeHead(302, {
      'location': auth.redirect,
      'set-cookie': `${COOKIE_NAME}=${encodeURIComponent(TOKEN)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`,
    });
    res.end();
    return;
  }
  if (!auth.ok) { send401(res); return; }

  // ─── 認証済みルート ───
  if (path === '/' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(renderHtml());
    return;
  }

  if (path === '/status' && req.method === 'GET') {
    const s = await buildStatus();
    sendJson(res, 200, s);
    return;
  }

  if (path === '/logs' && req.method === 'GET') {
    const out = await run('journalctl', ['-u', APOLLO_SERVICE, '--no-pager', '-n', '150'], { timeout: 8000 });
    if (out.code !== 0 && !out.stdout) { sendText(res, 500, `journalctl failed: ${out.error || out.stderr}`); return; }
    sendText(res, 200, out.stdout || out.stderr || '(empty)');
    return;
  }

  if (path === '/restart' && req.method === 'POST') {
    const sinceLast = Date.now() - lastRestartAt;
    if (sinceLast < RESTART_COOLDOWN_MS) {
      sendJson(res, 429, { ok: false, error: 'cooldown', cooldownRemainingMs: RESTART_COOLDOWN_MS - sinceLast });
      return;
    }
    lastRestartAt = Date.now(); // 先にスタンプして並行連打を抑止
    const out = await run('sudo', ['-n', 'systemctl', 'restart', APOLLO_SERVICE], { timeout: 30000 });
    if (out.code !== 0) {
      sendJson(res, 500, { ok: false, error: 'restart_failed', code: out.code, message: out.stderr || out.error });
      return;
    }
    // restart 後に healthz を軽く待って確認（最大 ~8s）
    let recovered = null;
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const hz = await probeHealthz();
      if (hz.reachable && hz.status === 200) { recovered = hz; break; }
    }
    sendJson(res, 200, { ok: true, restarted: APOLLO_SERVICE, recovered: !!recovered, healthz: recovered });
    return;
  }

  sendText(res, 404, 'not found');
});

server.listen(PORT, () => {
  console.log(`[apollo-rescue] listening on :${PORT}`);
  if (!TOKEN) {
    console.warn('[apollo-rescue] ⚠ MC_TOKEN 未設定 — 認証が無効です（全リクエスト素通り）。' +
      ' .mc.env / .mc_token / env のいずれかに MC_TOKEN を設定してください。');
  } else {
    console.log('[apollo-rescue] auth: ENABLED (MC_TOKEN loaded)');
  }
});

// graceful shutdown
function shutdown(sig) {
  console.log(`[apollo-rescue] ${sig} received, closing`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
