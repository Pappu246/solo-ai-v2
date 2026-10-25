## 2026-10-24 - Control Character Obfuscation in URL Sanitization
**Vulnerability:** URLs containing embedded ASCII/C1 control characters (e.g. `java\tscript:`, `java\nscript:`) or surrounding whitespace could lead to unexpected behavior or potential scheme parsing bypasses depending on browser normalization rules in rendered anchor elements.
**Learning:** Standard `new URL()` constructors don't automatically strip all control characters prior to protocol checks, while HTML parsers and browsers historically strip control characters in `href` attributes during navigation.
**Prevention:** Always strip ASCII (`\x00-\x1F`) and C1 (`\x7F-\x9F`) control characters and trim whitespace in `safeHref` before protocol verification and rendering to `href` attributes.
