# Default schemas

The RELAX NG schemas the editor checks and completes TEI, DocBook and JATS documents against when they name no schema of their own, as their publishers distribute them, each with the files it includes. `npm run schemas` (`scripts/schemas.py`) downloads them again; they remain under each standard's terms, not OPM Studio's AGPL.

## tei/

`tei_all.rng` of the current TEI P5 release, <https://tei-c.org/release/xml/tei/custom/schema/relaxng/tei_all.rng>, © the TEI Consortium. TEI material is available under both [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) and the [BSD 2-Clause licence](https://opensource.org/license/bsd-2-clause).

## docbook/

The DocBook 5.2 RELAX NG schema, <https://cdn.docbook.org/schema/5.2/rng/docbook.rng>, under its permission notice:

> Copyright 1992-2015 HaL Computer Systems, Inc.,
> O'Reilly & Associates, Inc., ArborText, Inc., Fujitsu Software
> Corporation, Norman Walsh, Sun Microsystems, Inc., and the
> Organization for the Advancement of Structured Information
> Standards (OASIS).
>
> Permission to use, copy, modify and distribute the DocBook schema
> and its accompanying documentation for any purpose and without fee
> is hereby granted in perpetuity, provided that the above copyright
> notice and this paragraph appear in all copies. The copyright
> holders make no representation about the suitability of the schema
> for any purpose. It is provided "as is" without expressed or implied
> warranty.
>
> If you modify the DocBook schema in any way, label your schema as a
> variant of DocBook. See the reference documentation
> (http://docbook.org/tdg5/en/html/ch05.html#s-notdocbook)
> for more information.

## jats/

The JATS 1.3 Archiving RELAX NG with MathML 3, <https://jats.nlm.nih.gov/archiving/1.3/>, from the National Library of Medicine (NLM). The JATS (ANSI/NISO Z39.96) suite is in the public domain, as each of its modules states:

> This DTD is in the public domain. An organization that wishes to create its
> own DTD from the suite may do so without permission from NLM.
