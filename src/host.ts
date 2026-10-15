import z from '@deepseek-ai/schemastery';
import { API_PATH, type NotesRequest } from './contracts';
import { NotesError, NotesStore } from './storage';
import { NotesSettings } from './settings';
import { PLUGIN_VERSION } from './version';

export const name = 'markdown-notes';
export const inject = ['connection'];
export const Config = z.object({
  directory: z.string().default('').description('首次使用的笔记目录。后续请在笔记页的“保存位置”中迁移目录；迁移后的路径优先于此初始值。'),
});
interface HostContext {
  connection: { fetch: { register(route: {
    path: string; methods: string[]; requestBody: 'buffered'; fetch(request: Request): Promise<Response>;
  }): () => void } };
}

export function createHandler(store: NotesStore) {
  return async (request: Request): Promise<Response> => {
    const headers = { 'Cache-Control': 'no-store', 'X-DSH-Notes-Version': PLUGIN_VERSION };
    try {
      const clientVersion = request.headers.get('X-DSH-Notes-Client-Version');
      if (clientVersion !== PLUGIN_VERSION) throw new NotesError('version-mismatch', `笔记前后端版本不一致：页面 ${clientVersion ?? '未报告版本（可能仍为旧版）'}，宿主 ${PLUGIN_VERSION}。请确认已安装同一版本插件并完整退出、重新启动 DSH。`);
      const body = await request.json() as NotesRequest;
      if (!body || typeof body !== 'object') throw new NotesError('bad-request', '请求格式不正确。');
      let data: unknown;
      switch (body.action) {
        case 'list': data = await store.list(); break;
        case 'read': data = await store.read(body.name); break;
        case 'create': data = await store.create(body.name); break;
        case 'save': data = await store.save(body.name, body.content, body.previous); break;
        case 'rename': data = await store.rename(body.name, body.nextName); break;
        case 'delete': await store.delete(body.name); data = null; break;
        case 'create-folder': data = await store.createFolder(body.name); break;
        case 'rename-folder': data = await store.renameFolder(body.name, body.nextName); break;
        case 'delete-folder': await store.deleteFolder(body.name); data = null; break;
        case 'import': data = await store.importFiles(body.files, body.folder); break;
        case 'migrate': data = await store.migrate(body.directory); break;
        default: throw new NotesError('bad-request', `宿主 ${PLUGIN_VERSION} 不支持笔记操作「${String((body as { action?: unknown }).action).slice(0, 60)}」。请核对插件版本。`);
      }
      return Response.json({ data }, { headers });
    } catch (error) {
      const code = error instanceof NotesError ? error.code : (error as NodeJS.ErrnoException).code ?? 'io-error';
      const messages: Record<string, string> = {
        ENOENT: '文档或文件夹已不存在，请刷新列表。', EEXIST: '已存在同名文档或文件夹，请换一个名称。',
        ENOTEMPTY: '文件夹不为空，请先移走或删除里面的内容。', ENOTDIR: '路径不是文件夹，请刷新列表。',
        EACCES: '无法读写笔记目录，请检查目录权限。', EPERM: '文件被占用或没有操作权限，请关闭其他编辑器后重试。',
        ENOSPC: '磁盘空间不足，草稿尚未保存。',
      };
      const message = error instanceof NotesError ? error.message : messages[code] ?? '读写笔记失败，请检查目录和磁盘后重试。';
      return Response.json({ error: { code, message } }, { status: code === 'conflict' || code === 'EEXIST' || code === 'version-mismatch' ? 409 : 400, headers });
    }
  };
}

export { NotesSettings };
export async function apply(ctx: HostContext, config: { directory?: string } = {}, settings = new NotesSettings()) {
  const store = new NotesStore(await settings.directory(config.directory?.trim() || undefined), {
    seed: true, persistDirectory: directory => settings.saveDirectory(directory), settingsFile: settings.file,
  });
  // The connection registry owns disposal and the host's existing transport/trust boundary.
  ctx.connection.fetch.register({ path: API_PATH, methods: ['POST'], requestBody: 'buffered', fetch: createHandler(store) });
}
