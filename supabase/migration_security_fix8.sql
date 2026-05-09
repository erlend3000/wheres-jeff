-- ═══════════════════════════════════════════════════════════
-- Security fix 8: Block guess submission outside mystery window
--
-- Previously, submit_location_guess and submit_time_guess only
-- validated authentication and season membership. After a mystery
-- was revealed, the answer was exposed to clients, and any season
-- member could call the RPC with the exact answer to overwrite
-- their existing guess (ON CONFLICT DO UPDATE) and get max score.
--
-- This migration adds timing checks to both submission RPCs:
--   - Reject if mystery is not yet published
--   - Reject if mystery has already been revealed
--
-- Auto-guess at deadline is unaffected because it uses
-- auto_guess_expired_mysteries(), which does direct INSERTs.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION submit_location_guess(
    p_mystery_id uuid,
    p_lat float8,
    p_lng float8,
    p_location jsonb DEFAULT NULL,
    p_auto_guess boolean DEFAULT false,
    p_auto_submit boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_mystery record;
    v_user_id uuid;
    v_dist float8;
    v_score int4;
    v_guess jsonb;
    v_result record;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    SELECT * INTO v_mystery FROM mysteries WHERE id = p_mystery_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Mystery not found'; END IF;

    IF NOT EXISTS (SELECT 1 FROM season_members WHERE season_id = v_mystery.season_id AND user_id = v_user_id) THEN
        RAISE EXCEPTION 'Not a season member';
    END IF;

    IF v_mystery.published_at IS NULL OR v_mystery.published_at > now() THEN
        RAISE EXCEPTION 'Mystery not yet active';
    END IF;
    IF v_mystery.reveals_at IS NOT NULL AND v_mystery.reveals_at <= now() THEN
        RAISE EXCEPTION 'Mystery already revealed';
    END IF;

    v_dist := haversine_distance(p_lat, p_lng,
        (v_mystery.answer->>'lat')::float8, (v_mystery.answer->>'lng')::float8);
    v_score := calculate_location_score(v_dist, now(), v_mystery.published_at, v_mystery.reveals_at);

    v_guess := jsonb_build_object('lat', p_lat, 'lng', p_lng);
    IF p_location IS NOT NULL THEN v_guess := v_guess || jsonb_build_object('location', p_location); END IF;
    IF p_auto_guess THEN v_guess := v_guess || '{"auto_guess":true}';
    ELSIF p_auto_submit THEN v_guess := v_guess || '{"auto_submit":true}'; END IF;

    INSERT INTO guesses (mystery_id, user_id, guess, distance_m, score)
    VALUES (p_mystery_id, v_user_id, v_guess, v_dist, v_score)
    ON CONFLICT (mystery_id, user_id)
    DO UPDATE SET guess = EXCLUDED.guess, distance_m = EXCLUDED.distance_m, score = EXCLUDED.score
    RETURNING * INTO v_result;

    RETURN to_jsonb(v_result);
END;
$$;

CREATE OR REPLACE FUNCTION submit_time_guess(
    p_mystery_id uuid,
    p_guess jsonb,
    p_auto_guess boolean DEFAULT false,
    p_auto_submit boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_mystery record;
    v_user_id uuid;
    v_answer jsonb;
    v_detail text;
    v_years_diff float8;
    v_score int4;
    v_guess_store jsonb;
    v_result record;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    SELECT * INTO v_mystery FROM mysteries WHERE id = p_mystery_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Mystery not found'; END IF;

    IF NOT EXISTS (SELECT 1 FROM season_members WHERE season_id = v_mystery.season_id AND user_id = v_user_id) THEN
        RAISE EXCEPTION 'Not a season member';
    END IF;

    IF v_mystery.published_at IS NULL OR v_mystery.published_at > now() THEN
        RAISE EXCEPTION 'Mystery not yet active';
    END IF;
    IF v_mystery.reveals_at IS NOT NULL AND v_mystery.reveals_at <= now() THEN
        RAISE EXCEPTION 'Mystery already revealed';
    END IF;

    v_answer := v_mystery.answer;
    v_detail := coalesce(v_answer->>'detail_level', 'minute');

    v_years_diff := abs(
        time_to_decimal(truncate_to_detail(p_guess, v_detail))
        - time_to_decimal(truncate_to_detail(v_answer, v_detail))
    );

    v_score := calculate_time_score(v_years_diff, v_answer, now(), v_mystery.published_at, v_mystery.reveals_at);

    v_guess_store := p_guess;
    IF p_auto_guess THEN v_guess_store := v_guess_store || '{"auto_guess":true}';
    ELSIF p_auto_submit THEN v_guess_store := v_guess_store || '{"auto_submit":true}'; END IF;

    INSERT INTO guesses (mystery_id, user_id, guess, distance_m, score)
    VALUES (p_mystery_id, v_user_id, v_guess_store, v_years_diff, v_score)
    ON CONFLICT (mystery_id, user_id)
    DO UPDATE SET guess = EXCLUDED.guess, distance_m = EXCLUDED.distance_m, score = EXCLUDED.score
    RETURNING * INTO v_result;

    RETURN to_jsonb(v_result);
END;
$$;
