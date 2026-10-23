## 2026-05-18 - Multiple url() regex bypass in SVG attribute sanitization
**Vulnerability:** Single-pass `RegExp.prototype.exec()` on SVG attribute values allowed external URLs (e.g. `fill="url(#valid) url(https://evil.com/pixel.png)"`) to bypass sanitization because only the first `url(...)` target was inspected.
**Learning:** SVG/CSS presentation attributes can accept multiple `url(...)` targets. Using a non-global regex with `.exec()` validates only the first occurrence and leaves trailing external URLs active.
**Prevention:** Always iterate through all matches using `matchAll` with a global regex (`/gi`) when validating multi-URL attribute values, ensuring every target starts with `#`.
