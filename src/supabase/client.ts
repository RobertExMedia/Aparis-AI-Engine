import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';
import type { Database } from './database.types.js';

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith('sb_publishable_') || value.startsWith('sb_secret_');
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    // New Supabase API keys are opaque strings, not bearer JWTs.
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get('Authorization') === `Bearer ${supabaseKey}`
    ) {
      headers.delete('Authorization');
    }

    headers.set('apikey', supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

export type AppSupabaseClient = SupabaseClient<Database>;

/**
 * User-scoped client: RLS applies as the authenticated Supabase user.
 */
export function createUserSupabaseClient(accessToken: string): AppSupabaseClient {
  return createClient<Database>(config.supabase.url, config.supabase.anonKey, {
    global: {
      fetch: createSupabaseFetch(config.supabase.anonKey),
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

let serviceClient: AppSupabaseClient | null = null;

/**
 * Service-role client: bypasses RLS. Use only after explicit authorization checks.
 * Never expose this key to clients or logs.
 */
export function getServiceSupabaseClient(): AppSupabaseClient {
  if (!serviceClient) {
    serviceClient = createClient<Database>(
      config.supabase.url,
      config.supabase.serviceRoleKey,
      {
        global: {
          fetch: createSupabaseFetch(config.supabase.serviceRoleKey),
        },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
  }
  return serviceClient;
}

/** Test helper to reset singleton. */
export function resetServiceSupabaseClient(): void {
  serviceClient = null;
}
