# SVG import fixtures

Line-work SVG for exercising `Importer.fromSVG`. Two sets, for two different jobs.

## `basic/` — hand-authored, geometry known exactly

Each file is small enough to read at a glance and its expected geometry is stated in a
comment at the top, so tests can assert real numbers — segment counts, perimeters, areas,
bounding boxes — rather than "it did not throw". They are ours, so there is no licence to
carry and no upstream that can change them underneath the tests.

| File | Covers |
|---|---|
| `lines.svg` | several `<line>` elements → separate open curves |
| `polyline-open.svg` | `<polyline>` points, open |
| `polygon-closed.svg` | `<polygon>`, closed; a 3-4-5 triangle so perimeter and area are exact integers |
| `rect-sharp.svg` | plain `<rect>` |
| `rect-rounded.svg` | `<rect rx>` — `ry` defaults to `rx`, corners become real arcs |
| `path-absolute.svg` | `M`/`H`/`V`/`L`/`Z` |
| `path-relative.svg` | the same rectangle in `m`/`h`/`v`/`l`/`z`; must import identically |
| `path-subpaths.svg` | two subpaths in one `d` → two curves |
| `group-transform.svg` | nested `<g transform>` composed with an element transform |
| `transform-matrix.svg` | raw `matrix(a b c d e f)` |
| `mixed-shapes.svg` | every element type the importer handles, in one document |
| `arc-path.svg` | circular `A` commands |

## `feather/` — real-world files, MIT licensed

Ten icons from [feathericons/feather](https://github.com/feathericons/feather), vendored
unmodified with their `LICENSE`. Chosen because they are genuine stroke-based line work
built from the elements this importer reads — `<line>`, `<polyline>`, `<polygon>`,
`<rect rx>`, `<circle>` and short `<path>`s — rather than the dense single-path outlines
most icon sets ship. They catch the things hand-authored files do not: attribute ordering,
`fill="none"`, decimal coordinate lists, and paths written by a tool rather than by hand.

Tests treat these as a smoke set: every file must import to at least one curve, with
finite geometry and no warnings. Their exact segment counts are deliberately **not**
asserted — they are upstream data and may change.

## Deliberately not vendored

The obvious larger collections each have a catch:

- **[resvg test suite](https://github.com/linebender/resvg)** — by far the best structured
  set (hundreds of tiny files, one feature each, organised by element). MPL-2.0, which is
  file-level copyleft, so vendoring pulls obligations into this repo.
- **W3C SVG 1.1 test suite** — thorough but aimed at renderers: most files test paint,
  text and filters, and carry the W3C test-suite licence.
- **[simple-icons](https://github.com/simple-icons/simple-icons)** — CC0, so licensing is
  free, but every icon is one dense `<path>` of Béziers. Useful as a stress test for the
  curve path, not for line work.

If a broader corpus is ever wanted, simple-icons is the one to reach for first on licence
grounds, and resvg's `shapes/` subtree is the one to reach for on coverage — read, not
copied.
