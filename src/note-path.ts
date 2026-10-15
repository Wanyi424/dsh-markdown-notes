/** Library identifiers use '/' on every platform; filesystem validation lives in storage. */
export const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
export const parentFolder = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
export const inFolder = (folder: string, name: string) => folder ? `${folder}/${name}` : name;
export const withinFolder = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);
