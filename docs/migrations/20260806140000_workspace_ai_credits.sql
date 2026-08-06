-- AI Credits for workspaces (Stripe-ready ledger; no payment provider wired yet).
-- Apply on the Hub Supabase project, then:
--   NOTIFY pgrst, 'reload schema';

-- ============ TABLES ============

CREATE TABLE IF NOT EXISTS public.workspace_credits (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  monthly_credits INTEGER NULL,
  used_credits INTEGER NOT NULL DEFAULT 0 CHECK (used_credits >= 0),
  remaining_credits INTEGER NULL,
  reset_date TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workspace_credits_remaining_lte_monthly CHECK (
    monthly_credits IS NULL
    OR remaining_credits IS NULL
    OR remaining_credits <= monthly_credits
  )
);

COMMENT ON TABLE public.workspace_credits IS
  'Per-workspace AI credit balance. monthly_credits NULL = unlimited. Stripe can update allotment later.';
COMMENT ON COLUMN public.workspace_credits.monthly_credits IS
  'Period allotment (limit). NULL means unlimited.';
COMMENT ON COLUMN public.workspace_credits.remaining_credits IS
  'Credits left in the current period. NULL when unlimited.';
COMMENT ON COLUMN public.workspace_credits.reset_date IS
  'When the current period ends and balances reset.';

CREATE TABLE IF NOT EXISTS public.usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NULL,
  agent_id UUID NULL,
  conversation_id UUID NULL,
  request_id TEXT NULL,
  endpoint TEXT NOT NULL DEFAULT 'chat',
  model TEXT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  credits_charged INTEGER NOT NULL DEFAULT 0 CHECK (credits_charged >= 0),
  status TEXT NOT NULL DEFAULT 'success'
    CHECK (status IN ('success', 'failed', 'rejected')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_events_workspace_created_idx
  ON public.usage_events (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS usage_events_workspace_status_idx
  ON public.usage_events (workspace_id, status);

COMMENT ON TABLE public.usage_events IS
  'Immutable AI usage history (tokens + credits). Safe for Hub dashboards under RLS.';

-- ============ RLS ============

ALTER TABLE public.workspace_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read workspace credits" ON public.workspace_credits;
CREATE POLICY "Members can read workspace credits"
  ON public.workspace_credits FOR SELECT
  USING (public.current_user_is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members can read usage events" ON public.usage_events;
CREATE POLICY "Members can read usage events"
  ON public.usage_events FOR SELECT
  USING (public.current_user_is_workspace_member(workspace_id));

GRANT SELECT ON public.workspace_credits TO authenticated;
GRANT SELECT ON public.usage_events TO authenticated;
GRANT ALL ON public.workspace_credits TO service_role;
GRANT ALL ON public.usage_events TO service_role;

DROP TRIGGER IF EXISTS trg_workspace_credits_updated ON public.workspace_credits;
CREATE TRIGGER trg_workspace_credits_updated
  BEFORE UPDATE ON public.workspace_credits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ HELPERS ============

CREATE OR REPLACE FUNCTION public.plan_monthly_credits(_plan_code TEXT)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p.limits ? 'monthly_credits' THEN NULLIF(p.limits->>'monthly_credits', '')::integer
    WHEN p.limits ? 'ai_messages_month' THEN NULLIF(p.limits->>'ai_messages_month', '')::integer
    ELSE NULL
  END
  FROM public.plans p
  WHERE p.code = _plan_code;
$$;

CREATE OR REPLACE FUNCTION public.next_credits_reset_date(_from TIMESTAMPTZ DEFAULT now())
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (date_trunc('month', _from) + INTERVAL '1 month');
$$;

CREATE OR REPLACE FUNCTION public.seed_workspace_credits(_workspace_id UUID)
RETURNS public.workspace_credits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan TEXT;
  v_monthly INTEGER;
  v_row public.workspace_credits;
BEGIN
  SELECT plan_code INTO v_plan FROM public.workspaces WHERE id = _workspace_id;
  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'Workspace not found';
  END IF;

  v_monthly := public.plan_monthly_credits(v_plan);

  INSERT INTO public.workspace_credits (
    workspace_id, monthly_credits, used_credits, remaining_credits, reset_date
  ) VALUES (
    _workspace_id,
    v_monthly,
    0,
    v_monthly,
    public.next_credits_reset_date(now())
  )
  ON CONFLICT (workspace_id) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.workspace_id IS NULL THEN
    SELECT * INTO v_row FROM public.workspace_credits WHERE workspace_id = _workspace_id;
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_workspace_credits_if_needed(_workspace_id UUID)
RETURNS public.workspace_credits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.workspace_credits;
  v_plan TEXT;
  v_monthly INTEGER;
BEGIN
  SELECT * INTO v_row FROM public.workspace_credits WHERE workspace_id = _workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.seed_workspace_credits(_workspace_id);
  END IF;

  IF v_row.reset_date <= now() THEN
    SELECT plan_code INTO v_plan FROM public.workspaces WHERE id = _workspace_id;
    v_monthly := public.plan_monthly_credits(COALESCE(v_plan, 'starter'));

    UPDATE public.workspace_credits
    SET
      monthly_credits = v_monthly,
      used_credits = 0,
      remaining_credits = v_monthly,
      reset_date = public.next_credits_reset_date(now()),
      updated_at = now()
    WHERE workspace_id = _workspace_id
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

-- Trigger: seed credits when a workspace is created
CREATE OR REPLACE FUNCTION public.handle_workspace_credits_seed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_workspace_credits(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workspaces_seed_credits ON public.workspaces;
CREATE TRIGGER trg_workspaces_seed_credits
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.handle_workspace_credits_seed();

-- Backfill existing workspaces
INSERT INTO public.workspace_credits (workspace_id, monthly_credits, used_credits, remaining_credits, reset_date)
SELECT
  w.id,
  public.plan_monthly_credits(w.plan_code),
  0,
  public.plan_monthly_credits(w.plan_code),
  public.next_credits_reset_date(now())
FROM public.workspaces w
WHERE w.deleted_at IS NULL
ON CONFLICT (workspace_id) DO NOTHING;

-- ============ PUBLIC RPCs (user JWT + membership) ============

CREATE OR REPLACE FUNCTION public.get_workspace_credits(_workspace_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.workspace_credits;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.current_user_is_workspace_member(_workspace_id) THEN
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.current_user_can_edit_workspace(_workspace_id) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _credits IS NULL OR _credits < 0 THEN
    RAISE EXCEPTION 'Invalid credits';
  END IF;
  IF _status IS NULL OR _status NOT IN ('success', 'failed', 'rejected') THEN
    _status := 'success';
  END IF;

  v_row := public.reset_workspace_credits_if_needed(_workspace_id);
  v_total := GREATEST(0, COALESCE(_prompt_tokens, 0)) + GREATEST(0, COALESCE(_completion_tokens, 0));

  -- Unlimited allotment
  IF v_row.monthly_credits IS NULL THEN
    UPDATE public.workspace_credits
    SET used_credits = used_credits + _credits,
        updated_at = now()
    WHERE workspace_id = _workspace_id
    RETURNING * INTO v_row;
    v_charge := _credits;
  ELSE
    -- Exhausted
    IF COALESCE(v_row.remaining_credits, 0) <= 0 AND _credits > 0 THEN
      INSERT INTO public.usage_events (
        workspace_id, user_id, agent_id, conversation_id, request_id, endpoint, model,
        prompt_tokens, completion_tokens, total_tokens, credits_charged, status, metadata
      ) VALUES (
        _workspace_id, auth.uid(), _agent_id, _conversation_id, _request_id, COALESCE(_endpoint, 'chat'), _model,
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
    _workspace_id, auth.uid(), _agent_id, _conversation_id, _request_id, COALESCE(_endpoint, 'chat'), _model,
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

REVOKE ALL ON FUNCTION public.plan_monthly_credits(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_workspace_credits(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_workspace_credits_if_needed(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_monthly_credits(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.seed_workspace_credits(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_workspace_credits_if_needed(UUID) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_workspace_credits(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_workspace_credits(
  UUID, INTEGER, INTEGER, INTEGER, TEXT, TEXT, UUID, UUID, TEXT, TEXT, JSONB
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_workspace_credits(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_workspace_credits(
  UUID, INTEGER, INTEGER, INTEGER, TEXT, TEXT, UUID, UUID, TEXT, TEXT, JSONB
) TO service_role;

NOTIFY pgrst, 'reload schema';
