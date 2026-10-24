## 2025-05-18 - Markdown and Math Fast-Paths
**Learning:** During chat streaming, components like `Markdown` re-render frequently (on every incoming token delta). Helper functions such as `splitMarkdownSegments` and `normalizeMathDelimiters` run on every render.
**Action:** Always place cheap `includes()` short-circuit guards before line splitting, array allocations, or regex replacements on plain text strings.
