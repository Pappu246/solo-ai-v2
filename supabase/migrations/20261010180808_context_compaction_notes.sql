-- No schema change is required for context compaction.
-- `messages` remains the canonical, complete conversation history.
-- The chat Edge Function compacts only the transient provider request context.
comment on table public.messages is 'Canonical complete chat history. Model context may be compacted transiently; stored messages are never deleted for context management.';
