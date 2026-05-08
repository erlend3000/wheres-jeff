-- FIX: Return non-sensitive answer fields for unrevealed mysteries
-- The game needs detail_level, period, and range to render the guess UI.
-- Only the actual answer (lat/lng, year/month/day etc.) is sensitive.

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
            WHEN m.reveals_at IS NOT NULL AND m.reveals_at <= now() THEN
                -- Revealed: return full answer
                m.answer
            ELSE
                -- Active: strip sensitive fields, keep UI-needed fields
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
