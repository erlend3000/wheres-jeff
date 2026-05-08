-- HOTFIX 2: Replace ALL admin policy subqueries with is_current_user_admin()
-- to break circular RLS references across all tables.

-- Make sure the function exists
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean AS $$
    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- === SEASONS ===
DROP POLICY IF EXISTS "Admins can manage seasons" ON public.seasons;
CREATE POLICY "Admins can manage seasons"
    ON public.seasons FOR ALL
    TO authenticated
    USING (is_current_user_admin());

-- === SEASON_MEMBERS ===
DROP POLICY IF EXISTS "Admins can manage season members" ON public.season_members;
CREATE POLICY "Admins can manage season members"
    ON public.season_members FOR ALL
    TO authenticated
    USING (is_current_user_admin());

-- === MYSTERIES ===
DROP POLICY IF EXISTS "Admins can manage mysteries" ON public.mysteries;
CREATE POLICY "Admins can manage mysteries"
    ON public.mysteries FOR ALL
    TO authenticated
    USING (is_current_user_admin());

-- === GUESSES ===
DROP POLICY IF EXISTS "Admins can delete guesses" ON public.guesses;
CREATE POLICY "Admins can delete guesses"
    ON public.guesses FOR DELETE
    TO authenticated
    USING (is_current_user_admin());

-- === PROFILES (update/delete) ===
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
CREATE POLICY "Admins can update any profile"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (is_current_user_admin());

DROP POLICY IF EXISTS "Admins can delete profiles" ON public.profiles;
CREATE POLICY "Admins can delete profiles"
    ON public.profiles FOR DELETE
    TO authenticated
    USING (is_current_user_admin());

-- === PENDING_MEMBERS ===
DROP POLICY IF EXISTS "Pending members viewable by admins" ON public.pending_members;
CREATE POLICY "Pending members viewable by admins"
    ON public.pending_members FOR SELECT
    TO authenticated
    USING (is_current_user_admin());

DROP POLICY IF EXISTS "Admins can manage pending members" ON public.pending_members;
CREATE POLICY "Admins can manage pending members"
    ON public.pending_members FOR ALL
    TO authenticated
    USING (is_current_user_admin());

-- === APP_SETTINGS ===
DROP POLICY IF EXISTS "Admins can manage app settings" ON public.app_settings;
CREATE POLICY "Admins can manage app settings"
    ON public.app_settings FOR ALL
    TO authenticated
    USING (is_current_user_admin());

-- === STORAGE ===
DROP POLICY IF EXISTS "Admins can upload mystery images" ON storage.objects;
CREATE POLICY "Admins can upload mystery images"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'mystery-images'
        AND is_current_user_admin()
    );
