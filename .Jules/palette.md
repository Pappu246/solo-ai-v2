## 2025-02-20 - Disabled IconButton pointer-events and title tooltips
**Learning:** Combining `disabled:pointer-events-none` with `title={label}` on `<button>` elements prevents native hover tooltips from displaying when disabled, and negates the `disabled:cursor-not-allowed` visual feedback.
**Action:** Omit `pointer-events-none` on disabled icon buttons so native tooltips and `not-allowed` cursor feedback remain interactive.
