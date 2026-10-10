-- Phase 5: persist web research sources alongside assistant messages.
-- Existing rows remain valid because the column is nullable.
alter table public.messages
  add column if not exists web_sources jsonb null;

comment on column public.messages.web_sources is
  'Web research sources cited by an assistant reply; each entry has title, url, domain, optional snippet and rank.';

alter table public.messages
  add constraint messages_web_sources_is_array
  check (web_sources is null or jsonb_typeof(web_sources) = 'array');
