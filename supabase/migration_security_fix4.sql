-- FIX: Hide titles on unrevealed mysteries + restrict mysteries to own seasons

-- 1. Update RPC: strip title for unrevealed mysteries
CREATE OR REPLACE FUNCTION public.get_season_mysteries(p_season_id uuid)
RETURNS SETOF json AS $$
    SELECT json_build_object(
        'id', m.id,
        'season_id', m.season_id,
        'title', CASE
            WHEN m.reveals_at IS NOT NULL AND m.reveals_at <= now() THEN m.title
            ELSE ''
        END,
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
            WHEN m.reveals_at IS NOT NULL AND m.reveals_at <= now() THEN
                m.answer
            ELSE
                (m.answer
                    - 'lat' - 'lng' - 'location'
                    - 'year' - 'month' - 'day' - 'hour' - 'minute' - 'bc'
                )
        END
    )
    FROM public.mysteries m
    WHERE m.season_id = p_season_id
      AND m.published_at IS NOT NULL
      AND m.published_at <= now()
    ORDER BY m.published_at DESC;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 2. Tighten mysteries RLS: only show mysteries from user's own seasons
DROP POLICY IF EXISTS "Published mysteries are viewable by authenticated users" ON public.mysteries;

CREATE POLICY "Members can view own season mysteries"
    ON public.mysteries FOR SELECT
    TO authenticated
    USING (
        published_at IS NOT NULL
        AND published_at <= now()
        AND EXISTS (
            SELECT 1 FROM public.season_members sm
            WHERE sm.season_id = mysteries.season_id
              AND sm.user_id = auth.uid()
        )
    );
