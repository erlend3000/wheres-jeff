-- Fix: Rewrite get_mystery_submissions as plpgsql + grant execute

DROP FUNCTION IF EXISTS get_mystery_submissions(uuid);

CREATE FUNCTION get_mystery_submissions(p_mystery_id uuid)
RETURNS TABLE (user_id uuid, submitted_at timestamptz, name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT g.user_id, g.submitted_at, pr.name
    FROM public.guesses g
    JOIN public.profiles pr ON pr.id = g.user_id
    WHERE g.mystery_id = p_mystery_id
      AND EXISTS (
          SELECT 1 FROM public.mysteries m
          JOIN public.season_members sm ON sm.season_id = m.season_id
          WHERE m.id = p_mystery_id AND sm.user_id = auth.uid()
      )
    ORDER BY g.submitted_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_mystery_submissions(uuid) TO authenticated;
