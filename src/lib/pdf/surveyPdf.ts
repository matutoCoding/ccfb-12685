// 勘测记录单 PDF 生成：尺寸表与测点录入逐条联动，改任意录入重出全篇一致
// 全部本地生成（pdf-lib），不依赖外部服务
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import type { Project, SurveyPoint, SurveyTask } from '@/types';

// pdf-lib 标准 14 字体不含中文字形。允许从设置页注入 CJK 字体字节（如思源/Noto 子集），
// 未注入时用 WinAnsi 安全降级（中文转写为可读标识），保证任何环境都能出 PDF。
export interface PdfOptions {
  cjkFontBytes?: Uint8Array;
}

export interface PdfRow {
  code: string;
  description: string;
  kind: string;
  status: string;
  readings: string;   // 历次读数
  adopted: string;    // 采用值
  check: string;      // 校核结论
}

export interface PdfData {
  project: Project;
  task: SurveyTask;
  rows: PdfRow[];
  generatedAt: string;
}

export function surveyToRows(task: SurveyTask): PdfRow[] {
  return task.points.map(p => ({
    code: p.code,
    description: p.description,
    kind: p.kind,
    status: p.status,
    readings: p.readings.map((r, i) => `#${i + 1}:${r.value}`).join(' / ') || '—',
    adopted: p.adoptedValue != null ? String(p.adoptedValue) : '未指定',
    check: p.crossCheck ? `${p.crossCheck.rule} ${p.crossCheck.passed ? '合格' : '超限'}` : '—',
  }));
}

/** 生成勘测记录单 PDF 字节。data 由当前录入实时构造 → 天然保证全篇一致、可逐条对应。 */
export async function buildSurveyPdf(data: PdfData, opts: PdfOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  let cjk: PDFFont | null = null;
  if (opts.cjkFontBytes && opts.cjkFontBytes.length > 0) {
    try { cjk = await doc.embedFont(opts.cjkFontBytes, { subset: true }); } catch { cjk = null; }
  }
  let page = doc.addPage([595.28, 841.89]); // A4 纵向
  const margin = 40;
  let y = 800;

  const drawText = (text: string, x: number, yy: number, size = 10, bold = false, color = rgb(0, 0, 0)) => {
    // 含 CJK 且已注入字体时用 CJK 字体，否则 WinAnsi 降级
    const hasCjk = /[一-鿿]/.test(text);
    const useFont = hasCjk && cjk ? cjk : (bold ? fontBold : font);
    const safe = hasCjk && !cjk ? latinSafe(text) : text;
    page.drawText(safe, { x, y: yy, size, font: useFont, color });
  };
  const newPageIfNeeded = (needed: number) => {
    if (y - needed < margin + 20) {
      page = doc.addPage([595.28, 841.89]);
      y = 800;
    }
  };

  // 标题（中文用括号内英文键名兜底，保证任何阅读器不缺字）
  drawText('SURVEY RECORD / 勘测记录单', margin, y, 16, true);
  y -= 22;
  drawText(`Project: ${latinSafe(data.project.name)}  ID: ${data.project.id}`, margin, y, 10);
  y -= 16;
  drawText(`Customer: ${latinSafe(data.project.customer)}  Site: ${latinSafe(data.project.siteAddress)}`, margin, y, 10);
  y -= 16;
  drawText(`Generated: ${data.generatedAt}  Points: ${data.rows.length}`, margin, y, 10);
  y -= 20;

  // 表头
  const cols = [
    { key: 'code', label: 'Code / 编号', w: 55 },
    { key: 'description', label: 'Description / 描述', w: 110 },
    { key: 'kind', label: 'Type / 类型', w: 50 },
    { key: 'status', label: 'Status / 状态', w: 55 },
    { key: 'readings', label: 'Readings / 历次读数', w: 110 },
    { key: 'adopted', label: 'Adopted / 采用值', w: 60 },
    { key: 'check', label: 'Check / 校核', w: 75 },
  ];
  const tableWidth = cols.reduce((s, c) => s + c.w, 0);

  const drawRow = (row: PdfRow | null, yy: number, header = false) => {
    let x = margin;
    page.drawRectangle({
      x: margin, y: yy - 14, width: tableWidth, height: 18,
      color: header ? rgb(0.88, 0.92, 0.98) : rgb(1, 1, 1),
      borderColor: rgb(0.4, 0.4, 0.4), borderWidth: 0.5,
    });
    for (const c of cols) {
      const val = header ? c.label : String((row as PdfRow)[c.key as keyof PdfRow]);
      const isFail = !header && c.key === 'check' && val.includes('超限');
      drawText(truncate(val, c.w / 5.2), x + 3, yy - 10, 8.5, header,
        isFail ? rgb(0.8, 0, 0) : rgb(0, 0, 0));
      x += c.w;
    }
  };

  drawRow(null, y, true);
  y -= 18;
  for (const row of data.rows) {
    newPageIfNeeded(20);
    drawRow(row, y);
    y -= 18;
  }

  // 汇总区：逐条数据指纹（行数 + 采用值哈希），用于证明“改任意一条→全篇一致”
  y -= 12;
  newPageIfNeeded(60);
  drawText('Data Fingerprint / 数据指纹', margin, y, 11, true);
  y -= 16;
  const fp = dataFingerprint(data.rows);
  drawText(`Rows: ${data.rows.length}  Hash: ${fp.hash}  AdoptedSum: ${fp.adoptedSum.toFixed(2)}`, margin, y, 9);
  y -= 14;
  drawText(`Pending: ${fp.pending}  Suspect: ${fp.suspect}  Passed: ${fp.passed}  Failed: ${fp.failed}`, margin, y, 9);

  const bytes = await doc.save();
  return bytes;
}

/** 数据指纹：行数、采用值之和、状态统计、稳定字符串哈希（FNV-1a） */
export function dataFingerprint(rows: PdfRow[]): {
  hash: string; adoptedSum: number; pending: number; suspect: number; passed: number; failed: number;
} {
  let adoptedSum = 0, pending = 0, suspect = 0, passed = 0, failed = 0;
  let h = 0x811c9dc5;
  for (const r of rows) {
    const line = [r.code, r.readings, r.adopted, r.status, r.check].join('|');
    for (let i = 0; i < line.length; i++) {
      h ^= line.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    const v = parseFloat(r.adopted);
    if (!isNaN(v)) adoptedSum += v;
    if (r.adopted === '未指定') pending++;
    if (r.status === '存疑') suspect++;
    if (r.check.includes('合格')) passed++;
    if (r.check.includes('超限')) failed++;
  }
  return { hash: h.toString(16).padStart(8, '0'), adoptedSum, pending, suspect, passed, failed };
}

function latinSafe(s: string): string {
  // pdf-lib 标准字体仅支持 WinAnsi；中文保留但替换为可打印占位，避免编码抛错
  return s.replace(/[^\x00-\xFF]/g, ch => `[${ch.codePointAt(0)?.toString(16)}]`);
}
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime = 'application/pdf'): void {
  const blob = new Blob([bytes.slice().buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
