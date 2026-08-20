-- Website widget infrastructure only (independently runnable).
-- Does NOT require workspace_credits / AI Credits.
-- Engine authenticates with X-Widget-Key and validates Origin against agent_domains.
-- Apply on Hub Supabase, then: NOTIFY pgrst, 'reload schema';
--
-- Depends on: public.workspaces, public.agents, public.set_updated_at(),
--             public.current_user_is_workspace_member(),
--             public.current_user_is_workspace_admin()

-- ============ agent_domains ============

CREATE TABLE IF NOT EXISTS public.agent_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'disabled')),
  verified_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_domains_domain_format CHECK (
    length(trim(domain)) > 0
    AND domain = lower(trim(domain))
  ),
  CONSTRAINT agent_domains_unique UNIQUE (agent_id, domain)
);

CREATE INDEX IF NOT EXISTS agent_domains_workspace_idx
  ON public.agent_domains (workspace_id);
CREATE INDEX IF NOT EXISTS agent_domains_agent_status_idx
  ON public.agent_domains (agent_id, status);

COMMENT ON TABLE public.agent_domains IS
  'Allowed website origins for the public embeddable widget (hostname, lowercase, no scheme).';

-- ============ widget_keys ============

CREATE TABLE IF NOT EXISTS public.widget_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default widget key',
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS widget_keys_agent_idx
  ON public.widget_keys (agent_id)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS widget_keys_workspace_idx
  ON public.widget_keys (workspace_id);

COMMENT ON TABLE public.widget_keys IS
  'Public widget keys (wpk_…). Safe to embed in websites; domain whitelist is the primary gate.';

-- ============ RLS ============

ALTER TABLE public.agent_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.widget_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read agent domains" ON public.agent_domains;
CREATE POLICY "Members can read agent domains"
  ON public.agent_domains FOR SELECT
  USING (public.current_user_is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Admins manage agent domains" ON public.agent_domains;
CREATE POLICY "Admins manage agent domains"
  ON public.agent_domains FOR ALL
  USING (public.current_user_is_workspace_admin(workspace_id))
  WITH CHECK (public.current_user_is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "Members can read widget keys metadata" ON public.widget_keys;
CREATE POLICY "Members can read widget keys metadata"
  ON public.widget_keys FOR SELECT
  USING (public.current_user_is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Admins manage widget keys" ON public.widget_keys;
CREATE POLICY "Admins manage widget keys"
  ON public.widget_keys FOR ALL
  USING (public.current_user_is_workspace_admin(workspace_id))
  WITH CHECK (public.current_user_is_workspace_admin(workspace_id));

GRANT SELECT ON public.agent_domains TO authenticated;
GRANT SELECT ON public.widget_keys TO authenticated;
GRANT ALL ON public.agent_domains TO service_role;
GRANT ALL ON public.widget_keys TO service_role;

-- ============ triggers ============

DROP TRIGGER IF EXISTS trg_agent_domains_updated ON public.agent_domains;
CREATE TRIGGER trg_agent_domains_updated
  BEFORE UPDATE ON public.agent_domains
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_widget_keys_updated ON public.widget_keys;
CREATE TRIGGER trg_widget_keys_updated
  BEFORE UPDATE ON public.widget_keys
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

NOTIFY pgrst, 'reload schema';
