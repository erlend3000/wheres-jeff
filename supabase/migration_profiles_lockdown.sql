-- Lock down profiles: hide testers from regular players.
-- Email/role/is_admin are hidden because the frontend only queries
-- profiles via JOINs on guesses (which only return 'name') or via
-- the get_own_profile RPC. Direct table queries are the "hacker" path.

-- 1. Replace co-members policy: exclude testers from being visible to non-admin players
DROP POLICY IF EXISTS "Season co-members can view profiles" ON public.profiles;
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
        AND (
            profiles.role != 'tester'
            OR profiles.id = auth.uid()
            OR is_current_user_admin()
        )
    );

-- 2. Column-level security: only expose id and name to authenticated users
REVOKE ALL ON public.profiles FROM authenticated;
GRANT SELECT (id, name) ON public.profiles TO authenticated;
GRANT UPDATE (name) ON public.profiles TO authenticated;

-- Admin needs full access for the admin panel
GRANT ALL ON public.profiles TO postgres;

-- 3. RPC for own profile (bypasses column restrictions)
CREATE OR REPLACE FUNCTION get_own_profile()
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
    result json;
BEGIN
    SELECT row_to_json(p) INTO result
    FROM public.profiles p
    WHERE p.id = auth.uid();
    RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_own_profile() TO authenticated;

-- 4. RPC for admin: get all profiles with full columns
CREATE OR REPLACE FUNCTION admin_get_profiles()
RETURNS SETOF public.profiles
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
    IF NOT is_current_user_admin() THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;
    RETURN QUERY SELECT * FROM public.profiles ORDER BY name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_profiles() TO authenticated;

-- 5. RPC for admin: get season members with full profile data
CREATE OR REPLACE FUNCTION admin_get_season_members(p_season_id uuid)
RETURNS TABLE (user_id uuid, profile_id uuid, profile_name text, profile_email text, profile_role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
    IF NOT is_current_user_admin() THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;
    RETURN QUERY
    SELECT sm.user_id, p.id, p.name, p.email, p.role
    FROM public.season_members sm
    JOIN public.profiles p ON p.id = sm.user_id
    WHERE sm.season_id = p_season_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_season_members(uuid) TO authenticated;

-- 6. RPC for admin: update user role (since column grants block direct update)
CREATE OR REPLACE FUNCTION admin_update_user_role(p_user_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF NOT is_current_user_admin() THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;
    UPDATE public.profiles
    SET role = p_role, is_admin = (p_role = 'admin')
    WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_user_role(uuid, text) TO authenticated;

-- 7. RPC for tester ID lookup (column 'role' not selectable by authenticated)
CREATE OR REPLACE FUNCTION get_tester_ids()
RETURNS TABLE (id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT p.id FROM public.profiles p WHERE p.role = 'tester';
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tester_ids() TO authenticated;
