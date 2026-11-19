// 抗风掀配重计算（参照 GB 50009 建筑结构荷载规范风荷载体系）与配重块排布
import type { BallastConfig, BallastBlock, BoqItem, MountingDesign, RoofZone, RoofPoint } from '@/types';
import { pointInPolygon } from './roofGeometry';

export interface RowInput { index: number; x: number; y: number; modules: number; moduleWidthM: number; rowLengthM: number; }

export interface BallastResult {
  windSuctionKpa: number;       // 单位面积风吸力 kPa
  upliftPerRowKn: number;       // 每排上拔力 kN
  requiredBallastKgPerRow: number;
  blocksPerRow: number;
  rows: MountingDesign['rows'];
  totalBallastKg: number;
  trace: string[];
}

let blockSeq = 0;
const bid = () => `BL${blockSeq++}`;

/**
 * 风荷载标准值（吸力）：
 *   w_k = β_gz · μ_s · μ_z · w0        （kN/m²）
 * 配重式支架抗风掀稳定（忽略支架自重以外的抗力，安全系数 1.4）：
 *   G_ballast ≥ 1.4 · w_k · A_trib / g
 * A_trib 为该排导轨从属受风面积（排距 × 排长度）。
 */
export function computeBallast(
  cfg: BallastConfig,
  rows: RowInput[],
  rowSpacing: number,
  roofPts: RoofPoint[],
  waterproofZones: RoofZone[],
): BallastResult {
  const trace: string[] = [];
  const wk = cfg.gustFactor * cfg.shapeFactor * cfg.heightFactor * cfg.basicWindPressure;
  trace.push(`风荷载标准值 w_k = β_gz(${cfg.gustFactor}) × μ_s(${cfg.shapeFactor}) × μ_z(${cfg.heightFactor}) × w0(${cfg.basicWindPressure}) = ${wk.toFixed(4)} kN/m²`);
  const safety = 1.4;
  const g = 9.81;
  trace.push(`抗浮稳定安全系数取 ${safety}，重力加速度 g=${g} m/s²`);

  const out: MountingDesign['rows'] = [];
  let total = 0;
  let firstReq = 0;
  let firstUplift = 0;

  for (const row of rows) {
    const inParapet = isNearParapet(row, roofPts, cfg.parapetZoneWidth);
    // 女儿墙风吸力衰减区：吸力放大（边角区），间距加密 → 该排体型系数局部放大、配重增加
    const localShape = inParapet ? cfg.shapeFactor / Math.max(0.4, cfg.parapetDensify) : cfg.shapeFactor;
    const wkLocal = cfg.gustFactor * localShape * cfg.heightFactor * cfg.basicWindPressure;
    const tribArea = rowSpacing * row.rowLengthM;
    const upliftKn = wkLocal * tribArea;
    const reqKg = safety * upliftKn * 1000 / g; // kN→N 后 /g
    const blocks = Math.max(2, Math.ceil(reqKg / cfg.blockWeight));
    const blockObjs = placeBlocks(row, blocks, cfg.blockWeight, inParapet, roofPts, waterproofZones);
    total += blockObjs.length * cfg.blockWeight;
    out.push({
      index: row.index, x: row.x, y: row.y, modules: row.modules,
      requiredBallastKg: reqKg, blocks: blockObjs,
    });
    if (row.index === 0) {
      firstReq = reqKg;
      firstUplift = upliftKn;
      trace.push(`第 1 排从属面积 A=${tribArea.toFixed(2)} m²，上拔力 F=${upliftKn.toFixed(3)} kN`);
      trace.push(`所需压重 G ≥ ${safety}×F/g = ${reqKg.toFixed(1)} kg，单块 ${cfg.blockWeight}kg → ${blocks} 块`);
      if (inParapet) trace.push('该排位于女儿墙衰减区，体型系数局部放大并加密配重');
    }
  }
  trace.push(`全屋面配重合计 = ${total.toFixed(1)} kg（${(total / 1000).toFixed(2)} t）`);

  return {
    windSuctionKpa: wk,
    upliftPerRowKn: firstUplift,
    requiredBallastKgPerRow: firstReq,
    blocksPerRow: Math.max(2, Math.ceil(firstReq / cfg.blockWeight)),
    rows: out, totalBallastKg: total, trace,
  };
}

function isNearParapet(row: RowInput, roofPts: RoofPoint[], width: number): boolean {
  // 距屋面任一边界小于衰减区宽度即判定（点到边距离）
  for (let i = 0; i < roofPts.length; i++) {
    const a = roofPts[i], b = roofPts[(i + 1) % roofPts.length];
    if (distPointSegment({ x: row.x, y: row.y }, a, b) < width) return true;
  }
  return false;
}

function distPointSegment(p: { x: number; y: number }, a: RoofPoint, b: RoofPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 配重块自动落位：导轨两端各一块，其余均布跨中；落入防水分区登记（夹具层面强制抗风夹具） */
function placeBlocks(row: RowInput, count: number, weight: number, inParapet: boolean,
  roofPts: RoofPoint[], zones: RoofZone[]): BallastBlock[] {
  const blocks: BallastBlock[] = [];
  const half = row.rowLengthM / 2;
  for (let k = 0; k < count; k++) {
    const t = count === 1 ? 0.5 : k / (count - 1); // 0..1
    const ox = -half + t * row.rowLengthM;
    const pos = { x: row.x + ox, y: row.y, z: 0 };
    const inWaterproof = zones.some(z => {
      const poly = z.pointIds.map(id => roofPts.find(p => p.id === id)).filter(Boolean) as RoofPoint[];
      return poly.length >= 3 && pointInPolygon({ x: pos.x, y: pos.y }, poly);
    });
    blocks.push({
      id: bid(), rowIndex: row.index, position: pos, weightKg: weight,
      inParapetZone: inParapet || inWaterproof,
    });
  }
  return blocks;
}

/** 支架物料汇总（延米 + 件数）→ 物料清单 */
export function mountingBoq(design: { railSpec: string; railLengthM: number; railCount: number; clampCount: number; windClampCount: number; totalBallastKg: number; blockWeight: number; type: string }): BoqItem[] {
  return [
    { id: 'BQ-RAIL', category: '支架', name: '铝合金导轨', spec: design.railSpec, unit: 'm', qty: design.railLengthM, unitPrice: 0, source: '支架设计' },
    { id: 'BQ-CLAMP', category: '支架', name: '标准夹具', spec: '配套组件边框', unit: '件', qty: design.clampCount - design.windClampCount, unitPrice: 0, source: '支架设计' },
    { id: 'BQ-WCLAMP', category: '支架', name: '抗风夹具（防水分区强制）', spec: '抗风掀型', unit: '件', qty: design.windClampCount, unitPrice: 0, source: '支架设计' },
    ...(design.type === '配重式' ? [{
      id: 'BQ-BLOCK', category: '支架', name: '混凝土配重块', spec: `${design.blockWeight}kg/块`,
      unit: '块', qty: Math.round(design.totalBallastKg / design.blockWeight), unitPrice: 0, source: '抗风掀计算',
    }] : []),
  ];
}
