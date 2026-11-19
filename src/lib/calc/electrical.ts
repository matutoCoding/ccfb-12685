// 组串电气校验：极端低温开路电压修正、MPPT 窗口比对、电缆载流量/压降选型
import type { ElectricalCheck, InverterModel, PvModuleModel } from '@/types';

const DEG = Math.PI / 180;

export interface ElectricalInput {
  module: PvModuleModel;
  inverter: InverterModel;
  stringSize: number;          // 每串组件数
  minTempC: number;            // 极端低温
  maxTempC: number;            // 极端高温
  stringCurrentA: number;      // 工作电流（取 Imp）
  cableOneWayM: number;        // 直流侧单程线长
  copperConductivity?: number; // 铜电导率 S·m/mm²
}

/** 极端低温下开路电压修正：Voc(T) = Voc(STC)·(1 + αVoc·(T-25))，α 为 %/°C（负值） */
export function coldVoc(m: PvModuleModel, stringSize: number, minTempC: number): number {
  const factor = 1 + (m.vocTempCoeff / 100) * (minTempC - 25);
  return m.voc * factor * stringSize;
}

/** 高温下 MPP 电压下限估算：Vmp(T)=Vmp(STC)·(1+αVoc·(T-25)) */
export function hotVmp(m: PvModuleModel, stringSize: number, maxTempC: number): number {
  const factor = 1 + (m.vocTempCoeff / 100) * (maxTempC - 25);
  return m.vmp * factor * stringSize;
}

/** 由工作电流选电缆截面（铜芯，载流量经验表，环境 30°C 明敷），返回 mm² */
export function selectCableSection(currentA: number, lengthM: number, allowDropPct: number,
  systemV: number, conductivity = 56): { section: number; spec: string; dropPct: number; ampacity: number } {
  const table: { section: number; ampacity: number }[] = [
    { section: 2.5, ampacity: 26 }, { section: 4, ampacity: 34 }, { section: 6, ampacity: 43 },
    { section: 10, ampacity: 60 }, { section: 16, ampacity: 82 }, { section: 25, ampacity: 108 },
    { section: 35, ampacity: 135 },
  ];
  // 压降约束：ΔU = 2·L·I/(κ·S) （来回长度 2L）
  const minSectionByDrop = 2 * lengthM * currentA / (conductivity * (allowDropPct / 100) * systemV);
  const pick = table.find(t => t.ampacity >= currentA * 1.25 && t.section >= minSectionByDrop)
    ?? table[table.length - 1];
  const dropPct = 2 * lengthM * currentA / (conductivity * pick.section) / systemV * 100;
  return { section: pick.section, spec: `PV1-F 1×${pick.section}mm²`, dropPct, ampacity: pick.ampacity };
}

export function checkElectrical(input: ElectricalInput): ElectricalCheck {
  const { module: m, inverter: inv, stringSize, minTempC, maxTempC } = input;
  const vocCold = coldVoc(m, stringSize, minTempC);
  const vmpHot = hotVmp(m, stringSize, maxTempC);
  const overVoltage = vocCold > inv.maxDcVoltage;
  const underVoltage = vmpHot < inv.mpptLow;

  // 建议串数：低温不超 maxDcVoltage，高温不低于 mpptLow，工作点落在窗口内
  const coldFactor = 1 + (m.vocTempCoeff / 100) * (minTempC - 25);
  const hotFactor = 1 + (m.vocTempCoeff / 100) * (maxTempC - 25);
  const maxByVoc = Math.floor(inv.maxDcVoltage / (m.voc * coldFactor));
  const minByMppt = Math.ceil(inv.mpptLow / (m.vmp * hotFactor));
  const maxByMppt = Math.floor(inv.mpptHigh / (m.vmp * hotFactor));
  const suggested = { min: minByMppt, max: Math.min(maxByVoc, maxByMppt) };

  const sysV = m.vmp * stringSize;
  const cable = selectCableSection(input.stringCurrentA, input.cableOneWayM, 2, sysV,
    input.copperConductivity);

  return {
    vocCold,
    maxDcVoltage: inv.maxDcVoltage,
    overVoltage,
    underVoltage,
    suggestedStringSize: suggested,
    cableSpec: cable.spec,
    cableLengthM: input.cableOneWayM,
    voltageDropPct: cable.dropPct,
    ampacityA: cable.ampacity,
    currentA: input.stringCurrentA,
    lengthWarning: input.cableOneWayM > 80 || cable.dropPct > 2,
  };
}

/** MPPT 路数/挂接串数/单路电流校验，超限返回违规项 */
export function checkMpptAssignment(inv: InverterModel, stringsPerMppt: number[],
  currentPerString: number): { mpptIndex: number; overCurrent: boolean; overStrings: boolean; totalA: number }[] {
  return stringsPerMppt.map((n, idx) => ({
    mpptIndex: idx,
    overStrings: n > inv.stringsPerMppt,
    overCurrent: n * currentPerString > inv.maxInputCurrent,
    totalA: n * currentPerString,
  }));
}

void DEG;
