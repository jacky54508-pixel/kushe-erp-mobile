from pathlib import Path
import hashlib,json,re,shutil
root=Path('source');here=Path(__file__).parent
p=root/'assets/js/erp-store.js';s=p.read_text()
helper=r'''  // P29-3: an in-memory form guard only; never stored or backfilled into business records.
  function payrollAdjustmentSnapshot(reference) {
    const key=String(reference||''),record=(state.payroll||[]).find(row=>String(row.id)===key),divider=key.lastIndexOf('__');
    const employee=record?payrollEmployeeId(record):divider>0?key.slice(0,divider):'',month=record?String(record.month||''):divider>0?key.slice(divider+2):'';
    if(!employee||!/^\d{4}-\d{2}$/.test(month))return '';
    const belongs=row=>String(row.employee||row.employeeId||'')===employee&&monthOf(row.date||row.month)===month;
    const logs=(state.dailyLogs||[]).filter(belongs),logIds=new Set(logs.map(row=>String(row.id))),billingIds=new Set(logs.flatMap(row=>[row.billingId,...(row.items||[]).map(item=>item.billingId)]).filter(Boolean).map(String));
    const ordered=rows=>[...rows].sort((a,b)=>String(a.id||'').localeCompare(String(b.id||'')));
    return JSON.stringify({payroll:ordered(state.payroll.filter(row=>payrollEmployeeId(row)===employee&&String(row.month||'')===month)),attendance:ordered((state.attendance||[]).filter(belongs)),commissions:ordered((state.commissions||[]).filter(row=>belongs(row)||(row.sourceType==='daily-log'&&logIds.has(String(row.sourceId||''))))),dailyLogs:ordered(logs),billings:ordered((state.billings||[]).filter(row=>billingIds.has(String(row.id))))});
  }
'''
needle='  async function updatePayrollAdjustments(groupKey, values={}) {'
assert s.count(needle)==1;s=s.replace(needle,helper+needle)
needle="    requireStoreTransactionDraft();\n    const reference=String(groupKey||''),group=monthlyPayrollGroups()"
repl="    requireStoreTransactionDraft();\n    if(values.expectedAdjustmentSnapshot!==undefined&&values.expectedAdjustmentSnapshot!==payrollAdjustmentSnapshot(groupKey))throw new Error('此員工該月份的薪資或施工來源已更新；本次未儲存，請保留輸入並重新開啟核對。');\n    const reference=String(groupKey||''),group=monthlyPayrollGroups()"
assert s.count(needle)==1;s=s.replace(needle,repl)
needle="    for(const [projectId,rawBasis] of Object.entries(requestedBases)){\n      const basis=normalizeCommissionBasis(rawBasis)"
repl="    for(const [projectId,rawBasis] of Object.entries(requestedBases)){\n      if(!['preTax','taxIncluded'].includes(rawBasis))throw new Error('抽成計算基準無效，請重新選擇。');\n      const basis=normalizeCommissionBasis(rawBasis)"
assert s.count(needle)==1;s=s.replace(needle,repl)
needle="      if(!targets.length)continue;\n      if(targets.some((log)=>dailyLogCommissionSettlementLock(log).locked))"
repl="      if(!targets.length)continue;\n      // Cached clients may still send all selects. An unchanged basis is NOT a request to recalculate commission.\n      if(targets.every(log=>normalizeCommissionBasis(log.commissionBasis)===basis))continue;\n      if(targets.some((log)=>dailyLogCommissionSettlementLock(log).locked))"
assert s.count(needle)==1;s=s.replace(needle,repl)
needle='dailyLogCommissionSettlementLock, updatePayrollAdjustments, addSalaryPayment'
assert s.count(needle)==1;s=s.replace(needle,'dailyLogCommissionSettlementLock, payrollAdjustmentSnapshot, updatePayrollAdjustments, addSalaryPayment')
p.write_text(s)
p=root/'assets/js/payroll.js';s=p.read_text();start=s.index('  function adjustmentInputs(');end=s.index('  function projectCommissionBasisRows',start)
s=s[:start]+'''  function adjustmentInputs(fields,group){
    return fields.map(([name,label])=>`<label class="payroll-adjustment-field"><span>${label}</span><span class="payroll-adjustment-money"><i aria-hidden="true">$</i><input name="${name}" aria-label="${label}" type="number" inputmode="numeric" min="0" step="1" value="${store.num(group[name])}"></span></label>`).join('');
  }
'''+s[end:]
start=s.index('  function projectCommissionBasisSection');end=s.index('  function legacyPaymentForm',start)
s=s[:start]+(here/'p29-3-editor.txt').read_text()+s[end:];p.write_text(s)
shutil.copyfile(here/'p29-3-style.css',root/'assets/css/payroll-adjustments.css')
p=root/'index.html';s=p.read_text()
s,n=re.subn(r'(src="assets/js/erp-store\.js\?v=)[^"]+',r'\g<1>p29-3-payroll-adjustments-1',s);assert n==1
s,n=re.subn(r'(src="assets/js/payroll\.js\?v=)[^"]+',r'\g<1>p29-3-payroll-adjustments-1',s);assert n==1
assert s.count('</head>')==1;s=s.replace('</head>','  <link rel="stylesheet" href="assets/css/payroll-adjustments.css?v=p29-3-payroll-adjustments-1">\n</head>');p.write_text(s)
expected={'assets/js/erp-store.js':'35ffa5bc486413864c11e2e47d53352c98f40196cbcdb41857d7b09b644dd0b6','assets/js/payroll.js':'54bf93a3d3e25535b7c8ac95fac4abafcf9c8e3818ff032e3dc6e04d271bacb2','assets/css/payroll-adjustments.css':'d5151f5e998b9e138a4811791339267ec022259338769a947706463dbf5b68f8','index.html':'f239adb430e5bc2f6ff93c5a685ed669cbd868be779f042ca656a40e32a37cfb'}
actual={f:hashlib.sha256((root/f).read_bytes()).hexdigest() for f in expected}
print(json.dumps(actual,indent=2));assert actual==expected,'STOP: source must exactly match locally tested code'
Path('source-manifest.json').write_text(json.dumps(actual,indent=2))
