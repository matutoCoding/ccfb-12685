// 收益测算：自发自用/余电上网、分时电价、静态回收期、IRR、NPV、敏感性分析
import type { FinanceConfig, FinanceResult } from '@/types';

export interface FinanceInput extends FinanceConfig {
  annualEnergyKwh: number;
  degradation: number; // 年衰减
  years: number;       // 评估年限
}

/** 分时电价加权平均自用单价 */
export function weightedSelfUseTariff(cfg: FinanceConfig): number {
  const totalHours = cfg.tariffs.reduce((s, t) => s + t.hours, 0) || 1;
  return cfg.tariffs.reduce((s, t) => s + t.price * t.hours, 0) / totalHours;
}

/** 年电费收入（含自发自用与余电上网两部分） */
export function annualRevenue(cfg: FinanceConfig, energyKwh: number): number {
  const selfUse = energyKwh * cfg.selfUseRatio;
  const feedIn = energyKwh * (1 - cfg.selfUseRatio);
  return selfUse * weightedSelfUseTariff(cfg) + feedIn * cfg.feedInTariff;
}

/** 净现值（首笔现金流视为 t=0，不折现） */
export function npv(rate: number, cashflows: number[]): number {
  return cashflows.reduce((s, cf, t) => s + cf / Math.pow(1 + rate, t), 0);
}

/** 内部收益率（二分法） */
export function irr(cashflows: number[], tol = 1e-6): number {
  let lo = -0.9, hi = 2;
  const f = (r: number) => npv(r, cashflows);
  if (f(lo) * f(hi) > 0) return NaN;
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    if (Math.abs(f(mid)) < tol) return mid;
    if (f(lo) * f(mid) < 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

export function computeFinance(input: FinanceInput): FinanceResult {
  const { annualEnergyKwh, initialInvestment, annualOpex, discountRate, years, degradation } = input;
  const firstRevenue = annualRevenue(input, annualEnergyKwh);
  const cashflows: number[] = [-initialInvestment];
  let cumulative = -initialInvestment;
  let payback = NaN;
  for (let y = 1; y <= years; y++) {
    const energy = annualEnergyKwh * Math.pow(1 - degradation, y - 1);
    const cf = annualRevenue(input, energy) - annualOpex;
    cashflows.push(cf);
    if (isNaN(payback) && cumulative + cf >= 0) {
      // 线性插值求静态回收时点
      payback = (y - 1) + Math.abs(cumulative) / cf;
    }
    cumulative += cf;
  }
  const calcIrr = irr(cashflows);
  const calcNpv = npv(discountRate, cashflows);

  // 敏感性：电价与装机量各 ±20% 对回收期的影响
  const sensitivity = [-20, -10, 0, 10, 20].map(changePct => {
    const rev = firstRevenue * (1 + changePct / 100);
    let cum = -initialInvestment, pb = NaN;
    for (let y = 1; y <= years; y++) {
      const cf = rev * Math.pow(1 - degradation, y - 1) - annualOpex;
      if (isNaN(pb) && cum + cf >= 0) pb = (y - 1) + Math.abs(cum) / cf;
      cum += cf;
    }
    return { changePct, payback: pb };
  });

  return {
    annualRevenue: firstRevenue,
    staticPaybackYears: payback,
    irr: calcIrr,
    npv: calcNpv,
    sensitivity,
  };
}
