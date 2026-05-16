/*
  # Add model tracking columns to messages

  1. New Columns
    - `model` (text) - The model ID used for the response
    - `model_name` (text) - The display name of the model
    - `category` (text) - The routing category (coding, conversation, etc.)

  2. Notes
    - All columns are nullable since existing messages don't have this data
    - These columns allow tracking which AI model generated each response
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'model'
  ) THEN
    ALTER TABLE messages ADD COLUMN model text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'model_name'
  ) THEN
    ALTER TABLE messages ADD COLUMN model_name text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'category'
  ) THEN
    ALTER TABLE messages ADD COLUMN category text;
  END IF;
END $$;
