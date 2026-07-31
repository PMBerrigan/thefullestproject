# Content blocks

Each `.njk` file here is one section type a page can be built from. They are dispatched by
`../block-renderer.njk` from a `blocks` array in `src/_data/`, and offered to editors as the
`block_types` palette in `src/admin/config.yml`. Adding a type means touching all three:
the partial, `BLOCK_TYPES` in the renderer, and the palette.

Pages currently built from blocks: **Home**, **About**, **Get Involved**.

---

## Why the block model stops at those three pages

Phase 3 of the visual-editor work was meant to roll the block model out across the
remaining marketing pages. Eight pages were analysed — one agent per page, each plan then
adversarially checked against the actual markup. **Seven of the eight came back "leave the
page alone."** This records why, so the question doesn't get re-opened from scratch.

## The structural finding

The pages divide into two shapes, and only one of them fits the block model.

**Section stacks.** `index.njk` and `about.njk` were a series of sibling `<section>`
elements, each self-contained, each with its own container div. That is exactly the shape
`block-renderer.njk` reproduces — which is why they converted with zero pixel change.

**Single-shell pages.** Everything else is *one* top-level `<section>` whose inner
container is the shared layout context for all the content inside it:

| Page | Top-level `<section>` count |
|---|---|
| contact.njk | 1 |
| donate.njk | 1 |
| events.njk | 1 |
| therapy-guide/index.njk | 1 |
| school-iep/index.njk | 1 (with 5 nested) |
| adaptive-equipment.njk | 1 |
| services/index.njk | 1 |
| **get-involved.njk** | **5** ← the exception, and the one that converted |

For a single-shell page, converting *any* part means splitting that one section in two.
That inserts a section-padding boundary that wasn't there and changes the container width —
these pages use `max-w-2xl` and `max-w-3xl`, while the block partials emit `max-w-4xl`,
`max-w-5xl` or `max-w-7xl`. The result is a visibly different page. There is no partial
conversion that is also a no-op.

## What forcing it would have cost

Across the seven pages the analysis identified roughly twenty new block types that would be
needed — `contactForm`, `eventDirectory`, `donateWidget`, `linkList`, `serviceCards`,
`promoPanel`, `detailCardGrid`, `disclaimer`, `pageNav`, `numberedSteps`, `callout`, and so
on. Almost every one would be used exactly once.

A block type used once is not a block type. It is the same template with a layer of JSON
indirection in front of it, and it gives Nicole nothing: she cannot meaningfully reorder a
list of one, and the fields inside are as bespoke as the markup was. The cost is real
though — twenty more partials to keep in sync, twenty more entries in the CMS palette for
her to scroll past, and twenty more chances to break a live page.

## What was done instead

**Get Involved converted** — it is a genuine stack of five "tier" sections sharing one
repeated motif (large emoji → heading → intro → a card holding the action). Two new
reusable types came out of it: `banner` and `tierCard`.

**A `custom` block type was added.** It renders a whitelisted partial from
`components/custom/`. The Get Involved newsletter and share sections use it: they keep
their forms, their scripts and their load-bearing element ids, but they still appear in the
page's block list, so Nicole can reorder and hide them like anything else.

That escape hatch is the useful outcome for the other seven pages. If any of them is ever
worth making rearrangeable, it can be split into `custom` blocks one section at a time
without inventing a bespoke block type for each — reorder and hide first, editable fields
later, if they turn out to be wanted.

## Two specific traps recorded for whoever picks this up

1. **`get-involved.njk` had a page-level `<script>`** bound to `#share-copy` and
   `#share-copied` by id. It now travels inside `components/custom/get-involved-share.njk`
   so the behaviour moves with the section. Any similar conversion must do the same or the
   script and its markup can be reordered apart from each other.

2. **Fixed input ids are an accessibility contract.** `get-involved.njk` has
   `<label for="community-email">` pointing at a fixed id, while the generic `newsletter`
   block generates `newsletter-email-{{ blockIndex }}`. Swapping one for the other would
   have silently broken the label association — invisible in a screenshot, obvious to a
   screen reader. This is why the newsletter section stayed custom.
