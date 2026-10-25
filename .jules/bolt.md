## 2025-05-21 - Short-circuiting String Operations and Single-pass Extraction

**Learning:**
1. In `dedupeChunks`, calling `long.includes(short)` before checking string length ratios evaluated expensive $O(N)$ substring searches on chunk pairs that would subsequently fail the 90% length ratio threshold. Reordering boolean operands short-circuits evaluation and skips substring searches when length differences exceed 10%.
2. In `extractKeywords`, chaining `.filter()` over all tokens in input text created intermediate array allocations and tested unnecessary words against stopwords and regexes even after reaching the keyword cap (`max = 12`). Combining filtering with early termination inside a single `for` loop stops evaluating words as soon as `max` unique keywords are found.

**Action:**
1. Always evaluate cheap scalar bounds (e.g., length, ratio, type checks) before invoking $O(N)$ string operations like `includes()`, `indexOf()`, or regexes.
2. When extracting or capping results from collection processing, avoid intermediate `.filter()` allocations when processing can break early once the quota is reached.
