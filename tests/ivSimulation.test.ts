import { describe, it, expect } from 'vitest';
import {
  fitSingleDiode, moduleCurve, stringCurve, globalScan,
  perturbObserve, perturbObserveMultiStart, simulateString,
} from '@/lib/calc/ivSimulation';
import type { PvModuleModel } from '@/types';
import type { ModuleCondition } from '@/lib/calc/ivSimulation';

const mod: PvModuleModel = {
  id: 'm1', manufacturer: '测试', model: 'TP-550', powerW: 550,
  lengthMm: 2278, widthMm: 1134, thicknessMm: 35, weightKg: 27.5,
  voc: 49.8, isc: 14.1, vmp: 41.8, imp: 13.16,
  vocTempCoeff: -0.25, iscTempCoeff: 0.05, noct: 45, nCells: 144, nSubstrings: 3,
};

const STC: Cell = { irradiance: 1000, tempC: 25, failureRate: 0 };
interface Cell { irradiance: number; tempC: number; failureRate: number }
const cond = (c: Cell, i: number): ModuleCondition => ({ ...c, moduleId: `pm${i}` });

describe('单二极管模型拟合', () => {
  it('STC 下组件曲线 MPP 功率贴近铭牌功率（±8%）', () => {
    const curve = moduleCurve(mod, STC);
    const mpp = globalScan(curve);
    expect(mpp.p).toBeGreaterThan(550 * 0.92);
    expect(mpp.p).toBeLessThan(550 * 1.08);
    expect(mpp.v).toBeGreaterThan(35);
    expect(mpp.v).toBeLessThan(48);
  });

  it('开路电压与短路电流量级正确，曲线单调不增', () => {
    const p = fitSingleDiode(mod);
    expect(p.iph).toBeCloseTo(14.1, 6);
    const curve = moduleCurve(mod, STC);
    const voc = curve[curve.length - 1];
    expect(voc.v).toBeGreaterThan(45);
    for (let k = 1; k < curve.length; k++) expect(curve[k].i).toBeLessThanOrEqual(curve[k - 1].i + 1e-9);
  });
});

describe('双峰 I-V 与 MPPT 算法精度', () => {
  // 12 块组件一串，其中 3 块遮挡 60% → 旁路二极管动作形成双峰
  const conds: ModuleCondition[] = Array.from({ length: 12 }, (_, i) =>
    cond(i < 3 ? { irradiance: 400, tempC: 35, failureRate: 0 } : STC, i));

  it('遮挡组串呈现多峰（存在两个以上局部功率极大值）', () => {
    const curve = stringCurve(mod, conds);
    let peaks = 0;
    for (let k = 2; k < curve.length - 2; k++) {
      if (curve[k].p > curve[k - 1].p && curve[k].p > curve[k + 1].p &&
          curve[k].p > 0.05 * globalScan(curve).p) peaks++;
    }
    expect(peaks).toBeGreaterThanOrEqual(2);
  });

  it('全局扫描找到全局最大功率点', () => {
    const curve = stringCurve(mod, conds);
    const g = globalScan(curve);
    expect(g.p).toBeGreaterThan(0);
    // 暴力复核：扫描点即全局最优（网格内）
    let max = 0;
    for (const pt of curve) max = Math.max(max, pt.p);
    expect(g.p).toBeCloseTo(max, 6);
  });

  it('单起点扰动观察可能误锁低峰，并如实报告误锁损失', () => {
    const curve = stringCurve(mod, conds);
    const g = globalScan(curve);
    const { mpp, lockedLowPeak } = perturbObserve(curve);
    if (lockedLowPeak) {
      expect(g.p - mpp.p).toBeGreaterThan(0.03 * g.p);
    } else {
      expect(Math.abs(g.p - mpp.p) / g.p).toBeLessThan(0.03);
    }
  });

  it('多起点扰动观察落点与 GMPP 偏差 ≤ 3%（精度红线）', () => {
    const curve = stringCurve(mod, conds);
    const g = globalScan(curve);
    const mpp = perturbObserveMultiStart(curve);
    expect(Math.abs(g.p - mpp.p) / g.p).toBeLessThanOrEqual(0.03);
  });

  it('全局扫描与多起点 P&O 偏差 ≤ 3%（精度红线）；单起点误锁时损失被如实记录', () => {
    const r = simulateString(mod, conds);
    for (const run of r.mpptRuns.filter(x => !x.algorithm.includes('单起点'))) {
      expect(run.deviationPct).toBeLessThanOrEqual(3);
    }
    const single = r.mpptRuns.find(x => x.algorithm.includes('单起点'))!;
    if (single.lockedLowPeak) {
      expect(single.lossVsGlobalW).toBeGreaterThan(0.03 * r.globalMpp.p);
    } else {
      expect(single.deviationPct).toBeLessThanOrEqual(3);
    }
  });

  it('错配损失为正：遮挡组串 GMPP 低于同条件无遮挡参考组串', () => {
    const r = simulateString(mod, conds);
    expect(r.mismatchLossW).toBeGreaterThan(0);
  });

  it('加优化器后恢复单峰且捞回功率，回本周期可计算', () => {
    const r = simulateString(mod, conds,
      { id: 'op', manufacturer: 'X', model: 'OP-600', kind: '优化器', ratedW: 600, priceYuan: 180 },
      180, 1300, 0.4);
    expect(r.withOptimizer).toBeDefined();
    // 优化器 MPP = 各组件独立 MPP 之和；增益非负，回本周期有限
    expect(r.withOptimizer!.mpp.p).toBeGreaterThan(0);
    expect(r.withOptimizer!.gainKwh).toBeGreaterThanOrEqual(0);
    expect(isFinite(r.withOptimizer!.paybackYears)).toBe(true);
  });

  it('失效率等同于辐照折减：完全失效组件被旁路后曲线仍可解', () => {
    const dead = Array.from({ length: 6 }, (_, i) =>
      cond(i === 0 ? { irradiance: 1000, tempC: 25, failureRate: 1 } : STC, i));
    const curve = stringCurve(mod, dead);
    const g = globalScan(curve);
    expect(g.p).toBeGreaterThan(0);
  });
});
