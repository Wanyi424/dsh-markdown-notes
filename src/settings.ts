import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

/** Plugin-owned preferences survive package replacement and live outside the library being moved. */
export class NotesSettings {
  constructor(readonly file = join(homedir(), '.dsh-markdown-notes', 'settings.json')) {}
  async directory(fallback?: string) {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      if (typeof value.directory !== 'string' || !isAbsolute(value.directory)) throw new Error('笔记目录配置无效，请检查 ' + this.file);
      return value.directory as string;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      throw error;
    }
  }
  async saveDirectory(directory: string) {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ directory }, null, 2) + '\n', { flag: 'wx', encoding: 'utf8' });
      await rename(temporary, this.file);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
}
