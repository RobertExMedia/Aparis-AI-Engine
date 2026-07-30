# Aparis AI Hub — Schema Map (for Engine integration)

Source of truth: sibling project `aparis-ai-hub`  
Inspected: `supabase/migrations/*`, `src/integrations/supabase/types.ts`, `src/services/database/agents.ts`  
**No secrets.** Do not copy values from hub `.env`.

## Project identifiers (names only)

| Item | Value |
|------|--------|
| Hub env var for URL | `SUPABASE_URL` / `VITE_SUPABASE_URL` |
| Hub publishable key env | `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Hub service role env | `SUPABASE_SERVICE_ROLE_KEY` |
| Engine mapping | `SUPABASE_ANON_KEY` ← hub publishable/anon key |

## Enums

| Enum | Values |
|------|--------|
| `workspace_role` | `owner`, `admin`, `editor`, `viewer` |
| `workspace_status` | `trial`, `active`, `suspended`, `cancelled` |
| `agent_status` | `draft`, `published`, `archived` |
| `agent_tone` | `professional`, `friendly`, `concise`, `enthusiastic`, `empathetic`, `technical` |
| `app_role` | `super_admin` |
| `subscription_status` | `trialing`, `active`, `past_due`, `cancelled` |
| `invitation_status` | `pending`, `accepted`, `expired`, `revoked` |

## RLS helpers (use these)

| Function | Purpose |
|----------|---------|
| `current_user_is_workspace_member(_workspace_id)` | Membership or super_admin |
| `current_user_can_edit_workspace(_workspace_id)` | Role in `owner` \| `admin` \| `editor` |
| `current_user_is_workspace_admin(_workspace_id)` | Role in `owner` \| `admin` |
| `current_user_is_workspace_owner(_workspace_id)` | Role `owner` |
| `current_user_workspace_role(_workspace_id)` | Returns `workspace_role` |
| `generate_agent_public_id()` | Returns `agt_` + 16 hex chars |

**Chat authorization:** allow when role ∈ {`owner`,`admin`,`editor`} (= `current_user_can_edit_workspace`). Reject `viewer`.

## Tables used by the Engine

### `profiles`

`id`, `email`, `full_name`, `avatar_url`, `company_name`, `intended_use`, `onboarding_completed`, `created_at`, `updated_at`

### `workspaces`

`id`, `name`, `slug`, `logo_url`, `owner_id`, `plan_code`, `status`, `settings`, `created_at`, `updated_at`, `deleted_at`

### `workspace_members`

`id`, `workspace_id`, `user_id`, `role`, `created_at`, `updated_at`  
Unique `(workspace_id, user_id)`.

### `agents`

| Column | Type / notes |
|--------|----------------|
| `id` | uuid PK |
| `workspace_id` | uuid FK → workspaces |
| `public_id` | text unique, default `agt_…` |
| `name` | text |
| `description` | text nullable |
| `avatar_url` | text nullable |
| `status` | `agent_status` (`draft`\|`published`\|`archived`) |
| `greeting` | text |
| `system_prompt` | text |
| `tone` | `agent_tone` |
| `language` | text (default `en`) |
| `temperature` | numeric 0–2 (default 0.70) |
| `max_tokens` | int 128–8192 (default 1024) |
| `fallback_message` | text |
| `settings` | jsonb (no dedicated `model` column — optional model may live in settings) |
| `created_by` | uuid nullable |
| `published_at` | timestamptz nullable |
| `archived_at` | timestamptz nullable |
| `created_at` / `updated_at` | timestamptz |

**Unavailable for chat:** `status = 'archived'` (or `archived_at` set).  
Draft agents are allowed for workspace playground chat.

### Conversation tables (did not exist — added by Engine migration)

See migration in `aparis-ai-hub/supabase/migrations/` for `conversations` and `conversation_messages`.

## Not duplicated in Engine Prisma

Users, workspaces, memberships, agents, profiles, subscriptions remain **only** in Supabase.  
Local Prisma may still hold operational usage logs / future server API keys — never mirror hub tenants.

## Differences vs earlier assumptions

| Assumption | Reality |
|------------|---------|
| Dedicated `model` column on agents | **Missing** — use Engine `OLLAMA_CHAT_MODEL`; optionally `settings.model` if present and allowlisted |
| Conversation tables already exist | **Did not** — migration created |
| Hub anon key name | Hub uses `SUPABASE_PUBLISHABLE_KEY`; Engine env uses `SUPABASE_ANON_KEY` for the same value |
| Service role key | **Not required** for Hub playground — Engine uses user JWT + RLS |
