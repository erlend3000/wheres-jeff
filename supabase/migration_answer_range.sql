-- Explicit correct-answer time ranges (answer_start / answer_end)
-- Replaces symmetric Range ± for new mysteries; legacy range still supported.

-- ═══════════════════════════════════════════════════════════
-- 1. Helper: time_years_diff
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION time_years_diff(a jsonb, b jsonb, detail text) RETURNS float8
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    RETURN abs(
        time_to_decimal(truncate_to_detail(a, detail))
        - time_to_decimal(truncate_to_detail(b, detail))
    );
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 2. Helper: time_effective_years_diff (matches lib/game.js)
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION time_effective_years_diff(guess jsonb, answer jsonb) RETURNS float8
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    dl text;
    g_dec float8;
    lo float8;
    hi float8;
    tmp float8;
    diff float8;
    range_val float8;
    range_unit text;
    range_years float8;
BEGIN
    dl := coalesce(answer->>'detail_level', 'minute');
    g_dec := time_to_decimal(truncate_to_detail(guess, dl));

    IF answer->'answer_start' IS NOT NULL AND answer->'answer_end' IS NOT NULL THEN
        lo := time_to_decimal(truncate_to_detail(answer->'answer_start', dl));
        hi := time_to_decimal(truncate_to_detail(answer->'answer_end', dl));
        IF lo > hi THEN
            tmp := lo; lo := hi; hi := tmp;
        END IF;
        IF g_dec >= lo AND g_dec <= hi THEN RETURN 0; END IF;
        RETURN least(abs(g_dec - lo), abs(g_dec - hi));
    END IF;

    diff := time_years_diff(guess, answer, dl);
    range_val := coalesce((answer->>'range')::float8, 0);
    range_unit := answer->>'range_unit';
    IF range_val > 0 AND range_unit IS NOT NULL THEN
        range_years := range_val * CASE range_unit
            WHEN 'minute' THEN 1.0/525960 WHEN 'hour' THEN 1.0/8766
            WHEN 'day' THEN 1.0/365.25 WHEN 'month' THEN 1.0/12 ELSE 1.0 END;
        diff := greatest(0, diff - range_years);
    END IF;
    RETURN diff;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 3. submit_time_guess: use effective diff
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
    v_years_diff := time_effective_years_diff(p_guess, v_answer);
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

-- ═══════════════════════════════════════════════════════════
-- 4. calculate_time_score: skip legacy range when explicit range
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
    IF p_answer->'answer_start' IS NULL OR p_answer->'answer_end' IS NULL THEN
        range_val := coalesce((p_answer->>'range')::float8, 0);
        range_unit := p_answer->>'range_unit';
        IF range_val > 0 AND range_unit IS NOT NULL THEN
            range_years := range_val * CASE range_unit
                WHEN 'minute' THEN 1.0/525960 WHEN 'hour' THEN 1.0/8766
                WHEN 'day' THEN 1.0/365.25 WHEN 'month' THEN 1.0/12 ELSE 1.0 END;
            abs_diff := greatest(0, abs_diff - range_years);
        END IF;
    END IF;

    fraction := least(1.0, abs_diff / period);
    base := greatest(0, 2500.0 - 220.0 * ln(1.0 + 20000.0 * fraction));

    total_s := extract(epoch from (p_reveals_at - p_published_at));
    remaining_s := extract(epoch from (p_reveals_at - p_submitted_at));
    IF total_s <= 0 THEN RETURN round(base)::int4; END IF;
    multiplier := 0.5 + 0.5 * (remaining_s / total_s);
    RETURN greatest(0, round(base * multiplier))::int4;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 5. Recalculate existing time guess scores
-- ═══════════════════════════════════════════════════════════
DO $$
DECLARE
    g record;
    v_answer jsonb;
    v_new_dist float8;
    v_new_score int4;
BEGIN
    FOR g IN
        SELECT gu.id, gu.mystery_id, gu.guess, gu.submitted_at,
               m.answer, m.published_at, m.reveals_at
        FROM guesses gu
        JOIN mysteries m ON m.id = gu.mystery_id
        WHERE m.type = 'time'
          AND gu.guess->>'auto_guess' IS NULL
    LOOP
        v_answer := g.answer;
        v_new_dist := time_effective_years_diff(g.guess, v_answer);
        v_new_score := calculate_time_score(v_new_dist, v_answer, g.submitted_at, g.published_at, g.reveals_at);
        UPDATE guesses SET distance_m = v_new_dist, score = v_new_score WHERE id = g.id;
    END LOOP;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 6. get_season_mysteries: strip answer range fields when unrevealed
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_season_mysteries(p_season_id uuid)
RETURNS SETOF json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT json_build_object(
        'id', m.id,
        'season_id', m.season_id,
        'title', CASE
            WHEN m.reveals_at IS NOT NULL AND m.reveals_at <= now() THEN m.title
            ELSE ''
        END,
        'type', m.type,
        'image_url', m.image_url,
        'image_width', m.image_width,
        'image_height', m.image_height,
        'published_at', m.published_at,
        'reveals_at', m.reveals_at,
        'sort_order', m.sort_order,
        'created_at', m.created_at,
        'template_id', m.template_id,
        'override', m.override,
        'answer', CASE
            WHEN m.reveals_at IS NOT NULL AND m.reveals_at <= now() THEN
                m.answer
            ELSE
                (m.answer
                    - 'lat' - 'lng' - 'location'
                    - 'year' - 'month' - 'day' - 'hour' - 'minute' - 'bc'
                    - 'answer_start' - 'answer_end' - 'answer_is_range'
                    - 'range' - 'range_unit'
                )
        END
    )
    FROM public.mysteries m
    WHERE m.season_id = p_season_id
      AND m.published_at IS NOT NULL
      AND m.published_at <= now()
      AND (
          EXISTS (
              SELECT 1 FROM public.season_members sm
              WHERE sm.season_id = p_season_id AND sm.user_id = auth.uid()
          )
          OR public.is_current_user_admin()
      )
    ORDER BY m.published_at DESC;
$$;

-- ═══════════════════════════════════════════════════════════
-- 7. auto_guess_expired_mysteries: center + effective diff for ranges
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.auto_guess_expired_mysteries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
    r record;
    rand_lat double precision;
    rand_lng double precision;
    dist_m double precision;
    d_lat double precision;
    d_lng double precision;
    a_val double precision;
    answer_lat double precision;
    answer_lng double precision;
    sc int;
    ans_decimal double precision;
    guess_year double precision;
    big_bang constant double precision := -13800000000.0;
    current_yr double precision;
    v_guess jsonb;
    effective_diff double precision;
    period double precision;
    range_start double precision;
    range_end double precision;
    fraction double precision;
begin
    if auth.uid() is not null and not is_current_user_admin() then
        raise exception 'Not authorized';
    end if;

    current_yr := extract(year from now())
        + (extract(doy from now()) - 1) / 365.25
        + extract(hour from now()) / 8766.0
        + extract(minute from now()) / 525960.0;

    for r in
        select m.id as mystery_id,
               sm.user_id,
               m.type,
               m.answer,
               (m.answer->>'lat')::double precision as ans_lat,
               (m.answer->>'lng')::double precision as ans_lng,
               m.reveals_at
        from mysteries m
        join season_members sm on sm.season_id = m.season_id
        left join guesses g on g.mystery_id = m.id and g.user_id = sm.user_id
        where m.reveals_at is not null
          and m.reveals_at <= now()
          and m.published_at is not null
          and m.published_at <= now()
          and g.id is null
          and sm.joined_at <= m.published_at
    loop
        if r.type = 'time' then
            if r.answer->'answer_start' is not null and r.answer->'answer_end' is not null then
                ans_decimal := (
                    time_to_decimal(r.answer->'answer_start')
                    + time_to_decimal(r.answer->'answer_end')
                ) / 2.0;
            else
                ans_decimal := time_to_decimal(r.answer);
            end if;

            if r.answer->'period_start' is not null and r.answer->'period_end' is not null then
                range_start := time_to_decimal(r.answer->'period_start');
                range_end := time_to_decimal(r.answer->'period_end');
                period := abs(range_end - range_start);
            else
                period := compute_time_period(ans_decimal);
                range_start := greatest(big_bang, current_yr - period);
                range_end := current_yr;
            end if;

            guess_year := range_start + random() * (range_end - range_start);
            if abs(guess_year - ans_decimal) < period * 0.1 then
                guess_year := ans_decimal + (case when guess_year < ans_decimal then -1 else 1 end) * period * 0.15;
            end if;
            guess_year := greatest(range_start, least(range_end, guess_year));

            v_guess := jsonb_build_object(
                'year', round(guess_year),
                'month', 1, 'day', 1, 'hour', 0, 'minute', 0,
                'bc', guess_year < 0,
                'detail_level', coalesce(r.answer->>'detail_level', 'year'),
                'auto_guess', true
            );
            effective_diff := time_effective_years_diff(v_guess, r.answer);
            fraction := least(1.0, effective_diff / greatest(period, 0.001));
            sc := greatest(0, round(2500 - 220.0 * ln(1.0 + 20000.0 * fraction)));

            insert into guesses (mystery_id, user_id, guess, distance_m, score, submitted_at)
            values (r.mystery_id, r.user_id, v_guess, effective_diff, sc, r.reveals_at)
            on conflict (mystery_id, user_id) do nothing;
        else
            rand_lat := (random() * 180.0) - 90.0;
            rand_lng := (random() * 360.0) - 180.0;

            answer_lat := r.ans_lat;
            answer_lng := r.ans_lng;

            d_lat := radians(answer_lat - rand_lat);
            d_lng := radians(answer_lng - rand_lng);
            a_val := sin(d_lat / 2) ^ 2
                     + cos(radians(rand_lat)) * cos(radians(answer_lat)) * sin(d_lng / 2) ^ 2;
            dist_m := 6371000.0 * 2.0 * atan2(sqrt(a_val), sqrt(1.0 - a_val));

            sc := greatest(0, round(2500 - 220 * ln(1.0 + dist_m / 1000.0)));

            insert into guesses (mystery_id, user_id, guess, distance_m, score, submitted_at)
            values (
                r.mystery_id,
                r.user_id,
                jsonb_build_object('lat', rand_lat, 'lng', rand_lng, 'location', '[]'::jsonb, 'auto_guess', true),
                dist_m,
                sc,
                r.reveals_at
            )
            on conflict (mystery_id, user_id) do nothing;
        end if;
    end loop;
end;
$$;
