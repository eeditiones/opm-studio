---
layout: home

hero:
  name: OPM Studio
  text: Transform XML in your browser
  tagline: Define transformation rules in a declarative specification. No installation, no server.
  image:
    src: /screenshots/workspace.png
    alt: OPM Studio editor with XML source and PDF preview
    link: https://wolfgangmm.github.io/opm-studio/
  actions:
    - theme: brand
      text: Open the app
      link: https://wolfgangmm.github.io/opm-studio/
      target: _self
    - theme: alt
      text: Your first project
      link: /tutorials/first-project

features:
  - title: Entirely in the browser
    details: Your files never leave your machine.
  - title: Zero installation
    details: Includes all required libraries. No installation needed.
  - title: Cross-media
    details: Web, print, EPUB, Markdown, Word, Typst to PDF, multi-page sites, all from the same specification.
  - title: Visual editor
    details: Edit element specs and models in a visual editor or as XML source, and generate documentation for your specs.
---

## What is _OPM Studio_?

Describe *what* your XML should become — OPM Studio takes care of the *how*. Write a few declarative rules and turn TEI, JATS, DocBook or other XML into anything from a single HTML page to a complete static website. Everything runs right in your browser: just open it and start transforming.

## What is _OPM_?

The [Open Processing Model](https://opm.e-editiones.org) is the library on which studio is based. It's a Python implementation of the TEI Processing Model, which is part of the TEI standard. Born in the TEI world, it works just as well with any XML vocabulary. In comparison with, say, XSLT stylesheets, it tends to be concise, easy to read, and self-documented. All you need to know is basic XPath plus a few key elements and attributes.
