-- Include token_count in match_knowledge_chunks for retrieval debug.
-- Apply on Hub Supabase, then: NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_embedding extensions.vector(768),
  match_workspace_id uuid,
  match_agent_id uuid,
  match_count integer DEFAULT 8,
  match_threshold double precision DEFAULT 0.25
)
RETURNS TABLE (
  id uuid,
  knowledge_source_id uuid,
  knowledge_file_id uuid,
  content text,
  metadata jsonb,
  source_page integer,
  similarity double precision,
  source_name text,
  file_name text,
  source_url text,
  priority integer,
  required boolean,
  token_count integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT
    c.id,
    c.knowledge_source_id,
    c.knowledge_file_id,
    c.content,
    c.metadata,
    c.source_page,
    (1 - (c.embedding <=> query_embedding))::double precision AS similarity,
    s.name AS source_name,
    f.file_name,
    COALESCE(f.source_url, (c.metadata ->> 'url')) AS source_url,
    aks.priority,
    aks.required,
    c.token_count
  FROM public.knowledge_chunks c
  INNER JOIN public.agent_knowledge_sources aks
    ON aks.knowledge_source_id = c.knowledge_source_id
   AND aks.agent_id = match_agent_id
   AND aks.workspace_id = match_workspace_id
   AND aks.enabled = true
  INNER JOIN public.knowledge_sources s
    ON s.id = c.knowledge_source_id
   AND s.workspace_id = match_workspace_id
   AND s.status = 'ready'
  LEFT JOIN public.knowledge_files f
    ON f.id = c.knowledge_file_id
  WHERE c.workspace_id = match_workspace_id
    AND c.embedding IS NOT NULL
    AND c.embedding_status = 'embedded'
    AND length(btrim(c.content)) > 0
    AND (1 - (c.embedding <=> query_embedding)) >= match_threshold
  ORDER BY
    aks.required DESC,
    aks.priority DESC,
    c.embedding <=> query_embedding ASC
  LIMIT greatest(match_count, 1);
$$;

GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(
  extensions.vector,
  uuid,
  uuid,
  integer,
  double precision
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
