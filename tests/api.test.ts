import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api';
import { PLUGIN_VERSION } from '../src/version';

function library(directory = 'D:\\Notes') { return Response.json({ data: { directory, notes: [] } }, { headers: { 'X-DSH-Notes-Version': PLUGIN_VERSION } }); }
test('Explorer uses the native DSH endpoint and the directory returned by the host', async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const api = createApi(async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return requests.length === 1 ? library('D:\\新目录') : Response.json({ ok: true });
  });
  await api.openDirectory();
  assert.deepEqual(requests, [
    { url: 'api/markdown-notes', body: { action: 'list' } },
    { url: 'open-in-app/open', body: { app: 'explorer', path: 'D:\\新目录' } },
  ]);
});
test('native launch failures are shown rather than reported as success', async () => {
  const api = createApi(async url => String(url).startsWith('api/') ? library() : Response.json({ message: 'launch failed' }, { status: 500 }));
  await assert.rejects(api.openDirectory(), /资源管理器打开失败：launch failed/);
});
test('an older host without version metadata is diagnosed before opening a folder', async () => {
  let requests = 0;
  const api = createApi(async () => { requests++; return Response.json({ data: { directory: 'D:\\Notes', notes: [] } }); });
  await assert.rejects(api.openDirectory(), /前后端版本不一致/);
  assert.equal(requests, 1);
});
test('a mismatched host version is included in the failure message', async () => {
  const api = createApi(async () => Response.json({ data: {} }, { headers: { 'X-DSH-Notes-Version': '0.0.1' } }));
  await assert.rejects(api.list(), /宿主 0.0.1/);
});
test('an authentication failure is not mislabeled as a plugin version mismatch', async () => {
  const api = createApi(async () => new Response('unauthorized', { status: 401 }));
  await assert.rejects(api.list(), /连接未通过授权/);
});
