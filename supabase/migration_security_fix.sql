-- HOTFIX: Fix circular reference in profiles RLS policies
-- The admin-check policy on profiles referenced profiles itself,
-- causing infinite recursion and 500 errors on ALL tables.

-- 1. Create a SECURITY DEFINER function that bypasses RLS
--    to check admin status without triggering policy recursion.
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean AS $$
    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 2. Drop the broken profiles policies
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Season co-members can view profiles" ON public.profiles;

-- 3. Recreate profiles policies without self-referencing subqueries
CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (is_current_user_admin());

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

-- 4. Also fix the guesses admin policy to use the function
DROP POLICY IF EXISTS "Admins can view all guesses" ON public.guesses;
CREATE POLICY "Admins can view all guesses"
    ON public.guesses FOR SELECT
    TO authenticated
    USING (is_current_user_admin());
