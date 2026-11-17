"""P40-16O source-only audit of formal ERP writer entrypoints (NEVER imports JS).

Usage: python .p40-16o-tests/audit_writers.py --root . --output /tmp/p40o-audit.json
Read-only. Lexical inventory is NOT a proof of complete call-graph coverage.
An unreviewed network writer or missing explicitly documented anchor FAILS CI.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import re
import sys

# Explicitly reviewed HTTP modules. Auth API methods mutate AUTH only,
# while employee-shell calls a named read-projection RPC via POST.
ALLOWED_FETCH_FILES={
    "assets/js/auth-gate.js",
    "assets/js/cloud-sync.js",
    "assets/js/employee-shell.js",
}
ALLOWED_REST_FILES=ALLOWED_FETCH_FILES
SOURCE_FILES={
    "assets/js/cloud-sync.js",
    "assets/js/erp-store.js",
    "assets/js/auth-gate.js",
    "assets/js/employee-shell.js",
    "assets/js/settings.js",
    "assets/js/recovery.js",
    "assets/js/legacy-adapter.js",
    "assets/js/app.js",
}
PATTERNS={
    "fetch":re.compile(r"\bfetch\s*\("),
    "xhr":re.compile(r"\b(?:XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\("),
    "rest":re.compile(r"/rest/v1/"),
    "rpc":re.compile(r"/rest/v1/rpc/"),
    "indexeddb_open":re.compile(r"\bindexedDB\.open\s*\("),
    "local_write":re.compile(r"\b(?:window\.)?localStorage\.(?:setItem|removeItem|clear)\s*\("),
    "session_write":re.compile(r"\b(?:window\.)?sessionStorage\.(?:setItem|removeItem|clear)\s*\("),
    "raw_idb_write":re.compile(r"(?:\.put|\.delete|\.clear|\.add|dbSet|dbDelete|dbReplaceStateCas)\s*\("),
}
# These are exact code anchors in the formal GitHub main source, not
# assumptions that same name in an untrusted later commit is safe.
# Do not silently update this set upon changes; manual classification required.
ANCHORS={
 "assets/js/cloud-sync.js":{
  "remote_get":("function remotePath(userId)", "REMOTE_READ"),
  "raw_request":("async function request(path, auth, options = {})", "NETWORK_BROKER"),
  "cas_rpc":("'/rest/v1/rpc/erp_state_cas_write_v2'", "REMOTE_JSONB_WRITE"),
  "cas_operation":("async function casWrite(auth, expectedSyncVersion, data, options = {})", "REMOTE_JSONB_WRITE"),
  "temporary_write":("async function commitTemporarySnapshot(value,context={})", "REMOTE_JSONB_WRITE"),
  "trusted_priority_write":("async function trustedPriorityUseLocalOperation()", "REMOTE_JSONB_WRITE"),
  "manual_upload":("async function uploadOperation()", "REMOTE_JSONB_WRITE"),
  "auto_write":("async function autoBackupOperation()", "REMOTE_JSONB_WRITE"),
  "restore_local":("async function restoreOperation(allowLocalNewer = false, allowTrustedPriority = false)", "LOCAL_RESTORE"),
  "auto_apply_local":("async function safeApplyOperation(lifecycleGuard = () => true)", "LOCAL_RESTORE"),
  "pending_fence":("async function recoverPendingApplyFence(generation)", "LOCAL_RECOVERY"),
 },
 "assets/js/erp-store.js":{
  "idb_open":("indexedDB.open(DB_NAME, 1)", "LOCAL_STORE"),
  "idb_put":("objectStore(DB_STORE).put(value, key)", "LOCAL_STORE"),
  "idb_state_cas":("async function commitStoreDraft(checkpoint,draft,transaction)", "LOCAL_MUTATION_CORE"),
  "persist_wrapper":("function persist(action, auditDetails = null)", "LOCAL_MUTATION_CORE"),
  "receipt_rollback":("async function restoreReceiptMutation(checkpoint, primaryError, operationId)", "LOCAL_ROLLBACK"),
  "payable_delete_fallback":("async function deletePayable(payableId)", "FINANCE_LOCAL_ROLLBACK"),
  "salary_delete_fallback":("async function deleteSalaryPayment(id)", "FINANCE_LOCAL_ROLLBACK"),
  "project_merge_fallback":("async function projectMergeRestore(snapshot)", "FINANCE_LOCAL_ROLLBACK"),
  "emergency_heal":("async function repairEmergencyMirrorForRemoteApply()", "LOCAL_REPAIR"),
  "remote_apply":("async function applyRemoteSnapshot(value, options = {})", "LOCAL_RESTORE"),
  "remote_replace":("async function replaceSnapshot(value,confirmation={})", "LOCAL_RESTORE"),
  "controlled_recovery":("async function recoverStore(confirmation={})", "LOCAL_RECOVERY"),
  "invoice_mutation":("async function saveInvoice(values,id='')", "FINANCE_MUTATION"),
  "project_merge":("async function mergeProject(sourceProjectId,targetProjectId,confirmation)", "FINANCE_MUTATION"),
 },
 "assets/js/recovery.js":{
  "user_recovery_ui":("window.KuSheERPStore.recoverStore(", "LOCAL_RECOVERY_ENTRY"),
 },
 "assets/js/settings.js":{
  "safe_backup_export":("function safeBackupSnapshot(value)", "BACKUP_EXPORT"),
  "backup_download":("URL.createObjectURL(blob)", "BACKUP_EXPORT"),
  "settings_save":("store.saveSystemSettings(values)", "LOCAL_MUTATION_ENTRY"),
 },
 "assets/js/auth-gate.js":{
  "auth_broker":("async function requestJson(path, options = {})", "AUTH_ONLY_NETWORK"),
  "membership_read":("'/rest/v1/company_members?select=", "AUTH_READ"),
  "company_read":("'/rest/v1/companies?select=", "AUTH_READ"),
  "company_state_read":("'/rest/v1/erp_company_states?select=", "AUTH_READ"),
 },
 "assets/js/employee-shell.js":{
  "employee_projection":("'/rest/v1/rpc/employee_erp_read_projection'", "READ_ONLY_RPC"),
 },
 "assets/js/legacy-adapter.js":{
  "legacy_emergency_reader":("function readLocal()", "LOCAL_READ"),
 },
 "assets/js/app.js":{
  "cloud_start":("window.KusheCloudSync?.startAutoBackup?.()", "REMOTE_WRITE_TRIGGER"),
 },
}
DATA_API_WRITER="erp_state_cas_write_v2"


def read_code(root, paths=None):
    root=Path(root)
    if paths is None:
        files=sorted(p for p in (root/"assets"/"js").rglob("*.js")
                     if not p.name.endswith(".min.js"))
        paths=[p.relative_to(root).as_posix() for p in files]
    return {path:(root/path).read_text(encoding="utf-8") for path in paths}


def classify(root, sources=None):
    all_sources=sources if sources is not None else read_code(root)
    missing_sources=sorted(SOURCE_FILES-set(all_sources))
    errors=[f"MISSING_SOURCE:{p}" for p in missing_sources]
    rows=[]
    for path,code in sorted(all_sources.items()):
        for n,line in enumerate(code.splitlines(),1):
            for kind,pattern in PATTERNS.items():
                # A lexical hit is a candidate, not an executed network call.
                # Each candidate is still counted, including comments/strings.
                if pattern.search(line):
                    rows.append({"path":path,"line":n,"kind":kind})
                    if kind=="fetch" and path not in ALLOWED_FETCH_FILES:
                        errors.append(f"UNREVIEWED_FETCH:{path}:{n}")
                    if kind=="rest" and path not in ALLOWED_REST_FILES:
                        errors.append(f"UNREVIEWED_REST:{path}:{n}")
                    if kind=="xhr":
                        errors.append(f"UNREVIEWED_NETWORK_API:{path}:{n}")
    anchors=[]
    for path,anchors_map in ANCHORS.items():
        code=all_sources.get(path,"")
        for label,(needle,kind) in anchors_map.items():
            hits=[i for i,line in enumerate(code.splitlines(),1) if needle in line]
            if len(hits)!=1:
                errors.append(f"ANCHOR_{'ABSENT' if not hits else 'AMBIGUOUS'}:{path}:{label}:{len(hits)}")
            else:
                anchors.append({"path":path,"line":hits[0],"kind":kind,"label":label})
    cloud=all_sources.get("assets/js/cloud-sync.js","")
    store=all_sources.get("assets/js/erp-store.js","")
    if cloud.count("'/rest/v1/rpc/"+DATA_API_WRITER+"'")!=1:
        errors.append("CAS_RPC_UNEXPECTED_CARDINALITY")
    if "expected_sync_version: expected, new_data: data, writer_mode: writerMode" not in cloud:
        errors.append("CAS_REQUEST_CONTRACT_CHANGED")
    # Adding a ledger_version in formal CloudSync is a material architecture
    # change and MUST receive manual review, never auto-whitelisted by CI.
    if re.search(r"ledger[_A-Za-z]*version|ledgerVersion",cloud,re.I):
        errors.append("NEW_LEDGER_FENCE_MUST_BE_REVIEWED")
    if "return `/rest/v1/erp_states?select=" not in cloud:
        errors.append("LEGACY_ERP_STATES_READ_REMOVED_OR_CHANGED")
    if "async function commitStoreDraft" not in store:
        errors.append("LOCAL_STORE_TRANSACTION_CHANGED")
    if "async function recoverStore(confirmation={})" not in store:
        errors.append("CONTROLLED_RECOVERY_CHANGED")
    # A nonempty business write in a new JS module must be surfaced to review,
    # not silently marked safe. This catches new direct API writers.
    sink_files={r["path"] for r in rows if r["kind"] in ("fetch","rest")}
    summary=Counter(r["kind"] for r in rows)
    return {
      "schema":"p40-16o-main-source-write-entrypoints-v1",
      "scope":"source-only; no execution and no real data accessed",
      "scanned_js_files":len(all_sources),
      "source_paths":sorted(all_sources),
      "counts":dict(sorted(summary.items())),
      "network_source_files":sorted(sink_files),
      "anchors":sorted(anchors,key=lambda x:(x["path"],x["line"])),
      "lexical_hits":rows,
      "production_posting_safe":False,
      "formal_erp_ledger_version_integrated":False,
      "requires_manual_review":True,
      "errors":sorted(set(errors)),
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--root",default=".")
    p.add_argument("--output",default="")
    p.add_argument("--strict",action="store_true")
    args=p.parse_args()
    result=classify(args.root)
    text=json.dumps(result,indent=2,ensure_ascii=False,sort_keys=True)
    if args.output:
        Path(args.output).write_text(text+"\n",encoding="utf-8")
    print("P40-16O scanned JS:",result["scanned_js_files"])
    print("Network source files:",", ".join(result["network_source_files"]))
    print("Lexical count by kind:",result["counts"])
    print("Anchored critical entrypoints:",len(result["anchors"]))
    print("Audit warnings/errors:",json.dumps(result["errors"],ensure_ascii=False))
    print("FINANCIAL POSTING IS NOT CLEARED")
    if args.strict and result["errors"]:return 1
    return 0

if __name__=="__main__":sys.exit(main())
