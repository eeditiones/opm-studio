"""Download the default schemas the editor falls back to, into schema/<name>/.

Each is the publisher's RELAX NG, with every file it includes at its relative path,
so the validation worker (src/runtime/validator.ts) converts it as it is::

    npm run schemas            # all of them
    npm run schemas -- jats    # one

src/ui/xmlSchema.ts names the main file of each.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import urlopen

from lxml import etree

ROOT = Path(__file__).resolve().parents[1]
RNG_NS = 'http://relaxng.org/ns/structure/1.0'

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
        out = ROOT / 'schema' / name
        shutil.rmtree(out, ignore_errors=True)
        seen: set[str] = set()
        rng = download(url, url.rsplit('/', 1)[0] + '/', out, seen)
        print(f'Wrote {rng.relative_to(ROOT)} ({len(seen)} files) from {url}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
