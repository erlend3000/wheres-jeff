-- FIX: Lock down guesses properly
-- 1. Only see guesses from mysteries in your own seasons
-- 2. Only see others' guesses after reveal
-- 3. Always see your own guesses

-- Drop all existing SELECT policies on guesses
DROP POLICY IF EXISTS "Guesses are viewable by authenticated users" ON public.guesses;
DROP POLICY IF EXISTS "Users can view own guesses" ON public.guesses;
DROP POLICY IF EXISTS "Revealed mystery guesses are viewable" ON public.guesses;
DROP POLICY IF EXISTS "Admins can view all guesses" ON public.guesses;

-- Own guesses: always visible
CREATE POLICY "Users can view own guesses"
    ON public.guesses FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Other players' guesses: only on revealed mysteries in your own seasons
CREATE POLICY "Revealed guesses in own seasons"
    ON public.guesses FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.mysteries m
            JOIN public.season_members sm ON sm.season_id = m.season_id
            WHERE m.id = guesses.mystery_id
              AND sm.user_id = auth.uid()
              AND m.reveals_at IS NOT NULL
              AND m.reveals_at <= now()
        )
    );

-- Admin override
CREATE POLICY "Admins can view all guesses"
    ON public.guesses FOR SELECT
    TO authenticated
    USING (is_current_user_admin());
