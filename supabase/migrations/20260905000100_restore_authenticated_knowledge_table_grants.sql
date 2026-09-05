-- Phase 2 runtime fix: restore PostgREST CRUD privileges for the authenticated role.
-- RLS policies remain the authorization boundary; these grants only allow the
-- authenticated role to reach the tables so those policies can be evaluated.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.projects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.files TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.memories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.file_chunks TO authenticated;
