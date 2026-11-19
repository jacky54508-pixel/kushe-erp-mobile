#!/usr/bin/env bash
set -euo pipefail
# CI-ONLY against temporary Postgres database configured by workflow environment.
# Two fake *writer* transactions try to update one source/version concurrently.
base='00000000-0000-4000-8000-0000000000a2'
query="SET ROLE p40bj_writer; SELECT p40bj.commit_fake_snapshot('$base',1,1,data) FROM p40bj.snapshots WHERE document_id='$base';"
psql -X -q -v ON_ERROR_STOP=1 -c "$query" > /tmp/p40bj_race_one.out 2>&1 &
first=$!
psql -X -q -v ON_ERROR_STOP=1 -c "$query" > /tmp/p40bj_race_two.out 2>&1 &
second=$!
r1=0;r2=0
wait "$first" || r1=$?
wait "$second" || r2=$?
if [[ $r1 -eq 0 && $r2 -ne 0 ]] || [[ $r2 -eq 0 && $r1 -ne 0 ]]; then
  echo 'P40BJ_RACE_ONE_SUCCESS_ONE_CONFLICT'
else
  echo 'P40BJ_RACE_INVALID: both succeeded or both failed'
  cat /tmp/p40bj_race_one.out /tmp/p40bj_race_two.out
  exit 1
fi
psql -X -q -v ON_ERROR_STOP=1 -Atc "SELECT CASE WHEN d.revision=2 AND d.source_version=2 AND s.sync_version=2 AND d.status='pending_review' AND d.approved_revision=0 THEN 'P40BJ_RACE_POSTCONDITION_PASS' ELSE 'FAIL' END FROM p40bj.documents d JOIN p40bj.snapshots s ON s.document_id=d.id WHERE d.id='$base';" | grep -qx 'P40BJ_RACE_POSTCONDITION_PASS'
psql -X -q -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM p40bj.audit_events WHERE document_id='$base';" | grep -qx '1'
echo 'P40BJ_RACE_REVIEW_REQUIRED_AND_ONE_AUDIT_PASS'
