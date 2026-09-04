-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2 — Knowledge layer: projects, files, file_chunks, memories,
-- Supabase Storage bucket + policies, global search and chunk retrieval RPCs.
--
-- Additive and idempotent. Safe to run after the existing migration chain.
-- No existing column is dropped or altered destructively.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── shared trigger (already present from the v3 migration; kept idempotent) ──
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

-- ── projects ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description   text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  instructions  text NOT NULL DEFAULT '' CHECK (char_length(instructions) <= 4000),
  archived      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own projects" ON projects;
CREATE POLICY "Users own projects" ON projects
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_projects_user_list
  ON projects (user_id, archived, updated_at DESC);

DROP TRIGGER IF EXISTS projects_updated_at ON projects;
CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── conversations.project_id ─────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'project_id'
  ) THEN
    ALTER TABLE conversations
      ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_project
  ON conversations (project_id, updated_at DESC)
  WHERE project_id IS NOT NULL;

-- ── messages.sources (knowledge sources used for an assistant reply) ─────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'sources'
  ) THEN
    ALTER TABLE messages ADD COLUMN sources jsonb;
  END IF;
END $$;

-- ── files ────────────────────────────────────────────────────────────────────
-- Metadata only. File bytes live in Storage; extracted text lives in file_chunks.
CREATE TABLE IF NOT EXISTS files (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id       uuid REFERENCES projects(id) ON DELETE SET NULL,
  conversation_id  uuid REFERENCES conversations(id) ON DELETE SET NULL,
  name             text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  mime_type        text NOT NULL DEFAULT 'application/octet-stream',
  size             bigint NOT NULL CHECK (size >= 0),
  storage_path     text NOT NULL UNIQUE,
  status           text NOT NULL DEFAULT 'uploading'
                   CHECK (status IN ('uploading', 'processing', 'ready', 'failed')),
  error            text,
  chunk_count      integer NOT NULL DEFAULT 0,
  char_count       integer NOT NULL DEFAULT 0,
  preview          text CHECK (preview IS NULL OR char_length(preview) <= 600),
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- Ownership is enforced on every operation. The storage_path must sit inside
-- the caller's own folder so a row can never point at another user's object.
DROP POLICY IF EXISTS "Users read own files" ON files;
CREATE POLICY "Users read own files" ON files
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own files" ON files;
CREATE POLICY "Users insert own files" ON files
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND split_part(storage_path, '/', 1) = auth.uid()::text);

DROP POLICY IF EXISTS "Users update own files" ON files;
CREATE POLICY "Users update own files" ON files
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND split_part(storage_path, '/', 1) = auth.uid()::text);

DROP POLICY IF EXISTS "Users delete own files" ON files;
CREATE POLICY "Users delete own files" ON files
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_files_user_created ON files (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_project ON files (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_conversation ON files (conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_name_fts ON files USING gin (to_tsvector('simple', name));

DROP TRIGGER IF EXISTS files_updated_at ON files;
CREATE TRIGGER files_updated_at
  BEFORE UPDATE ON files
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── file_chunks ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS file_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id      uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chunk_index  integer NOT NULL CHECK (chunk_index >= 0),
  content      text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 8000),
  char_count   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_id, chunk_index)
);

ALTER TABLE file_chunks ENABLE ROW LEVEL SECURITY;

-- A chunk may only be written for a file the caller owns.
DROP POLICY IF EXISTS "Users read own file chunks" ON file_chunks;
CREATE POLICY "Users read own file chunks" ON file_chunks
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own file chunks" ON file_chunks;
CREATE POLICY "Users insert own file chunks" ON file_chunks
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM files f WHERE f.id = file_id AND f.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users delete own file chunks" ON file_chunks;
CREATE POLICY "Users delete own file chunks" ON file_chunks
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_file_chunks_user ON file_chunks (user_id);
CREATE INDEX IF NOT EXISTS idx_file_chunks_content_fts
  ON file_chunks USING gin (to_tsvector('english', content));

-- ── memories ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memories (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id              uuid REFERENCES projects(id) ON DELETE CASCADE,
  type                    text NOT NULL DEFAULT 'fact'
                          CHECK (type IN ('fact', 'preference', 'instruction', 'context')),
  content                 text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
  source                  text NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'chat')),
  source_conversation_id  uuid REFERENCES conversations(id) ON DELETE SET NULL,
  importance              smallint NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own memories" ON memories;
CREATE POLICY "Users own memories" ON memories
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_memories_user_scope
  ON memories (user_id, project_id, importance DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_content_fts
  ON memories USING gin (to_tsvector('simple', content));

DROP TRIGGER IF EXISTS memories_updated_at ON memories;
CREATE TRIGGER memories_updated_at
  BEFORE UPDATE ON memories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Search indexes on existing tables ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_conversations_title_fts
  ON conversations USING gin (to_tsvector('simple', title));
CREATE INDEX IF NOT EXISTS idx_messages_content_fts
  ON messages USING gin (to_tsvector('simple', content));
CREATE INDEX IF NOT EXISTS idx_projects_name_fts
  ON projects USING gin (to_tsvector('simple', name || ' ' || description));

-- ── Storage: private "knowledge" bucket ──────────────────────────────────────
-- Objects are stored under "<user_id>/<file_id>/<name>". Every policy checks
-- that the first path segment equals the caller's id, so a user can never
-- read, overwrite or delete another user's objects even with a guessed path.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'knowledge', 'knowledge', false, 20971520,
  ARRAY['application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'application/json']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "knowledge: users read own objects" ON storage.objects;
CREATE POLICY "knowledge: users read own objects" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'knowledge' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "knowledge: users upload own objects" ON storage.objects;
CREATE POLICY "knowledge: users upload own objects" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'knowledge' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "knowledge: users update own objects" ON storage.objects;
CREATE POLICY "knowledge: users update own objects" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'knowledge' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'knowledge' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "knowledge: users delete own objects" ON storage.objects;
CREATE POLICY "knowledge: users delete own objects" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'knowledge' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ── Helper: build a safe prefix-matching OR tsquery from a word list ─────────
-- Strips everything except letters/digits so user input can never break the
-- tsquery parser. Returns NULL when no usable word remains.
CREATE OR REPLACE FUNCTION knowledge_tsquery(p_words text[], p_config regconfig)
RETURNS tsquery
LANGUAGE sql IMMUTABLE STRICT
SET search_path = public
AS $$
  SELECT CASE WHEN count(*) = 0 THEN NULL
              ELSE to_tsquery(p_config, string_agg(w || ':*', ' | '))
         END
  FROM (
    SELECT DISTINCT lower(regexp_replace(word, '[^[:alnum:]]', '', 'g')) AS w
    FROM unnest(p_words[1:12]) AS word
  ) s
  WHERE w <> '' AND char_length(w) <= 64;
$$;

-- ── Retrieval: rank chunks of the caller's own files against a query ─────────
-- SECURITY INVOKER: row level security applies. The explicit auth.uid()
-- predicates are defense in depth, not the only barrier.
CREATE OR REPLACE FUNCTION match_file_chunks(
  p_words    text[],
  p_file_ids uuid[],
  p_limit    integer DEFAULT 24
)
RETURNS TABLE (
  file_id     uuid,
  file_name   text,
  chunk_index integer,
  content     text,
  rank        real
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH q AS (SELECT knowledge_tsquery(p_words, 'english'::regconfig) AS query)
  SELECT c.file_id,
         f.name,
         c.chunk_index,
         c.content,
         ts_rank_cd(to_tsvector('english', c.content), q.query, 32)::real AS rank
  FROM file_chunks c
  JOIN files f ON f.id = c.file_id
  CROSS JOIN q
  WHERE q.query IS NOT NULL
    AND c.user_id = auth.uid()
    AND f.user_id = auth.uid()
    AND f.status = 'ready'
    AND c.file_id = ANY (p_file_ids)
    AND to_tsvector('english', c.content) @@ q.query
  ORDER BY rank DESC, c.chunk_index ASC
  LIMIT greatest(1, least(coalesce(p_limit, 24), 50));
$$;

REVOKE ALL ON FUNCTION match_file_chunks(text[], uuid[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION match_file_chunks(text[], uuid[], integer) TO authenticated;

-- ── Global search across the caller's own data ───────────────────────────────
-- Returns a flat, ranked list; the client groups by kind. p_kinds narrows to a
-- subset (used for "show more" pagination of a single group).
CREATE OR REPLACE FUNCTION search_all(
  p_query  text,
  p_kinds  text[] DEFAULT NULL,
  p_limit  integer DEFAULT 30,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  kind            text,
  id              uuid,
  title           text,
  snippet         text,
  conversation_id uuid,
  project_id      uuid,
  updated_at      timestamptz,
  rank            real
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      auth.uid() AS uid,
      knowledge_tsquery(regexp_split_to_array(trim(coalesce(p_query, '')), '\s+'), 'simple'::regconfig) AS tsq,
      knowledge_tsquery(regexp_split_to_array(trim(coalesce(p_query, '')), '\s+'), 'english'::regconfig) AS tsq_en,
      '%' || replace(replace(replace(trim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pattern,
      greatest(1, least(coalesce(p_limit, 30), 100)) AS lim,
      greatest(0, coalesce(p_offset, 0)) AS off
  ),
  hits AS (
    -- Conversations by title
    (SELECT 'conversation'::text AS kind, c.id AS id, c.title AS title, NULL::text AS snippet,
            c.id AS conversation_id, c.project_id AS project_id, c.updated_at AS updated_at,
            (CASE WHEN c.title ILIKE p.pattern THEN 1.0 ELSE 0.6 END)::real AS rank
     FROM conversations c, params p
     WHERE c.user_id = p.uid
       AND (p_kinds IS NULL OR 'conversation' = ANY (p_kinds))
       AND (c.title ILIKE p.pattern OR (p.tsq IS NOT NULL AND to_tsvector('simple', c.title) @@ p.tsq))
     ORDER BY rank DESC, updated_at DESC
     LIMIT (SELECT lim + off FROM params))
    UNION ALL
    -- Messages by content (snippet marks matched words with ⟦ ⟧ for the UI to highlight)
    (SELECT 'message'::text AS kind, m.id AS id, c.title AS title,
            ts_headline('simple', left(m.content, 4000), p.tsq,
                        'MaxWords=24, MinWords=10, MaxFragments=1, StartSel="⟦", StopSel="⟧", FragmentDelimiter=" … "') AS snippet,
            m.conversation_id AS conversation_id, c.project_id AS project_id, m.created_at AS updated_at,
            ts_rank_cd(to_tsvector('simple', m.content), p.tsq, 32)::real AS rank
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     CROSS JOIN params p
     WHERE m.user_id = p.uid AND c.user_id = p.uid
       AND (p_kinds IS NULL OR 'message' = ANY (p_kinds))
       AND p.tsq IS NOT NULL
       AND to_tsvector('simple', m.content) @@ p.tsq
     ORDER BY rank DESC, updated_at DESC
     LIMIT (SELECT lim + off FROM params))
    UNION ALL
    -- Projects by name/description
    (SELECT 'project'::text AS kind, pr.id AS id, pr.name AS title, nullif(left(pr.description, 200), '') AS snippet,
            NULL::uuid AS conversation_id, pr.id AS project_id, pr.updated_at AS updated_at,
            (CASE WHEN pr.name ILIKE p.pattern THEN 1.0 ELSE 0.6 END)::real AS rank
     FROM projects pr, params p
     WHERE pr.user_id = p.uid
       AND (p_kinds IS NULL OR 'project' = ANY (p_kinds))
       AND (pr.name ILIKE p.pattern OR pr.description ILIKE p.pattern
            OR (p.tsq IS NOT NULL AND to_tsvector('simple', pr.name || ' ' || pr.description) @@ p.tsq))
     ORDER BY rank DESC, updated_at DESC
     LIMIT (SELECT lim + off FROM params))
    UNION ALL
    -- Files by name, or by matching content in their chunks
    (SELECT 'file'::text AS kind, f.id AS id, f.name AS title,
            CASE WHEN f.name ILIKE p.pattern THEN nullif(left(coalesce(f.preview, ''), 200), '')
                 ELSE (SELECT ts_headline('english', left(ch.content, 4000), p.tsq_en,
                                          'MaxWords=24, MinWords=10, MaxFragments=1, StartSel="⟦", StopSel="⟧", FragmentDelimiter=" … "')
                       FROM file_chunks ch
                       WHERE ch.file_id = f.id AND ch.user_id = p.uid
                         AND p.tsq_en IS NOT NULL
                         AND to_tsvector('english', ch.content) @@ p.tsq_en
                       ORDER BY ts_rank_cd(to_tsvector('english', ch.content), p.tsq_en, 32) DESC
                       LIMIT 1)
            END AS snippet,
            f.conversation_id AS conversation_id, f.project_id AS project_id, f.updated_at AS updated_at,
            (CASE WHEN f.name ILIKE p.pattern THEN 1.0 ELSE 0.5 END)::real AS rank
     FROM files f, params p
     WHERE f.user_id = p.uid
       AND (p_kinds IS NULL OR 'file' = ANY (p_kinds))
       AND (f.name ILIKE p.pattern
            OR (p.tsq IS NOT NULL AND to_tsvector('simple', f.name) @@ p.tsq)
            OR (p.tsq_en IS NOT NULL AND f.status = 'ready' AND EXISTS (
                  SELECT 1 FROM file_chunks ch
                  WHERE ch.file_id = f.id AND ch.user_id = p.uid
                    AND to_tsvector('english', ch.content) @@ p.tsq_en)))
     ORDER BY rank DESC, updated_at DESC
     LIMIT (SELECT lim + off FROM params))
    UNION ALL
    -- Memories by content
    (SELECT 'memory'::text AS kind, me.id AS id, left(me.content, 120) AS title, nullif(left(me.content, 300), '') AS snippet,
            me.source_conversation_id AS conversation_id, me.project_id AS project_id, me.updated_at AS updated_at,
            (CASE WHEN me.content ILIKE p.pattern THEN 0.9 ELSE 0.5 END)::real AS rank
     FROM memories me, params p
     WHERE me.user_id = p.uid
       AND (p_kinds IS NULL OR 'memory' = ANY (p_kinds))
       AND (me.content ILIKE p.pattern OR (p.tsq IS NOT NULL AND to_tsvector('simple', me.content) @@ p.tsq))
     ORDER BY rank DESC, updated_at DESC
     LIMIT (SELECT lim + off FROM params))
  )
  SELECT h.kind, h.id, h.title, h.snippet, h.conversation_id, h.project_id, h.updated_at, h.rank
  FROM hits h, params p
  WHERE char_length(trim(coalesce(p_query, ''))) >= 2
  ORDER BY h.rank DESC, h.updated_at DESC
  LIMIT (SELECT lim FROM params)
  OFFSET (SELECT off FROM params);
$$;

REVOKE ALL ON FUNCTION search_all(text, text[], integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION search_all(text, text[], integer, integer) TO authenticated;
