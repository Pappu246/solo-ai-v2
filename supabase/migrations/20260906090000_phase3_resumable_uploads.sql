-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3 (Chunk 4/5) — resumable uploads for the private "knowledge" bucket.
--
-- The browser now uploads through the Storage TUS endpoint in 6 MB chunks, so
-- the artificial 20 MB bucket cap is lifted. The bucket stays PRIVATE and every
-- storage.objects policy from the Phase 2 migration is left untouched: objects
-- must still live under "<user_id>/…" and are only readable by their owner.
--
-- Additive and idempotent. Safe to run after the existing migration chain.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE storage.buckets
SET
  public = false,
  -- NULL = no bucket-specific limit; the project-wide upload limit applies.
  file_size_limit = NULL,
  -- Everything the client can extract text from. Code files are normalised to
  -- text/plain by the client, but browsers occasionally attach their own MIME
  -- type to the TUS metadata, so the common source-code types are allowed too.
  allowed_mime_types = ARRAY[
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/x-markdown',
    'text/csv',
    'text/tab-separated-values',
    'application/json',
    'text/x-python',
    'text/x-script.python',
    'text/javascript',
    'application/javascript',
    'application/typescript',
    'text/x-c',
    'text/x-c++',
    'text/x-java-source',
    'application/xml',
    'text/xml'
  ]
WHERE id = 'knowledge';

-- Defense in depth: assert the ownership policies still exist. If a policy was
-- dropped by hand, fail loudly instead of leaving the bucket without one.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(p, ', ') INTO missing
  FROM unnest(ARRAY[
    'knowledge: users read own objects',
    'knowledge: users upload own objects',
    'knowledge: users update own objects',
    'knowledge: users delete own objects'
  ]) AS p
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = p
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'knowledge bucket policies missing: %. Re-run 20260903120000_phase2_knowledge.sql first.', missing;
  END IF;
END $$;

-- The authenticated role must be able to reach the Phase 2 tables for RLS to be
-- evaluated at all (PostgREST reports a missing grant as a 42501 as well).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.projects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.files TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.memories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.file_chunks TO authenticated;
