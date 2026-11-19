// 导线法坐标推算 + 闭合差计算 + 坐标增量平差（罗盘法/导线平差规则）
import type { RoofPoint, TraverseLeg, TraverseResult, ID } from '@/types';

const DEG = Math.PI / 180;

export interface TraverseInput {
  legs: TraverseLeg[];
  firstBearingDeg: number; // 起始边方位角（北=0，顺时针，度）
  toleranceK: number;      // 容许闭合差系数：限差 = K * sqrt(周长)
  fixedPointIds?: ID[];    // 人工锁定角点（不分配改正数）
  overrides?: Record<ID, { x: number; y: number }>; // 角点坐标手工微调
}

/** 方位角归一化到 [0,360) */
export function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** 由各边边长与转折角（左角）推算未平差坐标 */
export function computeRawTraverse(legs: TraverseLeg[], firstBearingDeg: number): {
  points: RoofPoint[]; bearings: number[];
} {
  if (legs.length < 3) throw new Error('导线至少需要 3 条边');
  const bearings: number[] = [];
  let bearing = firstBearingDeg;
  for (let i = 0; i < legs.length; i++) {
    bearings.push(normalizeBearing(bearing));
    // α_前 = α_后 + 180° + β_左（导线左角推算公式）
    bearing = normalizeBearing(bearing + 180 + legs[i].turnAngleDeg);
  }
  // 闭合导线：从原点起算，逐点累加坐标增量
  const points: RoofPoint[] = [{ id: id(0, legs), name: legs[0].from, x: 0, y: 0, z: 0 }];
  let x = 0, y = 0;
  for (let i = 0; i < legs.length; i++) {
    const a = bearings[i] * DEG;
    x += legs[i].length * Math.sin(a); // 方位角以北为 0：Δx(东)=L·sinα，Δy(北)=L·cosα
    y += legs[i].length * Math.cos(a);
    const isClose = i === legs.length - 1;
    if (!isClose) points.push({ id: id(i + 1, legs), name: legs[i].to, x, y, z: 0 });
  }
  return { points, bearings };
}

function id(i: number, legs: TraverseLeg[]): ID {
  return `P${i}_${legs[Math.min(i, legs.length - 1)].from}`;
}

/** 鞋带公式多边形面积（水平投影） */
export function polygonArea2D(pts: { x: number; y: number }[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/**
 * 完整平差流程。
 * 平差规则（罗盘法 / Bowditch）：第 i 点改正数
 *   vx_i = -fx · (累计边长_i / 总长)，vy_i 同理，按边长比例分配闭合差。
 * 锁定点不参与分配，其份额按剩余边长重新摊派。
 */
export function adjustTraverse(input: TraverseInput): TraverseResult {
  const { legs, firstBearingDeg, toleranceK } = input;
  const { points: rawPoints, bearings } = computeRawTraverse(legs, firstBearingDeg);

  // 闭合差 = 末点（理论上回到起点）坐标
  let endX = 0, endY = 0;
  for (let i = 0; i < legs.length; i++) {
    const a = bearings[i] * DEG;
    endX += legs[i].length * Math.sin(a);
    endY += legs[i].length * Math.cos(a);
  }
  const closureFx = endX;
  const closureFy = endY;
  const closureF = Math.hypot(closureFx, closureFy);
  const perimeter = legs.reduce((s, l) => s + l.length, 0);
  const tolerance = toleranceK * Math.sqrt(perimeter);
  const closureRatio = closureF > 1e-12 ? perimeter / closureF : Infinity;

  // 最可疑边：边长误差对闭合差的贡献 = 该边方向单位向量在闭合差方向上的投影。
  // 投影接近 +1 表示该边方向与闭合差方向高度一致，即误差最可能来自这条边。
  let suspiciousLegId: ID | undefined;
  let worst = -Infinity;
  for (let i = 0; i < legs.length; i++) {
    const a = bearings[i] * DEG;
    const ux = Math.sin(a), uy = Math.cos(a);
    const alignment = closureF < 1e-12
      ? 0
      : (closureFx * ux + closureFy * uy) / closureF; // 方向余弦，范围 [-1,1]
    if (alignment > worst) { worst = alignment; suspiciousLegId = legs[i].id; }
  }

  // 坐标增量平差（罗盘法/Bowditch）：每条边的改正数按边长比例分配到该边终点；
  // 锁定点不分配，其份额按自由边边长重新摊派，保证自由点改正数之和恰为 -f。
  const fixed = new Set(input.fixedPointIds ?? []);
  const weightAt = (vertexIdx: number) =>
    vertexIdx === 0 || fixed.has(rawPoints[vertexIdx].id) ? 0 : legs[vertexIdx - 1].length;
  const totalFreeWeight = rawPoints.reduce((s, _, i) => s + weightAt(i), 0);

  const corrections: TraverseResult['corrections'] = {};
  const points: RoofPoint[] = rawPoints.map((p, i) => {
    const w = weightAt(i);
    if (w === 0 || totalFreeWeight === 0) {
      corrections[p.id] = { dx: 0, dy: 0 };
      return { ...p };
    }
    const vx = -closureFx * w / totalFreeWeight;
    const vy = -closureFy * w / totalFreeWeight;
    corrections[p.id] = { dx: vx, dy: vy };
    return { ...p, x: p.x + vx, y: p.y + vy };
  });

  // 手工微调覆盖
  if (input.overrides) {
    for (const pt of points) {
      const ov = input.overrides[pt.id];
      if (ov) { pt.x = ov.x; pt.y = ov.y; pt.fixed = true; }
    }
  }

  const area2d = polygonArea2D(points);
  const rawArea2d = polygonArea2D(rawPoints);

  return {
    points, rawPoints,
    closureFx, closureFy, closureF,
    closureRatio, perimeter, tolerance,
    passed: closureF <= tolerance,
    suspiciousLegId,
    area2d, rawArea2d, corrections,
  };
}

/** 面积误差核对：与勘测表标注面积对比，返回相对误差（%） */
export function areaErrorPct(calcArea: number, surveyArea: number): number {
  if (surveyArea <= 0) return Infinity;
  return Math.abs(calcArea - surveyArea) / surveyArea * 100;
}
