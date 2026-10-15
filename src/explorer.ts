import { spawn } from 'node:child_process';
import { isAbsolute, join } from 'node:path';

/** Opens the active, host-owned directory only. No arbitrary commands or shell interpolation. */
export async function openInExplorer(directory: string): Promise<void> {
  if (process.platform !== 'win32') throw new Error('当前版本的资源管理器入口仅支持 Windows 桌面端。');
  if (!isAbsolute(directory)) throw new Error('笔记目录必须是绝对路径。');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'), [directory], { shell: false, windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
