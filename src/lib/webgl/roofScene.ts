// 屋面/支架/组件/配重 → WebGL 渲染节点
import type { RoofModel, MountingDesign, Scheme } from '@/types';
import { buildPlane3D, intersectPlanes, type Plane3D } from '@/lib/calc/roofGeometry';
import { polygonMesh, lineMesh, boxMesh, identityModel, type RenderNode, type Mesh } from './renderer';

const COLORS = {
  plane: [0.36, 0.55, 0.78, 0.85] as Mesh['color'],
  planeAlt: [0.42, 0.62, 0.5, 0.85] as Mesh['color'],
  edge: [0.85, 0.88, 0.95, 1] as Mesh['color'],
  ridge: [0.95, 0.45, 0.3, 1] as Mesh['color'],
  gutter: [0.3, 0.7, 0.95, 1] as Mesh['color'],
  zoneLoad: [0.95, 0.75, 0.2, 0.25] as Mesh['color'],
  zoneWater: [0.2, 0.85, 0.75, 0.25] as Mesh['color'],
  equipment: [0.55, 0.5, 0.58, 0.95] as Mesh['color'],
  block: [0.75, 0.6, 0.4, 1] as Mesh['color'],
  module: [0.12, 0.2, 0.45, 1] as Mesh['color'],
  moduleShaded: [0.5, 0.3, 0.15, 1] as Mesh['color'],
};

export interface SceneOptions {
  showZones?: boolean;
  showEquipment?: boolean;
  showBallast?: boolean;
  showModules?: boolean;
  mounting?: MountingDesign;
  scheme?: Scheme;
}

export function buildRoofScene(roof: RoofModel, opts: SceneOptions = {}): RenderNode[] {
  const nodes: RenderNode[] = [];
  if (!roof.result) return nodes;
  const pts = roof.result.points;
  const planes: Plane3D[] = [];

  // 坡面
  roof.planes.forEach((plane, idx) => {
    const p3d = buildPlane3D(plane, pts);
    planes.push(p3d);
    nodes.push({ mesh: polygonMesh(p3d.vertices3d.map(v => [v.x, v.y, v.z]), idx % 2 ? COLORS.planeAlt : COLORS.plane), model: identityModel() });
    // 坡面边界
    const loop = [...p3d.vertices3d, p3d.vertices3d[0]];
    nodes.push({ mesh: lineMesh(loop.map(v => [v.x, v.y, v.z + 0.05]), COLORS.edge), model: identityModel() });
  });

  // 屋脊/天沟交线
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      const ridge = intersectPlanes(planes[i], planes[j], pts);
      if (ridge) {
        nodes.push({
          mesh: lineMesh([[ridge.start.x, ridge.start.y, ridge.start.z + 0.1], [ridge.end.x, ridge.end.y, ridge.end.z + 0.1]],
            ridge.kind === '屋脊线' ? COLORS.ridge : COLORS.gutter),
          model: identityModel(),
        });
      }
    }
  }

  // 分区多边形（俯视投影，半透明）
  if (opts.showZones) {
    for (const z of roof.zones) {
      const poly = z.pointIds.map(id => pts.find(p => p.id === id)).filter(Boolean) as typeof pts;
      if (poly.length < 3) continue;
      const z0 = Math.max(...pts.map(p => p.z)) + 0.15;
      nodes.push({
        mesh: polygonMesh(poly.map(p => [p.x, p.y, z0]), z.type === '承重分区' ? COLORS.zoneLoad : COLORS.zoneWater),
        model: identityModel(),
      });
    }
  }

  // 既有设备占位
  if (opts.showEquipment) {
    for (const e of roof.equipment) {
      const cx = e.footprint.reduce((s, p) => s + p.x, 0) / e.footprint.length;
      const cy = e.footprint.reduce((s, p) => s + p.y, 0) / e.footprint.length;
      const sx = Math.max(...e.footprint.map(p => p.x)) - Math.min(...e.footprint.map(p => p.x));
      const sy = Math.max(...e.footprint.map(p => p.y)) - Math.min(...e.footprint.map(p => p.y));
      const z0 = Math.max(...pts.map(p => p.z)) + 0.4;
      nodes.push({ mesh: boxMesh(cx, cy, z0, Math.max(0.3, sx), Math.max(0.3, sy), 0.8, COLORS.equipment), model: identityModel() });
    }
  }

  // 配重块
  if (opts.showBallast && opts.mounting) {
    for (const row of opts.mounting.rows) {
      for (const b of row.blocks) {
        nodes.push({ mesh: boxMesh(b.position.x, b.position.y, b.position.z + 0.25, 0.4, 0.4, 0.5, COLORS.block), model: identityModel() });
      }
    }
  }

  // 组件阵列
  if (opts.showModules && opts.scheme) {
    for (const mod of opts.scheme.modules) {
      const shaded = mod.shading > 0;
      nodes.push({
        mesh: boxMesh(mod.position.x, mod.position.y, mod.position.z + 0.15, 1.13, 2.28, 0.05,
          shaded ? COLORS.moduleShaded : COLORS.module),
        model: identityModel(),
      });
    }
  }

  return nodes;
}
