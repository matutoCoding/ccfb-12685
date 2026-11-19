import { describe, it, expect } from 'vitest';
import { coldVoc, hotVmp, selectCableSection, checkElectrical, checkMpptAssignment } from '@/lib/calc/electrical';
import { computeFinance, irr, npv, annualRevenue } from '@/lib/calc/finance';
import { parseTmyCsv } from '@/lib/calc/tmy';
import { simulateEnergy } from '@/lib/calc/energy';
import type { PvModuleModel, InverterModel, FinanceConfig } from '@/types';

const mod: PvModuleModel = {
  id: 'm', manufacturer: 't', model: 't', powerW: 550, lengthMm: 2278, widthMm: 1134, thicknessMm: 35, weightKg: 27.5,
  voc: 49.8, isc: 14.1, vmp: 41.8, imp: 13.16, vocTempCoeff: -0.25, iscTempCoeff: 0.05, noct: 45, nCells: 144, nSubstrings: 3,
};
const inv: InverterModel = {
  id: 'i', manufacturer: 't', model: 't', ratedKw: 100, maxDcVoltage: 1100, mpptLow: 200, mpptHigh: 1000,
  mpptCount: 10, stringsPerMppt: 2, maxInputCurrent: 26, euroEfficiency: 0.984,
};

describe('电气校验', () => {
  it('低温 Voc 修正随温度降低而升高', () => {
    const warm = coldVoc(mod, 20, 25);
    const cold = coldVoc(mod, 20, -20);
    expect(cold).toBeGreaterThan(warm);
    expect(cold).toBeCloseTo(49.8 * 20 * (1 + 0.0025 * 45), 6);
  });

  it('高温 Vmp 下降', () => {
    expect(hotVmp(mod, 20, 60)).toBeLessThan(41.8 * 20);
  });

  it('串数过多触发超压标红并给出建议串数上限', () => {
    const r = checkElectrical({ module: mod, inverter: inv, stringSize: 26, minTempC: -10, maxTempC: 60, stringCurrentA: 13.16, cableOneWayM: 60 });
    expect(r.overVoltage).toBe(true);
    expect(r.suggestedStringSize.max).toBeLessThan(26);
  });

  it('电缆按载流量+压降选型，线长超阈值给提示', () => {
    const c = selectCableSection(13.16, 120, 2, 800);
    expect(c.section).toBeGreaterThanOrEqual(4);
    const r = checkElectrical({ module: mod, inverter: inv, stringSize: 20, minTempC: -10, maxTempC: 60, stringCurrentA: 13.16, cableOneWayM: 120 });
    expect(r.lengthWarning).toBe(true);
  });

  it('MPPT 挂接串数/电流超限判定', () => {
    const ok = checkMpptAssignment(inv, [2, 2], 13.16);
    expect(ok[0].overStrings).toBe(false);
    const bad = checkMpptAssignment(inv, [3], 13.16);
    expect(bad[0].overStrings).toBe(true);
  });
});

describe('收益测算', () => {
  const cfg: FinanceConfig = {
    selfUseRatio: 0.8, feedInTariff: 0.39,
    tariffs: [{ name: '峰', price: 1.0, hours: 6 }, { name: '平', price: 0.6, hours: 10 }, { name: '谷', price: 0.3, hours: 8 }],
    initialInvestment: 400000, annualOpex: 8000, discountRate: 0.06,
  };
  it('年收入按自用/上网两部分计算', () => {
    const rev = annualRevenue(cfg, 100000);
    const weighted = (1 * 6 + 0.6 * 10 + 0.3 * 8) / 24;
    expect(rev).toBeCloseTo(100000 * 0.8 * weighted + 100000 * 0.2 * 0.39, 6);
  });
  it('IRR 对 [-100, 110, 110] 给出约 73.4% 的高收益率，且该利率下 NPV≈0', () => {
    const r = irr([-100, 110, 110]);
    expect(r).toBeGreaterThan(0.7);
    expect(r).toBeLessThan(0.77);
    expect(npv(r, [-100, 110, 110])).toBeCloseTo(0, 4);
  });
  it('完整测算给出回收期、IRR、NPV 与五点敏感性', () => {
    const r = computeFinance({ ...cfg, annualEnergyKwh: 120000, degradation: 0.0055, years: 25 });
    expect(r.sensitivity).toHaveLength(5);
    expect(isFinite(r.staticPaybackYears)).toBe(true);
    expect(isFinite(r.irr)).toBe(true);
  });
});

describe('TMY 解析与逐时发电', () => {
  it('解析 CSV 并生成逐时记录', () => {
    const csv = 'month,day,hour,GHI,DHI,temp,wind\n1,1,10,800,120,15,2.1\n1,1,11,900,140,17,2.5\n1,1,12,0,0,10,1';
    const { data, warnings } = parseTmyCsv(csv, '测试地', 31, 121);
    expect(data.records).toHaveLength(3);
    expect(data.records[0].ghi).toBe(800);
    expect(warnings.length).toBeGreaterThan(0); // 数据量不足提示
  });

  it('逐时模拟输出损耗拆分、12 个月、25 年曲线', () => {
    const records = Array.from({ length: 100 }, (_, i) => ({
      month: (i % 12) + 1, day: 1, hour: 12, ghi: 800, dhi: 150, tempC: 25, windMs: 2,
    }));
    const r = simulateEnergy({
      capacityKw: 50,
      tmy: { locationName: 't', lat: 31, lon: 121, records },
      loss: { dust: 0.03, cable: 0.015, mismatch: 0.02, inverter: 0.02, temperature: 0.04, transformer: 0.01, other: 0.01 },
      inverterEfficiency: 0.98, yearOneDegradation: 0.02, annualDegradation: 0.0055,
      tiltDeg: 10, azimuthDeg: 180, cleaningCostYuan: 800, electricityPrice: 0.4, dustAccumRate: 0.001,
    });
    expect(r.monthly).toHaveLength(12);
    expect(r.yearly25).toHaveLength(25);
    expect(r.losses.length).toBeGreaterThanOrEqual(6);
    expect(r.netKwh).toBeGreaterThan(0);
    expect(r.yearly25[24].kwh).toBeLessThan(r.yearly25[0].kwh);
  });
});
