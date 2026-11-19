import { useMemo, useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import { ProjectSelector } from '@/components/ProjectSelector';
import { LineChart, BarChart } from '@/components/Charts';
import { useToast } from '@/components/Toast';
import { simulateString, type ModuleCondition } from '@/lib/calc/ivSimulation';
import { parseTmyCsv } from '@/lib/calc/tmy';
import { simulateEnergy } from '@/lib/calc/energy';
import { checkElectrical } from '@/lib/calc/electrical';
import { computeFinance, weightedSelfUseTariff } from '@/lib/calc/finance';
import type { FinanceConfig, TmyDataset } from '@/types';

type Tab = 'iv' | 'energy' | 'electrical' | 'finance';

export function SimulationPage() {
  const { projects, modules, inverters, optimizers, settings, upsertProject } = useStore();
  const toast = useToast();
  const [pid, setPid] = useState(projects[0]?.id ?? '');
  const [tab, setTab] = useState<Tab>('iv');
  const project = projects.find(p => p.id === pid);

  return (
    <div>
      <div className="page-head">
        <h1>仿真分析</h1>
        <ProjectSelector value={pid} onChange={setPid} />
      </div>
      {!project ? <div className="panel muted">请先选择项目。</div> : (
        <>
          <div className="row" style={{ marginBottom: 14 }}>
            {([['iv', '组件级 I-V 仿真'], ['energy', '逐时发电量'], ['electrical', '电气校验'], ['finance', '收益测算']] as [Tab, string][]).map(([k, l]) => (
              <button key={k} className={`small ${tab === k ? 'primary' : ''}`} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab === 'iv' && <IvPanel projectId={pid} />}
          {tab === 'energy' && <EnergyPanel projectId={pid} />}
          {tab === 'electrical' && <ElectricalPanel projectId={pid} />}
          {tab === 'finance' && <FinancePanel projectId={pid} />}
        </>
      )}
    </div>
  );
}

// ---------- I-V / MPPT ----------
function IvPanel({ projectId }: { projectId: string }) {
  const { modules, optimizers } = useStore();
  const mod = modules.find(m => !m.discontinued) ?? modules[0];
  const [stringSize, setStringSize] = useState(12);
  const [shadedCount, setShadedCount] = useState(3);
  const [shading, setShading] = useState(0.6);
  const [failure, setFailure] = useState(0);
  const [useOptimizer, setUseOptimizer] = useState(false);

  const result = useMemo(() => {
    if (!mod) return null;
    const conds: ModuleCondition[] = Array.from({ length: stringSize }, (_, i) => ({
      moduleId: `m${i}`,
      irradiance: i < shadedCount ? 1000 * (1 - shading) : 1000,
      tempC: i < shadedCount ? 35 : 25,
      failureRate: i < shadedCount ? failure : 0,
    }));
    return simulateString(mod, conds, useOptimizer ? optimizers[0] : undefined,
      optimizers[0]?.priceYuan ?? 180, 1300, 0.4);
  }, [mod, stringSize, shadedCount, shading, failure, useOptimizer, optimizers]);

  if (!mod || !result) return null;
  const ivSeries = {
    name: 'I-V 电流 A', color: '#2f5fe0',
    points: result.ivCurve.filter((_, i) => i % 3 === 0).map(p => ({ x: p.v, y: p.i })),
  };
  const pSeries = {
    name: 'P-V 功率 W', color: '#d64045',
    points: result.ivCurve.filter((_, i) => i % 3 === 0).map(p => ({ x: p.v, y: p.p / 100 })),
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.3fr)' }}>
      <div className="panel">
        <h3>遮挡 / 失效工况设置</h3>
        <div className="form-grid">
          <div className="field"><label>组串组件数</label><input type="number" value={stringSize} onChange={e => setStringSize(+e.target.value)} /></div>
          <div className="field"><label>被遮挡组件数</label><input type="number" value={shadedCount} onChange={e => setShadedCount(Math.min(stringSize, +e.target.value))} /></div>
          <div className="field"><label>遮挡比例</label><input type="number" step="0.05" min={0} max={1} value={shading} onChange={e => setShading(+e.target.value)} /></div>
          <div className="field"><label>失效率</label><input type="number" step="0.05" min={0} max={1} value={failure} onChange={e => setFailure(+e.target.value)} /></div>
        </div>
        <label className="clickable" style={{ marginBottom: 12 }}>
          <input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={useOptimizer} onChange={e => setUseOptimizer(e.target.checked)} />
          模拟加装 {optimizers[0]?.kind ?? '优化器'} 后曲线恢复单峰
        </label>

        <h4>MPPT 算法落点对比（GMPP 偏差红线 3%）</h4>
        <table>
          <thead><tr><th>算法</th><th>Vmpp</th><th>Pmpp(W)</th><th>偏差</th><th>误锁低峰</th></tr></thead>
          <tbody>
            {result.mpptRuns.map(r => (
              <tr key={r.algorithm}>
                <td>{r.algorithm}</td>
                <td className="mono">{r.vmpp.toFixed(1)}</td>
                <td className="mono">{r.pmpp.toFixed(0)}</td>
                <td className={r.deviationPct > 3 ? 'check-cell-bad' : 'check-cell-ok'}>{r.deviationPct.toFixed(2)}%</td>
                <td>{r.lockedLowPeak ? <span className="badge red">误锁，损失 {r.lossVsGlobalW.toFixed(0)}W</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="kv" style={{ marginTop: 12 }}>
          <dt>错配损失</dt><dd className="mono">{result.mismatchLossW.toFixed(1)} W（同朝向无遮挡参考 {result.mismatchLossRefW.toFixed(0)}W）</dd>
          {result.withOptimizer && <>
            <dt>优化后 MPP</dt><dd className="mono">{result.withOptimizer.mpp.p.toFixed(0)} W，年多捞 {result.withOptimizer.gainKwh.toFixed(1)} kWh</dd>
            <dt>回本周期</dt><dd className={result.withOptimizer.worthIt ? 'check-cell-ok' : 'check-cell-bad'}>
              {isFinite(result.withOptimizer.paybackYears) ? `${result.withOptimizer.paybackYears.toFixed(1)} 年` : '无法回本'}
              （{result.withOptimizer.worthIt ? '值得装' : '不建议装'}）</dd>
          </>}
        </div>
      </div>
      <div className="panel">
        <h3>多峰 I-V / P-V 曲线（含旁路二极管分段）</h3>
        <LineChart series={[ivSeries, pSeries]} xLabel="电压 V" yLabel="电流 A / 功率(÷100) kW" />
        <p className="muted" style={{ fontSize: 12.5 }}>
          全局 GMPP：{result.globalMpp.v.toFixed(1)}V / {result.globalMpp.p.toFixed(0)}W。双峰下扰动观察单起点可能误锁低峰，多起点与全局扫描偏差均 ≤3%。
        </p>
      </div>
    </div>
  );
}

// ---------- TMY 逐时 ----------
function EnergyPanel({ projectId }: { projectId: string }) {
  const { projects, settings, upsertProject } = useStore();
  const toast = useToast();
  const project = projects.find(p => p.id === projectId)!;
  const fileRef = useRef<HTMLInputElement>(null);
  const [tilt, setTilt] = useState(10);
  const [azimuth, setAzimuth] = useState(180);
  const [cleaningCost, setCleaningCost] = useState(800);
  const [dustRate, setDustRate] = useState(0.0008);

  const tmy: TmyDataset | undefined = project.tmy;
  const result = useMemo(() => {
    if (!tmy || !tmy.records.length) return null;
    const invDefault = 0.98;
    return simulateEnergy({
      capacityKw: project.capacityKw || 50, tmy, loss: settings.lossCoeffs,
      inverterEfficiency: invDefault, yearOneDegradation: 0.02, annualDegradation: 0.0055,
      tiltDeg: tilt, azimuthDeg: azimuth, cleaningCostYuan: cleaningCost,
      electricityPrice: 0.4, dustAccumRate: dustRate,
    });
  }, [tmy, project.capacityKw, settings.lossCoeffs, tilt, azimuth, cleaningCost, dustRate]);

  const importCsv = async (file: File) => {
    const text = await file.text();
    try {
      const { data, warnings } = parseTmyCsv(text, settings.defaultCity, settings.defaultLat, settings.defaultLon);
      await upsertProject({ ...project, tmy: data });
      toast(warnings.length ? warnings.join('；') : `已导入 ${data.records.length} 条逐时气象记录`);
    } catch (e) {
      toast('CSV 解析失败：' + (e as Error).message);
    }
  };

  return (
    <div>
      <div className="panel">
        <div className="row">
          <input ref={fileRef} type="file" accept=".csv" style={{ maxWidth: 300 }}
            onChange={e => e.target.files?.[0] && importCsv(e.target.files[0])} />
          <label style={{ margin: 0 }}>倾角 <input type="number" value={tilt} onChange={e => setTilt(+e.target.value)} style={{ width: 70, display: 'inline-block' }} />°</label>
          <label style={{ margin: 0 }}>方位角 <input type="number" value={azimuth} onChange={e => setAzimuth(+e.target.value)} style={{ width: 80, display: 'inline-block' }} />°</label>
          <span className="muted">气象数据全部本地解析，不上传任何外部服务</span>
        </div>
      </div>

      {!result ? <div className="panel muted">导入典型气象年 CSV（列：month,day,hour,GHI,DHI,temp,wind）后开始逐时模拟。</div> : (
        <>
          <div className="grid grid-4">
            <div className="kpi"><div className="lbl">首年总发电量</div><div className="num">{(result.netKwh / 10000).toFixed(1)} 万kWh</div></div>
            <div className="kpi"><div className="lbl">毛发电量</div><div className="num">{(result.grossKwh / 10000).toFixed(1)} 万kWh</div></div>
            <div className="kpi"><div className="lbl">建议清洗周期</div><div className="num">{result.cleaningAdvice.intervalDays} 天</div></div>
            <div className="kpi"><div className="lbl">清洗净收益</div><div className="num" style={{ fontSize: 18 }}>{(result.cleaningAdvice.recoveredValueYuan - result.cleaningAdvice.costYuan).toFixed(0)} 元/次</div></div>
          </div>

          <div className="panel">
            <h3>损耗逐项拆分</h3>
            <table>
              <thead><tr><th>损耗项</th><th>电量 kWh</th><th>占毛发电</th></tr></thead>
              <tbody>{result.losses.map(l => <tr key={l.name}><td>{l.name}</td><td className="mono">{l.kwh.toFixed(0)}</td><td className="mono">{l.pct.toFixed(2)}%</td></tr>)}</tbody>
            </table>
          </div>

          <div className="panel">
            <h3>月度发电量与等效利用小时（弃光限电时段单列）</h3>
            <BarChart data={result.monthly.map(m => ({ label: `${m.month}月`, value: m.kwh }))} unit="kWh" />
            <table>
              <thead><tr><th>月</th><th>电量 kWh</th><th>等效小时</th><th>弃光限电时段</th></tr></thead>
              <tbody>{result.monthly.map(m => <tr key={m.month}><td>{m.month}</td><td className="mono">{m.kwh.toFixed(0)}</td><td className="mono">{m.equivHours.toFixed(1)}</td><td>{m.curtailHours} h</td></tr>)}</tbody>
            </table>
          </div>

          <div className="panel">
            <h3>25 年衰减发电曲线（首年衰减 2%，逐年 0.55%）</h3>
            <LineChart series={[{ name: '年发电量 万kWh', color: '#2e9e62', points: result.yearly25.map(y => ({ x: y.year, y: y.kwh / 10000, label: `${y.year}` })) }]} xLabel="运行年" yLabel="万kWh" />
          </div>

          <div className="panel">
            <h3>清洗经济性</h3>
            <div className="kv">
              <dt>单次人工费</dt><dd>{result.cleaningAdvice.costYuan} 元</dd>
              <dt>单次多捞电量</dt><dd className="mono">{result.cleaningAdvice.recoveredKwh.toFixed(1)} kWh</dd>
              <dt>多捞电费</dt><dd className="mono">{result.cleaningAdvice.recoveredValueYuan.toFixed(0)} 元</dd>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- 电气校验 ----------
function ElectricalPanel({ projectId }: { projectId: string }) {
  const { projects, modules, inverters } = useStore();
  const project = projects.find(p => p.id === projectId)!;
  const [minTemp, setMinTemp] = useState(-10);
  const [maxTemp, setMaxTemp] = useState(60);
  const [stringSize, setStringSize] = useState(20);
  const [cableLen, setCableLen] = useState(60);
  const mod = modules.find(m => !m.discontinued) ?? modules[0];
  const inv = inverters[0];

  const check = useMemo(() => checkElectrical({
    module: mod, inverter: inv, stringSize, minTempC: minTemp, maxTempC: maxTemp,
    stringCurrentA: mod.imp, cableOneWayM: cableLen,
  }), [mod, inv, stringSize, minTemp, maxTemp, cableLen]);

  return (
    <div className="panel">
      <h3>组串电气校验（极端低温开路电压修正）</h3>
      <div className="form-grid">
        <div className="field"><label>每串组件数</label><input type="number" value={stringSize} onChange={e => setStringSize(+e.target.value)} /></div>
        <div className="field"><label>极端低温 °C</label><input type="number" value={minTemp} onChange={e => setMinTemp(+e.target.value)} /></div>
        <div className="field"><label>极端高温 °C</label><input type="number" value={maxTemp} onChange={e => setMaxTemp(+e.target.value)} /></div>
        <div className="field"><label>直流单程线长 m</label><input type="number" value={cableLen} onChange={e => setCableLen(+e.target.value)} /></div>
      </div>
      <div className="grid grid-4">
        <div className="kpi"><div className="lbl">低温修正 Voc</div><div className={`num mono ${check.overVoltage ? 'check-cell-bad' : ''}`} style={{ fontSize: 18 }}>{check.vocCold.toFixed(0)} V</div></div>
        <div className="kpi"><div className="lbl">逆变器最大直流电压</div><div className="num mono" style={{ fontSize: 18 }}>{check.maxDcVoltage} V</div></div>
        <div className="kpi"><div className="lbl">建议串数范围</div><div className="num" style={{ fontSize: 18 }}>{check.suggestedStringSize.min}~{check.suggestedStringSize.max}</div></div>
        <div className="kpi"><div className="lbl">电缆选型</div><div className="num" style={{ fontSize: 15 }}>{check.cableSpec}</div></div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        {check.overVoltage && <span className="badge red">✗ 超压：低温 Voc 超逆变器上限，建议串数 ≤ {check.suggestedStringSize.max}</span>}
        {check.underVoltage && <span className="badge red">✗ 欠压：高温 MPP 电压低于窗口下限，建议串数 ≥ {check.suggestedStringSize.min}</span>}
        {!check.overVoltage && !check.underVoltage && <span className="badge green">✓ 电压窗口合格</span>}
        {check.lengthWarning && <span className="badge amber">⚠ 直流线长 {check.cableLengthM}m，压降 {check.voltageDropPct.toFixed(2)}%（限值 2%），建议加大截面</span>}
        {!check.lengthWarning && <span className="badge green">压降 {check.voltageDropPct.toFixed(2)}% 合格</span>}
      </div>
      <div className="kv" style={{ marginTop: 10 }}>
        <dt>载流量校验</dt><dd>工作电流 {check.currentA.toFixed(2)}A，所选电缆载流量 {check.ampacityA}A（1.25 倍裕度）</dd>
      </div>
    </div>
  );
}

// ---------- 收益 ----------
function FinancePanel({ projectId }: { projectId: string }) {
  const { projects, upsertProject } = useStore();
  const project = projects.find(p => p.id === projectId)!;
  const [cfg, setCfg] = useState<FinanceConfig>(project.finance ?? {
    selfUseRatio: 0.8, feedInTariff: 0.39,
    tariffs: [{ name: '峰', price: 0.95, hours: 6 }, { name: '平', price: 0.65, hours: 10 }, { name: '谷', price: 0.35, hours: 8 }],
    initialInvestment: (project.capacityKw || 50) * 3200, annualOpex: 8000, discountRate: 0.06,
  });
  const [annualKwh, setAnnualKwh] = useState((project.capacityKw || 50) * 1100);

  const result = useMemo(() => computeFinance({
    ...cfg, annualEnergyKwh: annualKwh, degradation: 0.0055, years: 25,
  }), [cfg, annualKwh]);

  const setTariff = (i: number, patch: Partial<FinanceConfig['tariffs'][0]>) =>
    setCfg({ ...cfg, tariffs: cfg.tariffs.map((t, k) => k === i ? { ...t, ...patch } : t) });

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr)' }}>
      <div className="panel">
        <h3>收益参数</h3>
        <div className="form-grid">
          <div className="field"><label>年发电量 kWh</label><input type="number" value={annualKwh} onChange={e => setAnnualKwh(+e.target.value)} /></div>
          <div className="field"><label>自发自用比例</label><input type="number" step="0.05" value={cfg.selfUseRatio} onChange={e => setCfg({ ...cfg, selfUseRatio: +e.target.value })} /></div>
          <div className="field"><label>余电上网电价</label><input type="number" step="0.01" value={cfg.feedInTariff} onChange={e => setCfg({ ...cfg, feedInTariff: +e.target.value })} /></div>
          <div className="field"><label>初投资 元</label><input type="number" value={cfg.initialInvestment} onChange={e => setCfg({ ...cfg, initialInvestment: +e.target.value })} /></div>
          <div className="field"><label>年运维 元</label><input type="number" value={cfg.annualOpex} onChange={e => setCfg({ ...cfg, annualOpex: +e.target.value })} /></div>
          <div className="field"><label>折现率</label><input type="number" step="0.01" value={cfg.discountRate} onChange={e => setCfg({ ...cfg, discountRate: +e.target.value })} /></div>
        </div>
        <h4>分时电价（峰平谷）</h4>
        {cfg.tariffs.map((t, i) => (
          <div className="row" key={i} style={{ marginBottom: 8 }}>
            <strong style={{ width: 30 }}>{t.name}</strong>
            <label style={{ margin: 0 }}>电价 <input type="number" step="0.01" value={t.price} onChange={e => setTariff(i, { price: +e.target.value })} style={{ width: 90, display: 'inline-block' }} /></label>
            <label style={{ margin: 0 }}>小时 <input type="number" value={t.hours} onChange={e => setTariff(i, { hours: +e.target.value })} style={{ width: 70, display: 'inline-block' }} /></label>
          </div>
        ))}
        <button className="primary" onClick={async () => { await upsertProject({ ...project, finance: cfg }); }}>保存收益参数</button>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>自用电价加权均值 {weightedSelfUseTariff(cfg).toFixed(3)} 元/kWh</p>
      </div>

      <div>
        <div className="grid grid-3">
          <div className="kpi"><div className="lbl">年电费收入</div><div className="num" style={{ fontSize: 19 }}>{(result.annualRevenue / 10000).toFixed(1)} 万</div></div>
          <div className="kpi"><div className="lbl">静态回收期</div><div className="num check-cell-ok" style={{ fontSize: 19 }}>{isFinite(result.staticPaybackYears) ? `${result.staticPaybackYears.toFixed(1)} 年` : '>25年'}</div></div>
          <div className="kpi"><div className="lbl">IRR / NPV</div><div className="num" style={{ fontSize: 16 }}>{isFinite(result.irr) ? (result.irr * 100).toFixed(1) : '—'}%<br /><span style={{ fontSize: 13 }}>{(result.npv / 10000).toFixed(1)} 万</span></div></div>
        </div>
        <div className="panel">
          <h3>敏感性分析：电价/装机 ±20% → 回收期实时变化</h3>
          <LineChart series={[{
            name: '静态回收期(年)', color: '#c77a16',
            points: result.sensitivity.map(s => ({ x: s.changePct, y: isFinite(s.payback) ? s.payback : 25, label: `${s.changePct}%` })),
          }]} xLabel="电价/装机变化 %" yLabel="回收期 年" />
          <table>
            <thead><tr><th>变化幅度</th><th>-20%</th><th>-10%</th><th>0</th><th>+10%</th><th>+20%</th></tr></thead>
            <tbody><tr>
              <td>回收期(年)</td>
              {result.sensitivity.map(s => <td key={s.changePct} className="mono">{isFinite(s.payback) ? s.payback.toFixed(1) : '>25'}</td>)}
            </tr></tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
