import { useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import { exportBackup, importBackup } from '@/lib/db';
import { useToast } from '@/components/Toast';
import { downloadBytes } from '@/lib/pdf/surveyPdf';
import type { PvModuleModel, InverterModel } from '@/types';
import { uid } from '@/lib/calc/selection';

export function SettingsPage() {
  const { settings, saveSettings, modules, inverters, optimizers, upsertModule, upsertInverter } = useStore();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(settings);
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft({ ...draft, [k]: v });
  const setLoss = (k: keyof typeof draft.lossCoeffs, v: number) =>
    setDraft({ ...draft, lossCoeffs: { ...draft.lossCoeffs, [k]: v } });

  const doExport = async () => {
    const json = await exportBackup();
    downloadBytes(new TextEncoder().encode(json), `光伏系统备份_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    toast('备份文件已导出（全本地数据）');
  };
  const doImport = async (file: File) => {
    if (!confirm('恢复备份将覆盖当前数据库，确定继续？')) return;
    try {
      await importBackup(await file.text());
      toast('恢复成功，刷新页面后生效');
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      toast('备份文件无效：' + (e as Error).message);
    }
  };

  return (
    <div>
      <div className="page-head"><h1>设置</h1></div>

      <div className="panel">
        <h3>单位与默认地理位置</h3>
        <div className="form-grid">
          <div className="field"><label>单位制</label>
            <select value={draft.unit} onChange={e => set('unit', e.target.value as typeof draft.unit)}>
              <option value="公制">公制（m / kW / kPa）</option>
              <option value="英制">英制（ft / hp / psf）</option>
            </select>
          </div>
          <div className="field"><label>默认城市</label><input value={draft.defaultCity} onChange={e => set('defaultCity', e.target.value)} /></div>
          <div className="field"><label>默认纬度</label><input type="number" step="0.01" value={draft.defaultLat} onChange={e => set('defaultLat', +e.target.value)} /></div>
          <div className="field"><label>默认经度</label><input type="number" step="0.01" value={draft.defaultLon} onChange={e => set('defaultLon', +e.target.value)} /></div>
          <div className="field"><label>导线闭合差系数 K</label><input type="number" step="0.01" value={draft.traverseToleranceK} onChange={e => set('traverseToleranceK', +e.target.value)} /></div>
        </div>
        <button className="primary" onClick={async () => { await saveSettings(draft); toast('设置已保存'); }}>保存设置</button>
      </div>

      <div className="panel">
        <h3>损耗系数表（逐时发电量模拟使用）</h3>
        <div className="grid grid-4">
          {(Object.keys(draft.lossCoeffs) as (keyof typeof draft.lossCoeffs)[]).map(k => (
            <div className="field" key={k}>
              <label>{k}（{(draft.lossCoeffs[k] * 100).toFixed(1)}%）</label>
              <input type="number" step="0.005" min={0} max={1} value={draft.lossCoeffs[k]} onChange={e => setLoss(k, +e.target.value)} />
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>组件型号库维护</h3>
        <div className="scroll-x">
          <table>
            <thead><tr><th>厂家</th><th>型号</th><th>功率W</th><th>尺寸 mm</th><th>Voc/Isc</th><th>Vmp/Imp</th><th>状态</th><th></th></tr></thead>
            <tbody>
              {modules.map(m => (
                <tr key={m.id}>
                  <td>{m.manufacturer}</td><td>{m.model}</td><td className="mono">{m.powerW}</td>
                  <td className="mono">{m.lengthMm}×{m.widthMm}</td>
                  <td className="mono">{m.voc}/{m.isc}</td><td className="mono">{m.vmp}/{m.imp}</td>
                  <td>{m.discontinued ? <span className="badge amber">停产</span> : <span className="badge green">在产</span>}</td>
                  <td><button className="small" onClick={() => upsertModule({ ...m, discontinued: !m.discontinued })}>
                    {m.discontinued ? '恢复在产' : '标记停产'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="small" style={{ marginTop: 10 }} onClick={() => {
          const m: PvModuleModel = {
            id: uid('mod'), manufacturer: '新厂家', model: '新型号', powerW: 550, lengthMm: 2278, widthMm: 1134,
            thicknessMm: 35, weightKg: 27.5, voc: 49.8, isc: 14.1, vmp: 41.8, imp: 13.16,
            vocTempCoeff: -0.25, iscTempCoeff: 0.05, noct: 45, nCells: 144, nSubstrings: 3,
          };
          upsertModule(m); toast('已添加空白组件型号，可编辑表格字段');
        }}>＋ 新增组件型号</button>
      </div>

      <div className="panel">
        <h3>逆变器型号库维护</h3>
        <div className="scroll-x">
          <table>
            <thead><tr><th>厂家</th><th>型号</th><th>额定kW</th><th>最大直流V</th><th>MPPT窗口</th><th>路数×串/路</th><th>效率</th><th></th></tr></thead>
            <tbody>
              {inverters.map(i => (
                <tr key={i.id}>
                  <td>{i.manufacturer}</td><td>{i.model}</td><td className="mono">{i.ratedKw}</td>
                  <td className="mono">{i.maxDcVoltage}</td><td className="mono">{i.mpptLow}~{i.mpptHigh}</td>
                  <td className="mono">{i.mpptCount}×{i.stringsPerMppt}</td><td className="mono">{(i.euroEfficiency * 100).toFixed(1)}%</td>
                  <td><button className="small" onClick={() => upsertInverter({ ...i, discontinued: !i.discontinued })}>
                    {i.discontinued ? '恢复在产' : '标记停产'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="small" style={{ marginTop: 10 }} onClick={() => {
          const inv: InverterModel = {
            id: uid('inv'), manufacturer: '新厂家', model: '新型号', ratedKw: 100, maxDcVoltage: 1100,
            mpptLow: 200, mpptHigh: 1000, mpptCount: 6, stringsPerMppt: 2, maxInputCurrent: 26, euroEfficiency: 0.98,
          };
          upsertInverter(inv); toast('已添加空白逆变器型号');
        }}>＋ 新增逆变器型号</button>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>优化器/关断器库：{optimizers.map(o => `${o.model}(${o.kind})`).join('；')}</p>
      </div>

      <div className="panel">
        <h3>数据备份与恢复</h3>
        <p className="muted">所有项目、屋面、方案、勘测、气象数据均保存在浏览器本地 IndexedDB，不依赖任何外部服务。</p>
        <div className="row">
          <button className="primary" onClick={doExport}>导出全量备份 JSON</button>
          <input ref={fileRef} type="file" accept=".json" hidden onChange={e => e.target.files?.[0] && doImport(e.target.files[0])} />
          <button onClick={() => fileRef.current?.click()}>从备份恢复</button>
        </div>
      </div>

      <div className="panel">
        <h3>PDF 中文字体（可选）</h3>
        <p className="muted" style={{ fontSize: 12.5 }}>
          勘测记录单 PDF 默认用内置字体可靠输出数字/英文；如需原生中文，可上传一个 .ttf/.otf 字体子集（如思源黑体），仅保存在本机浏览器内。
        </p>
        <CjkFontLoader />
      </div>
    </div>
  );
}

function CjkFontLoader() {
  const toast = useToast();
  const onChange = async (f: File) => {
    const bytes = new Uint8Array(await f.arrayBuffer());
    localStorage.setItem('pv-cjk-font', JSON.stringify(Array.from(bytes.slice(0, 1_800_000))));
    toast(`已载入字体 ${f.name}（${(bytes.length / 1024 / 1024).toFixed(1)}MB），后续 PDF 使用该字体`);
  };
  return <input type="file" accept=".ttf,.otf" onChange={e => e.target.files?.[0] && onChange(e.target.files[0])} style={{ maxWidth: 360 }} />;
}
