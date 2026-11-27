#!/usr/bin/env python3
"""Run isolated synthetic suites, preserving failures without changing old tests."""
import argparse
import hashlib
import json
import os
import socket
import subprocess
import sys
import time
import traceback
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--group', choices=('candidate', 'legacy'), required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    py = sys.executable
    tests = []
    results, errors, servers, handles = [], [], [], []
    baseline = output / 'k24-original-store.js'
    try:
        if args.group == 'candidate':
            for mode in ('baseline', 'candidate'):
                tests.append(('sync-contract-' + mode, ['node', '.p41-k29-tests/sync_contract.cjs', '--mode', mode, '--output', str(output / ('sync-contract-' + mode) / 'RESULT.json')]))
                tests.append(('sync-browser-' + mode, [py, '.p41-k29-tests/sync_browser.py', '--mode', mode, '--output', str(output / ('sync-browser-' + mode))]))
                tests.append(('commission-' + mode, [py, '.p41-k29-tests/commission_browser.py', '--mode', mode, '--output', str(output / ('commission-' + mode))]))
            tests.extend([
                ('receivables', [py, '.p41-k29-tests/receivables_ui.py', '--output', str(output / 'receivables')]),
                ('pdf', [py, '.p41-k29-tests/pdf_acceptance.py', '--output', str(output / 'pdf')]),
                ('k28-store', [py, '.p41-k28-tests/k28_browser_store.py', '--mode', 'candidate', '--store', 'assets/js/erp-store.js', '--output', str(output / 'k28-store')]),
                ('k28-ui', [py, '.p41-k28-tests/test_daily_ui.py', '--root', '.', '--store', 'assets/js/erp-store.js', '--output', str(output / 'k28-ui')]),
            ])
        else:
            baseline.write_bytes(subprocess.check_output(['git', 'cat-file', 'blob', '95773d5264d54fe1e1d1cfe54b37a2a2656a9fab'], cwd=root))
            candidate_hash = hashlib.sha256((root / 'assets/js/erp-store.js').read_bytes()).hexdigest()
            for port in (8774, 8784, 8795, 8796, 8797):
                handle = (output / ('http-' + str(port) + '.log')).open('w', encoding='utf-8')
                handles.append(handle)
                server = subprocess.Popen([py, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '--directory', str(root)], stdout=handle, stderr=subprocess.STDOUT)
                servers.append(server)
                deadline = time.monotonic() + 10
                while True:
                    if server.poll() is not None:
                        raise RuntimeError('Owned loopback server failed: ' + str(port))
                    try:
                        with socket.create_connection(('127.0.0.1', port), timeout=.2):
                            break
                    except OSError:
                        if time.monotonic() >= deadline:
                            raise RuntimeError('Owned loopback server not ready: ' + str(port))
                        time.sleep(.05)
            tests = [
                ('p33-4', [py, '.p39-inv1-tests/chrome_legacy.py', '.p33-4-tests/regression.py']),
                ('p34', [py, '.p39-inv1-tests/chrome_legacy.py', '.p34-tests/test.py']),
                ('p35-ui', [py, '.p39-inv1-tests/chrome_legacy.py', '.p35-tests/test_ui.py']),
                ('p36-auth', [py, '.p39-inv1-tests/chrome_legacy.py', '.p36-tests/test_permissions.py']),
                ('p39-inv1-store', [py, '.p39-inv1-tests/test_store.py']),
                ('k24-recovery', [py, '.p41-k24-tests/k24_browser_recovery.py', '--baseline-store', str(baseline), '--candidate-store', 'assets/js/erp-store.js', '--candidate-sha256', candidate_hash, '--evidence', '.p41-k24-tests/fixtures', '--output', str(output / 'k24-recovery')]),
                ('k25-review', [py, '.p41-k25-tests/k25_browser_review.py', '--root', '.', '--store', 'assets/js/erp-store.js', '--store-sha256', candidate_hash, '--output', str(output / 'k25-review')]),
                ('k27-projection', ['node', '.p41-k27-tests/test_backup_projection.cjs', '--root', '.']),
                ('k27-quote-route', [py, '.p41-k27-tests/test_quote_export_route.py', '--root', '.', '--output', str(output / 'k27-quote-route')]),
            ]
        for name, command in tests:
            started = time.monotonic()
            print('RUN ' + name, flush=True)
            try:
                result = subprocess.run(command, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace', timeout=600)
                log, code = result.stdout, result.returncode
            except subprocess.TimeoutExpired as error:
                log = error.stdout or ''
                if isinstance(log, bytes):
                    log = log.decode('utf-8', errors='replace')
                log += '\nTIMEOUT after 600 seconds\n'
                code = 124
            (output / (name + '.log')).write_text(log, encoding='utf-8')
            item = {'name': name, 'exitCode': code, 'passed': code == 0, 'seconds': round(time.monotonic() - started, 2), 'command': command}
            results.append(item)
            print(json.dumps(item, ensure_ascii=False), flush=True)
            if code:
                print('\n'.join(log.splitlines()[-24:]), flush=True)
    except Exception as error:
        errors.append({'type': type(error).__name__, 'message': str(error), 'traceback': traceback.format_exc()})
    finally:
        for server in servers:
            if server.poll() is None:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait(timeout=5)
        for handle in handles:
            handle.close()
        baseline.unlink(missing_ok=True)
        passed = bool(tests) and len(results) == len(tests) and all(item['passed'] for item in results) and not errors
        report = {'schema': 'k29-suite-runner-v1', 'group': args.group, 'status': 'PASS' if passed else 'BLOCKED', 'headCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(), 'tests': results, 'errors': errors, 'productionDataTouched': False, 'publishGate': 'BLOCKED'}
        (output / 'SUITE_RESULT.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'group': args.group, 'status': report['status'], 'passedSuites': sum(item['passed'] for item in results), 'totalSuites': len(tests), 'errors': errors}, ensure_ascii=False), flush=True)
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
