"""Describe a schema for editor autocompletion.

The result is the configuration ``@codemirror/lang-xml`` takes, in the format
jinn-codemirror ships for TEI, extended::

    {"elements": [{"name": "p", "top": true,
                   "children": ["hi", ...],
                   "attributes": ["xml:id", {"name": "rend", "values": [...], "completion": {...}}],
                   "completion": {"detail": "paragraph", "info": "marks paragraphs in prose."}}],
     "attributes": [{"name": "xml:id", "completion": {...}}]}

An attribute named by a string is described once, under the top-level
``attributes``.

It answers what may go where, not whether a document is valid: an element
gets every child and attribute any of its patterns allows, wherever they
stand in the content model.

This module reads RELAX NG (XML syntax), the schema DocBook and JATS publish
and the TEI exports from an ODD. The page loads it into Pyodide beside
glue.py; run on its own, it writes the JSON a project can ship instead::

    uv run --with lxml src/runtime/completion_schema.py docbook.rng -o schema/docbook.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import url2pathname

from lxml import etree

RNG_NS = 'http://relaxng.org/ns/structure/1.0'
ANNOTATIONS_NS = 'http://relaxng.org/ns/compatibility/annotations/1.0'
XML_NS = 'http://www.w3.org/XML/1998/namespace'

#: Patterns whose children are patterns again, walked straight through.
_CONTAINERS = {
    'group', 'interleave', 'choice', 'optional', 'zeroOrMore', 'oneOrMore',
    'mixed', 'div', 'list',
}
#: A ``detail`` longer than this is cut at a word.
_DETAIL_MAX = 80


def _rng(tag: str) -> str:
    return f'{{{RNG_NS}}}{tag}'


def _is_rng(el: etree._Element, name: str | None = None) -> bool:
    if not isinstance(el.tag, str):
        return False
    q = etree.QName(el)
    return q.namespace == RNG_NS and (name is None or q.localname == name)


def _local(el: etree._Element) -> str:
    return etree.QName(el).localname


def _collapse(text: str) -> str:
    return re.sub(r'\s+', ' ', text).strip()


def _documentation(el: etree._Element) -> str:
    """The text of *el*'s ``a:documentation`` children."""
    parts = [
        _collapse(''.join(d.itertext()))
        for d in el
        if isinstance(d.tag, str) and d.tag == f'{{{ANNOTATIONS_NS}}}documentation'
    ]
    return ' '.join(p for p in parts if p)


def _completion(doc: str) -> dict[str, str]:
    """``detail`` and ``info`` from one documentation string.

    TEI's exports open with the gloss in parentheses, ``(paragraph) marks
    paragraphs in prose. [3.1. Paragraphs]``: the gloss becomes the detail,
    and the chapters of the Guidelines cited at the end are dropped. Otherwise
    the detail is the first sentence, cut short, and the whole text the info.
    """
    if not doc:
        return {}
    doc = re.sub(r'\s*\[\d+(?:\.\d+)*\.\s[^\[\]]*\]$', '', doc)
    m = re.match(r'\(([^()]+)\)\s*(.*)', doc, re.S)
    if m:
        out = {'detail': m.group(1)}
        if m.group(2):
            out['info'] = m.group(2)
        return out
    detail = re.split(r'(?<=[.;:])\s', doc, maxsplit=1)[0].rstrip('.;:')
    if len(detail) > _DETAIL_MAX:
        detail = detail[:_DETAIL_MAX].rsplit(' ', 1)[0] + '…'
    out = {'detail': detail}
    if detail != doc:
        out['info'] = doc
    return out


def _qname(el: etree._Element, name: str, *, attribute: bool) -> str:
    """*name* as a document would write it.

    A prefixed name stays as it is (``xlink:href``, ``mml:math``). An attribute
    in a namespace given by ``@ns`` takes the prefix the schema binds to that
    namespace. Elements otherwise go by their local name: the schema's own
    namespace is the document's default one.
    """
    if ':' in name:
        return name
    if attribute:
        ns = el.get('ns')
        if ns == XML_NS:
            return 'xml:' + name
        if ns:
            prefix = next((p for p, uri in (el.nsmap or {}).items() if uri == ns and p), None)
            if prefix:
                return f'{prefix}:{name}'
    return name


def _names(el: etree._Element, *, attribute: bool) -> list[str]:
    """The names an ``element`` or ``attribute`` pattern matches; none for wildcards."""
    if el.get('name'):
        return [_qname(el, el.get('name').strip(), attribute=attribute)]
    first = next((c for c in el if _is_rng(c)), None)
    if first is None:
        return []
    return _name_class(first, attribute=attribute)


def _name_class(nc: etree._Element, *, attribute: bool) -> list[str]:
    tag = _local(nc)
    if tag == 'name':
        return [_qname(nc, (nc.text or '').strip(), attribute=attribute)]
    if tag == 'choice':
        return [n for c in nc if _is_rng(c) for n in _name_class(c, attribute=attribute)]
    return []  # anyName, nsName: not something to offer


def _content(el: etree._Element) -> list[etree._Element]:
    """The pattern children of an ``element`` or ``attribute``, after its name class."""
    pats = [c for c in el if _is_rng(c)]
    if not el.get('name') and pats:
        pats = pats[1:]
    return pats


# ── Grammar loading ───────────────────────────────────────────────────────


@dataclass(eq=False)
class _Scope:
    """One grammar: its defines (``@combine`` parts kept side by side) and start."""

    defines: dict[str, list[etree._Element]] = field(default_factory=dict)
    start: list[etree._Element] = field(default_factory=list)
    parent: _Scope | None = None

    @property
    def start_patterns(self) -> list[etree._Element]:
        return [c for s in self.start for c in s]


class _Loader:
    def __init__(self) -> None:
        self._docs: dict[Path, etree._Element] = {}
        #: Nested ``grammar`` patterns, built once each.
        self._nested: dict[etree._Element, _Scope] = {}

    def load(self, path: Path) -> etree._Element:
        path = path.resolve()
        root = self._docs.get(path)
        if root is None:
            parser = etree.XMLParser(remove_comments=True, resolve_entities=False, no_network=True)
            root = etree.parse(str(path), parser).getroot()
            self._docs[path] = root
        return root

    def grammar(self, el: etree._Element, parent: _Scope | None = None) -> _Scope:
        scope = _Scope(parent=parent)
        self._fill(scope, el, set(), skip_start=False)
        return scope

    def nested(self, el: etree._Element, parent: _Scope) -> _Scope:
        scope = self._nested.get(el)
        if scope is None:
            scope = self._nested[el] = self.grammar(el, parent)
        return scope

    def _fill(self, scope: _Scope, container: etree._Element, skip: set[str], *, skip_start: bool) -> None:
        """Add the components of a ``grammar`` (or ``div``, or included grammar)
        to *scope*, leaving out the defines in *skip*, which an ``include`` overrides."""
        for comp in container:
            if not _is_rng(comp):
                continue
            tag = _local(comp)
            if tag == 'define':
                name = comp.get('name', '').strip()
                if name not in skip:
                    scope.defines.setdefault(name, []).append(comp)
            elif tag == 'start':
                if not skip_start:
                    scope.start.append(comp)
            elif tag == 'div':
                self._fill(scope, comp, skip, skip_start=skip_start)
            elif tag == 'include':
                overrides = set()
                overrides_start = False
                for c in comp.iter(_rng('define'), _rng('start')):
                    if _local(c) == 'define':
                        overrides.add(c.get('name', '').strip())
                    else:
                        overrides_start = True
                included = self.load(_href(comp))
                if _is_rng(included, 'grammar'):
                    self._fill(scope, included, skip | overrides, skip_start=skip_start or overrides_start)
                self._fill(scope, comp, skip, skip_start=skip_start)


def _href(el: etree._Element) -> Path:
    """The file an ``include`` or ``externalRef`` points to, relative to its document."""
    url = urljoin(el.base or '', el.get('href', '').strip())
    return Path(url2pathname(urlparse(url).path)) if url.startswith('file:') else Path(url)


# ── Walking the patterns ──────────────────────────────────────────────────


@dataclass
class _Attr:
    name: str
    doc: str = ''
    values: dict[str, str] = field(default_factory=dict)


@dataclass
class _Found:
    """What one content model reaches without entering another element."""

    elements: list[tuple[etree._Element, _Scope]] = field(default_factory=list)
    attributes: list[etree._Element] = field(default_factory=list)


class _Walker:
    def __init__(self, loader: _Loader) -> None:
        self.loader = loader
        #: A define's reach, per scope. RELAX NG forbids a ref cycle that does
        #: not pass through an element, so a define can be finished before use.
        self._memo: dict[tuple[int, str], _Found] = {}

    def walk(self, patterns: list[etree._Element], scope: _Scope) -> _Found:
        found = _Found()
        for p in patterns:
            self._pattern(p, scope, found)
        return found

    def _pattern(self, p: etree._Element, scope: _Scope, found: _Found) -> None:
        if not _is_rng(p):
            return
        tag = _local(p)
        if tag == 'element':
            found.elements.append((p, scope))
        elif tag == 'attribute':
            found.attributes.append(p)
        elif tag in _CONTAINERS:
            for c in p:
                self._pattern(c, scope, found)
        elif tag == 'ref':
            self._merge(found, self._define(scope, p.get('name', '').strip()))
        elif tag == 'parentRef' and scope.parent is not None:
            self._merge(found, self._define(scope.parent, p.get('name', '').strip()))
        elif tag == 'grammar':
            nested = self.loader.nested(p, scope)
            self._merge(found, self.walk(nested.start_patterns, nested))
        elif tag == 'externalRef':
            ext = self.loader.load(_href(p))
            if _is_rng(ext, 'grammar'):
                g = self.loader.grammar(ext)
                self._merge(found, self.walk(g.start_patterns, g))
            else:
                self._pattern(ext, scope, found)
        # text, empty, data, value, notAllowed: nothing to offer

    def _define(self, scope: _Scope, name: str) -> _Found:
        key = (id(scope), name)
        found = self._memo.get(key)
        if found is None:
            found = self._memo[key] = _Found()  # a guard, should a schema loop anyway
            parts = scope.defines.get(name, [])
            self._merge(found, self.walk([c for d in parts for c in d], scope))
        return found

    @staticmethod
    def _merge(into: _Found, other: _Found) -> None:
        into.elements.extend(other.elements)
        into.attributes.extend(other.attributes)


def _attribute(el: etree._Element) -> list[_Attr]:
    """One ``attribute`` pattern: its names, documentation and enumerated values."""
    doc = _documentation(el)
    values: dict[str, str] = {}
    for v in el.iter(_rng('value')):
        if any(_is_rng(a, 'except') for a in v.iterancestors()):
            continue
        label = (v.text or '').strip()
        if not label:
            continue
        # TEI's exports document each value right after it
        nxt = v.getnext()
        while nxt is not None and not isinstance(nxt.tag, str):
            nxt = nxt.getnext()
        vdoc = ''
        if nxt is not None and nxt.tag == f'{{{ANNOTATIONS_NS}}}documentation':
            vdoc = _collapse(''.join(nxt.itertext()))
        values.setdefault(label, vdoc)
    return [_Attr(n, doc, dict(values)) for n in _names(el, attribute=True)]


@dataclass
class _Entry:
    name: str
    top: bool = False
    doc: str = ''
    children: set[str] = field(default_factory=set)
    attributes: dict[str, _Attr] = field(default_factory=dict)


def from_rng(path: Path | str) -> dict:
    """Describe the RELAX NG grammar at *path* for autocompletion.

    Only elements reachable from ``start`` are listed, so a customization
    that removes an element with ``notAllowed`` or by not referring to it
    leaves it out.
    """
    loader = _Loader()
    root = loader.load(Path(path))
    if _is_rng(root, 'grammar'):
        scope = loader.grammar(root)
        start = scope.start_patterns
    else:
        # a lone element pattern is a schema too
        scope = _Scope()
        start = [root]
    walker = _Walker(loader)

    entries: dict[str, _Entry] = {}
    seen: set[int] = set()
    queue: list[tuple[etree._Element, _Scope]] = []

    def entry(name: str) -> _Entry:
        e = entries.get(name)
        if e is None:
            e = entries[name] = _Entry(name)
        return e

    for el, sc in walker.walk(start, scope).elements:
        for name in _names(el, attribute=False):
            entry(name).top = True
        queue.append((el, sc))

    while queue:
        el, sc = queue.pop()
        if id(el) in seen:
            continue
        seen.add(id(el))
        names = _names(el, attribute=False)
        found = walker.walk(_content(el), sc)
        doc = _documentation(el)
        children = {n for child, _ in found.elements for n in _names(child, attribute=False)}
        attrs = [a for att in found.attributes for a in _attribute(att)]
        for name in names:
            e = entry(name)
            e.doc = e.doc or doc
            e.children |= children
            for a in attrs:
                have = e.attributes.get(a.name)
                if have is None:
                    e.attributes[a.name] = _Attr(a.name, a.doc, dict(a.values))
                else:
                    have.doc = have.doc or a.doc
                    for k, v in a.values.items():
                        if not have.values.get(k):
                            have.values[k] = v
        queue.extend(found.elements)

    return _schema_json([entries[n] for n in sorted(entries, key=str.lower)])


def _schema_json(entries: list[_Entry]) -> dict:
    """The JSON for *entries*. An attribute defined alike on every element
    that has it is described once, under ``attributes``, and the elements
    name it; that is how ``@codemirror/lang-xml`` reads a string there. Schemas
    share most attributes widely (``xml:id``, ``xlink:*``), so this keeps the
    file a fraction of the size."""
    variants: dict[str, list[dict]] = {}
    for e in entries:
        for a in e.attributes.values():
            js = _attr_json(a)
            seen = variants.setdefault(a.name, [])
            if js not in seen:
                seen.append(js)
    shared = {name: v[0] for name, v in variants.items() if len(v) == 1}
    elements = []
    for e in entries:
        out: dict = {'name': e.name}
        if e.top:
            out['top'] = True
        out['children'] = sorted(e.children, key=str.lower)
        out['attributes'] = [
            n if n in shared else _attr_json(e.attributes[n])
            for n in sorted(e.attributes, key=str.lower)
        ]
        if e.doc:
            out['completion'] = _completion(e.doc)
        elements.append(out)
    return {'elements': elements, 'attributes': [shared[n] for n in sorted(shared, key=str.lower)]}


def _attr_json(a: _Attr) -> dict:
    out: dict = {'name': a.name}
    if a.values:
        out['values'] = [
            {'label': v, **_completion(doc)} if doc else v
            for v, doc in a.values.items()
        ]
    if a.doc:
        out['completion'] = _completion(a.doc)
    return out


def main(argv: list[str] | None = None) -> int:
    """Write the JSON for one RELAX NG schema, to standard output or ``-o``."""
    parser = argparse.ArgumentParser(description='Describe a RELAX NG schema (.rng) for XML editor autocompletion.')
    parser.add_argument('schema', type=Path, help='RELAX NG schema in XML syntax (.rng)')
    parser.add_argument('-o', '--output', type=Path, help='write the JSON here instead of to standard output')
    args = parser.parse_args(argv)
    if args.schema.suffix.lower() != '.rng':
        parser.error(f'{args.schema}: expected a RELAX NG schema in XML syntax (.rng)')
    try:
        data = from_rng(args.schema)
    except (OSError, etree.XMLSyntaxError) as e:
        print(f'{args.schema}: {e}', file=sys.stderr)
        return 1
    text = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    if args.output is None:
        print(text)
    else:
        args.output.write_text(text, encoding='utf-8')
        print(f'Wrote {args.output} ({len(data["elements"])} elements)', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
