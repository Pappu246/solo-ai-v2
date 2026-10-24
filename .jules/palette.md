## 2025-10-24 - Accessible Styled Tooltips on IconButton

**Learning:** Combining CSS tooltips (`group-hover` and `group-focus-visible`) with `aria-label` provides styled visual feedback on hover/focus without introducing duplicate browser native title popups when custom tooltips are active.
**Action:** In `IconButton.tsx`, suppress standard `title` attributes when custom visual tooltips are rendered (`showTooltip=true`), keeping `aria-label` as the primary accessible name.
