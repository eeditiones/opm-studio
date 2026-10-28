"""Download the default schemas the editor falls back to, into schema/<name>/.

TEI, DocBook and JATS are their publishers' RELAX NG, with every file each includes at
its relative path, so the validation worker (src/runtime/validator.ts) converts it as it
is. The schema for ODDs is compiled from TEI Publisher's ODD for ODD authoring, which
jinks keeps, with `opm odd compile --format rng`::

    npm run schemas            # all of them
    npm run schemas -- jats    # one

For the ODD schema, a jinks checkout beside this one (or $JINKS_DIR) is preferred to
GitHub, and an opm checkout beside it (or $OPM_DIR) to the released opm.
src/ui/xmlSchema.ts names the main file of each.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
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
#: TEI Publisher's customization for writing ODDs: TEI with the pb: processing-model extensions
ODD_SOURCE = 'profiles/base10/resources/odd/teipublisher_odds.odd'
ODD_URL = f'https://raw.githubusercontent.com/eeditiones/jinks/main/{ODD_SOURCE}'


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


def compile_odd_schema(out: Path) -> Path:
    """schema/odd/teipublisher_odds.rng, compiled by opm from jinks' teipublisher_odds.odd."""
    jinks = Path(os.environ.get('JINKS_DIR', ROOT.parent / 'jinks'))
    opm = Path(os.environ.get('OPM_DIR', ROOT.parent / 'tei-publisher-py'))
    run = ['uv', 'run', '-q', '--project', str(opm), 'opm'] if (opm / 'pyproject.toml').is_file() \
        else ['uvx', '-q', '--from', 'open-processing-model', 'opm']
    with tempfile.TemporaryDirectory() as tmp:
        odd = jinks / ODD_SOURCE
        if not odd.is_file():
            odd = Path(tmp) / 'teipublisher_odds.odd'
            with urlopen(ODD_URL) as r:
                odd.write_bytes(r.read())
        out.mkdir(parents=True)
        rng = out / 'teipublisher_odds.rng'
        subprocess.run([*run, 'odd', 'compile', str(odd), '--format', 'rng', '-o', str(rng), '--force'], check=True)
    print(f'Wrote {rng.relative_to(ROOT)} from {odd}')
    return rng


def main(names: list[str]) -> int:
    for name in names or [*SCHEMAS, 'odd']:
        if name == 'odd':
            out = ROOT / 'schema' / 'odd'
            shutil.rmtree(out, ignore_errors=True)
            compile_odd_schema(out)
            continue
        url = SCHEMAS[name]
        out = ROOT / 'schema' / name
        shutil.rmtree(out, ignore_errors=True)
        seen: set[str] = set()
        rng = download(url, url.rsplit('/', 1)[0] + '/', out, seen)
        print(f'Wrote {rng.relative_to(ROOT)} ({len(seen)} files) from {url}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
