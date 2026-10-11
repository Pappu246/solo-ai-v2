-- Keep all SECURITY DEFINER ownership triggers independent of mutable
-- search_path resolution. Each trigger body references application tables with
-- explicit public schema qualification.
ALTER FUNCTION public.enforce_file_chunk_ownership()
  SET search_path = '';
ALTER FUNCTION public.enforce_file_conversation_ownership()
  SET search_path = '';
ALTER FUNCTION public.enforce_memory_conversation_ownership()
  SET search_path = '';
ALTER FUNCTION public.enforce_phase2_ownership()
  SET search_path = '';
ALTER FUNCTION public.enforce_phase2_project_ownership()
  SET search_path = '';
