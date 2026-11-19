// 组件级电气仿真：单二极管模型 + 旁路二极管分段 I-V 曲线 + 多峰 MPPT
import type { IvPoint, MpptRun, PvModuleModel, PlacedModule, SimulationResult, OptimizerModel } from '@/types';

const K = 1.380649e-23; // 玻尔兹曼常数
const Q = 1.602176634e-19; // 元电荷

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export interface CellCondition {
  irradiance: number;   // 有效辐照 W/m²（已按遮挡比例折减）
  tempC: number;
  failureRate: number;  // 失效率 0-1（按比例损失出力）
}

export interface ModuleCondition extends CellCondition {
  moduleId: string;
}

interface SingleDiodeParams {
  iph: number; // 光生电流 A
  isat: number;// 反向饱和电流 A
  rs: number;  // 串联电阻 Ω
  rsh: number; // 并联电阻 Ω
  n: number;   // 理想因子
  cells: number;
  tempK: number; // 参数所在工况温度
}

/** 一个电池分段的热电压 Vth = n·k·T/q · 串联电池片数 */
function thermalVoltage(p: Pick<SingleDiodeParams, 'n' | 'cells' | 'tempK'>): number {
  return p.n * K * p.tempK / Q * p.cells;
}

/** 由组件铭牌参数在参考工况（1000 W/m², 25°C）下拟合单二极管五参数。
 *  采用确定性网格搜索（结果可复现），约束 (Voc,Isc) 自洽且 MPP 点功率贴合铭牌。 */
export function fitSingleDiode(m: PvModuleModel): SingleDiodeParams {
  const tempK = 298.15;
  const cellsPerSub = m.nCells / m.nSubstrings;
  const vocSub = m.voc / m.nSubstrings;
  const vmpSub = m.vmp / m.nSubstrings;
  let best: { n: number; rs: number; rsh: number; isat: number; err: number } | null = null;

  for (let n = 0.8; n <= 1.6001; n += 0.05) {
    const vth = n * K * tempK / Q * cellsPerSub;
    for (let rsh = 100; rsh <= 2000.01; rsh += 50) {
      // 由 Voc 点反解 isat，保证开路电压与铭牌自洽
      const isat = (m.isc - vocSub / rsh) / (Math.exp(vocSub / vth) - 1);
      for (let rs = 0; rs <= 0.6001; rs += 0.01) {
        const i = substringCurrent(
          { iph: m.isc, isat, rs, rsh, n, cells: cellsPerSub, tempK }, vmpSub, m.isc);
        const err = Math.abs(i - m.imp);
        if (!best || err < best.err) best = { n, rs, rsh, isat, err };
      }
    }
  }
  const b = best!;
  return { iph: m.isc, isat: b.isat, rs: b.rs, rsh: b.rsh, n: b.n, cells: cellsPerSub, tempK };
}

/** 给定分段端电压求电流（牛顿迭代解隐式 I = Iph - Isat(e^((V+I·Rs)/Vth)-1) - (V+I·Rs)/Rsh） */
function substringCurrent(p: SingleDiodeParams, v: number, iph: number): number {
  const vt = thermalVoltage(p);
  let i = iph;
  for (let k = 0; k < 60; k++) {
    const vj = v + i * p.rs;
    const expT = Math.exp(Math.min(vj / vt, 60));
    // f(i) = Iph - Isat(e^(vj/vt)-1) - vj/Rsh - i = 0
    const f = iph - p.isat * (expT - 1) - vj / p.rsh - i;
    const dfdi = -p.isat * expT * p.rs / vt - p.rs / p.rsh - 1;
    const step = f / dfdi;
    i -= step;
    if (Math.abs(step) < 1e-7) break;
    if (i < -iph) i = -iph; // 反向限幅（旁路二极管会在更低电压导通）
  }
  return i;
}

/** 辐照/温度/失效率折算到等效光生电流与饱和电流 */
function scaleParams(base: SingleDiodeParams, c: CellCondition, m: PvModuleModel): SingleDiodeParams {
  const tK = c.tempC + 273.15;
  const tRef = 298.15;
  const eg = 1.121; // 硅带隙 eV
  const g = Math.max(0, (c.irradiance / 1000) * (1 - c.failureRate));
  const iph = base.iph * g * (1 + (m.iscTempCoeff / 100) * (c.tempC - 25));
  const isat = base.isat * Math.pow(tK / tRef, 3) *
    Math.exp(Q * eg / (base.n * K) * (1 / tRef - 1 / tK));
  return { ...base, iph, isat, tempK: tK };
}

/** 单个组件的 I-V 曲线（含旁路二极管分段，输出整组件端口电压电流） */
export function moduleCurve(m: PvModuleModel, cond: CellCondition, points = 240): IvPoint[] {
  const base = fitSingleDiode(m);
  const p = scaleParams(base, cond, m);
  const vocSub = openCircuitVoltage(p); // 单分段开路电压
  const vMax = m.nSubstrings * vocSub;  // 整组件端口电压
  const out: IvPoint[] = [];
  for (let k = 0; k <= points; k++) {
    const v = vMax * k / points;
    // 三分段串联且工况一致：单分段端电压 = v/3，求该分段电流（即整组件电流）
    const i = substringCurrent(p, v / m.nSubstrings, p.iph);
    out.push({ v, i: Math.max(0, i), p: v * Math.max(0, i) });
  }
  return out;
}

function openCircuitVoltage(p: SingleDiodeParams): number {
  const vt = thermalVoltage(p);
  // 对数不动点法（数值稳定，避免指数溢出）：
  // Voc = Vth·ln((Iph - Voc/Rsh)/Isat + 1)
  let v = vt * Math.log(p.iph / p.isat + 1);
  for (let k = 0; k < 100; k++) {
    const next = vt * Math.log(Math.max(1e-12, (p.iph - v / p.rsh) / p.isat) + 1);
    if (Math.abs(next - v) < 1e-9) return next;
    v = next;
  }
  return v;
}

const BYPASS_V = 0.5; // 旁路二极管导通压降 V

/** 串联多分段组件电流：二分电流使各分段电压（含旁路限幅）之和等于给定总电压 */
function seriesStringCurrent(p: SingleDiodeParams, vTotal: number, nSub: number): number {
  let lo = 0, hi = p.iph * 1.05;
  const voltageAt = (i: number) => {
    let sum = 0;
    for (let s = 0; s < nSub; s++) {
      const vSeg = segmentVoltage(p, i);
      sum += vSeg < -BYPASS_V ? -BYPASS_V : vSeg;
    }
    return sum;
  };
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    // 电流越大电压越低：V(mid) 偏大说明电流要上调
    if (voltageAt(mid) > vTotal) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 分段在给定电流下的电压（反解单二极管方程，数值稳定版）。
 *  正向区用对数初值 + 限幅牛顿；反向偏置（i>iph）用 Rsh 线性近似并由旁路二极管钳位。 */
function segmentVoltage(p: SingleDiodeParams, i: number): number {
  const vt = thermalVoltage(p);
  // 反向偏置：二极管截止，Iph - i 为负 → 电压为负，近似 v ≈ (Iph-i)·Rsh - i·Rs
  if (i >= p.iph) {
    const vLin = (p.iph - i) * p.rsh - i * p.rs;
    return Math.max(vLin, -BYPASS_V); // 旁路二极管钳位
  }
  // 正向区：先取忽略二极管的线性初值，再牛顿求解
  // I = Iph - Isat(e^(vj/vt)-1) - vj/Rsh  →  vj = vt·ln((Iph - i - vj/Rsh)/Isat + 1)
  let vj = vt * Math.log(Math.max(1e-12, (p.iph - i) / p.isat) + 1);
  for (let k = 0; k < 50; k++) {
    const e = Math.exp(Math.min(vj / vt, 60));
    const f = p.iph - p.isat * (e - 1) - vj / p.rsh - i;
    const df = -p.isat * e / vt - 1 / p.rsh;
    const step = f / df;
    vj -= step;
    if (Math.abs(step) < 1e-9) break;
  }
  const v = vj - i * p.rs;
  return v < -BYPASS_V ? -BYPASS_V : v;
}

/** 组串 I-V：不同工况组件串联，逐电压点电流取串联解（含各组件旁路分段） */
export function stringCurve(m: PvModuleModel, conds: ModuleCondition[], points = 300): IvPoint[] {
  const base = fitSingleDiode(m);
  const params = conds.map(c => scaleParams(base, c, m));
  const vocTotal = params.reduce((s, p) => s + openCircuitVoltage(p) * m.nSubstrings, 0);
  const iphMax = Math.max(...params.map(p => p.iph));
  const out: IvPoint[] = [];
  for (let k = 0; k <= points; k++) {
    const vTarget = vocTotal * k / points;
    // 二分电流：所有组件所有分段电压之和
    let lo = 0, hi = iphMax * 1.05;
    const totalV = (i: number) => {
      let sum = 0;
      for (const p of params) {
        for (let s = 0; s < m.nSubstrings; s++) {
          const vs = segmentVoltage(p, i);
          sum += vs < -BYPASS_V ? -BYPASS_V : vs;
        }
      }
      return sum;
    };
    for (let k2 = 0; k2 < 50; k2++) {
      const mid = (lo + hi) / 2;
      if (totalV(mid) > vTarget) lo = mid; else hi = mid;
    }
    const i = (lo + hi) / 2;
    out.push({ v: vTarget, i, p: vTarget * i });
  }
  return out;
}

export function globalScan(curve: IvPoint[]): IvPoint {
  let best = curve[0];
  for (const pt of curve) if (pt.p > best.p) best = pt;
  return best;
}

/** 扰动观察法（单起点，从开路侧下山）—— 双峰下可能误锁低峰 */
export function perturbObserve(curve: IvPoint[], startFrac = 0.85, stepFrac = 0.01): { mpp: IvPoint; lockedLowPeak: boolean } {
  let idx = Math.floor(curve.length * startFrac);
  const step = Math.max(1, Math.floor(curve.length * stepFrac));
  let guard = 0;
  while (guard++ < curve.length * 2) {
    const next = idx - step;
    if (next < 1) break;
    if (curve[next].p <= curve[idx].p) {
      const fwd = Math.min(curve.length - 1, idx + step);
      if (curve[fwd].p > curve[idx].p) { idx = fwd; continue; }
      break; // 两侧都不增 → 局部峰
    }
    idx = next;
  }
  const g = globalScan(curve);
  return { mpp: curve[idx], lockedLowPeak: g.p - curve[idx].p > 0.03 * g.p };
}

/** 多起点扰动观察：沿曲线均匀布起点，各跑一遍 P&O 取最优 —— 保证收敛到全局峰 */
export function perturbObserveMultiStart(curve: IvPoint[], starts = 8): IvPoint {
  let best = curve[0];
  for (let s = 0; s < starts; s++) {
    const frac = 0.1 + 0.8 * s / (starts - 1);
    const { mpp } = perturbObserve(curve, frac, 0.008);
    if (mpp.p > best.p) best = mpp;
  }
  return best;
}

/** 完整仿真：组串曲线 + 三种 MPPT 跑法 + 错配损失 + 优化器/关断器增益 */
export function simulateString(m: PvModuleModel, conds: ModuleCondition[], optimizer?: OptimizerModel,
  optimizerPricePerModule = 0, annualKwhPerModule = 0, electricityPrice = 0.4): SimulationResult {
  const curve = stringCurve(m, conds);
  const gmp = globalScan(curve);

  // 参考组串：同朝向无遮挡（统一取首组件工况）
  const refConds = conds.map(c => ({ ...c, irradiance: 1000, failureRate: 0 }));
  const refCurve = stringCurve(m, refConds);
  const refMpp = globalScan(refCurve);
  const mismatchLossW = refMpp.p - gmp.p;

  const po = perturbObserve(curve);
  const poMulti = perturbObserveMultiStart(curve);
  const mpptRuns: MpptRun[] = [
    mkRun('全局扫描', gmp, gmp),
    mkRun('扰动观察(单起点)', po.mpp, gmp, po.lockedLowPeak),
    mkRun('扰动观察(多起点)', poMulti, gmp),
  ];

  let withOptimizer: SimulationResult['withOptimizer'];
  if (optimizer) {
    // 加装优化器后每组件独立 MPPT：组串可输出功率 = 各组件自身 MPP 功率之和
    // （无优化器时弱光组件被串内电流拖累、分段旁路；优化器逐块恢复其可用功率）
    const perModule = conds.map(c => globalScan(moduleCurve(m, c)));
    const pSum = perModule.reduce((s, pt) => s + pt.p, 0);
    const vSum = perModule.reduce((s, pt) => s + pt.v, 0);
    const optMpp = { v: vSum, i: pSum / vSum, p: pSum };
    const gainW = Math.max(0, optMpp.p - gmp.p);
    // 年增益按 MPP 功率增益占比折算到该串年发电量
    const annualStringKwh = annualKwhPerModule * conds.length;
    const gainKwh = gmp.p > 0 ? gainW / gmp.p * annualStringKwh : 0;
    const cost = optimizerPricePerModule * conds.length;
    const annualSaving = gainKwh * electricityPrice;
    const paybackYears = annualSaving > 0 ? cost / annualSaving : Infinity;
    withOptimizer = {
      curve: buildSinglePeakCurve(optMpp),
      mpp: optMpp,
      gainKwh,
      paybackYears,
      worthIt: isFinite(paybackYears) && paybackYears <= 8,
    };
  }

  return {
    ivCurve: curve, globalMpp: gmp, mpptRuns,
    mismatchLossW, mismatchLossRefW: refMpp.p,
    withOptimizer,
  };
}

function mkRun(algorithm: MpptRun['algorithm'], mpp: IvPoint, gmp: IvPoint, lockedLowPeak = false): MpptRun {
  const deviationPct = gmp.p > 0 ? Math.abs(gmp.p - mpp.p) / gmp.p * 100 : 0;
  return {
    algorithm, vmpp: mpp.v, impp: mpp.i, pmpp: mpp.p,
    lockedLowPeak, lossVsGlobalW: gmp.p - mpp.p, deviationPct,
  };
}

function buildSinglePeakCurve(mpp: IvPoint): IvPoint[] {
  const pts: IvPoint[] = [];
  const voc = mpp.v * 1.2;
  for (let k = 0; k <= 120; k++) {
    const v = voc * k / 120;
    const t = v / voc;
    const i = mpp.i * Math.max(0, 1 - Math.pow(t, 6));
    pts.push({ v, i, p: v * i });
  }
  return pts;
}
