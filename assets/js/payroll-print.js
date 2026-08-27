(function () {
  'use strict';

  const number = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const text = (value) => String(value ?? '').trim();
  const safeFile = (value) => text(value)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '');
  const taipeiDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  const internalOnlyWorkText = new Set([
    '點工／出勤', '每日點工', '同日案場施工', '同日施工案場',
    '由請款單直接新增日薪點工', '由請款單', '直接新增日薪點工',
    '自動新增', '自動彙整', '系統自動建立', 'ERP'
  ]);
  const internalWorkPrefixes = [
    '由請款單直接新增日薪點工', '直接新增日薪點工', '由請款單',
    '每日點工：', '每日點工:'
  ];
  const internalIdentifier = /^(?:sourceId|sourceNo|attendanceId|billingId)\s*[:：=].*$/i;
  const sameDayProjectSegment = /^(?:同日施工案場|同日案場施工)\s*[:：]?\s*(.*)$/;

  function sameDayProjectNames(value) {
    const match = text(value).match(sameDayProjectSegment);
    if (!match) return null;
    return text(match[1]).replace(/^[：:\s\-–—]+/, '').split(/[、，,／/]/).map(text).filter(Boolean);
  }

  function stripInternalWorkText(value) {
    const parts = text(value).replace(/\r?\n/g, '｜').split(/[｜|]/).map(text);
    const internalProjectNames = new Set(parts.flatMap((part) => sameDayProjectNames(part) || []));
    return parts.map((part) => {
      if (sameDayProjectNames(part) !== null) return '';
      let visible = text(part);
      let changed = true;
      while (visible && changed) {
        changed = false;
        for (const prefix of internalWorkPrefixes) {
          if (!visible.startsWith(prefix)) continue;
          visible = text(visible.slice(prefix.length)).replace(/^[：:\s-]+/, '');
          changed = true;
          break;
        }
      }
      if (!visible || internalOnlyWorkText.has(visible) || internalProjectNames.has(visible) || internalIdentifier.test(visible)) return '';
      return visible;
    }).filter(Boolean).join('｜');
  }

  function employeeVisibleWorkContent(source) {
    return stripInternalWorkText(source?.content) || '現場施工';
  }

  function meaningfulProject(value) {
    const project = text(value);
    return project && project !== '—' && project !== '未指定案場' ? project : '';
  }

  function isWorkSalarySource(source) {
    const type = text(source?.type);
    if (type === '點工' || type === '出勤') return true;
    return type === '加班'
      && text(source?.sourceType) !== 'payroll-adjustment'
      && Boolean(text(source?.date) && meaningfulProject(source?.projectName) && text(source?.quantityLabel));
  }

  function otherItemLabel(source) {
    const type = text(source?.type);
    if (type === '抽成') return '業績抽成';
    return type || '其他薪資';
  }

  function otherDescription(source) {
    const type = text(source?.type);
    const project = meaningfulProject(source?.projectName);
    if (type === '抽成') return project || '—';
    const visible = stripInternalWorkText(source?.content);
    if (visible && visible !== type && visible !== otherItemLabel(source)) return visible;
    if (type === '油費' && project) return project;
    return '—';
  }

  function buildView(group) {
    if (!group) return null;
    const employeeName = text(group.employeeName) || '未命名員工';
    const month = text(group.month);
    const nonZeroSources = (Array.isArray(group.sources) ? group.sources : [])
      .filter((row) => number(row?.amount) !== 0);
    const workSources = nonZeroSources.filter(isWorkSalarySource).map((row) => ({
      date: text(row.date),
      projectName: meaningfulProject(row.projectName) || '—',
      content: text(row.type) === '加班' ? (stripInternalWorkText(row.content) || '加班') : employeeVisibleWorkContent(row),
      quantityLabel: text(row.quantityLabel),
      amount: number(row.amount)
    }));
    const otherSources = nonZeroSources.filter((row) => !isWorkSalarySource(row)).map((row) => ({
      item: otherItemLabel(row),
      description: otherDescription(row),
      direction: number(row.amount) < 0 ? '扣項' : '加項',
      amount: number(row.amount)
    }));
    const workSalary = workSources.reduce((sum, row) => sum + number(row.amount), 0);
    const otherAddition = otherSources.filter((row) => row.amount > 0).reduce((sum, row) => sum + row.amount, 0);
    const otherDeduction = Math.abs(otherSources.filter((row) => row.amount < 0).reduce((sum, row) => sum + row.amount, 0));
    const total = Math.max(0, number(group.total));
    return {
      title: '薪資單',
      companyName: '酷舍企業有限公司',
      employeeName,
      month,
      generatedDate: taipeiDate(),
      workSources,
      otherSources,
      workSalary,
      otherAddition,
      otherDeduction,
      totalDiff: workSalary + otherAddition - otherDeduction - total,
      total,
      fileName: `${safeFile(`酷舍_薪資單_${employeeName}_${month}`)}.pdf`
    };
  }

  function openView(group, autoPrint) {
    const view = buildView(group);
    if (!view) return;
    const payload = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(view)))));
    const url = new URL(`payroll-print.html?v=20260827-payroll-employee2&print=${autoPrint ? '1' : '0'}`, location.href);
    url.hash = payload;
    location.assign(url.href);
  }

  window.KushePayrollPrint = {
    open(group) { openView(group, false); },
    export(group) { openView(group, true); },
    print(group) { openView(group, false); },
    buildView,
    employeeVisibleWorkContent
  };
}());
