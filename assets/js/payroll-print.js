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

  function buildView(group) {
    if (!group) return null;
    const employeeName = text(group.employeeName) || '未命名員工';
    const month = text(group.month);
    const sources = (Array.isArray(group.sources) ? group.sources : [])
      .filter((row) => number(row?.amount) !== 0)
      .map((row) => ({
        date: text(row.date),
        type: text(row.type),
        projectName: text(row.projectName),
        content: text(row.content),
        quantityLabel: text(row.quantityLabel),
        rateLabel: text(row.rateLabel),
        amount: number(row.amount)
      }));
    const total = Math.max(0, number(group.total));
    return {
      title: '員工薪資單',
      companyName: '酷舍企業有限公司',
      employeeName,
      month,
      generatedDate: taipeiDate(),
      sources,
      total,
      fileName: `${safeFile(`酷舍_薪資單_${employeeName}_${month}`)}.pdf`
    };
  }

  function openView(group, autoPrint) {
    const view = buildView(group);
    if (!view) return;
    const payload = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(view)))));
    const url = new URL(`payroll-print.html?v=20260821-payroll-privacy1&print=${autoPrint ? '1' : '0'}`, location.href);
    url.hash = payload;
    location.assign(url.href);
  }

  window.KushePayrollPrint = {
    open(group) { openView(group, false); },
    export(group) { openView(group, true); },
    print(group) { openView(group, false); },
    buildView
  };
}());
