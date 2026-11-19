// IndexedDB 本地持久化层（idb 封装），所有工程数据不离开浏览器
import { openDB, type IDBPDatabase } from 'idb';
import type { Project, Tag, PvModuleModel, InverterModel, OptimizerModel, AppSettings, BoqItem } from '@/types';
import { defaultSettings } from './defaults';

const DB_NAME = 'pv-engineering-suite';
const DB_VERSION = 1;

export interface DBSchema {
  projects: Project;
  tags: Tag;
  modules: PvModuleModel;
  inverters: InverterModel;
  optimizers: OptimizerModel;
  boq: BoqItem;
  settings: AppSettings;
  kv: { key: string; value: unknown };
}

let dbp: Promise<IDBPDatabase> | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('projects', { keyPath: 'id' });
        db.createObjectStore('tags', { keyPath: 'id' });
        const modStore = db.createObjectStore('modules', { keyPath: 'id' });
        db.createObjectStore('inverters', { keyPath: 'id' });
        db.createObjectStore('optimizers', { keyPath: 'id' });
        db.createObjectStore('boq', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'unit' });
        db.createObjectStore('kv');
        modStore.createIndex('discontinued', 'discontinued');
      },
    });
  }
  return dbp;
}

export async function getAll<T>(store: keyof DBSchema): Promise<T[]> {
  const db = await getDB();
  return db.getAll(store) as Promise<T[]>;
}
export async function getOne<T>(store: keyof DBSchema, key: string): Promise<T | undefined> {
  const db = await getDB();
  return db.get(store, key) as Promise<T | undefined>;
}
export async function putOne<T extends { id?: string }>(store: keyof DBSchema, value: T): Promise<void> {
  const db = await getDB();
  await db.put(store, value);
}
export async function deleteOne(store: keyof DBSchema, key: string): Promise<void> {
  const db = await getDB();
  await db.delete(store, key);
}
export async function bulkPut<T>(store: keyof DBSchema, values: T[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(store, 'readwrite');
  await Promise.all(values.map(v => tx.store.put(v)));
  await tx.done;
}

export async function getKv<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  return db.get('kv', key) as Promise<T | undefined>;
}
export async function setKv(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put('kv', value, key);
}

export async function loadSettings(): Promise<AppSettings> {
  const db = await getDB();
  const all = await db.getAll('settings');
  return (all[0] as AppSettings) ?? structuredClone(defaultSettings);
}
export async function saveSettings(s: AppSettings): Promise<void> {
  const db = await getDB();
  await db.put('settings', s);
}

/** 整库备份（JSON 导出）与恢复，全部本地处理 */
export async function exportBackup(): Promise<string> {
  const db = await getDB();
  const stores: (keyof DBSchema)[] = ['projects', 'tags', 'modules', 'inverters', 'optimizers', 'boq', 'settings'];
  const dump: Record<string, unknown[]> = {};
  for (const s of stores) dump[s] = await db.getAll(s);
  return JSON.stringify({ version: DB_VERSION, exportedAt: new Date().toISOString(), data: dump }, null, 2);
}

export async function importBackup(json: string): Promise<void> {
  const parsed = JSON.parse(json) as { data: Record<string, any[]> };
  const db = await getDB();
  const tx = db.transaction(['projects', 'tags', 'modules', 'inverters', 'optimizers', 'boq', 'settings'], 'readwrite');
  for (const [store, rows] of Object.entries(parsed.data)) {
    for (const row of rows) await tx.objectStore(store).put(row);
  }
  await tx.done;
}
