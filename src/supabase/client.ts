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
 * This is the primary path for Aparis AI Hub / Lovable Cloud (no service-role required).
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

/**
 * Anonymous / publishable client (no user JWT). Useful for health checks
 * against publicly readable tables like `plans`.
 */
export function createAnonSupabaseClient(): AppSupabaseClient {
  return createClient<Database>(config.supabase.url, config.supabase.anonKey, {
    global: {
      fetch: createSupabaseFetch(config.supabase.anonKey),
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
 * Optional service-role client. Not required for Hub playground.
 * Lovable Cloud does not expose this key — leave SUPABASE_SERVICE_ROLE_KEY unset.
 */
export function getServiceSupabaseClient(): AppSupabaseClient {
  if (!config.supabase.serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not configured. Hub playground uses user JWT + RLS instead.',
    );
  }
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

export function hasServiceRoleKey(): boolean {
  return Boolean(config.supabase.serviceRoleKey);
}

export function resetServiceSupabaseClient(): void {
  serviceClient = null;
}
