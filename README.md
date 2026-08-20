# Aparis AI Engine

Production-grade **backend AI engine** powering Aparis products. This is an API only — no frontend.

**Production URL:** `https://api-ai.aparis.io`  
**Ollama host:** `https://ai.aparis.io` (never exposed to frontends)

## Stack

| Layer | Tech |
|-------|------|
| Runtime | Node.js 22 + TypeScript |
| HTTP | Fastify |
| ORM | Prisma + PostgreSQL |
| Cache / queues | Redis + BullMQ |
| Auth | JWT + API Keys |
| Validation | Zod |
| Docs | Swagger / OpenAPI |
| Tests | Vitest |
| Deploy | Docker + Compose |

## Architecture

```
src/
  controllers/     HTTP adapters
  routes/          Route registration + OpenAPI schemas
  services/        Business logic
  repositories/    Data access (workspace-scoped)
  providers/       AI provider abstraction (Ollama)
  middleware/      Auth, rate limit, usage, errors
  workers/         BullMQ job workers
  config/          Env, DB, Redis
  types/           Shared types + Zod schemas
  utils/           Logger, crypto, errors
```

Multi-tenant: every request is bound to a `workspace_id`. Repositories always filter by workspace to prevent leakage.

## Quick start

```bash
cp .env.example .env
# edit secrets, DATABASE_URL, REDIS_URL, OLLAMA_*

npm install
npx prisma migrate deploy
npx prisma generate
npm run dev
```

Swagger UI: [http://localhost:3000/docs](http://localhost:3000/docs)

### Docker

```bash
cp .env.example .env
# set JWT_SECRET, ADMIN_JWT_SECRET, POSTGRES_PASSWORD

docker compose up -d --build
```

## Endpoints (v1)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | — | Service status |
| `GET` | `/api/v1/health` | — | DB, Redis, Ollama, disk, memory |
| `POST` | `/api/v1/chat` | JWT / API key | Chat completion |
| `POST` | `/api/v1/chat/stream` | JWT / API key | SSE streaming chat |
| `GET` | `/api/v1/models` | JWT / API key | List Ollama models |

### Auth

- **JWT:** `Authorization: Bearer <token>`  
  Payload: `{ sub, workspaceId, role }`
- **API key:** `X-API-Key: apk_...` or Bearer `apk_...`
- **Admin:** admin JWT (`type: admin` / `role: ADMIN`) or master API keys

### Chat body

```json
{
  "workspaceId": "ws_...",
  "agentId": "optional",
  "conversationId": "optional",
  "messages": [
    { "role": "user", "content": "Hello" }
  ]
}
```

### Stream (SSE)

```
data: {"id":"...","conversationId":"...","delta":"Hello","done":false}
data: {"id":"...","delta":"","done":true,"usage":{...}}
data: [DONE]
```

## Environment

See `.env.example`. Critical vars:

- `OLLAMA_BASE_URL` — default `https://ai.aparis.io`
- `OLLAMA_CHAT_MODEL` — default DeepSeek (`deepseek-r1:latest`)
- `OLLAMA_EMBED_MODEL` — default `nomic-embed-text`
- `JWT_SECRET` / `ADMIN_JWT_SECRET`
- `DATABASE_URL` / `REDIS_URL`

## Deferred (interfaces only)

- Knowledge / Supabase RAG (`KnowledgeService`)
- Billing
- Full worker job implementations

## Scripts

```bash
npm run dev          # watch mode
npm run build        # compile
npm start            # production
npm test             # vitest
npm run prisma:migrate
```
