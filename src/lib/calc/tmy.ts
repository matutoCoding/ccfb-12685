// 典型气象年 CSV 解析（本地处理，不依赖外部服务）
import type { TmyDataset, TmyRecord } from '@/types';

export interface CsvParseResult {
  data: TmyDataset;
  warnings: string[];
}

/**
 * 支持列名（中英文，表头可含单位）：
 * month/day/hour, GHI(总辐射), DHI(散射), temp(温度), wind(风速)
 * 也支持单列 timestamp(ISO) 自动拆月日时。
 */
export function parseTmyCsv(text: string, locationName: string, lat: number, lon: number): CsvParseResult {
  const warnings: string[] = [];
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV 至少需要表头和一行数据');
  const header = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const col = (names: string[]) => header.findIndex(h => names.some(n => h.includes(n)));

  const iMonth = col(['month', '月']);
  const iDay = col(['day', '日']);
  const iHour = col(['hour', '时']);
  const iGhi = col(['ghi', '总辐射', '水平面总']);
  const iDhi = col(['dhi', '散射']);
  const iTemp = col(['temp', '温度', '气温']);
  const iWind = col(['wind', '风速']);
  const iTs = col(['timestamp', 'time', '时间']);

  if (iGhi < 0 || iTemp < 0) throw new Error('CSV 缺少必需列：总辐射(GHI) 与 温度(temp)');

  const records: TmyRecord[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = splitCsvLine(lines[li]);
    let month = +cells[iMonth], day = +cells[iDay], hour = +cells[iHour];
    if (iTs >= 0 && cells[iTs]) {
      const d = new Date(cells[iTs]);
      if (!isNaN(d.getTime())) { month = d.getMonth() + 1; day = d.getDate(); hour = d.getHours(); }
    }
    const ghi = num(cells[iGhi]);
    const rec: TmyRecord = {
      month: clampInt(month, 1, 12), day: clampInt(day, 1, 31), hour: clampInt(hour, 0, 23),
      ghi,
      dhi: iDhi >= 0 ? num(cells[iDhi]) : ghi * 0.2,
      tempC: num(cells[iTemp]),
      windMs: iWind >= 0 ? num(cells[iWind]) : 0,
    };
    if (rec.ghi < 0 || rec.tempC < -60 || rec.tempC > 70) {
      warnings.push(`第 ${li} 行数据越界已跳过`);
      continue;
    }
    records.push(rec);
  }
  if (records.length < 100) warnings.push(`有效记录仅 ${records.length} 条，典型气象年通常应含 8760 条逐时数据`);
  return { data: { locationName, lat, lon, records }, warnings };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQuote = false;
  for (const ch of line) {
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ',' && !inQuote) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
function num(s: string | undefined): number { const v = parseFloat((s ?? '').trim()); return isNaN(v) ? 0 : v; }
function clampInt(v: number, lo: number, hi: number): number {
  if (isNaN(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
