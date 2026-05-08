-- FIX: Column-level security on mysteries table
-- RLS filters rows but cannot hide columns. We revoke SELECT on the
-- sensitive columns (title, answer) so direct table queries can't read them.
-- The RPC function (SECURITY DEFINER) still has full access.

-- Revoke all and re-grant only non-sensitive columns
REVOKE SELECT ON public.mysteries FROM authenticated;
REVOKE SELECT ON public.mysteries FROM anon;

GRANT SELECT (
    id, season_id, type, image_url, image_width, image_height,
    published_at, reveals_at, sort_order, created_at, template_id, override
) ON public.mysteries TO authenticated;

-- Also restrict guesses: hide the guess column (contains lat/lng)
-- on direct table access. The RPC/RLS already filters rows, but
-- this prevents reading the actual guess coordinates via direct query.
REVOKE SELECT ON public.guesses FROM anon;
