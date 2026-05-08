-- Server-side scoring: move score computation from client to server
-- Fixes bug where security-stripped answer fields caused wrong scores

-- ═══════════════════════════════════════════════════════════
-- 1. Helper: time_to_decimal(jsonb) → float8
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION time_to_decimal(t jsonb) RETURNS float8
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    yr int; mo int; dy int; hr int; mn int;
    is_bc boolean; y float8; abs_y int;
    soy timestamp; eoy timestamp; dt timestamp;
    frac float8;
BEGIN
    yr := coalesce((t->>'year')::int, 0);
    mo := coalesce((t->>'month')::int, 1);
    dy := coalesce((t->>'day')::int, 1);
    hr := coalesce((t->>'hour')::int, 0);
    mn := coalesce((t->>'minute')::int, 0);
    is_bc := coalesce((t->>'bc')::boolean, false);

    y := yr::float8;
    IF is_bc AND y > 0 THEN y := -y; END IF;
    abs_y := abs(yr);

    IF yr >= 1 AND abs_y <= 9999 THEN
        soy := make_timestamp(abs_y, 1, 1, 0, 0, 0);
        eoy := make_timestamp(abs_y + 1, 1, 1, 0, 0, 0);
        dy := least(dy, 28); -- safe day clamp
        mo := least(greatest(mo, 1), 12);
        dt := make_timestamp(abs_y, mo, dy, hr, mn, 0);
        RETURN y + extract(epoch from (dt - soy)) / extract(epoch from (eoy - soy));
    END IF;

    frac := ((mo - 1) + ((dy - 1) + (hr + mn / 60.0) / 24.0) / 30.44) / 12.0;
    RETURN y + frac;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 2. Helper: truncate_to_detail(jsonb, text) → jsonb
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION truncate_to_detail(t jsonb, detail text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE r jsonb;
BEGIN
    r := jsonb_build_object(
        'year', coalesce((t->>'year')::int, 0),
        'month', 1, 'day', 1, 'hour', 0, 'minute', 0,
        'bc', coalesce((t->>'bc')::boolean, false)
    );
    IF detail = 'year' THEN RETURN r; END IF;
    r := r || jsonb_build_object('month', coalesce((t->>'month')::int, 1));
    IF detail = 'month' THEN RETURN r; END IF;
    r := r || jsonb_build_object('day', coalesce((t->>'day')::int, 1));
    IF detail = 'day' THEN RETURN r; END IF;
    r := r || jsonb_build_object(
        'hour', coalesce((t->>'hour')::int, 0),
        'minute', coalesce((t->>'minute')::int, 0)
    );
    RETURN r;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 3. Helper: compute_time_period(answer_decimal) → float8
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION compute_time_period(answer_decimal float8) RETURNS float8
LANGUAGE plpgsql STABLE AS $$
DECLARE
    current_dec float8; d float8;
    soy timestamp; eoy timestamp;
    yr int;
BEGIN
    yr := extract(year from now())::int;
    soy := make_timestamp(yr, 1, 1, 0, 0, 0);
    eoy := make_timestamp(yr + 1, 1, 1, 0, 0, 0);
    current_dec := yr + extract(epoch from (now()::timestamp - soy)) / extract(epoch from (eoy - soy));
    d := greatest(1.0, abs(current_dec - answer_decimal));
    RETURN least(13800000000.0, greatest(100.0, d * (1.0 + 0.5 * ln(d))));
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 4. Helper: calculate_time_score → int4
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION calculate_time_score(
    p_years_diff float8,
    p_answer jsonb,
    p_submitted_at timestamptz,
    p_published_at timestamptz,
    p_reveals_at timestamptz
) RETURNS int4
LANGUAGE plpgsql STABLE AS $$
DECLARE
    period float8; abs_diff float8; fraction float8;
    base float8; multiplier float8;
    total_s float8; remaining_s float8;
    range_val float8; range_unit text; range_years float8;
BEGIN
    IF p_answer->'period_start' IS NOT NULL AND p_answer->>'period_start' IS NOT NULL
       AND p_answer->'period_end' IS NOT NULL AND p_answer->>'period_end' IS NOT NULL THEN
        period := abs(time_to_decimal(p_answer->'period_end') - time_to_decimal(p_answer->'period_start'));
    ELSE
        period := compute_time_period(time_to_decimal(p_answer));
    END IF;
    period := greatest(period, 0.001);

    abs_diff := abs(p_years_diff);
    range_val := coalesce((p_answer->>'range')::float8, 0);
    range_unit := p_answer->>'range_unit';
    IF range_val > 0 AND range_unit IS NOT NULL THEN
        range_years := range_val * CASE range_unit
            WHEN 'minute' THEN 1.0/525960 WHEN 'hour' THEN 1.0/8766
            WHEN 'day' THEN 1.0/365.25 WHEN 'month' THEN 1.0/12 ELSE 1.0 END;
        abs_diff := greatest(0, abs_diff - range_years);
    END IF;

    fraction := least(1.0, abs_diff / period);
    base := greatest(0, 2500.0 - 220.0 * ln(1.0 + 20000.0 * fraction));

    multiplier := 1.0;
    IF p_submitted_at IS NOT NULL AND p_published_at IS NOT NULL AND p_reveals_at IS NOT NULL THEN
        total_s := extract(epoch from (p_reveals_at - p_published_at));
        remaining_s := extract(epoch from (p_reveals_at - p_submitted_at));
        IF total_s > 0 THEN
            multiplier := 1.0 + 0.10 * greatest(0, least(1.0, remaining_s / total_s));
        END IF;
    END IF;

    RETURN round(base * multiplier);
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 5. Helper: haversine_distance(lat1, lng1, lat2, lng2) → meters
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION haversine_distance(lat1 float8, lng1 float8, lat2 float8, lng2 float8) RETURNS float8
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    d_lat float8; d_lng float8; a_val float8;
BEGIN
    d_lat := radians(lat2 - lat1);
    d_lng := radians(lng2 - lng1);
    a_val := sin(d_lat / 2) ^ 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lng / 2) ^ 2;
    RETURN 6371000.0 * 2.0 * atan2(sqrt(a_val), sqrt(1.0 - a_val));
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 6. Helper: calculate_location_score → int4
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION calculate_location_score(
    p_distance_m float8,
    p_submitted_at timestamptz,
    p_published_at timestamptz,
    p_reveals_at timestamptz
) RETURNS int4
LANGUAGE plpgsql STABLE AS $$
DECLARE
    km float8; base float8; multiplier float8;
    total_s float8; remaining_s float8;
BEGIN
    km := p_distance_m / 1000.0;
    base := greatest(0, 2500.0 - 220.0 * ln(1.0 + km));

    multiplier := 1.0;
    IF p_submitted_at IS NOT NULL AND p_published_at IS NOT NULL AND p_reveals_at IS NOT NULL THEN
        total_s := extract(epoch from (p_reveals_at - p_published_at));
        remaining_s := extract(epoch from (p_reveals_at - p_submitted_at));
        IF total_s > 0 THEN
            multiplier := 1.0 + 0.10 * greatest(0, least(1.0, remaining_s / total_s));
        END IF;
    END IF;

    RETURN round(base * multiplier);
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 7. RPC: submit_location_guess
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

GRANT EXECUTE ON FUNCTION submit_location_guess(uuid, float8, float8, jsonb, boolean, boolean) TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- 8. RPC: submit_time_guess
-- ═══════════════════════════════════════════════════════════
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

GRANT EXECUTE ON FUNCTION submit_time_guess(uuid, jsonb, boolean, boolean) TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- 9. Recalculate all existing scores using correct answer data
-- ═══════════════════════════════════════════════════════════
DO $$
DECLARE
    g record;
    v_answer jsonb;
    v_detail text;
    v_new_dist float8;
    v_new_score int4;
BEGIN
    FOR g IN
        SELECT gu.id, gu.mystery_id, gu.guess, gu.submitted_at,
               m.answer, m.type, m.published_at, m.reveals_at
        FROM guesses gu
        JOIN mysteries m ON m.id = gu.mystery_id
        WHERE gu.guess->>'auto_guess' IS NULL
    LOOP
        IF g.type = 'time' THEN
            v_answer := g.answer;
            v_detail := coalesce(v_answer->>'detail_level', 'minute');
            v_new_dist := abs(
                time_to_decimal(truncate_to_detail(g.guess, v_detail))
                - time_to_decimal(truncate_to_detail(v_answer, v_detail))
            );
            v_new_score := calculate_time_score(v_new_dist, v_answer, g.submitted_at, g.published_at, g.reveals_at);
        ELSE
            v_new_dist := haversine_distance(
                (g.guess->>'lat')::float8, (g.guess->>'lng')::float8,
                (g.answer->>'lat')::float8, (g.answer->>'lng')::float8
            );
            v_new_score := calculate_location_score(v_new_dist, g.submitted_at, g.published_at, g.reveals_at);
        END IF;

        UPDATE guesses SET distance_m = v_new_dist, score = v_new_score WHERE id = g.id;
    END LOOP;
END;
$$;
