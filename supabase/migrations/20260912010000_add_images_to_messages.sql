-- Persist server-returned Smart Image Search results with assistant messages.
-- Existing rows remain valid because the column is nullable.
alter table public.messages
  add column if not exists images jsonb null;

comment on column public.messages.images is
  'Normalized Smart Image Search results attached to an assistant message; contains URLs, thumbnails, titles and source attribution.';

alter table public.messages
  add constraint messages_images_is_array
  check (images is null or jsonb_typeof(images) = 'array');
