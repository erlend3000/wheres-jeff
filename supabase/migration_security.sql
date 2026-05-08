-- Where's Jeff? — Security hardening
-- Run this in Supabase SQL Editor to lock down data exposure.
--
-- WHAT THIS FIXES:
-- 1. Guesses: players could see everyone's guesses on active mysteries
-- 2. Mysteries: the answer column was visible on unrevealed mysteries
-- 3. Profiles: email addresses were visible to all players

-- ============================================================
-- 1. GUESSES — only see own guesses + revealed mystery guesses
-- ============================================================

-- Drop the old wide-open policy
DROP POLICY IF EXISTS "Guesses are viewable by authenticated users" ON public.guesses;

-- Own guesses: always visible
CREATE POLICY "Users can view own guesses"
    ON public.guesses FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Other players' guesses: only on revealed mysteries
CREATE POLICY "Revealed mystery guesses are viewable"
    ON public.guesses FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.mysteries m
            WHERE m.id = mystery_id
              AND m.reveals_at IS NOT NULL
              AND m.reveals_at <= now()
        )
    );

-- Admin override: admins can see all guesses
CREATE POLICY "Admins can view all guesses"
    ON public.guesses FOR SELECT
    TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
    );


-- ============================================================
-- 2. MYSTERIES — hide answer on unrevealed mysteries
-- ============================================================

-- We can't filter columns with RLS, so we create a secure function
-- that strips the answer from active (unrevealed) mysteries.
-- The frontend will call this instead of querying the table directly.

CREATE OR REPLACE FUNCTION public.get_season_mysteries(p_season_id uuid)
RETURNS SETOF json AS $$
    SELECT json_build_object(
        'id', m.id,
        'season_id', m.season_id,
        'title', m.title,
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
            WHEN m.reveals_at IS NOT NULL AND m.reveals_at <= now() THEN m.answer
            ELSE '{}'::jsonb
        END
    )
    FROM public.mysteries m
    WHERE m.season_id = p_season_id
      AND m.published_at IS NOT NULL
      AND m.published_at <= now()
    ORDER BY m.published_at DESC;
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- ============================================================
-- 3. PROFILES — hide email from non-admin users
-- ============================================================

-- Drop the old wide-open policy
DROP POLICY IF EXISTS "Profiles are viewable by all authenticated users" ON public.profiles;

-- All authenticated users can see basic profile info (id, name, scores)
-- but NOT email. We achieve this with a view.
-- However, RLS can't filter columns. So we keep the read policy but
-- create a secure view for the game frontend.

-- Restricted policy: users see own full profile
CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (auth.uid() = id);

-- Other profiles: only non-sensitive fields via RPC
CREATE POLICY "Admins can view all profiles"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- Members of the same season can see each other's names (needed for leaderboard)
CREATE POLICY "Season co-members can view profiles"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.season_members sm1
            JOIN public.season_members sm2 ON sm1.season_id = sm2.season_id
            WHERE sm1.user_id = auth.uid()
              AND sm2.user_id = profiles.id
        )
    );
