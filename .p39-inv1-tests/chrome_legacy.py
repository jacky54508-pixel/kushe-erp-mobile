"""P39-INV-1 legacy regression runner uses system Chrome, unchanged tests.
This monkeypatch changes ONLY the Playwright executable used; it does not
modify any tests or ERP source. All test URLs remain 127.0.0.1 synthetic.
"""
import runpy
import sys
from playwright.sync_api import BrowserType

original = BrowserType.launch

def system_chrome(self, *args, **kwargs):
    if self.name == "chromium" and not kwargs.get("channel"):
        kwargs["channel"] = "chrome"
    return original(self, *args, **kwargs)

BrowserType.launch = system_chrome

if __name__ == "__main__":
    if len(sys.argv) != 2 or not sys.argv[1].startswith(
        (".p33-4-tests/", ".p34-tests/", ".p35-tests/", ".p36-tests/")
    ):
        raise SystemExit("Only approved original ERP synthetic tests allowed")
    filename = sys.argv[1]
    sys.argv = [filename]
    runpy.run_path(filename, run_name="__main__")
