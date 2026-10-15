import { API_PATH, type NotesApi, type NotesRequest } from './contracts';

declare global {
  interface Window {
    __DSH_TRANSPORT__?: { fetch?: typeof fetch };
  }
}

export function createApi(): NotesApi {
  async function request<T>(body: NotesRequest): Promise<T> {
    const send = window.__DSH_TRANSPORT__?.fetch ?? globalThis.fetch.bind(globalThis);
    const response = await send(API_PATH.slice(1), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
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
    openDirectory: () => request({ action: 'open-directory' }),
  };
}
