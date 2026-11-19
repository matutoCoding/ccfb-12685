import { useStore } from '@/store/useStore';

/** 当前操作项目选择器（跨页面共享） */
export function ProjectSelector({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const projects = useStore(s => s.projects);
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ maxWidth: 320 }}>
      <option value="">— 请选择项目 —</option>
      {projects.map(p => <option key={p.id} value={p.id}>{p.name}（{p.customer}）</option>)}
    </select>
  );
}
