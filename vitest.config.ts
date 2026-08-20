import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'test-anon-key',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-jwt-secret-32-characters!!',
      ADMIN_JWT_SECRET: 'test-admin-secret-32-characters!',
      ALLOWED_ORIGINS: 'https://studio.aparis.io,http://localhost:5173,http://localhost:8080',
      OLLAMA_BASE_URL: 'https://ai.aparis.io',
      OLLAMA_CHAT_ENDPOINT: '/api/chat',
      OLLAMA_MODELS_ENDPOINT: '/api/tags',
      OLLAMA_EMBED_ENDPOINT: '/api/embed',
      OLLAMA_EMBEDDINGS_ENDPOINT: '/api/embeddings',
      OLLAMA_CHAT_MODEL: 'deepseek-r1:1.5b',
    },
  },
});
