// 典型气象年逐时发电量模拟：损耗拆分、月度等效小时、25 年衰减、清洗周期建议
import type { TmyDataset, EnergyResult, EnergyLossItem, MonthlyEnergy, LossCoeffs } from '@/types';

export interface EnergyInput {
  capacityKw: number;
  tmy: TmyDataset;
  loss: LossCoeffs;
  inverterEfficiency: number; // 0-1
  yearOneDegradation: number; // 首年衰减
  annualDegradation: number;  // 逐年衰减
  tiltDeg: number;
  azimuthDeg: number;
  curtailLimitKw?: number;    // 弃光限电出力上限
  cleaningCostYuan: number;   // 清洗一次人工费
  electricityPrice: number;
  dustAccumRate: number;      // 灰尘累积速率（每日额外损耗占比）
}

const DEG = Math.PI / 180;

/** 倾斜面辐照转换（Hay-Davies 简化：直接辐射入射角折减 + 散射各向同性 + 地面反射） */
export function planeOfArray(ghi: number, dhi: number, lat: number, tilt: number, azimuth: number,
  hour: number, month: number): number {
  const dni = Math.max(0, ghi - dhi);
  const decl = 23.45 * Math.sin((360 * (284 + month * 30) / 365) * DEG);
  const hourAngle = (hour - 12) * 15;
  const latR = lat * DEG, declR = decl * DEG, haR = hourAngle * DEG;
  const elev = Math.asin(Math.sin(latR) * Math.sin(declR) + Math.cos(latR) * Math.cos(declR) * Math.cos(haR));
  if (elev <= 0) return 0;
  const sinElev = Math.sin(elev);
  const cosZen = sinElev;
  const azSun = Math.atan2(Math.cos(declR) * Math.sin(haR),
    Math.cos(latR) * Math.sin(declR) - Math.sin(latR) * Math.cos(declR) * Math.cos(haR));
  const cosInc = sinElev * Math.cos(tilt * DEG)
    + cosZen * Math.sin(tilt * DEG) * Math.cos(azSun - azimuth * DEG);
  const beam = dni * Math.max(0, cosInc);
  const diffuse = dhi * (1 + Math.cos(tilt * DEG)) / 2;
  const albedo = 0.2;
  const reflected = ghi * albedo * (1 - Math.cos(tilt * DEG)) / 2;
  return Math.max(0, beam + diffuse + reflected);
}

/** 电池温度：NOCT 模型 Tcell = Tamb + (NOCT-20)/800 * G */
export function cellTemp(ambientC: number, irradiance: number, noct: number): number {
  return ambientC + (noct - 20) / 800 * irradiance;
}

/** 温度导致的功率损耗（Voc 温度系数近似折算功率，-0.4%/°C 经验） */
export function tempLossPct(cellT: number): number {
  if (cellT <= 25) return 0;
  return (cellT - 25) * 0.004;
}

export function simulateEnergy(input: EnergyInput, noct = 45): EnergyResult {
  const { capacityKw, tmy, loss } = input;
  const totalLossFactor = (1 - loss.dust) * (1 - loss.cable) * (1 - loss.mismatch)
    * (1 - loss.transformer) * (1 - loss.other);

  const monthlyMap = new Map<number, { kwh: number; ghi: number; curtailHours: number; hours: number }>();
  let grossKwh = 0;
  const lossAccum: Record<string, number> = {
    灰尘: 0, 线损: 0, 失配: 0, 温度: 0, 逆变器: 0, 变压器及其他: 0,
  };

  for (const r of tmy.records) {
    const poa = planeOfArray(r.ghi, r.dhi, tmy.lat, input.tiltDeg, input.azimuthDeg, r.hour, r.month);
    if (poa <= 0) continue;
    const gRatio = poa / 1000;
    const tc = cellTemp(r.tempC, poa, noct);
    const tLoss = tempLossPct(tc);
    // 直流侧毛发电量（kWh，逐时）
    const dcGross = capacityKw * gRatio * (1 - tLoss);
    const limit = input.curtailLimitKw ?? Infinity;
    const curtailed = Math.min(dcGross, limit);
    const isCurtail = dcGross > limit;
    const dcNet = curtailed * totalLossFactor;
    const ac = dcNet * input.inverterEfficiency;
    grossKwh += dcGross;

    lossAccum.灰尘 += dcGross * loss.dust;
    lossAccum.线损 += dcGross * (1 - loss.dust) * loss.cable;
    lossAccum.失配 += dcGross * loss.mismatch;
    lossAccum.温度 += capacityKw * gRatio * tLoss;
    lossAccum.逆变器 += dcNet * (1 - input.inverterEfficiency);
    lossAccum.变压器及其他 += dcGross * (loss.transformer + loss.other);

    const cur = monthlyMap.get(r.month) ?? { kwh: 0, ghi: 0, curtailHours: 0, hours: 0 };
    cur.kwh += ac;
    cur.ghi += r.ghi;
    cur.hours++;
    if (isCurtail) cur.curtailHours++;
    monthlyMap.set(r.month, cur);
  }

  const losses: EnergyLossItem[] = Object.entries(lossAccum)
    .map(([name, kwh]) => ({ name, kwh, pct: grossKwh > 0 ? kwh / grossKwh * 100 : 0 }));
  const netKwh = grossKwh - losses.reduce((s, l) => s + l.kwh, 0);

  const monthly: MonthlyEnergy[] = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const cur = monthlyMap.get(m) ?? { kwh: 0, ghi: 0, curtailHours: 0, hours: 0 };
    return {
      month: m, kwh: cur.kwh,
      equivHours: capacityKw > 0 ? cur.kwh / capacityKw : 0,
      curtailHours: cur.curtailHours,
    };
  });

  // 25 年衰减曲线
  const yearly25 = Array.from({ length: 25 }, (_, i) => ({
    year: i + 1,
    kwh: netKwh * (1 - input.yearOneDegradation) * Math.pow(1 - input.annualDegradation, i),
  }));

  // 清洗建议：灰尘累积到边际清洗收益 = 清洗成本时的周期
  const dailyGeneration = netKwh / 365;
  let intervalDays = 30;
  for (let d = 5; d <= 90; d += 5) {
    const avgDustLoss = input.dustAccumRate * d / 2; // 周期内平均积灰
    const recoveredKwh = dailyGeneration * avgDustLoss * d;
    const recoveredValue = recoveredKwh * input.electricityPrice;
    if (recoveredValue >= input.cleaningCostYuan) { intervalDays = d; break; }
  }
  const avgLossAtInterval = input.dustAccumRate * intervalDays / 2;
  const recoveredKwh = dailyGeneration * avgLossAtInterval * intervalDays;
  const cleaningAdvice = {
    intervalDays,
    costYuan: input.cleaningCostYuan,
    recoveredKwh,
    recoveredValueYuan: recoveredKwh * input.electricityPrice,
  };

  return { grossKwh, netKwh, losses, monthly, yearly25, cleaningAdvice };
}
