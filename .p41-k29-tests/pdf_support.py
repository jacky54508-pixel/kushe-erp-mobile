"""K29 isolated browser helpers. Serve only enumerated synthetic/static resources."""
import base64
import hashlib
import io
import json
import os
import platform
import shutil
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

BASE = '15eff6fc574fb64480682656daf88dc7a906baa8'


def sha(value):
    return hashlib.sha256(value).hexdigest()


def source(root, path, version):
    return subprocess.check_output(['git', '-C', str(root), 'show', BASE + ':' + path]) if version == 'before' else (root / path).read_bytes()


class Report:
    def __init__(self, output, name):
        self.output = output
        output.mkdir(parents=True, exist_ok=True)
        self.qa = output / 'internal-qa'
        self.qa.mkdir(exist_ok=True)
        self.data = {'schema': name, 'status': 'RUNNING', 'platform': platform.platform(), 'baseline': BASE,
                     'productionDataTouched': False, 'checks': [], 'cases': [], 'externalRequests': [], 'pageErrors': []}

    def check(self, name, passed, details=None):
        self.data['checks'].append({'name': name, 'passed': bool(passed), 'details': details})
        if not passed:
            self.flush()
            raise AssertionError(name + ': ' + str(details))

    def save(self, name, value):
        (self.output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    def flush(self):
        self.data['passCount'] = sum(x['passed'] for x in self.data['checks'])
        self.data['failCount'] = sum(not x['passed'] for x in self.data['checks'])
        self.save('RESULT.json', self.data)


class Server:
    def __init__(self, resources):
        self.resources = resources
        self.requests = []
        parent = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                path = urlsplit(self.path).path
                parent.requests.append(path)
                entry = resources.get(path)
                if entry is None:
                    self.send_error(404)
                    return
                content, mime = entry
                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.send_header('Content-Length', str(len(content)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(content)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.origin = 'http://127.0.0.1:' + str(self.server.server_address[1])
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


def restrict(context, server, report, name):
    def route(r):
        parsed = urlsplit(r.request.url)
        if r.request.method == 'GET' and parsed.scheme + '://' + parsed.netloc == server.origin and parsed.path in server.resources:
            r.continue_()
        else:
            report.data['externalRequests'].append({'case': name, 'method': r.request.method, 'url': r.request.url})
            r.abort()
    context.route('**/*', route)
    context.on('page', lambda page: page.on('pageerror', lambda error: report.data['pageErrors'].append({'case': name, 'message': str(error)})))


def browser_options(explicit=None):
    candidates = [str(explicit)] if explicit else [shutil.which(n) for n in ('google-chrome', 'google-chrome-stable', 'chromium', 'chrome')]
    if not explicit and os.name == 'nt':
        candidates += [str(Path(os.environ[k]) / 'Google/Chrome/Application/chrome.exe') for k in ('ProgramFiles', 'ProgramFiles(x86)') if os.environ.get(k)]
    for path in dict.fromkeys(p for p in candidates if p):
        try:
            if Path(path).is_file() and subprocess.run([path, '--version'], capture_output=True, timeout=10).returncode == 0:
                return {'headless': True, 'executable_path': path}
        except (OSError, subprocess.SubprocessError):
            pass
    return {'headless': True}


def synthetic_assets():
    from PIL import Image, ImageDraw
    image = Image.new('RGB', (180, 90), 'white')
    draw = ImageDraw.Draw(image)
    for i in range(25):
        draw.rectangle((i * 3, i, 170 - i, 80 - i), outline=(160 + i, 20 + i, 40))
    raw = io.BytesIO()
    image.save(raw, format='PNG')
    data = 'data:image/png;base64,' + base64.b64encode(raw.getvalue()).decode()
    assert len(data) > 1024
    return ("const companyLogoAsset='" + data + "';\nconst companySealAsset='" + data + "';\n").encode()


def artifact_pdf(page, path):
    from pypdf import PdfReader
    content = page.pdf(format='A4', print_background=True, prefer_css_page_size=True)
    path.write_bytes(content)
    reader = PdfReader(io.BytesIO(content))
    if shutil.which('pdftotext'):
        text = subprocess.check_output(['pdftotext', '-layout', str(path), '-'], encoding='utf-8')
    else:
        text = '\n\f\n'.join(p.extract_text() or '' for p in reader.pages)
    path.with_suffix('.txt').write_text(text, encoding='utf-8')
    if shutil.which('pdftoppm'):
        subprocess.run(['pdftoppm', '-scale-to', '1400', '-png', str(path), str(path.with_name(path.stem + '-page'))], check=True, capture_output=True)
    return len(reader.pages), text, [list(map(float, (p.mediabox.width, p.mediabox.height))) for p in reader.pages]
