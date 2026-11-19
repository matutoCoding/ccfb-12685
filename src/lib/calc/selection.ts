// 设备选型：组件+逆变器组合方案、超配/电压裕度、组串分路、停产替代、基线偏差
import type {
  InverterModel, PvModuleModel, Scheme, PvString, PlacedModule, ID, ModuleBatch,
} from '@/types';
import { coldVoc, hotVmp } from './electrical';

let idSeq = 0;
export const uid = (prefix = 'id'): ID => `${prefix}_${Date.now().toString(36)}_${(idSeq++).toString(36)}`;

export interface SchemeOption {
  moduleModelId: ID;
  inverterModelId: ID;
  moduleCount: number;
  inverterCount: number;
  capacityKw: number;
  oversizeRatio: number;   // 超配率 = 直流装机/交流额定 - 1
  voltageMargin: number;   // 直流侧电压裕度 %
  strings: PvString[];
  modules: PlacedModule[];
  feasible: boolean;
  warnings: string[];
}

/** 根据目标装机量与可利用面积枚举可行组合 */
export function generateSchemeOptions(
  modules: PvModuleModel[],
  inverters: InverterModel[],
  targetKw: number,
  usableArea: number,
  minTempC = -10,
  maxTempC = 60,
): SchemeOption[] {
  const options: SchemeOption[] = [];
  for (const m of modules) {
    if (m.discontinued) continue;
    const areaEach = (m.lengthMm / 1000) * (m.widthMm / 1000);
    const maxByArea = Math.floor(usableArea / (areaEach * 1.15)); // 含通道/间距系数
    const targetCount = Math.round(targetKw * 1000 / m.powerW);
    const moduleCount = Math.min(maxByArea, targetCount);
    if (moduleCount < 6) continue;

    for (const inv of inverters) {
      if (inv.discontinued) continue;
      const dcKw = moduleCount * m.powerW / 1000;
      const inverterCount = Math.max(1, Math.ceil(dcKw / (inv.ratedKw * 1.3)));
      const acKw = inverterCount * inv.ratedKw;
      const oversize = dcKw / acKw - 1;
      const warnings: string[] = [];

      // 自动分路：按总 MPPT 路数均分，每路挂接串数不超限值
      const totalMppt = inv.mpptCount * inverterCount;
      const stringSize = Math.max(6, Math.round(moduleCount / totalMppt / inv.stringsPerMppt));
      const actualStrings = Math.ceil(moduleCount / stringSize);
      const perMppt = distribute(actualStrings, totalMppt);
      const strings: PvString[] = [];
      const placed: PlacedModule[] = [];
      let remaining = moduleCount;
      perMppt.forEach((n, mpptIdx) => {
        for (let s = 0; s < n && remaining > 0; s++) {
          const size = Math.min(stringSize, remaining);
          remaining -= size;
          const modIds: ID[] = [];
          for (let k = 0; k < size; k++) {
            const pid = uid('pm');
            modIds.push(pid);
            placed.push({
              id: pid, modelId: m.id, position: { x: 0, y: 0, z: 0 },
              rotationDeg: 0, shading: 0, failureRate: 0,
            });
          }
          strings.push({ id: uid('st'), mpptIndex: mpptIdx % inv.mpptCount, moduleIds: modIds });
        }
      });

      // 电压校验
      const vocCold = coldVoc(m, stringSize, minTempC);
      const vmpHot = hotVmp(m, stringSize, maxTempC);
      if (vocCold > inv.maxDcVoltage) warnings.push(`低温开路电压 ${vocCold.toFixed(0)}V 超逆变器上限 ${inv.maxDcVoltage}V`);
      if (vmpHot < inv.mpptLow) warnings.push(`高温 MPP 电压 ${vmpHot.toFixed(0)}V 低于 MPPT 下限 ${inv.mpptLow}V`);
      const voltageMargin = (inv.maxDcVoltage - vocCold) / inv.maxDcVoltage * 100;
      if (oversize > 0.3) warnings.push(`超配率 ${(oversize * 100).toFixed(1)}% 偏高`);

      options.push({
        moduleModelId: m.id, inverterModelId: inv.id, moduleCount, inverterCount,
        capacityKw: dcKw, oversizeRatio: oversize, voltageMargin,
        strings, modules: placed, feasible: warnings.length === 0, warnings,
      });
    }
  }
  return options.sort((a, b) => Number(b.feasible) - Number(a.feasible) || Math.abs(a.oversizeRatio) - Math.abs(b.oversizeRatio));
}

function distribute(total: number, buckets: number): number[] {
  const arr = new Array(buckets).fill(0);
  for (let i = 0; i < total; i++) arr[i % buckets]++;
  return arr;
}

/** 方案转持久化 Scheme */
export function optionToScheme(o: SchemeOption, name: string, batches: ModuleBatch[]): Scheme {
  return {
    id: uid('sch'), name,
    moduleModelId: o.moduleModelId, inverterModelId: o.inverterModelId,
    moduleCount: o.moduleCount, inverterCount: o.inverterCount,
    capacityKw: o.capacityKw, oversizeRatio: o.oversizeRatio,
    voltageMargin: o.voltageMargin, strings: o.strings, modules: o.modules,
    isBaseline: false, createdAt: Date.now(),
    ...(batches[0] ? {} : {}),
  };
}

/** 与基线方案的偏差 */
export function baselineDelta(current: Scheme, baseline: Scheme): {
  capacityKw: number; energyPct: number; investmentPct: number; lcoePct: number;
} {
  const pct = (a: number | undefined, b: number | undefined) =>
    (a && b) ? (a - b) / b * 100 : 0;
  return {
    capacityKw: current.capacityKw - baseline.capacityKw,
    energyPct: pct(current.annualEnergyKwh, baseline.annualEnergyKwh),
    investmentPct: pct(current.initialInvestment, baseline.initialInvestment),
    lcoePct: pct(current.lcoe, baseline.lcoe),
  };
}

export interface ReplacementCandidate {
  model: PvModuleModel | InverterModel;
  score: number;             // 相近度 0-100
  diffs: { field: string; old: number; next: number; pct: number }[];
}

/** 停产替代：按功率/尺寸/电参相近度打分，逐条列出差异参数 */
export function findReplacements(discontinued: PvModuleModel, pool: PvModuleModel[]): ReplacementCandidate[] {
  return pool
    .filter(m => !m.discontinued && m.id !== discontinued.id)
    .map(m => {
      const powerScore = 100 - Math.abs(m.powerW - discontinued.powerW) / discontinued.powerW * 100;
      const sizeScore = 100 - (Math.abs(m.lengthMm - discontinued.lengthMm) / discontinued.lengthMm
        + Math.abs(m.widthMm - discontinued.widthMm) / discontinued.widthMm) * 50;
      const elecScore = 100 - (Math.abs(m.voc - discontinued.voc) / discontinued.voc
        + Math.abs(m.isc - discontinued.isc) / discontinued.isc) * 50;
      const score = (powerScore * 0.4 + sizeScore * 0.3 + elecScore * 0.3);
      return {
        model: m, score,
        diffs: [
          { field: '功率W', old: discontinued.powerW, next: m.powerW, pct: (m.powerW - discontinued.powerW) / discontinued.powerW * 100 },
          { field: '长mm', old: discontinued.lengthMm, next: m.lengthMm, pct: (m.lengthMm - discontinued.lengthMm) / discontinued.lengthMm * 100 },
          { field: '宽mm', old: discontinued.widthMm, next: m.widthMm, pct: (m.widthMm - discontinued.widthMm) / discontinued.widthMm * 100 },
          { field: 'Voc', old: discontinued.voc, next: m.voc, pct: (m.voc - discontinued.voc) / discontinued.voc * 100 },
          { field: 'Isc', old: discontinued.isc, next: m.isc, pct: (m.isc - discontinued.isc) / discontinued.isc * 100 },
        ],
      };
    })
    .filter(r => r.score > 70)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
