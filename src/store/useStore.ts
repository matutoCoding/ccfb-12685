// 全局应用状态：项目、标签、设备库、设置，全部与 IndexedDB 同步
import { create } from 'zustand';
import type {
  Project, Tag, PvModuleModel, InverterModel, OptimizerModel, AppSettings, ID,
} from '@/types';
import * as db from '@/lib/db';
import { seedTags, seedModules, seedInverters, seedOptimizers, defaultSettings } from '@/lib/defaults';
import { uid } from '@/lib/calc/selection';

interface AppState {
  ready: boolean;
  projects: Project[];
  tags: Tag[];
  modules: PvModuleModel[];
  inverters: InverterModel[];
  optimizers: OptimizerModel[];
  settings: AppSettings;
  selectedProjectIds: ID[];

  init: () => Promise<void>;
  upsertProject: (p: Project) => Promise<void>;
  removeProject: (id: ID) => Promise<void>;
  toggleSelect: (id: ID) => void;
  bulkSetTags: (ids: ID[], tagIds: ID[]) => Promise<void>;
  bulkMoveGroup: (ids: ID[], customer: string, site: string) => Promise<void>;
  upsertTag: (t: Tag) => Promise<void>;
  removeTag: (id: ID) => Promise<void>;
  upsertModule: (m: PvModuleModel) => Promise<void>;
  upsertInverter: (i: InverterModel) => Promise<void>;
  upsertOptimizer: (o: OptimizerModel) => Promise<void>;
  saveSettings: (s: AppSettings) => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  ready: false,
  projects: [], tags: [], modules: [], inverters: [], optimizers: [],
  settings: structuredClone(defaultSettings),
  selectedProjectIds: [],

  init: async () => {
    let [projects, tags, modules, inverters, optimizers] = await Promise.all([
      db.getAll<Project>('projects'), db.getAll<Tag>('tags'),
      db.getAll<PvModuleModel>('modules'), db.getAll<InverterModel>('inverters'),
      db.getAll<OptimizerModel>('optimizers'),
    ]);
    if (!tags.length) { await db.bulkPut('tags', seedTags); tags = seedTags; }
    if (!modules.length) { await db.bulkPut('modules', seedModules); modules = seedModules; }
    if (!inverters.length) { await db.bulkPut('inverters', seedInverters); inverters = seedInverters; }
    if (!optimizers.length) { await db.bulkPut('optimizers', seedOptimizers); optimizers = seedOptimizers; }
    const settings = await db.loadSettings();
    set({ ready: true, projects, tags, modules, inverters, optimizers, settings });
  },

  upsertProject: async (p) => {
    const now = Date.now();
    const merged = { ...p, updatedAt: now };
    await db.putOne('projects', merged);
    set(s => ({ projects: [merged, ...s.projects.filter(x => x.id !== p.id)] }));
  },
  removeProject: async (id) => {
    await db.deleteOne('projects', id);
    set(s => ({ projects: s.projects.filter(p => p.id !== id), selectedProjectIds: s.selectedProjectIds.filter(x => x !== id) }));
  },
  toggleSelect: (id) => set(s => ({
    selectedProjectIds: s.selectedProjectIds.includes(id)
      ? s.selectedProjectIds.filter(x => x !== id)
      : [...s.selectedProjectIds, id],
  })),
  bulkSetTags: async (ids, tagIds) => {
    const updated = get().projects.map(p =>
      ids.includes(p.id) ? { ...p, tagIds: Array.from(new Set([...p.tagIds, ...tagIds])), updatedAt: Date.now() } : p);
    await db.bulkPut('projects', updated.filter(p => ids.includes(p.id)));
    set({ projects: updated });
  },
  bulkMoveGroup: async (ids, customer, site) => {
    const updated = get().projects.map(p =>
      ids.includes(p.id) ? { ...p, customer, siteAddress: site, updatedAt: Date.now() } : p);
    await db.bulkPut('projects', updated.filter(p => ids.includes(p.id)));
    set({ projects: updated });
  },
  upsertTag: async (t) => { await db.putOne('tags', t); set(s => ({ tags: [t, ...s.tags.filter(x => x.id !== t.id)] })); },
  removeTag: async (id) => {
    await db.deleteOne('tags', id);
    set(s => ({ tags: s.tags.filter(t => t.id !== id) }));
  },
  upsertModule: async (m) => { await db.putOne('modules', m); set(s => ({ modules: [m, ...s.modules.filter(x => x.id !== m.id)] })); },
  upsertInverter: async (i) => { await db.putOne('inverters', i); set(s => ({ inverters: [i, ...s.inverters.filter(x => x.id !== i.id)] })); },
  upsertOptimizer: async (o) => { await db.putOne('optimizers', o); set(s => ({ optimizers: [o, ...s.optimizers.filter(x => x.id !== o.id)] })); },
  saveSettings: async (st) => { await db.saveSettings(st); set({ settings: st }); },
}));

export const newProject = (partial: Partial<Project>): Project => ({
  id: uid('prj'),
  name: partial.name ?? '新建项目',
  customer: partial.customer ?? '',
  siteAddress: partial.siteAddress ?? '',
  capacityKw: partial.capacityKw ?? 0,
  expectedGridDate: partial.expectedGridDate ?? new Date().toISOString().slice(0, 10),
  status: partial.status ?? '前期',
  tagIds: partial.tagIds ?? [],
  note: partial.note ?? '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  roof: partial.roof,
  survey: partial.survey,
  schemes: partial.schemes,
  tmy: partial.tmy,
  finance: partial.finance,
});
