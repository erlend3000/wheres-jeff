-- Where's Jeff? — Allow players to see who has submitted on active mysteries
-- Returns only metadata (user_id, name, submitted_at) — no guess content.

CREATE OR REPLACE FUNCTION get_mystery_submissions(p_mystery_id uuid)
RETURNS TABLE (user_id uuid, submitted_at timestamptz, name text)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT g.user_id, g.submitted_at, p.name
    FROM public.guesses g
    JOIN public.profiles p ON p.id = g.user_id
    JOIN public.mysteries m ON m.id = g.mystery_id
    JOIN public.season_members sm ON sm.season_id = m.season_id AND sm.user_id = auth.uid()
    WHERE g.mystery_id = p_mystery_id
    ORDER BY g.submitted_at;
$$;
