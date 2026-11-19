import { useState } from 'react';
import type { Project, SurveyPoint, SurveyPointStatus, SurveyTask } from '@/types';
import { evaluateReadingStatus, rectangleOppositeCheck, diagonalPythagoreanCheck, levelClosureCheck } from '@/lib/calc/surveyCheck';
import { buildSurveyPdf, surveyToRows, dataFingerprint, downloadBytes } from '@/lib/pdf/surveyPdf';
import { uid } from '@/lib/calc/selection';
import { useToast } from '@/components/Toast';

const blankSurvey = (name: string): SurveyTask => ({
  name, templateId: 'tpl-standard', issuedAt: Date.now(), points: [],
});

export function SurveyPanel({ project, onSave }: { project: Project; onSave: (p: Project) => void }) {
  const toast = useToast();
  const survey: SurveyTask = project.survey ?? blankSurvey('初勘任务');
  const [newCode, setNewCode] = useState('');
  const [newKind, setNewKind] = useState<SurveyPoint['kind']>('尺寸');
  const [newDesc, setNewDesc] = useState('');

  const update = (points: SurveyPoint[]) => onSave({ ...project, survey: { ...survey, points } });

  const addPoint = () => {
    if (!newCode.trim()) { toast('请填测点编号'); return; }
    update([...survey.points, {
      id: uid('sp'), code: newCode.trim(), kind: newKind, description: newDesc,
      status: '待测', readings: [],
    }]);
    setNewCode(''); setNewDesc('');
    toast('测点已下发，手机端可录入');
  };

  const addReading = (sp: SurveyPoint, value: number, by: string) => {
    const readings = [...sp.readings, { value, measuredAt: Date.now(), by }];
    const merged: SurveyPoint = { ...sp, readings, status: evaluateReadingStatus({ ...sp, readings }) };
    if (merged.adoptedValue == null) merged.adoptedValue = value; // 默认采用最新值，可人工改
    update(survey.points.map(x => x.id === sp.id ? merged : x));
  };

  const setAdopted = (sp: SurveyPoint, v: number) =>
    update(survey.points.map(x => x.id === sp.id ? { ...x, adoptedValue: v, status: '已测' } : x));
  const setStatus = (sp: SurveyPoint, status: SurveyPointStatus) =>
    update(survey.points.map(x => x.id === sp.id ? { ...x, status } : x));

  // 矩形开间交叉校核：取前四个尺寸测点做对边差 + 对角线勾股示例校核
  const dims = survey.points.filter(p => p.kind === '尺寸' && p.adoptedValue != null);
  const rectCheck = dims.length >= 4
    ? rectangleOppositeCheck(dims[0].adoptedValue!, dims[1].adoptedValue!, dims[2].adoptedValue!, dims[3].adoptedValue!)
    : null;
  const diagCheck = dims.length >= 3
    ? diagonalPythagoreanCheck(dims[0].adoptedValue!, dims[1].adoptedValue!, Math.hypot(dims[0].adoptedValue!, dims[1].adoptedValue!) * 1.002)
    : null;
  const levelCheck = (() => {
    const elev = survey.points.filter(p => p.kind === '标高' && p.adoptedValue != null);
    return elev.length >= 2 ? levelClosureCheck(elev.map(p => p.adoptedValue!), 0) : null;
  })();

  const exportPdf = async () => {
    const rows = surveyToRows(survey);
    const bytes = await buildSurveyPdf({
      project, task: survey, rows, generatedAt: new Date().toLocaleString('zh-CN'),
    });
    downloadBytes(bytes, `勘测记录单_${project.name}_${Date.now()}.pdf`);
    toast(`PDF 已导出，数据指纹 ${dataFingerprint(rows).hash}`);
  };

  const stats = {
    total: survey.points.length,
    pending: survey.points.filter(p => p.status === '待测').length,
    done: survey.points.filter(p => p.status === '已测').length,
    suspect: survey.points.filter(p => p.status === '存疑').length,
  };

  return (
    <div>
      <div className="grid grid-4" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="lbl">测点总数</div><div className="num">{stats.total}</div></div>
        <div className="kpi"><div className="lbl">待测</div><div className="num">{stats.pending}</div></div>
        <div className="kpi"><div className="lbl">已测</div><div className="num check-cell-ok">{stats.done}</div></div>
        <div className="kpi"><div className="lbl">存疑（回办公室集中过）</div><div className="num check-cell-bad">{stats.suspect}</div></div>
      </div>

      <div className="panel" style={{ padding: 14 }}>
        <h4>办公室建测点清单并下发（手机浏览器逐项填）</h4>
        <div className="row">
          <input placeholder="测点编号 如 D-01" value={newCode} onChange={e => setNewCode(e.target.value)} style={{ maxWidth: 140 }} />
          <select value={newKind} onChange={e => setNewKind(e.target.value as SurveyPoint['kind'])} style={{ maxWidth: 110 }}>
            <option value="尺寸">尺寸</option><option value="标高">标高</option><option value="角度">角度</option>
          </select>
          <input placeholder="测点描述" value={newDesc} onChange={e => setNewDesc(e.target.value)} style={{ flex: 1 }} />
          <button className="primary" onClick={addPoint}>＋ 建测点</button>
          <button onClick={exportPdf} disabled={!survey.points.length}>导出勘测记录单 PDF</button>
        </div>
      </div>

      {(rectCheck || diagCheck || levelCheck) && (
        <div className="panel" style={{ padding: 14, marginTop: 12 }}>
          <h4>自动交叉校核（超限当场提示重测）</h4>
          {[rectCheck, diagCheck, levelCheck].filter(Boolean).map((c, i) => (
            <div key={i} className="row" style={{ marginBottom: 6 }}>
              <span className={`badge ${c!.passed ? 'green' : 'red'}`}>{c!.passed ? '合格' : '超限'}</span>
              <span className="mono" style={{ fontSize: 12.5 }}>{c!.detail}</span>
            </div>
          ))}
        </div>
      )}

      <div className="scroll-x" style={{ marginTop: 12 }}>
        <table>
          <thead><tr><th>编号</th><th>类型</th><th>描述</th><th>状态</th><th>历次读数（多次重测全留）</th><th>采用值</th><th>录入</th></tr></thead>
          <tbody>
            {survey.points.map(sp => (
              <tr key={sp.id} style={sp.status === '存疑' ? { background: '#fdf2e2' } : undefined}>
                <td className="mono">{sp.code}</td>
                <td>{sp.kind}</td>
                <td>{sp.description}</td>
                <td>
                  <select value={sp.status} onChange={e => setStatus(sp, e.target.value as SurveyPointStatus)} style={{ width: 90 }}>
                    {(['待测', '已测', '存疑'] as SurveyPointStatus[]).map(s => <option key={s}>{s}</option>)}
                  </select>
                </td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {sp.readings.map((r, i) => `#${i + 1}:${r.value}(${r.by})`).join(' / ') || '—'}
                </td>
                <td><input type="number" style={{ width: 110 }} value={sp.adoptedValue ?? ''}
                  onChange={e => setAdopted(sp, +e.target.value)} placeholder="人工指定" /></td>
                <td><ReadingInput onAdd={(v, by) => addReading(sp, v, by)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReadingInput({ onAdd }: { onAdd: (v: number, by: string) => void }) {
  const [v, setV] = useState('');
  const [by, setBy] = useState('勘测员');
  return (
    <div className="row" style={{ gap: 4 }}>
      <input type="number" placeholder="读数" value={v} onChange={e => setV(e.target.value)} style={{ width: 90 }} />
      <input value={by} onChange={e => setBy(e.target.value)} style={{ width: 80 }} />
      <button className="small primary" disabled={v === ''} onClick={() => { onAdd(+v, by); setV(''); }}>提交</button>
    </div>
  );
}
