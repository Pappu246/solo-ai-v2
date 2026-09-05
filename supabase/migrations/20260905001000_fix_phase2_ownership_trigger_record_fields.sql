-- Fix Phase 2 ownership triggers: PostgreSQL trigger NEW records are table-specific.
-- Keep project ownership in a generic function that only reads project_id, and
-- use table-specific functions for conversation references.

CREATE OR REPLACE FUNCTION public.enforce_phase2_project_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.projects p
       WHERE p.id = NEW.project_id
         AND p.user_id = NEW.user_id
     ) THEN
    RAISE EXCEPTION 'project does not belong to user' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_phase2_project_ownership() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.enforce_file_conversation_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.conversation_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.conversations c
       WHERE c.id = NEW.conversation_id
         AND c.user_id = NEW.user_id
     ) THEN
    RAISE EXCEPTION 'conversation does not belong to user' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_file_conversation_ownership() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.enforce_memory_conversation_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.source_conversation_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.conversations c
       WHERE c.id = NEW.source_conversation_id
         AND c.user_id = NEW.user_id
     ) THEN
    RAISE EXCEPTION 'source conversation does not belong to user' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_memory_conversation_ownership() FROM PUBLIC;

DROP TRIGGER IF EXISTS conversations_project_ownership ON public.conversations;
CREATE TRIGGER conversations_project_ownership
  BEFORE INSERT OR UPDATE OF user_id, project_id ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_phase2_project_ownership();

DROP TRIGGER IF EXISTS files_project_ownership ON public.files;
CREATE TRIGGER files_project_ownership
  BEFORE INSERT OR UPDATE OF user_id, project_id ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.enforce_phase2_project_ownership();

DROP TRIGGER IF EXISTS files_conversation_ownership ON public.files;
CREATE TRIGGER files_conversation_ownership
  BEFORE INSERT OR UPDATE OF user_id, conversation_id ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.enforce_file_conversation_ownership();

DROP TRIGGER IF EXISTS memories_project_ownership ON public.memories;
CREATE TRIGGER memories_project_ownership
  BEFORE INSERT OR UPDATE OF user_id, project_id ON public.memories
  FOR EACH ROW EXECUTE FUNCTION public.enforce_phase2_project_ownership();

DROP TRIGGER IF EXISTS memories_conversation_ownership ON public.memories;
CREATE TRIGGER memories_conversation_ownership
  BEFORE INSERT OR UPDATE OF user_id, source_conversation_id ON public.memories
  FOR EACH ROW EXECUTE FUNCTION public.enforce_memory_conversation_ownership();
