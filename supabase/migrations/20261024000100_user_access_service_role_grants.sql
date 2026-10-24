-- Fix: approving a request failed with "Could not save the decision" because
-- service_role had no INSERT/UPDATE on user_access. Idempotent.
grant select, insert, update, delete on public.user_access to service_role;
