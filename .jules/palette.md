## 2025-05-18 - Live status announcements for copy buttons
**Learning:** Updating `aria-label` or button text dynamically when an action completes (such as copying code or messages) is invisible to screen readers unless paired with an `aria-live` or `role="status"` region. Screen readers do not automatically re-announce button labels on state mutation.
**Action:** Always include an `aria-live="polite"` or `role="status"` live region for transient success states (copy to clipboard, save indicator, etc.) so assistive technology users receive explicit audio feedback.
