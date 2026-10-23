## 2025-05-18 - Fast-pathing Math Delimiters & Single-Pass Markdown Segmentation

**Learning:** Assistant markdown responses in chat streams repeatedly undergo segment extraction and LaTeX math normalization. Performing regex string manipulation on every segment on every render is costly, especially when >90% of message chunks contain no LaTeX math delimiters (`\` or `$`). Furthermore, allocating boolean arrays (`inFence`) during line parsing creates unnecessary garbage collection pressure during streaming updates.

**Action:** Fast-path check string contents for math delimiters (`\` and `$`) before executing regex replacements, process line fences in a single pass without intermediate array allocation, and pre-compute normalized segment text inside `useMemo`.
