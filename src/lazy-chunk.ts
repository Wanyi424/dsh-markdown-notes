/** DSH 0.2's native, revisioned sibling-chunk loader. All chunks are self-contained. */
declare const require: { async<T>(path: string): Promise<T> };
export function loadChunk<T>(name: string): Promise<T> { return require.async<T>(`./${name}`); }
