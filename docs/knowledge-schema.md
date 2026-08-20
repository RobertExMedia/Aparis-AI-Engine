# Knowledge / RAG schema inspection (aparis-ai-hub origin/main)

Source migrations:
- `20260730142823_…` — tables + RLS
- `20260730142851_…` — storage policies for bucket `knowledge-files`
- `20260730170000_knowledge_embeddings_pgvector.sql` — **Engine-proposed** (pgvector + match RPC)

## Existing columns

### `knowledge_sources`
`id`, `workspace_id`, `name`, `description`, `type`, `status`, `language`, `category`, `tags`, `visibility`, `settings`, `storage_bytes`, `chunk_count`, `word_count`, `character_count`, `error_message`, `created_by`, `created_at`, `updated_at`, `last_processed_at`, `last_synced_at`

Enums: `knowledge_type`, `knowledge_status`

### `knowledge_files`
`id`, `knowledge_source_id`, `workspace_id`, `file_name`, `file_type`, `file_size`, `storage_path`, `source_url`, `status`, `page_count`, `row_count`, `error_message`, `metadata`, `created_at`, `updated_at`

Enum: `knowledge_file_status`

### `knowledge_chunks`
`id`, `knowledge_source_id`, `knowledge_file_id`, `workspace_id`, `chunk_index`, `content`, `token_count`, `source_page`, `embedding_status`, `metadata`, `created_at`, `updated_at`

**No embedding vector column in Lovable schema.**

Enum: `embedding_status` (`pending|processing|embedded|failed`)

### `agent_knowledge_sources`
`id`, `workspace_id`, `agent_id`, `knowledge_source_id`, `enabled`, `priority`, `required` (always-consult), `created_at`, `updated_at`  
Unique `(agent_id, knowledge_source_id)`

### Storage
Bucket id: `knowledge-files` (private). Path: `{workspaceId}/{sourceId}/{uuid}-{filename}`  
Policies isolate by workspace UUID folder segment. Bucket create may be dashboard-only (not in SQL).

## Missing for RAG (migration required)

| Item | Status |
|---|---|
| `pgvector` extension | **Not enabled** in Hub migrations |
| `knowledge_chunks.embedding` | **Missing** — add `vector(768)` for `nomic-embed-text` |
| Vector index | **Missing** — HNSW cosine |
| `match_knowledge_chunks` RPC | **Missing** — agent-scoped retrieval |

## Embedding model

- Model: `nomic-embed-text`
- Dimensions: **768**
- Endpoint: `OLLAMA_EMBEDDINGS_ENDPOINT` (default `/api/embeddings`)

## Not missing (no migration)

CRUD fields for sources/files/assignments, processing settings (in `settings` jsonb), statuses, RLS helpers.
