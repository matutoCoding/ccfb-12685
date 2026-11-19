// 光伏工程设计与交付管理系统 —— 领域模型类型定义

export type ID = string;

export type ProjectStatus = '前期' | '勘测中' | '设计中' | '待评审' | '施工中' | '已并网' | '搁置';

export interface Tag {
  id: ID;
  name: string;
  color: string; // 十六进制颜色
}

export interface Project {
  id: ID;
  name: string;
  customer: string;        // 客户名（分组键）
  siteAddress: string;     // 屋顶地址（分组键）
  capacityKw: number;      // 装机容量 kWp
  expectedGridDate: string;// 预计并网日期 ISO
  status: ProjectStatus;
  tagIds: ID[];
  note: string;
  createdAt: number;
  updatedAt: number;
  // 子数据（同一 IndexedDB 库内按 projectId 关联）
  roof?: RoofModel;
  survey?: SurveyTask;
  schemes?: Scheme[];
  baselineSchemeId?: ID;
  tmy?: TmyDataset;
  finance?: FinanceConfig;
}

// ---------- 屋面 / 导线法 ----------

export interface TraverseLeg {
  id: ID;
  from: string;            // 起点点名
  to: string;              // 终点点名
  length: number;          // 实测边长 m
  turnAngleDeg: number;    // 转折角（水平角，度），导线前进方向左角
}

export interface RoofPoint {
  id: ID;
  name: string;
  x: number;               // 平面坐标 m（平差后）
  y: number;
  z: number;               // 标高 m
  fixed?: boolean;         // 人工锁定，不参与平差
}

export interface TraverseResult {
  points: RoofPoint[];                 // 平差后角点
  rawPoints: RoofPoint[];              // 未平差角点
  closureFx: number;                   // x 闭合差 m
  closureFy: number;
  closureF: number;                    // 总闭合差 m
  closureRatio: number;                // 相对闭合差 1/N
  perimeter: number;                   // 导线总长 m
  tolerance: number;                   // 容许闭合差 m（按等级系数）
  passed: boolean;
  suspiciousLegId?: ID;                // 最可疑边
  area2d: number;                      // 平差后水平投影面积 m²
  rawArea2d: number;
  corrections: Record<ID, { dx: number; dy: number }>; // 每点改正数
}

export interface RoofPlane {
  id: ID;
  name: string;
  pointIds: ID[];         // 平面边界角点（有序）
  slopeDeg: number;       // 坡度 度
  azimuthDeg: number;     // 坡向（坡面法线水平投影方位角，北=0，顺时针）
  eaveElev: number;       // 檐口标高 m
  color: string;
  area3d?: number;        // 坡面面积 m²（自动计算）
  slopeLength?: number;   // 坡长 m
  ridgeIds?: ID[];        // 推算出的屋脊/天沟线（点 id 对）
}

export type ZoneType = '承重分区' | '防水分区';

export interface RoofZone {
  id: ID;
  name: string;
  type: ZoneType;
  pointIds: ID[];          // 多边形（角点或图上取点）
  allowLoadKpa?: number;   // 允许荷载 kPa（承重分区）
  membraneLifeYears?: number; // 防水层年限（防水分区）
}

export interface ExistingEquipment {
  id: ID;
  name: string;
  kind: string;            // 风机基础/空调/排烟设备/天窗...
  footprint: { x: number; y: number }[]; // 平面多边形
  footprintArea: number;
}

export interface RoofModel {
  traverse: TraverseLeg[];
  firstBearingDeg: number; // 起始边方位角
  toleranceCoeff: number;  // 容许闭合差系数 K（限差 = K * sqrt(周长) 或 K*周长，按设置）
  result?: TraverseResult;
  planes: RoofPlane[];
  zones: RoofZone[];
  equipment: ExistingEquipment[];
  usableArea?: number;     // 可利用面积
  grossArea?: number;
  overrides?: Record<ID, { x: number; y: number }>; // 角点坐标手工微调
}

// ---------- 支架 / 配重 ----------

export type MountingType = '配重式' | '锚固式';

export interface BallastConfig {
  basicWindPressure: number; // 基本风压 kN/m²
  roofHeight: number;        // 屋面高度 m
  gustFactor: number;        // 阵风系数 βgz
  shapeFactor: number;       // 风荷载体型系数 μs（吸力，正值输入）
  heightFactor: number;      // 风压高度变化系数 μz
  blockWeight: number;       // 单块配重重量 kg
  parapetZoneWidth: number;  // 女儿墙风吸力衰减区宽度 m
  parapetDensify: number;    // 衰减区间距折减系数
}

export interface BallastBlock {
  id: ID;
  rowIndex: number;
  position: { x: number; y: number; z: number };
  weightKg: number;
  inParapetZone: boolean;
}

export interface MountingDesign {
  type: MountingType;
  tiltDeg: number;
  rowSpacing: number;       // 排距 m
  railSpec: string;         // 导轨规格
  railLengthM: number;      // 导轨延米
  railCount: number;
  clampCount: number;       // 夹具件数
  windClampCount: number;   // 抗风夹具数（防水分区内强制）
  rows: { index: number; x: number; y: number; modules: number; requiredBallastKg: number; blocks: BallastBlock[] }[];
  totalBallastKg: number;
  formulaTrace: string[];   // 公式手算复核痕迹
  boq: BoqItem[];
}

// ---------- 设备库 ----------

export interface PvModuleModel {
  id: ID;
  manufacturer: string;
  model: string;
  powerW: number;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  weightKg: number;
  voc: number;             // 开路电压 V
  isc: number;             // 短路电流 A
  vmp: number;
  imp: number;
  vocTempCoeff: number;    // %/°C（负值）
  iscTempCoeff: number;    // %/°C
  noct: number;            // 电池标称工作温度 °C
  nCells: number;          // 电池片数
  nSubstrings: number;     // 旁路二极管分段数
  discontinued?: boolean;
}

export interface InverterModel {
  id: ID;
  manufacturer: string;
  model: string;
  ratedKw: number;
  maxDcVoltage: number;    // 最大直流电压
  mpptLow: number;         // MPPT 窗口下限
  mpptHigh: number;
  mpptCount: number;       // MPPT 路数
  stringsPerMppt: number;  // 每路挂接串数上限
  maxInputCurrent: number; // 每路最大输入电流 A
  euroEfficiency: number;  // 欧洲效率 0-1
  discontinued?: boolean;
}

export interface OptimizerModel {
  id: ID;
  manufacturer: string;
  model: string;
  kind: '优化器' | '关断器';
  ratedW: number;
  priceYuan: number;
}

export interface ModuleBatch {
  id: ID;
  name: string;
  moduleModelId: ID;
  yearOneDegradation: number; // 首年衰减
  annualDegradation: number;  // 逐年衰减
}

// ---------- 方案 / 组串 ----------

export interface PvString {
  id: ID;
  mpptIndex: number;        // 接入的 MPPT 路号（-1 未分配）
  moduleIds: ID[];          // 串内组件（带遮挡/失效仿真属性的实例）
  batchId?: ID;
}

export interface PlacedModule {
  id: ID;
  modelId: ID;
  batchId?: ID;
  position: { x: number; y: number; z: number };
  rotationDeg: number;
  shading: number;          // 遮挡比例 0-1
  failureRate: number;      // 失效率 0-1
  planeId?: ID;
}

export interface Scheme {
  id: ID;
  name: string;
  moduleModelId: ID;
  inverterModelId: ID;
  moduleCount: number;
  inverterCount: number;
  capacityKw: number;
  oversizeRatio: number;    // 超配率
  voltageMargin: number;    // 直流侧电压裕度 %
  strings: PvString[];
  modules: PlacedModule[];
  isBaseline: boolean;
  // 对比指标
  annualEnergyKwh?: number;
  initialInvestment?: number;
  lcoe?: number;
  createdAt: number;
}

// ---------- 仿真 ----------

export interface IvPoint { v: number; i: number; p: number; }

export interface MpptRun {
  algorithm: '全局扫描' | '扰动观察(单起点)' | '扰动观察(多起点)';
  vmpp: number;
  impp: number;
  pmpp: number;
  lockedLowPeak: boolean;
  lossVsGlobalW: number;
  deviationPct: number;     // 与全局 GMPP 偏差
}

export interface SimulationResult {
  ivCurve: IvPoint[];
  globalMpp: IvPoint;
  mpptRuns: MpptRun[];
  mismatchLossW: number;       // 混接错配损失
  mismatchLossRefW: number;    // 同朝向参考
  withOptimizer?: { curve: IvPoint[]; mpp: IvPoint; gainKwh: number; paybackYears: number; worthIt: boolean };
}

// ---------- 典型气象年 / 逐时 ----------

export interface TmyRecord {
  month: number; day: number; hour: number;
  ghi: number;  // 总辐射 W/m²
  dhi: number;  // 散射
  tempC: number;
  windMs: number;
}

export interface TmyDataset {
  locationName: string;
  lat: number; lon: number;
  records: TmyRecord[];
}

export interface EnergyLossItem { name: string; kwh: number; pct: number; }

export interface MonthlyEnergy { month: number; kwh: number; equivHours: number; curtailHours: number; }

export interface EnergyResult {
  grossKwh: number;
  netKwh: number;
  losses: EnergyLossItem[];
  monthly: MonthlyEnergy[];
  yearly25: { year: number; kwh: number }[];
  cleaningAdvice: { intervalDays: number; costYuan: number; recoveredKwh: number; recoveredValueYuan: number };
}

// ---------- 电气校验 ----------

export interface ElectricalCheck {
  vocCold: number;
  maxDcVoltage: number;
  overVoltage: boolean;
  underVoltage: boolean;
  suggestedStringSize: { min: number; max: number };
  cableSpec: string;
  cableLengthM: number;
  voltageDropPct: number;
  ampacityA: number;
  currentA: number;
  lengthWarning: boolean;
}

// ---------- 收益 ----------

export interface TariffPeriod { name: '峰' | '平' | '谷'; price: number; hours: number; }

export interface FinanceConfig {
  selfUseRatio: number;             // 自发自用比例
  feedInTariff: number;             // 余电上网电价
  tariffs: TariffPeriod[];          // 分时电价
  initialInvestment: number;
  annualOpex: number;
  discountRate: number;
}

export interface FinanceResult {
  annualRevenue: number;
  staticPaybackYears: number;
  irr: number;
  npv: number;
  sensitivity: { changePct: number; payback: number }[];
}

// ---------- 勘测任务 ----------

export type SurveyPointStatus = '待测' | '已测' | '存疑';

export interface SurveyReading { value: number; measuredAt: number; by: string; }

export interface SurveyPoint {
  id: ID;
  code: string;                 // 测点编号
  kind: '尺寸' | '标高' | '角度';
  description: string;
  status: SurveyPointStatus;
  readings: SurveyReading[];    // 多次重测全保留
  adoptedValue?: number;        // 最终采用值（人工指定）
  benchmarkId?: ID;             // 水准基准点（标高类）
  crossCheck?: { rule: string; diff: number; tolerance: number; passed: boolean };
}

export interface SurveyTask {
  name: string;
  points: SurveyPoint[];
  templateId: string;
  issuedAt: number;
}

// ---------- 物料清单 ----------

export interface BoqItem {
  id: ID;
  category: string;
  name: string;
  spec: string;
  unit: string;
  qty: number;
  unitPrice: number;
  source: string; // 来源（支架/电气/土建）
}

// ---------- 设置 ----------

export interface LossCoeffs {
  dust: number;       // 灰尘损耗
  cable: number;      // 线损
  mismatch: number;   // 组件失配
  inverter: number;   // 逆变器（默认，可被机型效率覆盖）
  temperature: number;// 温度损耗
  transformer: number;
  other: number;
}

export interface AppSettings {
  unit: '公制' | '英制';
  defaultLat: number;
  defaultLon: number;
  defaultCity: string;
  traverseToleranceK: number; // 导线闭合差系数
  lossCoeffs: LossCoeffs;
  defaultModuleParams: Partial<PvModuleModel>;
  defaultInverterParams: Partial<InverterModel>;
}
