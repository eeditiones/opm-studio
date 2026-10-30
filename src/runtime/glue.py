# Python side of the page: thin helpers over opm, called from runtime/opm.ts.
import json
import shutil
import sys
from pathlib import Path

from opm import Project
from opm.scaffold import EXAMPLES, VOCABULARIES, InitOptions, scaffold


def list_examples():
    return json.dumps([{'name': e.name, 'title': e.title, 'summary': e.summary} for e in EXAMPLES])


def list_vocabs():
    labels = {'tei': 'TEI', 'jats': 'JATS', 'docbook': 'DocBook'}
    return json.dumps([[v, labels.get(v, v)] for v in VOCABULARIES])


def reset_dir(d):
    shutil.rmtree(d, ignore_errors=True)
    Path(d).mkdir(parents=True)


def remove_path(p):
    p = Path(p)
    shutil.rmtree(p) if p.is_dir() else p.unlink()


# Projects made here never get README.md, AGENTS.md, CLAUDE.md or .gitignore:
# they live in the browser, not in a repository.
def init_project(d, vocab, templates, base=False):
    reset_dir(d)
    return scaffold(InitOptions(directory=Path(d), vocabulary=vocab, templates=bool(templates), base=bool(base), bare=True)).sample_path


def copy_example(d, name, templates, base=False):
    reset_dir(d)
    return scaffold(InitOptions(directory=Path(d), example=name, templates=bool(templates), base=bool(base), bare=True)).sample_path


_project_root = None


def _use_project(root):
    """Make root the project Python imports from.

    The session outlives switching between projects, and most have an
    `extensions` package, so the one imported first would shadow the next:
    drop the previous project's import path and modules before root's are used.
    """
    global _project_root
    import importlib
    root = Path(root)
    if _project_root is not None and _project_root != root:
        prefix = str(_project_root) + '/'
        sys.path[:] = [p for p in sys.path if p != str(_project_root) and not p.startswith(prefix)]
        for name, module in list(sys.modules.items()):
            if (getattr(module, '__file__', None) or '').startswith(prefix):
                del sys.modules[name]
        importlib.invalidate_caches()
    _project_root = root
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    return root


def convert(root, xml, mode):
    root = _use_project(root)
    return Project.load(root / 'opm.toml').transform(root / xml, mode=mode)


def chunk(root, xml, out):
    """Chunk root/xml into HTML pages below out; returns the files written and the page to open first."""
    root = _use_project(root)
    project = Project.load(root / 'opm.toml')
    if not project.config.chunking:
        raise ValueError('This project has no [chunking] section in opm.toml, so there is nothing to chunk.')
    out = Path(out)
    project.chunk(root / xml, format='html', output_dir=out, overwrite=True)
    return _site(out)


def page_site(root, mode, page, html, out):
    """Write html as out/page with the assets its template links, as `opm transform -o` does.

    Returns the site as JSON, or None when the mode's template declares no
    assets: then the page needs nothing beside it.
    """
    from opm.assets import copy_assets
    from opm.output_modes import output_mode
    from opm.transform import template_assets
    root = _use_project(root)
    project = Project.load(root / 'opm.toml')
    assets = template_assets(output_mode(mode), project.config)
    if not assets:
        return None
    reset_dir(out)
    (Path(out) / page).write_text(html, encoding='utf-8')
    copy_assets(project.root, assets, Path(out))
    site = json.loads(_site(Path(out)))
    site['landing'] = page
    return json.dumps(site)


def _site(out):
    """The files below out and the page to open first, as JSON."""
    files = sorted(str(p.relative_to(out)) for p in out.rglob('*') if p.is_file())
    # as `opm chunk --preview` does: the site index, else the first numbered page
    landing = 'index.html' if 'index.html' in files else next(
        (f for f in files if f.endswith('.html')), '')
    return json.dumps({'files': files, 'landing': landing})


class _NeedTei(Exception):
    """opm wants the TEI schema, which the page has to supply: there are no sockets here."""


def _no_download(url, dest, **_kwargs):
    raise _NeedTei(url)


def install_tei(gz):
    """Put the TEI schema (p5all.xml.gz, as bytes) where opm looks for its cached copy."""
    import gzip
    from opm.odd_schema import p5all_cache_path
    dest = p5all_cache_path()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(gzip.decompress(bytes(gz)))


def document_odd(root, odd, out, on_progress=None):
    """Build the documentation site for root/odd below out, as `opm odd document` does.

    Returns the site as JSON, or {"needTei": true} when the ODD is merged onto
    TEI and the schema is not installed yet (see install_tei).
    """
    from opm import odd_schema
    from opm.document_site import build_document_site
    root = _use_project(root)
    odd_schema._download_file = _no_download
    try:
        compiled = odd_schema.compile_schema(root / odd)
    except _NeedTei:
        return json.dumps({'needTei': True})
    reset_dir(out)
    build_document_site(compiled, out, on_progress=on_progress)
    return _site(Path(out))


def packaged_odd_text(name):
    """Text of an ODD shipped with opm (e.g. teipublisher.odd), or None."""
    from opm.resources import packaged_odd
    try:
        return packaged_odd(name).read_text(encoding='utf-8')
    except FileNotFoundError:
        return None
