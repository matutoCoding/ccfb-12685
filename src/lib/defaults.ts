// 内置默认数据：常用组件/逆变器型号库、损耗系数、应用设置
import type { AppSettings, InverterModel, OptimizerModel, PvModuleModel, Tag } from '@/types';

export const defaultSettings: AppSettings = {
  unit: '公制',
  defaultLat: 31.23,
  defaultLon: 121.47,
  defaultCity: '上海',
  traverseToleranceK: 0.05,
  lossCoeffs: {
    dust: 0.03, cable: 0.015, mismatch: 0.02, inverter: 0.02,
    temperature: 0.04, transformer: 0.01, other: 0.01,
  },
  defaultModuleParams: { vocTempCoeff: -0.25, iscTempCoeff: 0.05, noct: 45, nSubstrings: 3 },
  defaultInverterParams: { euroEfficiency: 0.98, stringsPerMppt: 2 },
};

export const seedTags: Tag[] = [
  { id: 'tag-red', name: '紧急', color: '#e5484d' },
  { id: 'tag-orange', name: '重点', color: '#f76b15' },
  { id: 'tag-blue', name: '常规', color: '#3e63dd' },
  { id: 'tag-green', name: '已复核', color: '#30a46c' },
];

export const seedModules: PvModuleModel[] = [
  { id: 'mod-550', manufacturer: '晶澳', model: 'JAM72S30-550/MR', powerW: 550, lengthMm: 2278, widthMm: 1134, thicknessMm: 35, weightKg: 27.5, voc: 49.8, isc: 14.1, vmp: 41.8, imp: 13.16, vocTempCoeff: -0.25, iscTempCoeff: 0.05, noct: 45, nCells: 144, nSubstrings: 3 },
  { id: 'mod-580', manufacturer: '隆基', model: 'Hi-MO 6 LR5-72HTH-580M', powerW: 580, lengthMm: 2278, widthMm: 1134, thicknessMm: 30, weightKg: 27.2, voc: 51.7, isc: 14.42, vmp: 43.4, imp: 13.37, vocTempCoeff: -0.24, iscTempCoeff: 0.046, noct: 45, nCells: 144, nSubstrings: 3 },
  { id: 'mod-600', manufacturer: '天合', model: 'Vertex TSM-DE20-600', powerW: 600, lengthMm: 2172, widthMm: 1303, thicknessMm: 35, weightKg: 34.3, voc: 52.2, isc: 14.85, vmp: 43.7, imp: 13.73, vocTempCoeff: -0.25, iscTempCoeff: 0.05, noct: 45, nCells: 150, nSubstrings: 3 },
  { id: 'mod-450', manufacturer: '晶科', model: 'Tiger Neo N-type 54HL4-B-450', powerW: 450, lengthMm: 1762, widthMm: 1134, thicknessMm: 30, weightKg: 21.1, voc: 41.6, isc: 13.85, vmp: 34.8, imp: 12.93, vocTempCoeff: -0.25, iscTempCoeff: 0.045, noct: 45, nCells: 108, nSubstrings: 3 },
  { id: 'mod-550-old', manufacturer: '晶澳', model: 'JAM72S20-460(停产旧款)', powerW: 460, lengthMm: 2120, widthMm: 1052, thicknessMm: 35, weightKg: 24.8, voc: 49.3, isc: 11.9, vmp: 41.4, imp: 11.12, vocTempCoeff: -0.27, iscTempCoeff: 0.05, noct: 45, nCells: 144, nSubstrings: 3, discontinued: true },
];

export const seedInverters: InverterModel[] = [
  { id: 'inv-100', manufacturer: '华为', model: 'SUN2000-100KTL-M2', ratedKw: 100, maxDcVoltage: 1100, mpptLow: 200, mpptHigh: 1000, mpptCount: 10, stringsPerMppt: 2, maxInputCurrent: 26, euroEfficiency: 0.984 },
  { id: 'inv-110', manufacturer: '阳光', model: 'SG110CX', ratedKw: 110, maxDcVoltage: 1100, mpptLow: 200, mpptHigh: 1000, mpptCount: 9, stringsPerMppt: 2, maxInputCurrent: 26, euroEfficiency: 0.983 },
  { id: 'inv-50', manufacturer: '锦浪', model: 'GCI-50K-5G', ratedKw: 50, maxDcVoltage: 1100, mpptLow: 180, mpptHigh: 1000, mpptCount: 4, stringsPerMppt: 2, maxInputCurrent: 32, euroEfficiency: 0.981 },
  { id: 'inv-25', manufacturer: '固德威', model: 'GW25K-HT', ratedKw: 25, maxDcVoltage: 1000, mpptLow: 200, mpptHigh: 950, mpptCount: 3, stringsPerMppt: 2, maxInputCurrent: 26, euroEfficiency: 0.979 },
];

export const seedOptimizers: OptimizerModel[] = [
  { id: 'op-600', manufacturer: '华为', model: 'Smart PV Optimizer 600W', kind: '优化器', ratedW: 600, priceYuan: 180 },
  { id: 'sd-450', manufacturer: 'Tigo', model: 'TS4-A-F 关断器', kind: '关断器', ratedW: 450, priceYuan: 120 },
];
