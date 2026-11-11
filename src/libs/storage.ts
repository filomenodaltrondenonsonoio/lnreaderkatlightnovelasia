// Type-check stub for LNReader's '@libs/storage' (persistent key/value store
// that also backs plugin settings).
declare class Storage {
  set(key: string, value: unknown, expires?: Date | number): void;
  get(key: string, raw?: false): any;
  get(key: string, raw: true): { created: Date; value: any; expires?: Date | number } | undefined;
  delete(key: string): void;
  clearAll(): void;
  getAllKeys(): string[];
}

export declare const storage: Storage;
