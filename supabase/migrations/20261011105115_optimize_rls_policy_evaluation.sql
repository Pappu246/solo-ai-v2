-- Optimize owner-only RLS checks to evaluate auth.uid() once per statement.
-- Remove duplicate ALL policies on conversations/messages; equivalent CRUD policies remain.
DROP POLICY IF EXISTS "Users own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users own messages" ON public.messages;

ALTER POLICY "Users can read own conversations" ON public.conversations
  USING ((SELECT auth.uid()) = user_id);
ALTER POLICY "Users can insert own conversations" ON public.conversations
  WITH CHECK ((SELECT auth.uid()) = user_id);
ALTER POLICY "Users can update own conversations" ON public.conversations
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
ALTER POLICY "Users can delete own conversations" ON public.conversations
  USING ((SELECT auth.uid()) = user_id);

ALTER POLICY "Users can read own messages" ON public.messages
  USING ((SELECT auth.uid()) = user_id);
ALTER POLICY "Users can insert own messages" ON public.messages
  WITH CHECK ((SELECT auth.uid()) = user_id);
ALTER POLICY "Users can delete own messages" ON public.messages
  USING ((SELECT auth.uid()) = user_id);

ALTER POLICY "Users read own files" ON public.files
  USING ((SELECT auth.uid()) = user_id);
ALTER POLICY "Users insert own files" ON public.files
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND split_part(storage_path, '/', 1) = (SELECT auth.uid())::text
  );
ALTER POLICY "Users update own files" ON public.files
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND split_part(storage_path, '/', 1) = (SELECT auth.uid())::text
  );
ALTER POLICY "Users delete own files" ON public.files
  USING ((SELECT auth.uid()) = user_id);

ALTER POLICY "Users read own file chunks" ON public.file_chunks
  USING ((SELECT auth.uid()) = user_id);
ALTER POLICY "Users insert own file chunks" ON public.file_chunks
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1
      FROM public.files AS f
      WHERE f.id = file_chunks.file_id
        AND f.user_id = (SELECT auth.uid())
    )
  );
ALTER POLICY "Users delete own file chunks" ON public.file_chunks
  USING ((SELECT auth.uid()) = user_id);

ALTER POLICY "Users own folders" ON public.folders
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
ALTER POLICY "Users own memories" ON public.memories
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
ALTER POLICY "Users own projects" ON public.projects
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Support foreign-key checks/deletes on nullable memory references.
CREATE INDEX IF NOT EXISTS idx_memories_project_id
  ON public.memories (project_id);
CREATE INDEX IF NOT EXISTS idx_memories_source_conversation_id
  ON public.memories (source_conversation_id);

-- Exact duplicate of idx_messages_conversation; keep one canonical index.
DROP INDEX IF EXISTS public.idx_messages_conversation_id;
