/*
  # Add attachments column to messages table

  1. Changes
    - Add `attachments` column (jsonb, nullable) to `messages` table
    - This column stores serialized attachment data (file name, type, extracted text, etc.)
    - Default value is NULL since not all messages have attachments

  2. Security
    - No RLS policy changes needed - existing policies already cover this column
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'attachments'
  ) THEN
    ALTER TABLE messages ADD COLUMN attachments jsonb;
  END IF;
END $$;
