import { describe, it, expect } from 'vitest';
import { computeBallast } from '@/lib/calc/windBallast';
import type { BallastConfig, RoofPoint } from '@/types';

const roof: RoofPoint[] = [
  { id: 'A', name: 'A', x: 0, y: 0, z: 0 },
  { id: 'B', name: 'B', x: 20, y: 0, z: 0 },
  { id: 'C', name: 'C', x: 20, y: 10, z: 0 },
  { id: 'D', name: 'D', x: 0, y: 10, z: 0 },
];

const cfg: BallastConfig = {
  basicWindPressure: 0.45,
  roofHeight: 24,
  gustFactor: 1.9,
  shapeFactor: 1.3,
  heightFactor: 1.42,
  blockWeight: 25,
  parapetZoneWidth: 2,
  parapetDensify: 0.75,
};

const rows = Array.from({ length: 5 }, (_, i) => ({
  index: i, x: 10, y: 1 + i * 2, modules: 18, moduleWidthM: 1.13, rowLengthM: 20,
}));

describe('抗风掀配重手算复核', () => {
  it('风荷载标准值与手算一致：wk=βgz·μs·μz·w0', () => {
    const r = computeBallast(cfg, rows, 2.4, roof, []);
    const expectWk = 1.9 * 1.3 * 1.42 * 0.45;
    expect(r.windSuctionKpa).toBeCloseTo(expectWk, 6);
  });

  it('中排（非衰减区）压重与手算一致：G=1.4·wk·A/g（A=排距×排长）', () => {
    const r = computeBallast(cfg, rows, 2.4, roof, []);
    const wk = 1.9 * 1.3 * 1.42 * 0.45;
    const area = 2.4 * 20;
    const expectKg = 1.4 * wk * area * 1000 / 9.81;
    const mid = r.rows[2]; // y=5，远离所有檐口
    expect(mid.requiredBallastKg).toBeCloseTo(expectKg, 6);
    expect(mid.blocks.length).toBe(Math.max(2, Math.ceil(expectKg / 25)));
  });

  it('配重块自动落位：每排两端必有块，数量满足压重需求', () => {
    const r = computeBallast(cfg, rows, 2.4, roof, []);
    for (const row of r.rows) {
      expect(row.blocks.length).toBeGreaterThanOrEqual(2);
      const xs = row.blocks.map(b => b.position.x).sort((a, b) => a - b);
      expect(xs[0]).toBeCloseTo(0, 6);           // 左端
      expect(xs[xs.length - 1]).toBeCloseTo(20, 6); // 右端
      expect(row.blocks.reduce((s, b) => s + b.weightKg, 0)).toBeGreaterThanOrEqual(row.requiredBallastKg - 25);
    }
  });

  it('总配重为各排块数×单块重量之和，可直接汇总进物料清单', () => {
    const r = computeBallast(cfg, rows, 2.4, roof, []);
    const manual = r.rows.reduce((s, row) => s + row.blocks.length * 25, 0);
    expect(r.totalBallastKg).toBeCloseTo(manual, 6);
  });

  it('女儿墙衰减区（首排贴近檐口）的排被标记并加密', () => {
    const r = computeBallast(cfg, rows, 2.4, roof, []);
    // y=1 距 y=0 边 1m < 衰减区宽 2m
    expect(r.rows[0].blocks[0].inParapetZone).toBe(true);
    expect(r.rows[2].blocks[0].inParapetZone).toBe(false);
  });
});
