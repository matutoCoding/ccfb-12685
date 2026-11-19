// 屋面三维几何：起坡、坡面面积/坡长、屋脊/天沟交线、可利用面积扣减
import type { RoofPlane, RoofZone, ExistingEquipment, RoofPoint } from '@/types';
import { polygonArea2D } from './traverse';

const DEG = Math.PI / 180;

export interface Plane3D {
  plane: RoofPlane;
  normal: [number, number, number]; // 单位法向量（坡面朝上）
  d: number;                        // 平面方程 n·p + d = 0
  centroid2d: { x: number; y: number };
  vertices3d: { x: number; y: number; z: number }[];
  area3d: number;
  slopeLength: number;
}

/** 由坡向（方位角）与坡度求坡面单位法向量 */
export function slopeNormal(azimuthDeg: number, slopeDeg: number): [number, number, number] {
  const az = azimuthDeg * DEG, sl = slopeDeg * DEG;
  // 最陡下坡方向水平分量 = (sin az, cos az)；法向在其反方向上抬升
  return [
    -Math.sin(sl) * Math.sin(az),
    -Math.sin(sl) * Math.cos(az),
    Math.cos(sl),
  ];
}

/** 构造单个坡面：以檐口标高处的平面方程拟合边界点，再反算各点三维坐标 */
export function buildPlane3D(plane: RoofPlane, pts2d: RoofPoint[]): Plane3D {
  const boundary = plane.pointIds.map(id => pts2d.find(p => p.id === id)!).filter(Boolean);
  if (boundary.length < 3) throw new Error(`坡面 ${plane.name} 至少需要 3 个角点`);
  const n = slopeNormal(plane.azimuthDeg, plane.slopeDeg);
  const cx = boundary.reduce((s, p) => s + p.x, 0) / boundary.length;
  const cy = boundary.reduce((s, p) => s + p.y, 0) / boundary.length;
  // 檐口点（平面上 z=eaveElev 的参考点取质心），定平面方程常数
  const d = -(n[0] * cx + n[1] * cy + n[2] * plane.eaveElev);
  const zAt = (x: number, y: number) => -(n[0] * x + n[1] * y + d) / n[2];
  const vertices3d = boundary.map(p => ({ x: p.x, y: p.y, z: zAt(p.x, p.y) }));

  const area2d = polygonArea2D(boundary);
  const area3d = area2d / Math.cos(plane.slopeDeg * DEG);
  // 坡长：质心沿坡向到边界的平均爬升长度，用包围盒在坡向方向投影长度近似（供与勘测表核对）
  let minT = Infinity, maxT = -Infinity;
  const dx = Math.sin(plane.azimuthDeg * DEG), dy = Math.cos(plane.azimuthDeg * DEG);
  for (const p of boundary) {
    const t = (p.x - cx) * dx + (p.y - cy) * dy;
    minT = Math.min(minT, t); maxT = Math.max(maxT, t);
  }
  const horizontalRun = maxT - minT;
  const slopeLength = horizontalRun / Math.cos(plane.slopeDeg * DEG);

  return { plane, normal: n, d, centroid2d: { x: cx, y: cy }, vertices3d, area3d, slopeLength };
}

export interface RidgeLine {
  planeA: string;
  planeB: string;
  start: { x: number; y: number; z: number };
  end: { x: number; y: number; z: number };
  kind: '屋脊线' | '天沟线';
}

/** 两平面交线，裁剪到两坡面 2D 多边形重叠范围内，返回屋脊/天沟线段 */
export function intersectPlanes(a: Plane3D, b: Plane3D, pts2d: RoofPoint[]): RidgeLine | null {
  const dir = cross(a.normal, b.normal);
  if (norm3(dir) < 1e-9) return null; // 平行
  // 交线上一点：解 nA·p=-dA, nB·p=-dB, 取 z=0 平面求 x,y
  const det = a.normal[0] * b.normal[1] - a.normal[1] * b.normal[0];
  if (Math.abs(det) < 1e-9) return null;
  const x = ((-a.d) * b.normal[1] - a.normal[1] * (-b.d)) / det;
  const y = (a.normal[0] * (-b.d) - (-a.d) * b.normal[0]) / det;
  const p0 = { x, y, z: -(a.normal[0] * x + a.normal[1] * y + a.d) / a.normal[2] };

  // 沿交线水平投影方向，在两多边形内求参数区间
  const horiz = { x: dir[0], y: dir[1] };
  const hl = Math.hypot(horiz.x, horiz.y) || 1;
  const ux = horiz.x / hl, uy = horiz.y / hl;
  const polyA = a.plane.pointIds.map(id => pts2d.find(p => p.id === id)!).filter(Boolean);
  const polyB = b.plane.pointIds.map(id => pts2d.find(p => p.id === id)!).filter(Boolean);
  const range = intersectionRange(p0, { x: ux, y: uy }, polyA, polyB);
  if (!range) return null;
  const zAt = (xx: number, yy: number) => -(a.normal[0] * xx + a.normal[1] * yy + a.d) / a.normal[2];
  const start = { x: p0.x + ux * range[0], y: p0.y + uy * range[0], z: 0 };
  const end = { x: p0.x + ux * range[1], y: p0.y + uy * range[1], z: 0 };
  start.z = zAt(start.x, start.y);
  end.z = zAt(end.x, end.y);
  // 屋脊：两坡面法向 z 分量夹角朝外（交线高于两侧檐口）；天沟反之。用中点相对檐口高度判断
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const midZ = zAt(mid.x, mid.y);
  const kind: RidgeLine['kind'] = midZ > Math.max(a.plane.eaveElev, b.plane.eaveElev) ? '屋脊线' : '天沟线';
  return { planeA: a.plane.id, planeB: b.plane.id, start, end, kind };
}

function intersectionRange(p0: { x: number; y: number }, u: { x: number; y: number },
  polyA: RoofPoint[], polyB: RoofPoint[]): [number, number] | null {
  const r1 = rayPolygonInterval(p0, u, polyA);
  const r2 = rayPolygonInterval(p0, u, polyB);
  if (!r1 || !r2) return null;
  const lo = Math.max(r1[0], r2[0]), hi = Math.min(r1[1], r2[1]);
  return hi - lo > 1e-6 ? [lo, hi] : null;
}

/** 射线 p0+t·u 与凸/凹多边形的进出参数区间（取所有边交点的最内区间） */
function rayPolygonInterval(p0: { x: number; y: number }, u: { x: number; y: number },
  poly: { x: number; y: number }[]): [number, number] | null {
  const ts: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const denom = u.x * ey - u.y * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const t = ((a.x - p0.x) * ey - (a.y - p0.y) * ex) / denom;
    const s = ((a.x - p0.x) * u.y - (a.y - p0.y) * u.x) / denom;
    if (s >= -1e-9 && s <= 1 + 1e-9) ts.push(t);
  }
  if (ts.length < 2) return null;
  ts.sort((a, b) => a - b);
  return [ts[0], ts[ts.length - 1]];
}

/** 点在多边形内 */
export function pointInPolygon(p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > p.y) !== (yj > p.y) && p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface UsableAreaResult {
  grossArea: number;
  zoneDeduction: number;
  equipmentDeduction: number;
  usableArea: number;
  details: { name: string; area: number }[];
}

/**
 * 可利用面积 = 屋面水平投影总面积
 *   - 承重分区中不允许上组件的限制区（这里按承重分区多边形整体先统计，由设计勾选是否扣除）
 *   - 既有设备占位投影面积（合并重叠，避免重复扣减）
 */
export function computeUsableArea(roofPts: RoofPoint[], zones: RoofZone[], equip: ExistingEquipment[],
  excludeZoneIds: Set<string> = new Set()): UsableAreaResult {
  const grossArea = polygonArea2D(roofPts);
  const details: { name: string; area: number }[] = [];
  let zoneDeduction = 0;
  for (const z of zones) {
    if (!excludeZoneIds.has(z.id)) continue;
    const poly = z.pointIds.map(id => roofPts.find(p => p.id === id)).filter(Boolean) as RoofPoint[];
    if (poly.length >= 3) {
      const a = polygonArea2D(poly);
      zoneDeduction += a;
      details.push({ name: `分区扣除:${z.name}`, area: a });
    }
  }
  // 设备占位：限制在屋面多边形内，粗略合并（设备间重叠通常很小，按面积上限封顶）
  let equipmentDeduction = 0;
  for (const e of equip) {
    const inside = e.footprint.every(fp => pointInPolygon(fp, roofPts));
    const a = inside ? e.footprintArea : Math.min(e.footprintArea, grossArea);
    equipmentDeduction += a;
    details.push({ name: `设备占位:${e.name}`, area: a });
  }
  equipmentDeduction = Math.min(equipmentDeduction, grossArea);
  const usableArea = Math.max(0, grossArea - zoneDeduction - equipmentDeduction);
  return { grossArea, zoneDeduction, equipmentDeduction, usableArea, details };
}

function cross(a: number[], b: number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm3(v: number[]) { return Math.hypot(v[0], v[1], v[2]); }
