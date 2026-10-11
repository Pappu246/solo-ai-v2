-- Harden privileged database functions against object shadowing.
--
-- consume_usage must remain SECURITY DEFINER because authenticated Edge Function
-- requests call the RPC with their user JWT while usage_counters deliberately
-- has no client table grants or RLS policies. Its authorization guard remains
-- the self-only auth.uid() check, and all application relations are explicitly
-- schema-qualified. An empty search_path prevents untrusted object shadowing.
ALTER FUNCTION public.consume_usage(uuid, text, bigint, integer, bigint, bigint)
  SET search_path = '';

-- This trigger helper uses only NEW and PostgreSQL's built-in now().
ALTER FUNCTION public.update_updated_at()
  SET search_path = '';
