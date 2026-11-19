import { useMemo, useState } from 'react';
import { useStore } from '@/store/useStore';
import type { BallastConfig, MountingDesign, MountingType, Scheme } from '@/types';
import { ProjectSelector } from '@/components/ProjectSelector';
import { WebGLCanvas } from '@/components/WebGLCanvas';
import { buildRoofScene } from '@/lib/webgl/roofScene';
import { computeBallast, mountingBoq, type RowInput } from '@/lib/calc/windBallast';
import { generateSchemeOptions, optionToScheme, baselineDelta, findReplacements } from '@/lib/calc/selection';
import { checkMpptAssignment } from '@/lib/calc/electrical';
import { useToast } from '@/components/Toast';
import { uid } from '@/lib/calc/selection';

const defaultBallast: BallastConfig = {
  basicWindPressure: 0.45, roofHeight: 20, gustFactor: 1.9, shapeFactor: 1.3,
  heightFactor: 1.42, blockWeight: 25, parapetZoneWidth: 2, parapetDensify: 0.75,
};

export function LayoutPage() {
  const { projects, modules, inverters, upsertProject } = useStore();
  const toast = useToast();
  const [pid, setPid] = useState(projects[0]?.id ?? '');
  const project = projects.find(p => p.id === pid);
  const [type, setType] = useState<MountingType>('配重式');
  const [tilt, setTilt] = useState(10);
  const [rowSpacing, setRowSpacing] = useState(2.4);
  const [cfg, setCfg] = useState<BallastConfig>(defaultBallast);
  const [targetKw, setTargetKw] = useState(project?.capacityKw ?? 50);

  const roofPts = project?.roof?.result?.points ?? [];
  const zones = project?.roof?.zones.filter(z => z.type === '防水分区') ?? [];

  // 自动生成排（沿屋面 x 向布排，简化网格）
  const rows: RowInput[] = useMemo(() => {
    if (roofPts.length < 3) return [];
    const xs = roofPts.map(p => p.x), ys = roofPts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const len = maxX - minX;
    const out: RowInput[] = [];
    const mod = modules[0];
    for (let y = minY + 1; y + 1 < maxY; y += rowSpacing) {
      out.push({
        index: out.length, x: (minX + maxX) / 2, y,
        modules: Math.floor(len / (mod ? mod.widthMm / 1000 * 1.05 : 1.2)),
        moduleWidthM: mod ? mod.widthMm / 1000 : 1.13, rowLengthM: len,
      });
    }
    return out;
  }, [roofPts, rowSpacing, modules]);

  const ballast = useMemo(() => {
    if (type !== '配重式' || !rows.length || roofPts.length < 3) return null;
    return computeBallast(cfg, rows, rowSpacing, roofPts, zones);
  }, [type, rows, roofPts, zones, cfg, rowSpacing]);

  const mounting: MountingDesign | null = useMemo(() => {
    if (!ballast || !project?.roof?.result) return null;
    const railPerRow = 2;
    const moduleTotal = ballast.rows.reduce((s, r) => s + r.modules, 0);
    const clampCount = moduleTotal * 2;
    const windClampCount = ballast.rows.flatMap(r => r.blocks).filter(b => b.inParapetZone).length;
    return {
      type, tiltDeg: tilt, rowSpacing, railSpec: 'AL6005-T5 40×40',
      railLengthM: rows.reduce((s, r) => s + r.rowLengthM, 0) * railPerRow,
      railCount: ballast.rows.length * railPerRow,
      clampCount, windClampCount,
      rows: ballast.rows, totalBallastKg: ballast.totalBallastKg,
      formulaTrace: ballast.trace,
      boq: [],
    };
  }, [ballast, project, type, tilt, rowSpacing, rows]);

  const boq = useMemo(() => mounting ? mountingBoq({
    railSpec: mounting.railSpec, railLengthM: mounting.railLengthM, railCount: mounting.railCount,
    clampCount: mounting.clampCount, windClampCount: mounting.windClampCount,
    totalBallastKg: mounting.totalBallastKg, blockWeight: cfg.blockWeight, type,
  }) : [], [mounting, cfg.blockWeight, type]);

  // 设备选型组合
  const options = useMemo(() => {
    const area = project?.roof?.usableArea ?? 1000;
    return generateSchemeOptions(modules, inverters, targetKw, area);
  }, [modules, inverters, targetKw, project]);

  const adoptScheme = async (idx: number) => {
    if (!project) return;
    const o = options[idx];
    const scheme = optionToScheme(o, `方案${(project.schemes?.length ?? 0) + 1}`, []);
    const schemes = [...(project.schemes ?? []), scheme];
    await upsertProject({ ...project, schemes, roof: project.roof });
    toast(`已生成 ${scheme.name}：${scheme.moduleCount} 块 / ${scheme.inverterCount} 台逆变器`);
  };

  const lockBaseline = async (s: Scheme) => {
    if (!project) return;
    const schemes = (project.schemes ?? []).map(x => ({ ...x, isBaseline: x.id === s.id }));
    await upsertProject({ ...project, schemes, baselineSchemeId: s.id });
    toast(`已锁定基线方案：${s.name}`);
  };

  const baseline = project?.schemes?.find(s => s.isBaseline);
  const discontinued = modules.find(m => m.discontinued);

  return (
    <div>
      <div className="page-head">
        <h1>排布设计</h1>
        <ProjectSelector value={pid} onChange={setPid} />
      </div>

      {!project ? <div className="panel muted">请先选择项目。</div> : (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
            <div className="panel">
              <h3>支架与抗风掀配重</h3>
              <div className="row" style={{ marginBottom: 12 }}>
                {(['配重式', '锚固式'] as MountingType[]).map(t => (
                  <button key={t} className={`small ${type === t ? 'primary' : ''}`} onClick={() => setType(t)}>{t}</button>
                ))}
                <label style={{ margin: 0 }}>倾角 <input type="number" value={tilt} onChange={e => setTilt(+e.target.value)} style={{ width: 70, display: 'inline-block' }} />°</label>
                <label style={{ margin: 0 }}>排距 <input type="number" step="0.1" value={rowSpacing} onChange={e => setRowSpacing(+e.target.value)} style={{ width: 80, display: 'inline-block' }} />m</label>
              </div>
              <div className="form-grid">
                <div className="field"><label>基本风压 w0 (kN/m²)</label><input type="number" step="0.01" value={cfg.basicWindPressure} onChange={e => setCfg({ ...cfg, basicWindPressure: +e.target.value })} /></div>
                <div className="field"><label>屋面高度 (m)</label><input type="number" value={cfg.roofHeight} onChange={e => setCfg({ ...cfg, roofHeight: +e.target.value })} /></div>
                <div className="field"><label>阵风系数 βgz</label><input type="number" step="0.05" value={cfg.gustFactor} onChange={e => setCfg({ ...cfg, gustFactor: +e.target.value })} /></div>
                <div className="field"><label>体型系数 μs</label><input type="number" step="0.05" value={cfg.shapeFactor} onChange={e => setCfg({ ...cfg, shapeFactor: +e.target.value })} /></div>
                <div className="field"><label>高度变化系数 μz</label><input type="number" step="0.01" value={cfg.heightFactor} onChange={e => setCfg({ ...cfg, heightFactor: +e.target.value })} /></div>
                <div className="field"><label>单块配重 (kg)</label><input type="number" value={cfg.blockWeight} onChange={e => setCfg({ ...cfg, blockWeight: +e.target.value })} /></div>
                <div className="field"><label>女儿墙衰减区宽 (m)</label><input type="number" value={cfg.parapetZoneWidth} onChange={e => setCfg({ ...cfg, parapetZoneWidth: +e.target.value })} /></div>
                <div className="field"><label>衰减区间距折减</label><input type="number" step="0.05" value={cfg.parapetDensify} onChange={e => setCfg({ ...cfg, parapetDensify: +e.target.value })} /></div>
              </div>

              {ballast && mounting && (
                <>
                  <div className="grid grid-3">
                    <div className="kpi"><div className="lbl">风吸力 wk (kPa)</div><div className="num mono" style={{ fontSize: 18 }}>{ballast.windSuctionKpa.toFixed(4)}</div></div>
                    <div className="kpi"><div className="lbl">配重排数</div><div className="num" style={{ fontSize: 18 }}>{ballast.rows.length}</div></div>
                    <div className="kpi"><div className="lbl">配重总重 (kg)</div><div className="num check-cell-ok" style={{ fontSize: 18 }}>{ballast.totalBallastKg.toFixed(0)}</div></div>
                  </div>
                  <h4>公式手算复核痕迹</h4>
                  <div className="panel" style={{ padding: 10, background: '#f8fafd' }}>
                    {ballast.trace.map((t, i) => <div key={i} className="mono" style={{ fontSize: 12, marginBottom: 4 }}>{t}</div>)}
                  </div>
                  <div className="kv" style={{ marginTop: 10 }}>
                    <dt>导轨延米</dt><dd className="mono">{mounting.railLengthM.toFixed(1)} m（{mounting.railCount} 根）</dd>
                    <dt>夹具</dt><dd>{mounting.clampCount} 件，其中防水分区强制抗风夹具 <strong className="check-cell-bad">{mounting.windClampCount}</strong> 件（已登记）</dd>
                  </div>
                </>
              )}
              {type === '锚固式' && <p className="muted">锚固式免配重，按屋面结构化学锚栓拉拔力设计，物料清单自动剔除配重块。</p>}
            </div>

            <div className="panel">
              <h3>三维排布预览</h3>
              {project.roof?.result ? (
                <WebGLCanvas nodes={buildRoofScene(project.roof, { showZones: true, showEquipment: true, showBallast: type === '配重式', mounting: mounting ?? undefined })} height={420} />
              ) : <div className="muted" style={{ height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>请先在屋面建模完成平差</div>}
            </div>
          </div>

          <div className="panel">
            <h3>设备选型组合（目标装机 {targetKw} kW）</h3>
            <div className="row" style={{ marginBottom: 10 }}>
              <label style={{ margin: 0 }}>目标装机 <input type="number" value={targetKw} onChange={e => setTargetKw(+e.target.value)} style={{ width: 100, display: 'inline-block' }} /> kW</label>
            </div>
            <div className="scroll-x">
              <table>
                <thead><tr><th>组件</th><th>逆变器</th><th>组件数</th><th>装机 kW</th><th>超配率</th><th>电压裕度</th><th>组串/MPPT</th><th>校验</th><th></th></tr></thead>
                <tbody>
                  {options.slice(0, 8).map((o, i) => {
                    const mod = modules.find(m => m.id === o.moduleModelId)!;
                    const inv = inverters.find(x => x.id === o.inverterModelId)!;
                    const perMppt = Array.from({ length: inv.mpptCount }, () => 0);
                    o.strings.forEach(s => { if (perMppt[s.mpptIndex] !== undefined) perMppt[s.mpptIndex]++; });
                    const checks = checkMpptAssignment(inv, perMppt, mod.imp);
                    const violation = checks.some(c => c.overCurrent || c.overStrings);
                    return (
                      <tr key={i}>
                        <td>{mod.manufacturer} {mod.model}</td>
                        <td>{inv.manufacturer} {inv.model}</td>
                        <td className="mono">{o.moduleCount}</td>
                        <td className="mono">{o.capacityKw.toFixed(1)}</td>
                        <td className={o.oversizeRatio > 0.3 ? 'check-cell-bad' : ''}>{(o.oversizeRatio * 100).toFixed(1)}%</td>
                        <td>{o.voltageMargin.toFixed(1)}%</td>
                        <td className="mono">{o.strings.length} 串 / {inv.mpptCount} 路</td>
                        <td>{violation ? <span className="badge red">超限标红</span> : <span className="badge green">可行</span>}
                          {o.warnings.map((w, k) => <div key={k} className="muted" style={{ fontSize: 11.5 }}>{w}</div>)}</td>
                        <td><button className="small primary" onClick={() => adoptScheme(i)}>采用</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <h3>方案对比与基线锁定</h3>
            {!project.schemes?.length ? <p className="muted">尚未采用任何方案。</p> : (
              <table>
                <thead><tr><th>方案</th><th>装机</th><th>超配率</th><th>电压裕度</th><th>相对基线偏差</th><th>状态</th><th></th></tr></thead>
                <tbody>
                  {project.schemes.map(s => (
                    <tr key={s.id}>
                      <td>{s.name}</td><td className="mono">{s.capacityKw.toFixed(1)} kW</td>
                      <td>{(s.oversizeRatio * 100).toFixed(1)}%</td><td>{s.voltageMargin.toFixed(1)}%</td>
                      <td>{baseline && !s.isBaseline ? (() => { const d = baselineDelta(s, baseline); return `装机 ${d.capacityKw.toFixed(1)}kW`; })() : '—'}</td>
                      <td>{s.isBaseline ? <span className="badge green">基线 ✓</span> : <span className="badge">待选</span>}</td>
                      <td>{!s.isBaseline && <button className="small" onClick={() => lockBaseline(s)}>锁为基线</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {discontinued && (
              <div style={{ marginTop: 12 }}>
                <h4>停产型号替代推荐（{discontinued.model}）</h4>
                {findReplacements(discontinued, modules).map(r => (
                  <div key={r.model.id} className="panel" style={{ padding: 10, marginBottom: 8 }}>
                    <div className="row"><strong>{r.model.manufacturer} {r.model.model}</strong>
                      <span className="badge">相近度 {r.score.toFixed(1)}%</span></div>
                    <div className="row" style={{ fontSize: 12, marginTop: 6 }}>
                      {r.diffs.map(d => <span key={d.field} className="mono">{d.field}: {d.old}→{d.next} ({d.pct >= 0 ? '+' : ''}{d.pct.toFixed(1)}%)</span>)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <h3>物料清单（支架材料按延米/件数自动汇总）</h3>
            <table>
              <thead><tr><th>类别</th><th>名称</th><th>规格</th><th>单位</th><th>数量</th><th>来源</th></tr></thead>
              <tbody>
                {boq.map(b => <tr key={b.id}><td>{b.category}</td><td>{b.name}</td><td>{b.spec}</td><td>{b.unit}</td><td className="mono">{b.qty.toFixed(1)}</td><td className="muted">{b.source}</td></tr>)}
                {!boq.length && <tr><td colSpan={6} className="muted">完成配重计算后自动生成</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
