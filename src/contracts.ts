/** `modified`: the file's last write, in milliseconds since the epoch. */
export interface NoteSummary { name: string; modified: number }
export interface Note { name: string; content: string }
export interface Library { directory: string; notes: NoteSummary[]; folders: string[] }
export interface ImportFile { name: string; content: string }
export interface ImportResult { notes: { name: string }[]; errors: string[] }
export interface MigrationResult { directory: string; previousDirectory: string; moved: number; oldDirectoryRemoved: boolean; warnings: string[] }
export const MAX_NOTE_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_IMPORT_FILES = 20;
export type NotesRequest =
  | { action: 'list' }
  | { action: 'read' | 'delete'; name: string }
  | { action: 'create'; name: string }
  | { action: 'save'; name: string; content: string; previous: string }
  | { action: 'rename'; name: string; nextName: string }
  | { action: 'create-folder' | 'delete-folder'; name: string }
  | { action: 'rename-folder'; name: string; nextName: string }
  | { action: 'import'; files: ImportFile[]; folder?: string }
  | { action: 'migrate'; directory: string };
export interface NotesApi {
  list(): Promise<Library>;
  read(name: string): Promise<Note>;
  create(name: string): Promise<Note>;
  save(name: string, content: string, previous: string): Promise<Note>;
  rename(name: string, nextName: string): Promise<Note>;
  delete(name: string): Promise<void>;
  createFolder(name: string): Promise<string>;
  renameFolder(name: string, nextName: string): Promise<string>;
  deleteFolder(name: string): Promise<void>;
  importFiles(files: ImportFile[], folder?: string): Promise<ImportResult>;
  migrate(directory: string): Promise<MigrationResult>;
  openDirectory(): Promise<void>;
}
export const API_PATH = '/api/markdown-notes';
