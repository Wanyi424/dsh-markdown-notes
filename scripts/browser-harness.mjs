// Shared carrier for the isolated browser checks: the real built client and Host API, served by request
// interception instead of a local HTTP server, so the checks need no TCP port (Windows and WSL alike).
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

export const lightTheme = `--dsw-alias-label-primary:#20232a;--dsw-alias-label-secondary:#555f70;--dsw-alias-label-tertiary:#808898;--dsw-alias-label-primary-inverted:#fff;--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#f6f7f8;--dsw-alias-bg-overlay:#fff;--dsw-alias-border-l2:#e7e8ec;--dsw-alias-border-l3:#cbd0da;--dsw-alias-button-primary-fill:#14161b;--dsw-alias-button-primary-hover:#30343e;--dsw-alias-interactive-bg-hover:#eceef2;--dsw-alias-interactive-bg-active:#e9ebee;--dsw-alias-button-elevated-fill:#fff;--dsw-alias-brand-primary:#5578b8;--dsw-alias-brand-text:#4166a3;--dsw-alias-link:#4a71b2;--dsw-alias-markdown-inline-code:#f1f3f6;--dsw-alias-markdown-code-block:#f7f8fa;--dsw-alias-markdown-code-block-banner:#f0f2f5;--dsw-alias-state-error-primary:#be4545;--dsw-alias-state-error-secondary:#edcccc;--dsw-alias-state-warn-primary:#dba82e;--dsw-alias-state-success-primary:#32977a;--dsw-alias-bg-multi-select:#ccdcf3;--dsw-alias-bg-mask-1:#00000012;--dsw-alias-bg-mask-2:#00000055;--dsh-frame-top-clearance:0px;`;
export const darkTheme = `--dsw-alias-label-primary:#e2e5ec;--dsw-alias-label-secondary:#abb4c4;--dsw-alias-label-tertiary:#8791a4;--dsw-alias-label-primary-inverted:#16191f;--dsw-alias-bg-base:#191c22;--dsw-alias-bg-layer-1:#1f232b;--dsw-alias-bg-overlay:#262b35;--dsw-alias-border-l2:#343b48;--dsw-alias-border-l3:#485165;--dsw-alias-button-primary-fill:#e2e5ec;--dsw-alias-button-primary-hover:#fff;--dsw-alias-interactive-bg-hover:#303744;--dsw-alias-interactive-bg-active:#343b48;--dsw-alias-button-elevated-fill:#394150;--dsw-alias-markdown-inline-code:#2a303b;--dsw-alias-markdown-code-block:#20252e;--dsw-alias-markdown-code-block-banner:#272d38;--dsw-alias-link:#92b8f4;--dsw-alias-bg-multi-select:#344d70;`;

export function shell({ navWidth = 280, label = '隔离测试环境 · 非 DSH 实际窗口' } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{${lightTheme}}html[data-theme=dark]{${darkTheme}}*{box-sizing:border-box}body{margin:0;height:100vh;overflow:hidden;font-family:'Segoe UI','Microsoft YaHei',sans-serif;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}.fixture-shell{height:100%;display:grid;grid-template-columns:${navWidth}px minmax(0,1fr)}.fixture-nav{background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--dsw-alias-border-l2);padding:32px 20px}.fixture-nav h2{font-size:22px;margin:0 0 34px}.fixture-nav div,.fixture-nav button{font-size:14px;padding:14px;border-radius:8px;margin-bottom:6px;display:block;background:transparent;border:0;color:inherit;cursor:pointer}.fixture-nav .active{background:var(--dsw-alias-interactive-bg-active)}.fixture-label{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:24px}#plugin{min-width:0;height:100%;overflow:hidden}@media(max-width:900px){.fixture-shell{grid-template-columns:minmax(0,1fr)}.fixture-nav{display:none}}</style></head><body><div class="fixture-shell"><aside class="fixture-nav"><h2>DSH</h2><button id="close-notes">工作台</button><div>插件</div><button id="open-notes" class="active">笔记</button><p class="fixture-label">${label}</p></aside><div id="plugin"></div></div><script src="/entry.js"></script><script src="/plugin.js"></script></body></html>`;
}

/** Opens a page on http://dsh.test/ whose plugin requests reach `api` directly. */
export async function openHarness({ api, entry, viewport, navWidth, local = {} }) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport });
  const errors = [], external = [], requests = [], opened = [];
  page.on('pageerror', error => errors.push(error.message));
  const html = shell({ navWidth });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname !== 'dsh.test') {
      external.push(url.href);
      return local[url.href] ? route.fulfill({ path: local[url.href].path, contentType: local[url.href].type }) : route.abort();
    }
    requests.push(url.pathname);
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
    if (url.pathname === '/api/markdown-notes') {
      const response = await api(new Request('http://localhost/api/markdown-notes', { method: 'POST', headers: request.headers(), body: request.postDataBuffer() }));
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    }
    if (url.pathname === '/open-in-app/open') {
      opened.push(JSON.parse(request.postData() ?? '{}'));
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    if (url.pathname === '/entry.js') return route.fulfill({ contentType: 'text/javascript', body: await readFile(entry) });
    // The entry is served under another name so lazy chunk requests (/client.*.js) stay distinguishable.
    if (url.pathname === '/plugin.js') return route.fulfill({ contentType: 'text/javascript', body: await readFile('lib/client.js') });
    if (/^\/client\.[a-z]+\.js$/.test(url.pathname)) return route.fulfill({ contentType: 'text/javascript', body: await readFile('lib' + url.pathname) });
    return route.fulfill({ status: 404, body: '' });
  });
  return { browser, page, errors, external, requests, opened };
}
