"""Write the default schemas the editor falls back to: schema/<name>.json for completion,
schema/<name>.salve.json for validation.

Each is downloaded from its publisher as RELAX NG, with every file it includes, and
turned into JSON by src/runtime/completion_schema.py and by salve
(scripts/salve-schemas.mjs)::

    npm run schemas            # all of them
    npm run schemas -- jats    # one
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import urlopen

from lxml import etree

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src' / 'runtime'))
from completion_schema import RNG_NS, from_rng  # noqa: E402

SCHEMAS = {
    'tei': 'https://tei-c.org/release/xml/tei/custom/schema/relaxng/tei_all.rng',
    'docbook': 'https://cdn.docbook.org/schema/5.2/rng/docbook.rng',
    # Archiving, the loosest JATS tag set and a superset of Publishing, with MathML 3
    'jats': 'https://jats.nlm.nih.gov/archiving/1.3/rng/JATS-archivearticle1-3-mathml3.rng',
}


def download(url: str, base: str, into: Path, seen: set[str]) -> Path:
    """Save url and, recursively, the files it includes, at their paths relative to base."""
    target = into / url.removeprefix(base)
    if url in seen:
        return target
    seen.add(url)
    with urlopen(url) as r:
        data = r.read()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    for ref in etree.fromstring(data).iter(f'{{{RNG_NS}}}include', f'{{{RNG_NS}}}externalRef'):
        href = urljoin(url, ref.get('href', '').strip())
        if not href.startswith(base):
            raise ValueError(f'{url} includes {href}, outside {base}')
        download(href, base, into, seen)
    return target


def main(names: list[str]) -> int:
    for name in names or SCHEMAS:
        url = SCHEMAS[name]
        with tempfile.TemporaryDirectory() as tmp:
            rng = download(url, url.rsplit('/', 1)[0] + '/', Path(tmp), set())
            data = from_rng(rng)
            subprocess.run(['node', str(ROOT / 'scripts' / 'salve-schemas.mjs'), name, str(rng)], check=True)
        out = ROOT / 'schema' / f'{name}.json'
        out.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        print(f'Wrote {out.relative_to(ROOT)} ({len(data["elements"])} elements) from {url}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
