-- Where's Jeff? — Auto-Enrollment, Auto-Guess Fix & Display Title
-- Run this in Supabase SQL Editor AFTER the previous migrations.

-- === 0. Add display_title to seasons ===

ALTER TABLE seasons ADD COLUMN IF NOT EXISTS display_title text;
UPDATE seasons SET display_title = 'Season 1' WHERE auto_generated = true AND display_title IS NULL;

-- === 1. Add joined_at to season_members ===

ALTER TABLE season_members ADD COLUMN IF NOT EXISTS joined_at timestamptz NOT NULL DEFAULT now();

-- Backfill: use the later of season creation and profile creation
UPDATE season_members sm
SET joined_at = GREATEST(s.created_at, p.created_at)
FROM seasons s, profiles p
WHERE sm.season_id = s.id AND sm.user_id = p.id;


-- === 2. Fix handle_new_user: skip games with published mysteries + "Season N" naming ===

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
    v_season_id uuid;
    v_count int;
    v_pending record;
    v_found_pending boolean := false;
    v_name text;
BEGIN
    -- 1. Create profile
    INSERT INTO public.profiles (id, name, email)
    VALUES (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'name', ''),
        new.email
    );

    -- 2. Check pending_members for pre-enrollment by admin
    FOR v_pending IN
        SELECT season_id FROM public.pending_members WHERE email = new.email
    LOOP
        v_found_pending := true;
        INSERT INTO public.season_members (season_id, user_id)
        VALUES (v_pending.season_id, new.id)
        ON CONFLICT DO NOTHING;
    END LOOP;

    IF v_found_pending THEN
        DELETE FROM public.pending_members WHERE email = new.email;
        RETURN new;
    END IF;

    -- 3. Auto-enroll in newest auto-generated game with room AND no published mysteries
    SELECT s.id INTO v_season_id
    FROM public.seasons s
    WHERE s.active = true AND s.auto_generated = true
      AND (SELECT count(*) FROM public.season_members sm WHERE sm.season_id = s.id) < s.max_players
      AND NOT EXISTS (
          SELECT 1 FROM public.mysteries m
          WHERE m.season_id = s.id
            AND m.published_at IS NOT NULL
            AND m.published_at <= now()
      )
    ORDER BY s.created_at DESC
    LIMIT 1;

    IF v_season_id IS NULL THEN
        -- 4. Create new auto-generated game: label "Autogame #N", display "Season 1"
        SELECT 'Autogame #' || (COALESCE(
            (SELECT COUNT(*) FROM public.seasons WHERE auto_generated = true), 0
        ) + 1) INTO v_name;

        INSERT INTO public.seasons (name, display_title, auto_generated)
        VALUES (v_name, 'Season 1', true)
        RETURNING id INTO v_season_id;
    END IF;

    INSERT INTO public.season_members (season_id, user_id)
    VALUES (v_season_id, new.id)
    ON CONFLICT DO NOTHING;

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- === 3. Fix auto_guess: only auto-guess for members who joined before the mystery was published ===

CREATE OR REPLACE FUNCTION public.auto_guess_expired_mysteries()
RETURNS void AS $$
DECLARE
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
BEGIN
    FOR r IN
        SELECT m.id AS mystery_id,
               sm.user_id,
               (m.answer->>'lat')::double precision AS ans_lat,
               (m.answer->>'lng')::double precision AS ans_lng,
               m.reveals_at
        FROM mysteries m
        JOIN season_members sm ON sm.season_id = m.season_id
        LEFT JOIN guesses g ON g.mystery_id = m.id AND g.user_id = sm.user_id
        WHERE m.reveals_at IS NOT NULL
          AND m.reveals_at <= now()
          AND m.published_at IS NOT NULL
          AND m.published_at <= now()
          AND g.id IS NULL
          AND sm.joined_at <= m.published_at
    LOOP
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

        INSERT INTO guesses (mystery_id, user_id, guess, distance_m, score, submitted_at)
        VALUES (
            r.mystery_id,
            r.user_id,
            jsonb_build_object('lat', rand_lat, 'lng', rand_lng, 'location', '[]'::jsonb),
            dist_m,
            sc,
            r.reveals_at
        )
        ON CONFLICT (mystery_id, user_id) DO NOTHING;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
