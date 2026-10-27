"""Autocompletion schemas derived from RELAX NG."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from completion_schema import from_rng, main

RNG = Path(__file__).resolve().parent / 'fixtures' / 'rng'


@pytest.fixture(scope='module')
def schema() -> dict:
    return from_rng(RNG / 'main.rng')


def _elements(schema: dict) -> dict[str, dict]:
    return {e['name']: e for e in schema['elements']}


def _attributes(schema: dict, element: str) -> dict[str, dict]:
    """*element*'s attributes, those named by a string looked up in the shared list."""
    shared = {a['name']: a for a in schema['attributes']}
    atts = _elements(schema)[element]['attributes']
    return {a if isinstance(a, str) else a['name']: shared[a] if isinstance(a, str) else a for a in atts}


def test_lists_only_elements_reachable_from_start(schema: dict) -> None:
    # b and i are overridden by the include, orphan is never referenced,
    # and the anyName pattern names nothing to offer
    assert set(_elements(schema)) == {'doc', 'em', 'item', 'list', 'para', 'section', 'title'}


def test_marks_start_elements_top(schema: dict) -> None:
    assert [e['name'] for e in schema['elements'] if e.get('top')] == ['doc']


def test_children_follow_refs_combine_and_external_refs(schema: dict) -> None:
    els = _elements(schema)
    assert els['doc']['children'] == ['list', 'para', 'section', 'title']
    assert els['section']['children'] == ['list', 'para', 'section', 'title']
    assert els['para']['children'] == ['em']
    assert els['list']['children'] == ['item']
    assert els['title']['children'] == []


def test_an_element_with_two_patterns_gets_both_attribute_sets(schema: dict) -> None:
    assert set(_attributes(schema, 'title')) == {'id', 'level'}


def test_attribute_values_and_documentation(schema: dict) -> None:
    atts = _attributes(schema, 'section')
    assert set(atts) == {'id', 'type', 'xlink:href'}
    assert atts['type']['values'] == [{'label': 'chapter', 'detail': 'a chapter'}, 'appendix']
    assert atts['type']['completion'] == {'detail': 'the kind of section'}


def test_same_named_attributes_that_differ_stay_on_their_elements(schema: dict) -> None:
    # section's id is undocumented, title's is not: neither is shared
    assert 'id' not in {a['name'] for a in schema['attributes']}
    assert _attributes(schema, 'title')['id']['completion'] == {'detail': 'identifies the title'}
    assert 'type' in {a['name'] for a in schema['attributes']}


def test_documentation_becomes_detail_and_info(schema: dict) -> None:
    els = _elements(schema)
    assert els['doc']['completion'] == {'detail': 'document', 'info': 'the root of a test document.'}
    assert els['section']['completion'] == {
        'detail': 'A section',
        'info': 'A section. It may hold further sections.',
    }
    assert 'completion' not in els['para']


def test_main_writes_the_json(tmp_path: Path) -> None:
    out = tmp_path / 'main.json'
    assert main([str(RNG / 'main.rng'), '-o', str(out)]) == 0
    assert json.loads(out.read_text(encoding='utf-8')) == from_rng(RNG / 'main.rng')
