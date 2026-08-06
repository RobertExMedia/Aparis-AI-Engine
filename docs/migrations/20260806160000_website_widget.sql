-- Website widget: public keys + allowed domains.
-- Engine authenticates with X-Widget-Key and validates Origin against agent_domains.
-- Apply on Hub Supabase, then: NOTIFY pgrst, 'reload schema';

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

DROP TRIGGER IF EXISTS trg_agent_domains_updated ON public.agent_domains;
CREATE TRIGGER trg_agent_domains_updated
  BEFORE UPDATE ON public.agent_domains
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_widget_keys_updated ON public.widget_keys;
CREATE TRIGGER trg_widget_keys_updated
  BEFORE UPDATE ON public.widget_keys
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ Allow service_role to manage credits without end-user JWT ============

CREATE OR REPLACE FUNCTION public.get_workspace_credits(_workspace_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.workspace_credits;
BEGIN
  IF auth.role() = 'service_role' THEN
    NULL; -- Engine widget / ops path
  ELSIF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  ELSIF NOT public.current_user_is_workspace_member(_workspace_id) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  v_row := public.reset_workspace_credits_if_needed(_workspace_id);

  RETURN jsonb_build_object(
    'monthly_credits', v_row.monthly_credits,
    'used_credits', v_row.used_credits,
    'remaining_credits', v_row.remaining_credits,
    'reset_date', v_row.reset_date
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_workspace_credits(
  _workspace_id UUID,
  _credits INTEGER,
  _prompt_tokens INTEGER DEFAULT 0,
  _completion_tokens INTEGER DEFAULT 0,
  _endpoint TEXT DEFAULT 'chat',
  _request_id TEXT DEFAULT NULL,
  _agent_id UUID DEFAULT NULL,
  _conversation_id UUID DEFAULT NULL,
  _model TEXT DEFAULT NULL,
  _status TEXT DEFAULT 'success',
  _metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.workspace_credits;
  v_charge INTEGER;
  v_total INTEGER;
  v_user UUID;
BEGIN
  IF auth.role() = 'service_role' THEN
    v_user := NULL;
  ELSIF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  ELSIF NOT public.current_user_can_edit_workspace(_workspace_id) THEN
    RAISE EXCEPTION 'Forbidden';
  ELSE
    v_user := auth.uid();
  END IF;

  IF _credits IS NULL OR _credits < 0 THEN
    RAISE EXCEPTION 'Invalid credits';
  END IF;
  IF _status IS NULL OR _status NOT IN ('success', 'failed', 'rejected') THEN
    _status := 'success';
  END IF;

  v_row := public.reset_workspace_credits_if_needed(_workspace_id);
  v_total := GREATEST(0, COALESCE(_prompt_tokens, 0)) + GREATEST(0, COALESCE(_completion_tokens, 0));

  IF v_row.monthly_credits IS NULL THEN
    UPDATE public.workspace_credits
    SET used_credits = used_credits + _credits,
        updated_at = now()
    WHERE workspace_id = _workspace_id
    RETURNING * INTO v_row;
    v_charge := _credits;
  ELSE
    IF COALESCE(v_row.remaining_credits, 0) <= 0 AND _credits > 0 THEN
      INSERT INTO public.usage_events (
        workspace_id, user_id, agent_id, conversation_id, request_id, endpoint, model,
        prompt_tokens, completion_tokens, total_tokens, credits_charged, status, metadata
      ) VALUES (
        _workspace_id, v_user, _agent_id, _conversation_id, _request_id, COALESCE(_endpoint, 'chat'), _model,
        GREATEST(0, COALESCE(_prompt_tokens, 0)),
        GREATEST(0, COALESCE(_completion_tokens, 0)),
        v_total,
        0,
        'rejected',
        COALESCE(_metadata, '{}'::jsonb) || jsonb_build_object('reason', 'credits_exhausted')
      );

      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'credits_exhausted',
        'monthly_credits', v_row.monthly_credits,
        'used_credits', v_row.used_credits,
        'remaining_credits', 0,
        'reset_date', v_row.reset_date,
        'credits_charged', 0
      );
    END IF;

    v_charge := LEAST(_credits, COALESCE(v_row.remaining_credits, 0));

    UPDATE public.workspace_credits
    SET
      used_credits = used_credits + v_charge,
      remaining_credits = GREATEST(0, COALESCE(remaining_credits, 0) - v_charge),
      updated_at = now()
    WHERE workspace_id = _workspace_id
    RETURNING * INTO v_row;
  END IF;

  INSERT INTO public.usage_events (
    workspace_id, user_id, agent_id, conversation_id, request_id, endpoint, model,
    prompt_tokens, completion_tokens, total_tokens, credits_charged, status, metadata
  ) VALUES (
    _workspace_id, v_user, _agent_id, _conversation_id, _request_id, COALESCE(_endpoint, 'chat'), _model,
    GREATEST(0, COALESCE(_prompt_tokens, 0)),
    GREATEST(0, COALESCE(_completion_tokens, 0)),
    v_total,
    v_charge,
    _status,
    COALESCE(_metadata, '{}'::jsonb)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'monthly_credits', v_row.monthly_credits,
    'used_credits', v_row.used_credits,
    'remaining_credits', v_row.remaining_credits,
    'reset_date', v_row.reset_date,
    'credits_charged', v_charge
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
