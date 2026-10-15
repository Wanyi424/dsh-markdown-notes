import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { join } from 'node:path';

/** DSH resolves its own home; each plugin owns a separate data namespace. */
export function notesDataDirectory() { return dshHomePath('plugin-data', 'dsh-markdown-notes'); }
export function defaultNotesDirectory() { return join(notesDataDirectory(), 'notes'); }
