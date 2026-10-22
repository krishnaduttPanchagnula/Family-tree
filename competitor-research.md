# Competitor research — family tree builders

Research date: 22 October 2026. Sources: live product pages (familyecho.com,
treemily.com), current comparison round-ups (Lineage, Venngage, Incarn), and
each product's own help/blog sections. Pure directory sites (Wikipedia,
Forbes) were excluded on purpose: they rank on domain authority, not on a
comparable product experience.

Family Tree Builder is a **local-first, single-user, self-hosted visual tree
builder**. The benchmark set is therefore built from products a relative
without a research subscription would actually open, not from DNA-testing
giants.

---

## 1. Benchmark matrix

| Site | Positioning | Core page types | Interaction model | Import / export | Content & SEO engine | Gap we can use |
| --- | --- | --- | --- | --- | --- | --- |
| **FamilyEcho** (familyecho.com) | "Create and print a family tree online — free". No account needed to start. | One builder screen, plus About / FAQs / API / Resources / Help Forum / Send Feedback | Left form panel + live chart; click a person to edit, pencil icon to add | GEDCOM **and** FamilyScript in/out; printable output | Static help pages, no visible blog cadence | Free, fast, private by default — but a 2007-era interface and no media/story layer |
| **Geni** (geni.com) | "The largest online family tree of the world"; collaborative, profile-centric | Profile pages with an event timeline, media, documents, privacy controls | Click a person → profile; tree is the navigation, profile is the record | Import/export | MyHeritage-owned; no strong owned blog | Events, documents and privacy are first-class — our app has only a flat person record |
| **WikiTree** (wikitree.com) | Free, collaborative, public trees with **sourced** profiles | Profile pages, Tree Apps (ancestor/descendant/relationship charts), project pages, "How to" guides | Wiki-style collaboration; a Connection finder and relationship finder | GEDCOM | Glossary, tutorials, "how to" research guides | Sources and citations are the whole point; we have free-text notes only |
| **Treemily** | Visual-first, template-driven, gift-oriented ("eternalize your family history") | Landing page per chart type (Family Chart, Ancestor, Descendant, Dynasty, Photo, Traditional) + Wizard + Blog + FAQ + Glossary | 4-step wizard → fill a template → visual tweak | Import, PNG/JPG/PDF downloads, printed products | Blog, glossary, "How to Research Family History: A Step-by-Step Guide", "Family Tree Template for Kids", "Genealogy Research Questions" | Templates + a research-question funnel; closest to our "one tree, many formats" idea but paywalled |
| **Gramps** (gramps project) | Open-source, offline, local-first desktop app | Desktop app, reports, plugin manager | Dense desktop forms; relationship calculator | GEDCOM | Wiki/manual, no marketing | Same local-first promise as ours, but with a 2008 desktop UI |
| *(reference)* **FamilySearch** | Free, records-first, education-first | Tree + Learning Center + Family Activities + Keepsake templates + mobile app | Guided activities, printable templates | GEDCOM | Enormous: learning centre, activities, printable templates, "What's New" | Shows the education/printable-temple angle at scale — and the mobile app is the only real mobile tree experience in the category |
| *(reference)* **Creately family tree creator** | Diagramming tool with a family-tree template gallery | Template gallery, blank template, editor, viewer mode | Drag a diagram template | Image / SVG / CSV / PDF | Template gallery pages per use case (school project, printable poster) | Explicitly targets the **school-project** and **printable-poster** intents |

---

## 2. Winning content patterns

1. **A templated orientation before the tool.** Every serious competitor
   front-loads a "what is a family tree / how do I build one" explainer
   (Treemily's FAQ, FamilySearch's Learning Center, FamilyEcho's welcome
   strip). The chart is the product; the *instructions* are what pull in
   non-users.
2. **Content is grouped into topic clusters**, not one blog: *templates and
   charts*, *how-to research guides*, *glossary / definitions*, *printable
   resources*, *activities for kids and schools*. Each cluster targets a
   different stage of the journey.
3. **Chart and record are separate objects.** Competitors let you draw a
   chart (a visual artifact) while the underlying data lives on a profile
   page with events, media and documents. Our cards currently do both jobs
   at once, which is why a card is the only place a person exists.
4. **Export is a first-class, framed outcome.** Family Echo is "create and
   **print**"; Treemily sells prints; FamilySearch has Keepsake; Creately
   exports SVG/CSV/PDF. Export is the moment the user shares the work.
5. **Onboarding does the work of the landing page.** Family Echo's
   "Welcome to Family Echo!" strip, Treemily's wizard, our own getting-started
   checklist. The first-run flow is the real landing page for a local app.
6. **Free-tier limits are stated on the landing page.** Everyone converts
   on the constraint, and the constraint is what a self-hosted app turns into
   a feature ("no account, no upload limit, no subscription").
7. **Education-first SEO**: glossary terms, "how to research", "templates"
   and "research questions" bring in people who are not yet users of any
   particular tool.

---

## 3. Underserved angles

These are the openings a self-hosted, local-first builder can take, ordered by
how well they fit what this repository already does.

1. **Relationship *subtypes*.** Every mainstream tool flattens a family into
   parent / spouse / sibling. None of them model adoptive, foster, guardian
   or unknown parents, ex-partners, or half and step siblings as first-class
   states. This app already does. That is both a product differentiator and
   an unwritten content territory ("how do you show an adoptive parent on a
   family tree?").
2. **The small tree, done beautifully.** The category chases thousands of
   ancestors and record databases. Almost nobody serves a family of 50–200
   people who want a chart with photos, notes and a printable output for a
   reunion or a school project.
3. **Local-first and privacy, said in modern language.** Gramps is free and
   local but dated; Family Echo says "private" in a 2007 voice. "Your tree
   never leaves your house — no account, no subscription, no upload limit" is
   a message nobody currently says well.
4. **Trust as a feature.** Undo for destructive actions, a one-click JSON
   backup, a confirm dialog with real impact text, and export to a format you
   own. Big platforms hide destructive actions; a tool that never loses data
   can say so loudly.
5. **Printables.** Keepsake (FamilySearch) and Treemily prints prove the
   demand. A simple open-source tool that exports a good-looking chart —
   PNG, SVG, JSON — has no serious free competitor.
6. **Mobile.** FamilySearch has the only real mobile tree app; everything
   else is a desktop tool shrunk into a phone. A touch-first, one-hand
   "add a person" flow is open ground.
7. **Unwritten topics worth owning**: "how to draw a family tree by hand",
   "vertical vs horizontal family tree chart", "how to show half siblings",
   "family tree chart for a school project", "how to merge two family trees",
   "family tree chart ideas for a reunion".

---

## 4. What this repository changed because of the research

| Finding | Change |
| --- | --- |
| "Chart and record are separate objects" | The canvas card stays the chart; the side panel is the record, and it is now a drawer on small screens so the chart keeps the screen |
| "A templated orientation before the tool" | The empty canvas card, the first-run checklist and the new single **Add** entry point all teach the same flow |
| "Export is a first-class outcome" | Export sits in its own menu in the tool rail, one click from the tree, and always states the format |
| "Nobody models relationship subtypes" | The legend and the sidebar keep naming the exact relation (adoptive / foster / guardian / unknown parent, half and step siblings) |
| "Trust as a feature" | Undo, backup and restore are surfaced in the header and Settings; nothing is deleted silently |
| "Mobile is open ground" | Below 820px the panel becomes a drawer and the tool rail stays vertical, so the whole screen is the chart |
| Education-first SEO | This document plus a competitor-informed feature list in `README.md` |
