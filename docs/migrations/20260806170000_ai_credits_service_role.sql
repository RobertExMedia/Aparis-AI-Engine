-- Allow Engine service_role to call AI Credits RPCs (widget / ops paths).
-- Depends on: 20260806140000_workspace_ai_credits.sql (workspace_credits + RPCs).
-- Apply AFTER the AI Credits migration. Not required for website_widget tables alone.
-- Apply on Hub Supabase, then: NOTIFY pgrst, 'reload schema';

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

GRANT EXECUTE ON FUNCTION public.get_workspace_credits(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_workspace_credits(
  UUID, INTEGER, INTEGER, INTEGER, TEXT, TEXT, UUID, UUID, TEXT, TEXT, JSONB
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
