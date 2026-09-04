-- Phase 2 security hardening: relational ownership invariants.
-- RLS protects visibility, while these triggers protect referential ownership even
-- when a caller knows another user's UUID. SECURITY DEFINER is used only for the
-- ownership lookup; it never exposes data to the caller.

CREATE OR REPLACE FUNCTION public.enforce_phase2_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = NEW.project_id
        AND p.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'project does not belong to user'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'files' AND NEW.conversation_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = NEW.conversation_id
        AND c.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'conversation does not belong to user'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'memories' AND NEW.source_conversation_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = NEW.source_conversation_id
        AND c.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'source conversation does not belong to user'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_phase2_ownership() FROM PUBLIC;

DROP TRIGGER IF EXISTS conversations_project_ownership ON public.conversations;
CREATE TRIGGER conversations_project_ownership
  BEFORE INSERT OR UPDATE OF user_id, project_id ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_phase2_ownership();

DROP TRIGGER IF EXISTS files_project_ownership ON public.files;
CREATE TRIGGER files_project_ownership
  BEFORE INSERT OR UPDATE OF user_id, project_id, conversation_id ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.enforce_phase2_ownership();

DROP TRIGGER IF EXISTS memories_project_ownership ON public.memories;
CREATE TRIGGER memories_project_ownership
  BEFORE INSERT OR UPDATE OF user_id, project_id, source_conversation_id ON public.memories
  FOR EACH ROW EXECUTE FUNCTION public.enforce_phase2_ownership();

-- Keep chunk ownership tied to the parent file as well as the authenticated user.
CREATE OR REPLACE FUNCTION public.enforce_file_chunk_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.files f
    WHERE f.id = NEW.file_id
      AND f.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'file does not belong to user'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_file_chunk_ownership() FROM PUBLIC;

DROP TRIGGER IF EXISTS file_chunks_ownership ON public.file_chunks;
CREATE TRIGGER file_chunks_ownership
  BEFORE INSERT OR UPDATE OF user_id, file_id ON public.file_chunks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_file_chunk_ownership();

COMMENT ON FUNCTION public.enforce_phase2_ownership() IS
  'Enforces that Phase 2 records only reference projects/conversations owned by the same user.';
COMMENT ON FUNCTION public.enforce_file_chunk_ownership() IS
  'Enforces that file chunks belong to the same user as their parent file.';
