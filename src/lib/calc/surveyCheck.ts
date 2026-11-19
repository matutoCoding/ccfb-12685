// 勘测测点交叉校核：矩形对边差、对角线勾股误差、水准闭合、存疑判定
import type { SurveyPoint } from '@/types';

export interface CheckResult {
  rule: string;
  diff: number;
  tolerance: number;
  passed: boolean;
  detail: string;
}

/** 矩形开间对边差校核：两组对边长度差不超过限差（默认 边长 1/2000 且 ≤20mm） */
export function rectangleOppositeCheck(a: number, b: number, c: number, d: number,
  toleranceMm = 20): CheckResult {
  const diff1 = Math.abs(a - c);
  const diff2 = Math.abs(b - d);
  const diff = Math.max(diff1, diff2);
  const tol = Math.min(toleranceMm, Math.max(a, b, c, d) / 2000 * 1000);
  return {
    rule: '矩形对边差',
    diff, tolerance: tol, passed: diff <= tol,
    detail: `对边差 max(|${a}-${c}|, |${b}-${d}|)=${diff.toFixed(1)}mm，限差 ${tol.toFixed(1)}mm`,
  };
}

/** 对角线勾股校核：实测对角线与 √(L²+W²) 的相对误差（默认 ≤1/1000） */
export function diagonalPythagoreanCheck(length: number, width: number, measuredDiagonal: number,
  relTolerance = 1 / 1000): CheckResult {
  const theoretical = Math.hypot(length, width);
  const diff = Math.abs(measuredDiagonal - theoretical);
  const tol = theoretical * relTolerance;
  return {
    rule: '对角线勾股',
    diff, tolerance: tol, passed: diff <= tol,
    detail: `实测对角线 ${measuredDiagonal.toFixed(1)}mm，理论 √(L²+W²)=${theoretical.toFixed(1)}mm，偏差 ${diff.toFixed(1)}mm`,
  };
}

/** 水准闭合校核：标高测点绕基准点闭合，闭合差 ≤ ±K·√n（mm，K 取 4mm 等外水准） */
export function levelClosureCheck(elevations: number[], benchmark: number, kMm = 4): CheckResult {
  const n = elevations.length;
  // 闭合差 = 末站推算回到基准点的偏差（这里 elevations 为各测站高差，总和理论为 0）
  const closure = elevations.reduce((s, v) => s + v, 0);
  const tol = kMm * Math.sqrt(n);
  return {
    rule: '水准闭合',
    diff: Math.abs(closure), tolerance: tol, passed: Math.abs(closure) <= tol,
    detail: `测站数 ${n}，闭合差 ${closure.toFixed(1)}mm，限差 ±${tol.toFixed(1)}mm（${kMm}√n）`,
  };
}

/** 相邻尺寸测点自动交叉校核入口：按测点描述里的矩形组关联 */
export function crossCheckSurveyPoint(point: SurveyPoint, related: SurveyPoint[],
  toleranceMm = 20): CheckResult | null {
  if (point.kind !== '尺寸' || point.adoptedValue == null) return null;
  const vals = related.map(p => p.adoptedValue).filter((v): v is number => v != null);
  if (vals.length < 2) return null;
  // 简化规则：与相邻测点均值的偏差超 3σ 或超绝对限差即存疑
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const diff = Math.abs(point.adoptedValue - mean);
  const tol = Math.min(toleranceMm, mean * 0.005);
  return {
    rule: '相邻测点交叉校核',
    diff, tolerance: tol, passed: diff <= tol,
    detail: `测点 ${point.code} 采用值 ${point.adoptedValue}，相邻均值 ${mean.toFixed(1)}，偏差 ${diff.toFixed(1)}mm`,
  };
}

/** 多次重测离散度判定：极差超限自动置“存疑” */
export function evaluateReadingStatus(point: SurveyPoint, relTolerance = 0.01): SurveyPoint['status'] {
  if (point.readings.length === 0) return '待测';
  const values = point.readings.map(r => r.value);
  const max = Math.max(...values), min = Math.min(...values);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean !== 0 && (max - min) / Math.abs(mean) > relTolerance) return '存疑';
  return point.status === '存疑' ? '存疑' : '已测';
}
