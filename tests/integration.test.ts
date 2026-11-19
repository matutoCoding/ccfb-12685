import { describe, it, expect } from 'vitest';
import { adjustTraverse } from '@/lib/calc/traverse';
import { computeUsableArea } from '@/lib/calc/roofGeometry';
import { generateSchemeOptions } from '@/lib/calc/selection';
import { simulateString, type ModuleCondition } from '@/lib/calc/ivSimulation';
import { checkElectrical } from '@/lib/calc/electrical';
import type { InverterModel, PvModuleModel, TraverseLeg } from '@/types';

/** 端到端：勘测导线 → 平差 → 可利用面积 → 选型 → 电气 → 仿真 的完整数据流 */
describe('光伏设计端到端数据流', () => {
  const legs: TraverseLeg[] = [
    { id: 'l1', from: 'A', to: 'B', length: 40.02, turnAngleDeg: -90 },
    { id: 'l2', from: 'B', to: 'C', length: 24.01, turnAngleDeg: -90 },
    { id: 'l3', from: 'C', to: 'D', length: 39.98, turnAngleDeg: -90 },
    { id: 'l4', from: 'D', to: 'A', length: 23.99, turnAngleDeg: -90 },
  ];

  const mod: PvModuleModel = {
    id: 'm', manufacturer: 't', model: 't', powerW: 550, lengthMm: 2278, widthMm: 1134, thicknessMm: 35, weightKg: 27.5,
    voc: 49.8, isc: 14.1, vmp: 41.8, imp: 13.16, vocTempCoeff: -0.25, iscTempCoeff: 0.05, noct: 45, nCells: 144, nSubstrings: 3,
  };
  const inv: InverterModel = {
    id: 'i', manufacturer: 't', model: 't', ratedKw: 100, maxDcVoltage: 1100, mpptLow: 200, mpptHigh: 1000,
    mpptCount: 10, stringsPerMppt: 2, maxInputCurrent: 26, euroEfficiency: 0.984,
  };

  it('完整链路各环节数据自洽', () => {
    // 1. 导线平差
    const r = adjustTraverse({ legs, firstBearingDeg: 0, toleranceK: 0.05 });
    expect(r.passed).toBe(true);
    expect(r.area2d).toBeGreaterThan(900); // 约 40×24=960 m²

    // 2. 可利用面积（无分区/设备占用时等于屋面面积）
    const usable = computeUsableArea(r.points, [], []);
    expect(usable.usableArea).toBeCloseTo(r.area2d, 4);

    // 3. 选型组合
    const options = generateSchemeOptions([mod], [inv], 100, usable.usableArea);
    expect(options.length).toBeGreaterThan(0);
    const o = options[0];
    expect(o.moduleCount).toBeGreaterThan(0);
    expect(o.strings.length).toBeGreaterThan(0);
    // 每串组件总数等于全部组件
    const totalInStrings = o.strings.reduce((s, st) => s + st.moduleIds.length, 0);
    expect(totalInStrings).toBe(o.moduleCount);

    // 4. 电气校验（用选型串数）
    const stringSize = o.strings[0].moduleIds.length;
    const chk = checkElectrical({
      module: mod, inverter: inv, stringSize, minTempC: -10, maxTempC: 60,
      stringCurrentA: mod.imp, cableOneWayM: 50,
    });
    expect(chk.cableSpec).toContain('mm²');

    // 5. 仿真：取一串设遮挡，验证多峰与 MPPT 精度
    const conds: ModuleCondition[] = Array.from({ length: stringSize }, (_, i) => ({
      moduleId: `c${i}`, irradiance: i === 0 ? 400 : 1000, tempC: 25, failureRate: 0,
    }));
    const sim = simulateString(mod, conds);
    expect(sim.ivCurve.length).toBeGreaterThan(100);
    for (const run of sim.mpptRuns.filter(x => !x.algorithm.includes('单起点'))) {
      expect(run.deviationPct).toBeLessThanOrEqual(3);
    }
  });

  it('面积误差红线：平差面积与勘测标注 960m² 误差 <1%', () => {
    const r = adjustTraverse({ legs, firstBearingDeg: 0, toleranceK: 0.05 });
    const errPct = Math.abs(r.area2d - 960) / 960 * 100;
    expect(errPct).toBeLessThan(1);
  });
});
