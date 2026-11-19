import { useMemo, useState } from 'react';
import type { RoofModel, TraverseLeg } from '@/types';
import { adjustTraverse } from '@/lib/calc/traverse';
import { buildPlane3D, computeUsableArea } from '@/lib/calc/roofGeometry';
import { useToast } from '@/components/Toast';
import { uid } from '@/lib/calc/selection';

const DEG = Math.PI / 180;

/** 生成矩形示例导线（演示/快速上手） */
export function sampleTraverse(): TraverseLeg[] {
  const defs: [string, string, number, number][] = [
    ['A', 'B', 30, -90], ['B', 'C', 18, -90], ['C', 'D', 30, -90], ['D', 'A', 18, -90],
  ];
  return defs.map(([from, to, length, turn]) => ({ id: uid('leg'), from, to, length, turnAngleDeg: turn }));
}

export function TraverseEditor({ roof, onChange }: { roof: RoofModel; onChange: (r: RoofModel) => void }) {
  const toast = useToast();
  const [firstBearing, setFirstBearing] = useState(roof.firstBearingDeg ?? 0);
  const [toleranceK, setToleranceK] = useState(roof.toleranceCoeff ?? 0.05);

  const result = useMemo(() => {
    if (roof.traverse.length < 3) return undefined;
    try {
      return adjustTraverse({ legs: roof.traverse, firstBearingDeg: firstBearing, toleranceK });
    } catch (e) { return undefined; }
  }, [roof.traverse, firstBearing, toleranceK]);

  const setLeg = (id: string, patch: Partial<TraverseLeg>) =>
    onChange({ ...roof, traverse: roof.traverse.map(l => l.id === id ? { ...l, ...patch } : l) });

  const runAdjust = () => {
    if (!result) { toast('导线边数不足 3，无法平差'); return; }
    onChange({ ...roof, firstBearingDeg: firstBearing, toleranceCoeff: toleranceK, result,
      planes: roof.planes.length ? roof.planes : autoPlane(result.points) });
    toast(result.passed ? '平差通过，已生成角点坐标' : '闭合差超限，请检查标红边');
  };

  const usable = useMemo(() => {
    if (!result) return null;
    return computeUsableArea(result.points, roof.zones, roof.equipment);
  }, [result, roof.zones, roof.equipment]);

  return (
    <div>
      <div className="grid grid-3" style={{ marginBottom: 14 }}>
        <div className="field"><label>起始边方位角（北=0，顺时针°）</label>
          <input type="number" value={firstBearing} onChange={e => setFirstBearing(+e.target.value)} /></div>
        <div className="field"><label>闭合差限差系数 K（限差=K·√周长，m）</label>
          <input type="number" step="0.01" value={toleranceK} onChange={e => setToleranceK(+e.target.value)} /></div>
        <div className="field" style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <button className="primary" onClick={runAdjust}>运行导线平差</button>
          <button onClick={() => onChange({ ...roof, traverse: sampleTraverse() })}>填入矩形示例</button>
        </div>
      </div>

      <div className="scroll-x" style={{ marginBottom: 14 }}>
        <table>
          <thead><tr><th>边</th><th>起点</th><th>终点</th><th>实测边长(m)</th><th>转折角(左角°)</th><th></th></tr></thead>
          <tbody>
            {roof.traverse.map((l, i) => {
              const suspicious = result?.suspiciousLegId === l.id && !result.passed;
              return (
                <tr key={l.id} style={suspicious ? { background: '#fdecec' } : undefined}>
                  <td className="mono">#{i + 1}{suspicious && <span className="badge red" style={{ marginLeft: 6 }}>最可疑</span>}</td>
                  <td><input value={l.from} onChange={e => setLeg(l.id, { from: e.target.value })} /></td>
                  <td><input value={l.to} onChange={e => setLeg(l.id, { to: e.target.value })} /></td>
                  <td><input type="number" step="0.001" value={l.length} onChange={e => setLeg(l.id, { length: +e.target.value })} /></td>
                  <td><input type="number" step="0.01" value={l.turnAngleDeg} onChange={e => setLeg(l.id, { turnAngleDeg: +e.target.value })} /></td>
                  <td><button className="small danger" onClick={() => onChange({ ...roof, traverse: roof.traverse.filter(x => x.id !== l.id) })}>删</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button className="small" style={{ marginTop: 8 }} onClick={() => {
          const n = roof.traverse.length;
          const last = roof.traverse[n - 1];
          onChange({ ...roof, traverse: [...roof.traverse, { id: uid('leg'), from: last?.to ?? 'A', to: '新点', length: 5, turnAngleDeg: -90 }] });
        }}>＋ 添加导线边</button>
      </div>

      {result && (
        <>
          <div className="grid grid-4">
            <div className="kpi"><div className="lbl">总闭合差 fx/fy (m)</div><div className="num mono" style={{ fontSize: 17 }}>{result.closureFx.toFixed(4)} / {result.closureFy.toFixed(4)}</div></div>
            <div className="kpi"><div className="lbl">闭合差 / 限差 (m)</div>
              <div className={`num mono ${result.passed ? '' : 'check-cell-bad'}`} style={{ fontSize: 17 }}>{result.closureF.toFixed(4)} / {result.tolerance.toFixed(4)}</div></div>
            <div className="kpi"><div className="lbl">相对闭合差 1/N</div><div className="num mono" style={{ fontSize: 17 }}>{isFinite(result.closureRatio) ? Math.round(result.closureRatio).toLocaleString() : '∞'}</div></div>
            <div className="kpi"><div className="lbl">平差后水平面积 (m²)</div><div className="num mono" style={{ fontSize: 17 }}>{result.area2d.toFixed(2)}</div></div>
          </div>
          <div className="row" style={{ margin: '10px 0' }}>
            <span className={`badge ${result.passed ? 'green' : 'red'}`}>{result.passed ? '✓ 闭合差合格' : '✗ 闭合差超限，已标红最可疑边'}</span>
            <span className="muted">平差前后面积差 {Math.abs(result.area2d - result.rawArea2d).toFixed(4)} m²</span>
          </div>

          <h4 style={{ margin: '14px 0 8px' }}>角点坐标（可直接改数微调，锁定后不参与平差）</h4>
          <div className="scroll-x">
            <table>
              <thead><tr><th>点</th><th>X (m)</th><th>Y (m)</th><th>改正 dx (mm)</th><th>改正 dy (mm)</th><th>锁定</th></tr></thead>
              <tbody>
                {result.points.map(p => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td><input type="number" step="0.001" defaultValue={p.x.toFixed(3)}
                      onBlur={e => applyOverride(roof, onChange, p.id, +e.target.value, p.y)} /></td>
                    <td><input type="number" step="0.001" defaultValue={p.y.toFixed(3)}
                      onBlur={e => applyOverride(roof, onChange, p.id, p.x, +e.target.value)} /></td>
                    <td className="mono">{(result.corrections[p.id].dx * 1000).toFixed(1)}</td>
                    <td className="mono">{(result.corrections[p.id].dy * 1000).toFixed(1)}</td>
                    <td><input type="checkbox" style={{ width: 'auto' }} checked={!!p.fixed} readOnly /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {usable && (
        <div className="grid grid-4" style={{ marginTop: 14 }}>
          <div className="kpi"><div className="lbl">屋面总面积 m²</div><div className="num">{usable.grossArea.toFixed(1)}</div></div>
          <div className="kpi"><div className="lbl">分区扣除 m²</div><div className="num">{usable.zoneDeduction.toFixed(1)}</div></div>
          <div className="kpi"><div className="lbl">设备占位 m²</div><div className="num">{usable.equipmentDeduction.toFixed(1)}</div></div>
          <div className="kpi"><div className="lbl">可利用面积 m²</div><div className="num check-cell-ok">{usable.usableArea.toFixed(1)}</div></div>
        </div>
      )}
    </div>
  );
}

function applyOverride(roof: RoofModel, onChange: (r: RoofModel) => void, id: string, x: number, y: number) {
  if (!roof.result) return;
  const overrides = { ...(roof.overrides ?? {}) };
  const next = adjustTraverse({
    legs: roof.traverse, firstBearingDeg: roof.firstBearingDeg, toleranceK: roof.toleranceCoeff,
    fixedPointIds: [id], overrides: { ...overrides, [id]: { x, y } },
  });
  onChange({ ...roof, result: next });
}

function autoPlane(points: { id: string }[]) {
  if (points.length < 3) return [];
  return [{
    id: uid('plane'), name: '主坡面', pointIds: points.map(p => p.id),
    slopeDeg: 5, azimuthDeg: 180, eaveElev: 0, color: '#5c8cc7',
  }];
}

export { DEG };
