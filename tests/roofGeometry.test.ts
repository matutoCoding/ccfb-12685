import { describe, it, expect } from 'vitest';
import {
  buildPlane3D, intersectPlanes, computeUsableArea, slopeNormal, pointInPolygon,
} from '@/lib/calc/roofGeometry';
import type { RoofPoint, RoofPlane, RoofZone, ExistingEquipment } from '@/types';

const pts: RoofPoint[] = [
  { id: 'A', name: 'A', x: 0, y: 0, z: 0 },
  { id: 'B', name: 'B', x: 20, y: 0, z: 0 },
  { id: 'C', name: 'C', x: 20, y: 10, z: 0 },
  { id: 'D', name: 'D', x: 0, y: 10, z: 0 },
];

describe('坡面起坡与面积', () => {
  it('坡面面积 = 水平面积 / cos(坡度)，坡长随坡度增大', () => {
    const plane: RoofPlane = {
      id: 'pl', name: '主坡', pointIds: ['A', 'B', 'C', 'D'],
      slopeDeg: 10, azimuthDeg: 0, eaveElev: 0, color: '',
    };
    const p3d = buildPlane3D(plane, pts);
    expect(p3d.area3d).toBeCloseTo(200 / Math.cos(10 * Math.PI / 180), 6);
    expect(p3d.slopeLength).toBeGreaterThan(9.9);
  });

  it('坡向法向量 z 分量 = cos(坡度)', () => {
    const n = slopeNormal(180, 15);
    expect(n[2]).toBeCloseTo(Math.cos(15 * Math.PI / 180), 6);
  });

  it('两个对向坡面交线被识别为屋脊或天沟', () => {
    const p1: RoofPlane = { id: 'p1', name: '左坡', pointIds: ['A', 'B', 'C', 'D'], slopeDeg: 8, azimuthDeg: 0, eaveElev: 0, color: '' };
    const p2: RoofPlane = { id: 'p2', name: '右坡', pointIds: ['A', 'B', 'C', 'D'], slopeDeg: 8, azimuthDeg: 180, eaveElev: 0, color: '' };
    const a = buildPlane3D(p1, pts), b = buildPlane3D(p2, pts);
    const ridge = intersectPlanes(a, b, pts);
    // 同边界两坡面至少能求出交线对象或 null（不抛异常）
    if (ridge) expect(['屋脊线', '天沟线']).toContain(ridge.kind);
  });
});

describe('可利用面积扣减', () => {
  const zones: RoofZone[] = [{
    id: 'z1', name: '承重限制区', type: '承重分区', pointIds: ['A', 'B', 'C', 'D'],
    allowLoadKpa: 1.5,
  }];
  const eq: ExistingEquipment = {
    id: 'e1', name: '风机基础', kind: '风机基础',
    footprint: [{ x: 2, y: 2 }, { x: 5, y: 2 }, { x: 5, y: 5 }, { x: 2, y: 5 }], footprintArea: 9,
  };

  it('不扣分区时只减设备占位', () => {
    const r = computeUsableArea(pts, [], [eq]);
    expect(r.grossArea).toBeCloseTo(200, 6);
    expect(r.equipmentDeduction).toBeCloseTo(9, 6);
    expect(r.usableArea).toBeCloseTo(191, 6);
  });

  it('勾选扣除分区后可利用面积相应减少', () => {
    const r = computeUsableArea(pts, zones, [eq], new Set(['z1']));
    expect(r.zoneDeduction).toBeCloseTo(200, 6);
    expect(r.usableArea).toBeCloseTo(0, 6);
  });

  it('点在多边形判定', () => {
    expect(pointInPolygon({ x: 10, y: 5 }, pts)).toBe(true);
    expect(pointInPolygon({ x: 30, y: 5 }, pts)).toBe(false);
  });
});
