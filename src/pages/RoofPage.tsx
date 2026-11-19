import { useMemo, useState } from 'react';
import { useStore } from '@/store/useStore';
import type { RoofModel } from '@/types';
import { ProjectSelector } from '@/components/ProjectSelector';
import { WebGLCanvas } from '@/components/WebGLCanvas';
import { buildRoofScene } from '@/lib/webgl/roofScene';
import { TraverseEditor } from '@/components/roof/TraverseEditor';
import { PlaneEditor, ZoneEquipmentEditor } from '@/components/roof/PlaneEditor';
import { SurveyPanel } from '@/components/roof/SurveyPanel';
import type { RenderNode } from '@/lib/webgl/renderer';

type Tab = 'traverse' | 'plane' | 'zone' | 'survey';
const TABS: { key: Tab; label: string }[] = [
  { key: 'traverse', label: '导线法测量' },
  { key: 'plane', label: '坡面起坡' },
  { key: 'zone', label: '分区与设备' },
  { key: 'survey', label: '勘测任务' },
];

const emptyRoof = (): RoofModel => ({
  traverse: [], firstBearingDeg: 0, toleranceCoeff: 0.05,
  planes: [], zones: [], equipment: [],
});

export function RoofPage() {
  const { projects, upsertProject } = useStore();
  const [pid, setPid] = useState(projects[0]?.id ?? '');
  const [tab, setTab] = useState<Tab>('traverse');
  const [layers, setLayers] = useState({ zones: true, equipment: true, ballast: false, modules: false });
  const project = projects.find(p => p.id === pid);
  const roof = project?.roof ?? emptyRoof();

  const nodes: RenderNode[] = useMemo(() => {
    if (!project?.roof?.result) return [];
    return buildRoofScene(project.roof, {
      showZones: layers.zones, showEquipment: layers.equipment,
      showBallast: layers.ballast, showModules: layers.modules,
    });
  }, [project, layers]);

  const changeRoof = async (r: RoofModel) => {
    if (!project) return;
    await upsertProject({ ...project, roof: r });
  };

  return (
    <div>
      <div className="page-head">
        <h1>屋面建模</h1>
        <div className="row">
          <ProjectSelector value={pid} onChange={setPid} />
          {project && <button className="small" onClick={async () => { await upsertProject({ ...project, roof: emptyRoof() }); }}>清空屋面</button>}
        </div>
      </div>

      {!project ? <div className="panel muted">请先在项目管理创建并选择一个项目。</div> : (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.15fr) minmax(0,1fr)' }}>
          <div className="panel">
            <div className="row" style={{ marginBottom: 12 }}>
              {TABS.map(t => (
                <button key={t.key} className={`small ${tab === t.key ? 'primary' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
              ))}
            </div>
            <div className="row" style={{ marginBottom: 10, fontSize: 12.5 }}>
              {([['zones', '分区'], ['equipment', '设备占位']] as const).map(([k, label]) => (
                <label key={k} style={{ margin: 0 }} className="clickable">
                  <input type="checkbox" style={{ width: 'auto', marginRight: 4 }} checked={layers[k]}
                    onChange={e => setLayers({ ...layers, [k]: e.target.checked })} />{label}
                </label>
              ))}
            </div>
            <div style={{ maxHeight: '70vh', overflow: 'auto', paddingRight: 6 }}>
              {tab === 'traverse' && <TraverseEditor roof={roof} onChange={changeRoof} />}
              {tab === 'plane' && <PlaneEditor roof={roof} onChange={changeRoof} />}
              {tab === 'zone' && <ZoneEquipmentEditor roof={roof} onChange={changeRoof} />}
              {tab === 'survey' && <SurveyPanel project={project} onSave={upsertProject} />}
            </div>
          </div>

          <div className="panel">
            <h3>三维屋面（WebGL2 · 拖拽旋转 / 滚轮缩放）</h3>
            {nodes.length ? <WebGLCanvas nodes={nodes} height={560} /> : (
              <div style={{ height: 560, display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="muted">
                完成导线平差并定义坡面后，这里生成三维屋面
              </div>
            )}
            {roof.result && (
              <div className="kv" style={{ marginTop: 12 }}>
                <dt>水平投影面积</dt><dd className="mono">{roof.result.area2d.toFixed(2)} m²</dd>
                <dt>闭合差</dt><dd className={roof.result.passed ? 'check-cell-ok' : 'check-cell-bad'}>
                  {roof.result.closureF.toFixed(4)} m（限差 {roof.result.tolerance.toFixed(4)}）</dd>
                <dt>坡面数</dt><dd>{roof.planes.length}</dd>
                <dt>分区 / 设备</dt><dd>{roof.zones.length} / {roof.equipment.length}</dd>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
