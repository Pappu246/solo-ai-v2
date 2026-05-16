/*
  # Fix RLS policies and add user ownership

  1. Changes
    - Add `user_id` column to `conversations` table (uuid, no FK constraint to avoid backfill issues)
    - Add `user_id` column to `messages` table (uuid, no FK constraint to avoid backfill issues)
    - Backfill existing rows with a sentinel user_id so they remain accessible
    - Drop all permissive "USING (true)" / "WITH CHECK (true)" policies
    - Create restrictive RLS policies that check auth.uid() = user_id
    - Add index on user_id for both tables

  2. Security
    - All policies now require the authenticated user to own the row
    - anon role has no access (data is fully locked down for unauthenticated users)
    - SELECT: users can only read their own rows
    - INSERT: users can only insert rows with their own user_id
    - UPDATE: users can only update their own rows
    - DELETE: users can only delete their own rows
*/

-- Add user_id to conversations (no FK to avoid backfill constraint issues)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE conversations ADD COLUMN user_id uuid;
  END IF;
END $$;

-- Add user_id to messages (no FK to avoid backfill constraint issues)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE messages ADD COLUMN user_id uuid;
  END IF;
END $$;

-- Backfill existing rows with a sentinel value so they aren't orphaned
UPDATE conversations SET user_id = '00000000-0000-0000-0000-000000000000'::uuid WHERE user_id IS NULL;
UPDATE messages SET user_id = '00000000-0000-0000-0000-000000000000'::uuid WHERE user_id IS NULL;

-- Make user_id NOT NULL now that all rows are populated
ALTER TABLE conversations ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE messages ALTER COLUMN user_id SET NOT NULL;

-- Add indexes for user_id lookups
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);

-- Drop the permissive policies
DROP POLICY IF EXISTS "Allow public read on conversations" ON conversations;
DROP POLICY IF EXISTS "Allow public insert on conversations" ON conversations;
DROP POLICY IF EXISTS "Allow public update on conversations" ON conversations;
DROP POLICY IF EXISTS "Allow public delete on conversations" ON conversations;
DROP POLICY IF EXISTS "Allow public read on messages" ON messages;
DROP POLICY IF EXISTS "Allow public insert on messages" ON messages;
DROP POLICY IF EXISTS "Allow public delete on messages" ON messages;

-- Create restrictive policies for conversations
CREATE POLICY "Users can read own conversations"
  ON conversations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own conversations"
  ON conversations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own conversations"
  ON conversations FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own conversations"
  ON conversations FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create restrictive policies for messages
CREATE POLICY "Users can read own messages"
  ON messages FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own messages"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own messages"
  ON messages FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
