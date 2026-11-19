import type { RoofModel, RoofPlane, RoofZone, ExistingEquipment, ZoneType } from '@/types';
import { buildPlane3D } from '@/lib/calc/roofGeometry';
import { uid } from '@/lib/calc/selection';

export function PlaneEditor({ roof, onChange }: { roof: RoofModel; onChange: (r: RoofModel) => void }) {
  if (!roof.result) return <p className="muted">请先完成导线平差，再定义坡面起坡。</p>;
  const pts = roof.result.points;
  const setPlane = (id: string, patch: Partial<RoofPlane>) =>
    onChange({ ...roof, planes: roof.planes.map(p => p.id === id ? { ...p, ...patch } : p) });

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="small" onClick={() => onChange({
          ...roof,
          planes: [...roof.planes, { id: uid('plane'), name: `坡面${roof.planes.length + 1}`, pointIds: pts.slice(0, 3).map(p => p.id), slopeDeg: 5, azimuthDeg: 180, eaveElev: 0, color: '#5c8cc7' }],
        })}>＋ 添加坡面</button>
        <span className="muted">输入檐口标高与坡度后自动起坡生成三维屋面，屋脊/天沟由坡面交线自动推算</span>
      </div>
      {roof.planes.map(plane => {
        let stats: { area3d: number; slopeLength: number } | null = null;
        try { stats = buildPlane3D(plane, pts); } catch { stats = null; }
        return (
          <div key={plane.id} className="panel" style={{ padding: 14, marginBottom: 12 }}>
            <div className="form-grid">
              <div className="field"><label>坡面名称</label><input value={plane.name} onChange={e => setPlane(plane.id, { name: e.target.value })} /></div>
              <div className="field"><label>檐口标高 (m)</label><input type="number" step="0.01" value={plane.eaveElev} onChange={e => setPlane(plane.id, { eaveElev: +e.target.value })} /></div>
              <div className="field"><label>坡度 (°)</label><input type="number" step="0.1" value={plane.slopeDeg} onChange={e => setPlane(plane.id, { slopeDeg: +e.target.value })} /></div>
              <div className="field"><label>坡向方位角 (北=0°)</label><input type="number" step="1" value={plane.azimuthDeg} onChange={e => setPlane(plane.id, { azimuthDeg: +e.target.value })} /></div>
            </div>
            <div className="field"><label>边界角点（有序，勾选参与该坡面）</label>
              <div className="pill-group">
                {pts.map(p => {
                  const on = plane.pointIds.includes(p.id);
                  return <button key={p.id} type="button" className="small" style={{ opacity: on ? 1 : 0.45 }}
                    onClick={() => setPlane(plane.id, { pointIds: on ? plane.pointIds.filter(x => x !== p.id) : [...plane.pointIds, p.id] })}>
                    {p.name}{on ? ' ✓' : ''}
                  </button>;
                })}
              </div>
            </div>
            {stats && <div className="row muted" style={{ fontSize: 12.5 }}>
              <span>坡面面积 <strong className="mono">{stats.area3d.toFixed(2)} m²</strong>（与勘测表核对）</span>
              <span>坡长 <strong className="mono">{stats.slopeLength.toFixed(2)} m</strong></span>
              <button className="small danger" onClick={() => onChange({ ...roof, planes: roof.planes.filter(x => x.id !== plane.id) })}>删除坡面</button>
            </div>}
          </div>
        );
      })}
    </div>
  );
}

export function ZoneEquipmentEditor({ roof, onChange }: { roof: RoofModel; onChange: (r: RoofModel) => void }) {
  if (!roof.result) return <p className="muted">请先完成导线平差。</p>;
  const pts = roof.result.points;
  const setZone = (id: string, patch: Partial<RoofZone>) =>
    onChange({ ...roof, zones: roof.zones.map(z => z.id === id ? { ...z, ...patch } : z) });

  const addZone = (type: ZoneType) => onChange({
    ...roof,
    zones: [...roof.zones, {
      id: uid('zone'), name: `${type}${roof.zones.filter(z => z.type === type).length + 1}`, type,
      pointIds: pts.slice(0, 3).map(p => p.id),
      allowLoadKpa: type === '承重分区' ? 2.0 : undefined,
      membraneLifeYears: type === '防水分区' ? 10 : undefined,
    }],
  });

  const addEquipment = () => {
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const fp = [[cx - 1, cy - 1], [cx + 1, cy - 1], [cx + 1, cy + 1], [cx - 1, cy + 1]];
    const eq: ExistingEquipment = {
      id: uid('eq'), name: `设备${roof.equipment.length + 1}`, kind: '风机基础',
      footprint: fp.map(([x, y]) => ({ x, y })), footprintArea: 4,
    };
    onChange({ ...roof, equipment: [...roof.equipment, eq] });
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="small" onClick={() => addZone('承重分区')}>＋ 承重分区</button>
        <button className="small" onClick={() => addZone('防水分区')}>＋ 防水分区</button>
        <button className="small" onClick={addEquipment}>＋ 既有设备占位</button>
      </div>

      <h4>承重 / 防水分区</h4>
      {roof.zones.map(z => (
        <div key={z.id} className="panel" style={{ padding: 12, marginBottom: 10 }}>
          <div className="form-grid">
            <div className="field"><label>分区名称</label><input value={z.name} onChange={e => setZone(z.id, { name: e.target.value })} /></div>
            <div className="field"><label>类型</label><input value={z.type} readOnly /></div>
            {z.type === '承重分区' && <div className="field"><label>允许荷载 (kPa)</label><input type="number" step="0.1" value={z.allowLoadKpa ?? 0} onChange={e => setZone(z.id, { allowLoadKpa: +e.target.value })} /></div>}
            {z.type === '防水分区' && <div className="field"><label>防水层年限 (年)</label><input type="number" value={z.membraneLifeYears ?? 0} onChange={e => setZone(z.id, { membraneLifeYears: +e.target.value })} /></div>}
          </div>
          <div className="field"><label>多边形角点</label>
            <div className="pill-group">
              {pts.map(p => {
                const on = z.pointIds.includes(p.id);
                return <button key={p.id} type="button" className="small" style={{ opacity: on ? 1 : 0.45 }}
                  onClick={() => setZone(z.id, { pointIds: on ? z.pointIds.filter(x => x !== p.id) : [...z.pointIds, p.id] })}>
                  {p.name}{on ? ' ✓' : ''}
                </button>;
              })}
            </div>
          </div>
          <button className="small danger" onClick={() => onChange({ ...roof, zones: roof.zones.filter(x => x.id !== z.id) })}>删除分区</button>
        </div>
      ))}

      <h4 style={{ marginTop: 16 }}>既有设备台账（批量落位占位）</h4>
      <div className="scroll-x">
        <table>
          <thead><tr><th>设备名</th><th>类型</th><th>占位面积 m²</th><th></th></tr></thead>
          <tbody>
            {roof.equipment.map(e => (
              <tr key={e.id}>
                <td><input value={e.name} onChange={ev => onChange({ ...roof, equipment: roof.equipment.map(x => x.id === e.id ? { ...x, name: ev.target.value } : x) })} /></td>
                <td><select value={e.kind} onChange={ev => onChange({ ...roof, equipment: roof.equipment.map(x => x.id === e.id ? { ...x, kind: ev.target.value } : x) })}>
                  {['风机基础', '空调外机', '排烟设备', '天窗', '管道', '其他'].map(k => <option key={k}>{k}</option>)}
                </select></td>
                <td className="mono">{e.footprintArea.toFixed(2)}</td>
                <td><button className="small danger" onClick={() => onChange({ ...roof, equipment: roof.equipment.filter(x => x.id !== e.id) })}>删</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
