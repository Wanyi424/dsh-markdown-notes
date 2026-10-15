import { mkdir, readdir, readFile, writeFile, lstat, rename, unlink, link, copyFile, realpath, rmdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, resolve, relative, parse, sep } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { MAX_IMPORT_BYTES, MAX_IMPORT_FILES, MAX_NOTE_BYTES, type ImportFile, type ImportResult, type MigrationResult, type Library, type Note, type NotesApi } from './contracts';
import { SAMPLE_NAME, SAMPLE_CONTENT } from './sample';

export class NotesError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

async function writeImportedFile(path: string, content: string) {
  const handle = await open(path, 'wx');
  try { await handle.writeFile(content, 'utf8'); await handle.close(); }
  catch (error) { await handle.close().catch(() => {}); await unlink(path).catch(() => {}); throw error; }
}

export function noteName(input: string): string {
  if (typeof input !== 'string') throw new NotesError('invalid-name', '请输入文档名称。');
  const value = input.trim();
  const stem = value.replace(/\.md$/i, '');
  const filename = /\.md$/i.test(value) ? value : `${value}.md`;
  if (!stem || stem === '.' || stem === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(value)
      || /[. ]$/.test(stem) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)
      || filename.length > 180) {
    throw new NotesError('invalid-name', '名称不能含路径、特殊符号或以点结尾，最长 180 个字符。');
  }
  return filename;
}

/** One folder is the source of truth. Only direct, regular Markdown files are managed. */
export class NotesStore implements Omit<NotesApi, 'openDirectory'> {
  private currentDirectory: string;
  get directory() { return this.currentDirectory; }
  private tail: Promise<unknown> = Promise.resolve();
  constructor(directory = join(homedir(), 'Documents', 'DSH Notes'), private options: { seed?: boolean; persistDirectory?: (directory: string) => Promise<void>; settingsFile?: string } = {}) {
    if (!isAbsolute(directory)) throw new NotesError('invalid-directory', '笔记目录必须使用绝对路径。');
    this.currentDirectory = resolve(directory);
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.tail.then(operation);
    this.tail = run.catch(() => undefined);
    return run;
  }
  private async regular(name: string): Promise<string> {
    const path = join(this.directory, noteName(name));
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new NotesError('invalid-file', '只支持笔记目录内的普通 Markdown 文件。');
    return path;
  }
  private async readNote(name: string): Promise<Note> {
    const path = await this.regular(name);
    if ((await lstat(path)).size > MAX_NOTE_BYTES) throw new NotesError('too-large', '文档超过 2 MB，请使用外部编辑器打开。');
    return { name: noteName(name), content: await readFile(path, 'utf8') };
  }
  list(): Promise<Library> {
    return this.serial(async () => {
      await mkdir(this.directory, { recursive: true });
      if (this.options.seed) await this.seed();
      const entries = await readdir(this.directory, { withFileTypes: true });
      const notes = entries.filter(e => e.isFile() && /\.md$/i.test(e.name)).map(e => ({ name: e.name }))
        .sort((a, b) => a.name === SAMPLE_NAME ? -1 : b.name === SAMPLE_NAME ? 1 : a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
      return { directory: this.directory, notes };
    });
  }
  private async seed() {
    const marker = join(this.directory, '.dsh-notes-welcome-v1');
    try { await lstat(marker); return; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    try { await writeFile(join(this.directory, SAMPLE_NAME), SAMPLE_CONTENT, { flag: 'wx', encoding: 'utf8' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    try { await writeFile(marker, '1\n', { flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  read(name: string): Promise<Note> { return this.serial(() => this.readNote(name)); }
  create(input: string): Promise<Note> {
    return this.serial(async () => {
      const name = noteName(input);
      await mkdir(this.directory, { recursive: true });
      await writeFile(join(this.directory, name), '', { flag: 'wx', encoding: 'utf8' });
      return { name, content: '' };
    });
  }
  save(name: string, content: string, previous: string): Promise<Note> {
    return this.serial(async () => {
      if (typeof content !== 'string' || typeof previous !== 'string') throw new NotesError('invalid-content', '文档内容必须是文本。');
      if (Buffer.byteLength(content, 'utf8') > MAX_NOTE_BYTES) throw new NotesError('too-large', '单篇笔记最大支持 2 MB。');
      const path = await this.regular(name);
      const current = await readFile(path, 'utf8');
      // A lost response may be retried; identical content is already safely stored.
      if (current === content) return { name: noteName(name), content };
      if (current !== previous) throw new NotesError('conflict', '文件已被其他窗口或编辑器修改。当前草稿已保留，请先将草稿另存为新笔记。');
      const temporary = join(this.directory, `.dsh-notes-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, content, { flag: 'wx', encoding: 'utf8' });
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
      return { name: noteName(name), content };
    });
  }
  rename(name: string, input: string): Promise<Note> {
    return this.serial(async () => {
      const nextName = noteName(input);
      const source = await this.regular(name);
      if (noteName(name) === nextName) return this.readNote(name);
      // link() reserves the new name without ever overwriting an existing note.
      const destination = join(this.directory, nextName);
      await link(source, destination);
      try { await unlink(source); }
      catch (error) { await unlink(destination); throw error; }
      return this.readNote(nextName);
    });
  }
  delete(name: string): Promise<void> {
    return this.serial(async () => { await unlink(await this.regular(name)); });
  }
  importFiles(files: ImportFile[]): Promise<ImportResult> {
    return this.serial(async () => {
      if (!Array.isArray(files) || files.length === 0 || files.length > MAX_IMPORT_FILES) throw new NotesError('invalid-import', '每次可导入 1～20 篇 Markdown 文档。');
      let total = 0;
      const normalized = files.map(file => {
        if (!file || typeof file.name !== 'string' || !/\.(md|markdown)$/i.test(file.name) || typeof file.content !== 'string') throw new NotesError('invalid-import', '仅支持 UTF-8 编码的 .md 或 .markdown 文档。');
        const bytes = Buffer.byteLength(file.content, 'utf8'); total += bytes;
        if (bytes > MAX_NOTE_BYTES) throw new NotesError('too-large', `${file.name} 超过单篇 2 MB 的限制。`);
        return { name: noteName(file.name.replace(/\.markdown$/i, '.md')), content: file.content };
      });
      if (total > MAX_IMPORT_BYTES) throw new NotesError('too-large', '单次导入总大小不能超过 20 MB。');
      await mkdir(this.directory, { recursive: true });
      const notes: { name: string }[] = []; const errors: string[] = [];
      for (const file of normalized) {
        let candidate = file.name; let suffix = 1;
        while (true) {
          try { await writeImportedFile(join(this.directory, candidate), file.content); notes.push({ name: candidate }); break; }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') { candidate = `${file.name.slice(0, -3).slice(0, 160)} (${++suffix}).md`; continue; }
            errors.push(`${file.name}：导入失败（${(error as NodeJS.ErrnoException).code ?? '磁盘读写错误'}）`); break;
          }
        }
      }
      return { notes, errors };
    });
  }
  migrate(input: string): Promise<MigrationResult> {
    return this.serial(async () => {
      if (typeof input !== 'string' || !isAbsolute(input.trim())) throw new NotesError('invalid-directory', '请选择或输入完整的绝对目录路径。');
      const source = resolve(this.directory), requested = resolve(input.trim());
      const nested = (parent: string, child: string) => { const rel = relative(parent, child); return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel)); };
      if (source === requested) return { directory: source, previousDirectory: source, moved: 0, oldDirectoryRemoved: false, warnings: [] };
      if ([source, requested].some(path => path === parse(path).root || path === resolve(homedir()))) throw new NotesError('invalid-directory', '请使用专门的笔记文件夹，不能选择磁盘根目录或用户主目录。');
      if (nested(source, requested) || nested(requested, source)) throw new NotesError('nested-directory', '新旧笔记目录不能互为父子目录。');
      await mkdir(source, { recursive: true });
      if ((await lstat(source)).isSymbolicLink()) throw new NotesError('linked-directory', '旧目录是链接或联接点，请先改为普通文件夹。');
      let createdTarget = false;
      try { await mkdir(requested); createdTarget = true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { await mkdir(requested, { recursive: true }); createdTarget = true; } else if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const copied: string[] = [];
      let committed = false;
      try {
        const targetInfo = await lstat(requested);
        if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink()) throw new NotesError('linked-directory', '新目录必须是普通文件夹，不能是链接或联接点。');
        const [realSource, target] = await Promise.all([realpath(source), realpath(requested)]);
        if (nested(realSource, target) || nested(target, realSource)) throw new NotesError('nested-directory', '新旧目录实际指向相同位置或互为父子目录。');
        if (this.options.settingsFile && (nested(realSource, resolve(this.options.settingsFile)) || nested(target, resolve(this.options.settingsFile)))) throw new NotesError('settings-directory', '请将笔记目录与插件设置文件所在目录分开。');
        const entries = await readdir(source, { withFileTypes: true });
        const managed = entries.filter(e => e.isFile() && (/\.md$/i.test(e.name) || e.name === '.dsh-notes-welcome-v1'));
        // Complete collision checks before copying anything. Existing target documents are never overwritten.
        const targetNames = new Set((await readdir(target)).map(name => process.platform === 'win32' ? name.toLowerCase() : name));
        const conflicts = managed.filter(e => e.name !== '.dsh-notes-welcome-v1' && targetNames.has(process.platform === 'win32' ? e.name.toLowerCase() : e.name));
        if (conflicts.length) throw new NotesError('migration-conflict', `目标目录已有同名文档：${conflicts.slice(0, 5).map(e => e.name).join('、')}。请更换目录或先处理同名文件。`);
        const originals: { name: string; size: number; mtimeMs: number }[] = [];
        for (const entry of managed) {
          const from = join(source, entry.name), to = join(target, entry.name);
          const before = await lstat(from);
          if (!before.isFile() || before.isSymbolicLink()) throw new NotesError('migration-changed', '迁移期间文件发生变化，请重试。');
          if (entry.name !== '.dsh-notes-welcome-v1' || !targetNames.has(entry.name)) {
            await copyFile(from, to, constants.COPYFILE_EXCL); copied.push(to);
            const after = await lstat(from), destination = await lstat(to);
            if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || destination.size !== before.size) throw new NotesError('migration-changed', `${entry.name} 在复制期间发生变化，已停止迁移。`);
          }
          originals.push({ name: entry.name, size: before.size, mtimeMs: before.mtimeMs });
        }
        // Persist first: after a successful commit, restart must already point to the complete destination.
        await this.options.persistDirectory?.(target);
        this.currentDirectory = target; committed = true;
        const warnings: string[] = [];
        for (const original of originals) {
          const path = join(source, original.name);
          try {
            const current = await lstat(path);
            if (!current.isFile() || current.isSymbolicLink() || current.size !== original.size || current.mtimeMs !== original.mtimeMs) { warnings.push(`${original.name} 在迁移期间被修改，旧文件已保留。`); continue; }
            await unlink(path);
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(`${original.name} 的旧副本未能删除。`); }
        }
        let oldDirectoryRemoved = false;
        try { await rmdir(source); oldDirectoryRemoved = true; }
        catch (error) { warnings.push((error as NodeJS.ErrnoException).code === 'ENOTEMPTY' ? '旧目录还有其他文件或子文件夹，已保留旧目录。' : '旧目录暂时无法删除，已保留。'); }
        return { directory: target, previousDirectory: source, moved: originals.filter(e => /\.md$/i.test(e.name)).length, oldDirectoryRemoved, warnings };
      } catch (error) {
        if (!committed) {
          for (const path of copied) await unlink(path).catch(() => {});
          if (createdTarget) await rmdir(requested).catch(() => {});
        }
        throw error;
      }
    });
  }
}
