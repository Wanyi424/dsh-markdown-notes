import { API_PATH, type NotesApi, type NotesRequest, type Library } from './contracts';
import { PLUGIN_VERSION } from './version';

declare global {
  interface Window {
    __DSH_TRANSPORT__?: { fetch?: typeof fetch };
  }
}

export function createApi(fetcher?: typeof fetch): NotesApi {
  const send = fetcher ?? window.__DSH_TRANSPORT__?.fetch ?? globalThis.fetch.bind(globalThis);
  async function request<T>(body: NotesRequest): Promise<T> {
    const response = await send(API_PATH.slice(1), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DSH-Notes-Client-Version': PLUGIN_VERSION }, body: JSON.stringify(body),
    });
    const hostVersion = response.headers.get('X-DSH-Notes-Version');
    if (!hostVersion && (response.status === 401 || response.status === 403)) throw new Error('DSH 连接未通过授权，请重新打开应用后重试。');
    if (hostVersion !== PLUGIN_VERSION) throw new Error(`笔记前后端版本不一致：页面 ${PLUGIN_VERSION}，宿主 ${hostVersion ?? '未报告版本（可能仍为旧版）'}。请核对安装包，并完整退出、重新启动 DSH。`);
    const result = await response.json() as { data: T; error?: { message: string } };
    if (!response.ok || result.error) throw new Error(result.error?.message ?? `笔记请求失败（HTTP ${response.status}）。`);
    return result.data;
  }
  return {
    list: () => request({ action: 'list' }),
    read: name => request({ action: 'read', name }),
    create: name => request({ action: 'create', name }),
    save: (name, content, previous) => request({ action: 'save', name, content, previous }),
    rename: (name, nextName) => request({ action: 'rename', name, nextName }),
    delete: name => request({ action: 'delete', name }),
    importFiles: files => request({ action: 'import', files }),
    migrate: directory => request({ action: 'migrate', directory }),
    openDirectory: async () => {
      const { directory } = await request<Library>({ action: 'list' });
      const response = await send('open-in-app/open', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: 'explorer', path: directory }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(response.status === 404 ? 'DSH 的系统目录打开功能不可用，请确认当前桌面版本已启用该功能。' : `资源管理器打开失败：${result?.message ?? `HTTP ${response.status}`}`);
      }
    },
  };
}
