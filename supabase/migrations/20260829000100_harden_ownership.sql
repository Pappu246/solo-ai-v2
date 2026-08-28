-- Harden ownership after the original demo migrations.
-- Safe to run after the existing migration chain.

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversations_user_id_fkey'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'Skipping conversations FK because legacy orphan rows still exist; clean those rows before adding the FK.';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'messages_user_id_fkey'
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'Skipping messages FK because legacy orphan rows still exist; clean those rows before adding the FK.';
END $$;

DROP POLICY IF EXISTS "Users own conversations" ON conversations;
CREATE POLICY "Users own conversations" ON conversations
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users own messages" ON messages;
CREATE POLICY "Users own messages" ON messages
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
