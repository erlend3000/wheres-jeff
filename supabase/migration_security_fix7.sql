-- FIX: Restore admin access to mysteries while keeping players locked down
--
-- Strategy:
-- - Direct table queries (used by admin + hackers): only show REVEALED
--   mysteries for non-admin users. Since they're revealed, title/answer
--   are no longer sensitive.
-- - RPC function (used by game frontend): shows all published mysteries
--   with sensitive data stripped for unrevealed ones. Runs as SECURITY
--   DEFINER so it bypasses RLS.
-- - Admin: full access to everything via direct queries.

-- 1. Restore full SELECT on mysteries
GRANT SELECT ON public.mysteries TO authenticated;

-- 2. Tighten RLS: non-admin direct queries only return revealed mysteries
DROP POLICY IF EXISTS "Published mysteries are viewable by authenticated users" ON public.mysteries;
DROP POLICY IF EXISTS "Members can view own season mysteries" ON public.mysteries;

CREATE POLICY "Revealed mysteries viewable by season members"
    ON public.mysteries FOR SELECT
    TO authenticated
    USING (
        published_at IS NOT NULL
        AND published_at <= now()
        AND reveals_at IS NOT NULL
        AND reveals_at <= now()
        AND EXISTS (
            SELECT 1 FROM public.season_members sm
            WHERE sm.season_id = mysteries.season_id
              AND sm.user_id = auth.uid()
        )
    );

-- Admin keeps full access (already exists, but recreate to be safe)
DROP POLICY IF EXISTS "Admins can manage mysteries" ON public.mysteries;
CREATE POLICY "Admins can manage mysteries"
    ON public.mysteries FOR ALL
    TO authenticated
    USING (is_current_user_admin());
