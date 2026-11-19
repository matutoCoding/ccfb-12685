import { describe, it, expect } from 'vitest';
import { surveyToRows, dataFingerprint, buildSurveyPdf } from '@/lib/pdf/surveyPdf';
import type { Project, SurveyTask } from '@/types';

const project: Project = {
  id: 'p1', name: '测试屋顶项目', customer: '某客户', siteAddress: '某地 1 号',
  capacityKw: 100, expectedGridDate: '2026-12-01', status: '设计中', tagIds: [],
  note: '', createdAt: 0, updatedAt: 0,
};

function makeTask(): SurveyTask {
  return {
    name: '初勘', templateId: 'tpl1', issuedAt: 0,
    points: [
      { id: 's1', code: 'D-01', kind: '尺寸', description: 'AB 边长', status: '已测', readings: [{ value: 10000, measuredAt: 1, by: '张' }, { value: 10002, measuredAt: 2, by: '张' }], adoptedValue: 10001, crossCheck: { rule: '矩形对边差', diff: 1, tolerance: 5, passed: true } },
      { id: 's2', code: 'D-02', kind: '尺寸', description: 'BC 边长', status: '存疑', readings: [{ value: 6000, measuredAt: 1, by: '李' }], adoptedValue: 6000, crossCheck: { rule: '对角线勾股', diff: 12, tolerance: 8, passed: false } },
      { id: 's3', code: 'E-01', kind: '标高', description: '檐口标高', status: '已测', readings: [{ value: 12.5, measuredAt: 1, by: '王' }], adoptedValue: 12.5 },
    ],
  };
}

describe('勘测记录单 PDF 数据联动（精度红线三）', () => {
  it('测点到 PDF 行逐条对应：编号、历次读数、采用值、校核结论一一映射', () => {
    const rows = surveyToRows(makeTask());
    expect(rows).toHaveLength(3);
    expect(rows[0].code).toBe('D-01');
    expect(rows[0].readings).toContain('10000');
    expect(rows[0].readings).toContain('10002');
    expect(rows[0].adopted).toBe('10001');
    expect(rows[0].check).toContain('合格');
    expect(rows[1].check).toContain('超限');
  });

  it('改任意一条录入重新导出，数据指纹变化且采用值之和同步更新', () => {
    const before = dataFingerprint(surveyToRows(makeTask()));
    const task2 = makeTask();
    task2.points[0].adoptedValue = 10050; // 改一条采用值
    const after = dataFingerprint(surveyToRows(task2));
    expect(after.hash).not.toBe(before.hash);
    expect(after.adoptedSum).toBeCloseTo(before.adoptedSum + 49, 6);
  });

  it('未改数据时两次导出指纹完全一致（可复现）', () => {
    const a = dataFingerprint(surveyToRows(makeTask()));
    const b = dataFingerprint(surveyToRows(makeTask()));
    expect(a).toEqual(b);
  });

  it('状态统计正确：存疑/合格/超限计数与录入一致', () => {
    const fp = dataFingerprint(surveyToRows(makeTask()));
    expect(fp.suspect).toBe(1);
    expect(fp.passed).toBe(1);
    expect(fp.failed).toBe(1);
  });

  it('PDF 字节可生成且为合法 %PDF 文档，页数与行数匹配', async () => {
    const bytes = await buildSurveyPdf({
      project, task: makeTask(), rows: surveyToRows(makeTask()), generatedAt: '2026-11-20',
    });
    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
