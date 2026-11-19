import { describe, it, expect } from 'vitest';
import { adjustTraverse, computeRawTraverse, polygonArea2D, areaErrorPct, normalizeBearing } from '@/lib/calc/traverse';
import type { TraverseLeg } from '@/types';

let seq = 0;
const lid = () => `L${seq++}`;

/** 矩形导线：北→东→南→西，右角 90°（左角记 -90） */
function rectangleLegs(l1: number, l2: number, l3: number, l4: number): TraverseLeg[] {
  return [
    { id: lid(), from: 'A', to: 'B', length: l1, turnAngleDeg: -90 },
    { id: lid(), from: 'B', to: 'C', length: l2, turnAngleDeg: -90 },
    { id: lid(), from: 'C', to: 'D', length: l3, turnAngleDeg: -90 },
    { id: lid(), from: 'D', to: 'A', length: l4, turnAngleDeg: -90 },
  ];
}

describe('导线法坐标推算', () => {
  it('完美矩形闭合差为 0，面积精确等于长×宽', () => {
    const legs = rectangleLegs(10, 6, 10, 6);
    const r = adjustTraverse({ legs, firstBearingDeg: 0, toleranceK: 0.05 });
    expect(r.closureF).toBeCloseTo(0, 10);
    expect(r.area2d).toBeCloseTo(60, 10);
    expect(r.passed).toBe(true);
    expect(areaErrorPct(r.area2d, 60)).toBeLessThan(1);
  });

  it('推算角点坐标符合方位角定义（北=0，东=90）', () => {
    const legs = rectangleLegs(10, 6, 10, 6);
    const { points } = computeRawTraverse(legs, 0);
    expect(points[0]).toMatchObject({ x: 0, y: 0 });
    expect(points[1].x).toBeCloseTo(0, 10);
    expect(points[1].y).toBeCloseTo(10, 10);
    expect(points[2].x).toBeCloseTo(6, 10);
    expect(points[2].y).toBeCloseTo(10, 10);
    expect(points[3].x).toBeCloseTo(6, 10);
    expect(points[3].y).toBeCloseTo(0, 10);
  });

  it('方位角归一化', () => {
    expect(normalizeBearing(-90)).toBe(270);
    expect(normalizeBearing(370)).toBe(10);
  });
});

describe('导线平差（罗盘法）手算复核', () => {
  it('改正数按边长比例分配，且自由点改正数之和恰等于负闭合差', () => {
    const legs = rectangleLegs(10.02, 6.01, 9.98, 5.99);
    const r = adjustTraverse({ legs, firstBearingDeg: 0, toleranceK: 0.05 });
    // 手算闭合差：fx = 6.01 - 5.99 = 0.02；fy = 10.02 - 9.98 = 0.04
    expect(r.closureFx).toBeCloseTo(0.02, 10);
    expect(r.closureFy).toBeCloseTo(0.04, 10);

    const free = r.points.slice(1); // 起点不参与
    const sumVx = free.reduce((s, p) => s + r.corrections[p.id].dx, 0);
    const sumVy = free.reduce((s, p) => s + r.corrections[p.id].dy, 0);
    expect(sumVx).toBeCloseTo(-0.02, 10);
    expect(sumVy).toBeCloseTo(-0.04, 10);

    // 逐点手算复核（B 点，权重 = AB 边长 10.02，自由权重和 26.01）
    const wSum = 10.02 + 6.01 + 9.98;
    const b = r.points[1];
    expect(r.corrections[b.id].dx).toBeCloseTo(-0.02 * 10.02 / wSum, 10);
    expect(r.corrections[b.id].dy).toBeCloseTo(-0.04 * 10.02 / wSum, 10);

    // 平差后面积与勘测标注 60 m² 误差 < 1%
    expect(areaErrorPct(r.area2d, 60)).toBeLessThan(1);
  });

  it('锁定点不分配改正数，其份额由其余自由点摊派，总和仍闭合', () => {
    const legs = rectangleLegs(10.02, 6.01, 9.98, 5.99);
    const locked = adjustTraverse({
      legs, firstBearingDeg: 0, toleranceK: 0.05,
      fixedPointIds: ['P1_B'],
    });
    const b = locked.points[1];
    expect(locked.corrections[b.id]).toEqual({ dx: 0, dy: 0 });
    const sumVx = locked.points.reduce((s, p) => s + locked.corrections[p.id].dx, 0);
    const sumVy = locked.points.reduce((s, p) => s + locked.corrections[p.id].dy, 0);
    expect(sumVx).toBeCloseTo(-0.02, 10);
    expect(sumVy).toBeCloseTo(-0.04, 10);
  });

  it('闭合差超限标红（passed=false），并指出闭合差方向上最可疑的边', () => {
    // 东边故意量错 1m：BC=7.01
    const legs = rectangleLegs(10, 7.01, 10, 6);
    const r = adjustTraverse({ legs, firstBearingDeg: 0, toleranceK: 0.02 });
    expect(r.passed).toBe(false);
    expect(r.closureF).toBeCloseTo(1.01, 10);
    // 可疑边必须是东西向的 BC 或 DA，而非南北向边
    expect([legs[1].id, legs[3].id]).toContain(r.suspiciousLegId);
  });

  it('多边形面积（鞋带公式）', () => {
    expect(polygonArea2D([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }])).toBeCloseTo(12, 10);
  });
});
