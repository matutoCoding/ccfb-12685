import { useMemo, useState } from 'react';
import { useStore, newProject } from '@/store/useStore';
import type { Project, ProjectStatus } from '@/types';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';

const STATUSES: ProjectStatus[] = ['前期', '勘测中', '设计中', '待评审', '施工中', '已并网', '搁置'];

export function ProjectsPage() {
  const { projects, tags, selectedProjectIds, upsertProject, removeProject, toggleSelect, bulkSetTags, bulkMoveGroup, upsertTag, removeTag } = useStore();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sort, setSort] = useState<'updatedAt' | 'capacityKw'>('updatedAt');
  const [editing, setEditing] = useState<Project | null>(null);
  const [showBatchTag, setShowBatchTag] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [showTagMgr, setShowTagMgr] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#3e63dd');

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return projects
      .filter(p => !kw || [p.name, p.customer, p.siteAddress, p.note].some(s => s.toLowerCase().includes(kw)))
      .filter(p => !tagFilter || p.tagIds.includes(tagFilter))
      .filter(p => !statusFilter || p.status === statusFilter)
      .sort((a, b) => sort === 'updatedAt' ? b.updatedAt - a.updatedAt : b.capacityKw - a.capacityKw);
  }, [projects, q, tagFilter, statusFilter, sort]);

  const groups = useMemo(() => {
    const map = new Map<string, Project[]>();
    for (const p of filtered) {
      const key = `${p.customer || '未填客户'} / ${p.siteAddress || '未填地址'}`;
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const allChecked = filtered.length > 0 && filtered.every(p => selectedProjectIds.includes(p.id));

  const save = async (p: Project) => { await upsertProject(p); setEditing(null); toast('项目已保存'); };

  return (
    <div>
      <div className="page-head">
        <h1>项目管理</h1>
        <div className="row">
          <button onClick={() => setShowTagMgr(true)}>标签管理</button>
          <button className="primary" onClick={() => setEditing(newProject({}))}>＋ 新建项目</button>
        </div>
      </div>

      <div className="panel">
        <div className="row" style={{ marginBottom: 14 }}>
          <input placeholder="搜索项目名 / 客户 / 地址 / 备注" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 280 }} />
          <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} style={{ maxWidth: 160 }}>
            <option value="">全部标签</option>
            {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ maxWidth: 140 }}>
            <option value="">全部状态</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={sort} onChange={e => setSort(e.target.value as typeof sort)} style={{ maxWidth: 160 }}>
            <option value="updatedAt">按修改时间排序</option>
            <option value="capacityKw">按装机量排序</option>
          </select>
          <span className="muted">共 {filtered.length} 个 / 选中 {selectedProjectIds.length}</span>
        </div>

        <div className="row" style={{ marginBottom: 12 }}>
          <label style={{ margin: 0 }} className="clickable">
            <input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={allChecked}
              onChange={() => filtered.forEach(p => { if (allChecked || !selectedProjectIds.includes(p.id)) toggleSelect(p.id); })} />
            全选当前结果
          </label>
          <button className="small" disabled={!selectedProjectIds.length} onClick={() => setShowBatchTag(true)}>批量改标签</button>
          <button className="small" disabled={!selectedProjectIds.length} onClick={() => setShowMove(true)}>批量挪分组</button>
        </div>

        <div className="scroll-x">
          {groups.map(([key, list]) => (
            <div key={key} style={{ marginBottom: 18 }}>
              <div className="badge" style={{ marginBottom: 8 }}>▦ {key}（{list.length}）</div>
              <table>
                <thead><tr>
                  <th style={{ width: 36 }}></th><th>项目名</th><th>装机(kWp)</th><th>状态</th><th>标签</th><th>预计并网</th><th>更新时间</th><th>操作</th>
                </tr></thead>
                <tbody>
                  {list.map(p => (
                    <tr key={p.id}>
                      <td><input type="checkbox" style={{ width: 'auto' }} checked={selectedProjectIds.includes(p.id)} onChange={() => toggleSelect(p.id)} /></td>
                      <td><strong>{p.name}</strong>{p.note && <div className="muted" style={{ fontSize: 12 }}>{p.note}</div>}</td>
                      <td className="mono">{p.capacityKw.toFixed(1)}</td>
                      <td><span className="badge">{p.status}</span></td>
                      <td>
                        <div className="pill-group">
                          {p.tagIds.map(id => { const t = tags.find(x => x.id === id); return t ? <span key={id} className="tag" style={{ background: t.color }}>{t.name}</span> : null; })}
                        </div>
                      </td>
                      <td>{p.expectedGridDate}</td>
                      <td className="muted">{new Date(p.updatedAt).toLocaleString('zh-CN', { hour12: false })}</td>
                      <td className="row" style={{ gap: 6 }}>
                        <button className="small" onClick={() => setEditing(p)}>编辑</button>
                        <button className="small danger" onClick={() => { if (confirm(`删除项目「${p.name}」？`)) { removeProject(p.id); toast('已删除'); } }}>删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {!groups.length && <p className="muted">没有匹配的项目，调整筛选条件或新建项目。</p>}
        </div>
      </div>

      {editing && <ProjectEditor project={editing} onCancel={() => setEditing(null)} onSave={save} />}

      {showBatchTag && (
        <Modal title={`批量改标签（${selectedProjectIds.length} 个项目）`} onClose={() => setShowBatchTag(false)}>
          <div className="pill-group" style={{ marginBottom: 16 }}>
            {tags.map(t => (
              <button key={t.id} className="small" onClick={async () => { await bulkSetTags(selectedProjectIds, [t.id]); toast(`已加标签「${t.name}」`); setShowBatchTag(false); }}>
                <span className="tag" style={{ background: t.color }}>{t.name}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {showMove && (
        <MoveGroupEditor onSubmit={async (customer, site) => { await bulkMoveGroup(selectedProjectIds, customer, site); toast('已移动分组'); setShowMove(false); }} onClose={() => setShowMove(false)} />
      )}

      {showTagMgr && (
        <Modal title="标签管理" onClose={() => setShowTagMgr(false)}>
          <div className="row" style={{ marginBottom: 14 }}>
            <input placeholder="新标签名" value={newTagName} onChange={e => setNewTagName(e.target.value)} style={{ flex: 1 }} />
            <input type="color" value={newTagColor} onChange={e => setNewTagColor(e.target.value)} style={{ width: 50, padding: 2 }} />
            <button className="primary" onClick={async () => {
              if (!newTagName.trim()) return;
              await upsertTag({ id: `tag-${Date.now()}`, name: newTagName.trim(), color: newTagColor });
              setNewTagName(''); toast('标签已添加');
            }}>添加</button>
          </div>
          <table>
            <tbody>
              {tags.map(t => (
                <tr key={t.id}><td><span className="tag" style={{ background: t.color }}>{t.name}</span></td>
                  <td style={{ textAlign: 'right' }}><button className="small danger" onClick={() => removeTag(t.id)}>删除</button></td></tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}

function ProjectEditor({ project, onSave, onCancel }: { project: Project; onSave: (p: Project) => void; onCancel: () => void }) {
  const tags = useStore(s => s.tags);
  const [p, setP] = useState(project);
  const set = <K extends keyof Project>(k: K, v: Project[K]) => setP(prev => ({ ...prev, [k]: v }));
  return (
    <Modal title={project.name === '新建项目' ? '新建项目' : `编辑：${project.name}`} onClose={onCancel} width={640}>
      <div className="form-grid">
        <div className="field"><label>项目名称</label><input value={p.name} onChange={e => set('name', e.target.value)} /></div>
        <div className="field"><label>状态</label><select value={p.status} onChange={e => set('status', e.target.value as ProjectStatus)}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></div>
        <div className="field"><label>客户（分组）</label><input value={p.customer} onChange={e => set('customer', e.target.value)} /></div>
        <div className="field"><label>屋顶地址（分组）</label><input value={p.siteAddress} onChange={e => set('siteAddress', e.target.value)} /></div>
        <div className="field"><label>装机容量 kWp</label><input type="number" value={p.capacityKw} onChange={e => set('capacityKw', +e.target.value)} /></div>
        <div className="field"><label>预计并网日期</label><input type="date" value={p.expectedGridDate} onChange={e => set('expectedGridDate', e.target.value)} /></div>
      </div>
      <div className="field"><label>彩色标签（多选）</label>
        <div className="pill-group">
          {tags.map(t => {
            const on = p.tagIds.includes(t.id);
            return <button key={t.id} type="button" className="small" style={{ opacity: on ? 1 : 0.45 }}
              onClick={() => set('tagIds', on ? p.tagIds.filter(x => x !== t.id) : [...p.tagIds, t.id])}>
              <span className="tag" style={{ background: t.color }}>{t.name}{on ? ' ✓' : ''}</span>
            </button>;
          })}
        </div>
      </div>
      <div className="field"><label>备注</label><textarea rows={3} value={p.note} onChange={e => set('note', e.target.value)} /></div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onCancel}>取消</button>
        <button className="primary" disabled={!p.name.trim()} onClick={() => onSave(p)}>保存</button>
      </div>
    </Modal>
  );
}

function MoveGroupEditor({ onSubmit, onClose }: { onSubmit: (customer: string, site: string) => void; onClose: () => void }) {
  const [customer, setCustomer] = useState('');
  const [site, setSite] = useState('');
  return (
    <Modal title="批量移动到分组" onClose={onClose}>
      <div className="field"><label>目标客户</label><input value={customer} onChange={e => setCustomer(e.target.value)} placeholder="客户名称" /></div>
      <div className="field"><label>目标屋顶地址</label><input value={site} onChange={e => setSite(e.target.value)} placeholder="屋顶地址" /></div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onClose}>取消</button>
        <button className="primary" disabled={!customer.trim()} onClick={() => onSubmit(customer.trim(), site.trim())}>移动</button>
      </div>
    </Modal>
  );
}
