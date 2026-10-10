-- Phase 9: allow Word documents in the knowledge bucket.
-- `.docx` files are now detected and extracted entirely in the browser
-- (unzip word/document.xml — see src/lib/knowledge/docx.ts), then uploaded
-- with their real MIME type, so the bucket allow-list must accept it.
-- Additive and idempotent: safe to run after the Phase 3 migration chain.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY(
  SELECT DISTINCT m
  FROM unnest(
    COALESCE(allowed_mime_types, ARRAY[]::text[])
    || ARRAY['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  ) AS m
)
WHERE id = 'knowledge';
