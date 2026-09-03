-- Phase 1: archive support for conversations.
-- Additive and idempotent; safe to run after the existing migration chain.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'archived'
  ) THEN
    ALTER TABLE conversations ADD COLUMN archived BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- Sidebar lists a user's chats ordered by pinned, then recency.
CREATE INDEX IF NOT EXISTS idx_conversations_user_list
  ON conversations (user_id, archived, pinned DESC, updated_at DESC);
