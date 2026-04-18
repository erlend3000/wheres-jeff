-- === Time mystery support: update auto_guess_expired_mysteries ===
-- Handles both 'location' and 'time' mystery types

create or replace function public.auto_guess_expired_mysteries()
returns void as $$
declare
    r record;
    rand_lat double precision;
    rand_lng double precision;
    dist_m double precision;
    d_lat double precision;
    d_lng double precision;
    a_val double precision;
    answer_lat double precision;
    answer_lng double precision;
    sc int;
    -- Time mystery variables
    ans_year double precision;
    ans_month double precision;
    ans_day double precision;
    ans_hour double precision;
    ans_minute double precision;
    ans_decimal double precision;
    guess_decimal double precision;
    years_diff double precision;
    guess_year double precision;
    big_bang constant double precision := -13800000000.0;
    current_yr double precision;
begin
    current_yr := extract(year from now())
        + (extract(doy from now()) - 1) / 365.25
        + extract(hour from now()) / 8766.0
        + extract(minute from now()) / 525960.0;

    for r in
        select m.id as mystery_id,
               sm.user_id,
               m.type,
               m.answer,
               (m.answer->>'lat')::double precision as ans_lat,
               (m.answer->>'lng')::double precision as ans_lng,
               m.reveals_at
        from mysteries m
        join season_members sm on sm.season_id = m.season_id
        left join guesses g on g.mystery_id = m.id and g.user_id = sm.user_id
        where m.reveals_at is not null
          and m.reveals_at <= now()
          and m.published_at is not null
          and m.published_at <= now()
          and g.id is null
          and sm.joined_at <= m.published_at
    loop
        if r.type = 'time' then
            declare
                detail_level text;
            begin
            detail_level := coalesce(r.answer->>'detail_level', 'minute');
            ans_year := coalesce((r.answer->>'year')::double precision, 0);
            ans_month := case when detail_level in ('month','day','minute') then coalesce((r.answer->>'month')::double precision, 1) else 1 end;
            ans_day := case when detail_level in ('day','minute') then coalesce((r.answer->>'day')::double precision, 1) else 1 end;
            ans_hour := case when detail_level = 'minute' then coalesce((r.answer->>'hour')::double precision, 0) else 0 end;
            ans_minute := case when detail_level = 'minute' then coalesce((r.answer->>'minute')::double precision, 0) else 0 end;

            if (r.answer->>'bc')::boolean is true and ans_year > 0 then
                ans_year := -ans_year;
            end if;

            ans_decimal := ans_year + ((ans_month - 1) + ((ans_day - 1) + (ans_hour + ans_minute / 60.0) / 24.0) / 30.44) / 12.0;

            declare
                distance double precision;
                period double precision;
                range_start double precision;
                range_end double precision;
                ps_year double precision;
                pe_year double precision;
                range_val double precision;
                range_unit text;
                range_years double precision;
                effective_diff double precision;
                fraction double precision;
            begin
                if r.answer->'period_start' is not null and r.answer->'period_end' is not null then
                    ps_year := coalesce((r.answer->'period_start'->>'year')::double precision, 0);
                    if (r.answer->'period_start'->>'bc')::boolean is true and ps_year > 0 then ps_year := -ps_year; end if;
                    ps_year := ps_year + ((coalesce((r.answer->'period_start'->>'month')::double precision, 1) - 1)
                        + ((coalesce((r.answer->'period_start'->>'day')::double precision, 1) - 1)
                        + (coalesce((r.answer->'period_start'->>'hour')::double precision, 0) + coalesce((r.answer->'period_start'->>'minute')::double precision, 0) / 60.0) / 24.0) / 30.44) / 12.0;

                    pe_year := coalesce((r.answer->'period_end'->>'year')::double precision, 0);
                    if (r.answer->'period_end'->>'bc')::boolean is true and pe_year > 0 then pe_year := -pe_year; end if;
                    pe_year := pe_year + ((coalesce((r.answer->'period_end'->>'month')::double precision, 1) - 1)
                        + ((coalesce((r.answer->'period_end'->>'day')::double precision, 1) - 1)
                        + (coalesce((r.answer->'period_end'->>'hour')::double precision, 0) + coalesce((r.answer->'period_end'->>'minute')::double precision, 0) / 60.0) / 24.0) / 30.44) / 12.0;

                    range_start := ps_year;
                    range_end := pe_year;
                    period := abs(pe_year - ps_year);
                else
                    distance := greatest(1.0, abs(current_yr - ans_decimal));
                    period := least(13800000000.0, greatest(100.0, distance * (1.0 + 0.5 * ln(distance))));
                    range_start := greatest(big_bang, current_yr - period);
                    range_end := current_yr;
                end if;

                guess_year := range_start + random() * (range_end - range_start);
                if abs(guess_year - ans_decimal) < period * 0.1 then
                    guess_year := ans_decimal + (case when guess_year < ans_decimal then -1 else 1 end) * period * 0.15;
                end if;
                guess_year := greatest(range_start, least(range_end, guess_year));

                years_diff := abs(guess_year - ans_decimal);
                range_val := coalesce((r.answer->>'range')::double precision, 0);
                range_unit := coalesce(r.answer->>'range_unit', 'year');
                range_years := range_val * case range_unit
                    when 'minute' then 1.0 / 525960.0
                    when 'hour' then 1.0 / 8766.0
                    when 'day' then 1.0 / 365.25
                    when 'month' then 1.0 / 12.0
                    else 1.0
                end;
                effective_diff := greatest(0, years_diff - range_years);
                fraction := least(1.0, effective_diff / period);
                sc := greatest(0, round(2500 - 220.0 * ln(1.0 + 20000.0 * fraction)));
            end;

            insert into guesses (mystery_id, user_id, guess, distance_m, score, submitted_at)
            values (
                r.mystery_id,
                r.user_id,
                jsonb_build_object(
                    'year', round(guess_year),
                    'month', 1, 'day', 1, 'hour', 0, 'minute', 0,
                    'bc', guess_year < 0,
                    'detail_level', coalesce(r.answer->>'detail_level', 'year'),
                    'auto_guess', true
                ),
                years_diff,
                sc,
                r.reveals_at
            )
            on conflict (mystery_id, user_id) do nothing;
            end; -- detail_level block
        else
            -- Location mystery (existing logic)
            rand_lat := (random() * 180.0) - 90.0;
            rand_lng := (random() * 360.0) - 180.0;

            answer_lat := r.ans_lat;
            answer_lng := r.ans_lng;

            d_lat := radians(answer_lat - rand_lat);
            d_lng := radians(answer_lng - rand_lng);
            a_val := sin(d_lat / 2) ^ 2
                     + cos(radians(rand_lat)) * cos(radians(answer_lat)) * sin(d_lng / 2) ^ 2;
            dist_m := 6371000.0 * 2.0 * atan2(sqrt(a_val), sqrt(1.0 - a_val));

            sc := greatest(0, round(2500 - 220 * ln(1.0 + dist_m / 1000.0)));

            insert into guesses (mystery_id, user_id, guess, distance_m, score, submitted_at)
            values (
                r.mystery_id,
                r.user_id,
                jsonb_build_object('lat', rand_lat, 'lng', rand_lng, 'location', '[]'::jsonb, 'auto_guess', true),
                dist_m,
                sc,
                r.reveals_at
            )
            on conflict (mystery_id, user_id) do nothing;
        end if;
    end loop;
end;
$$ language plpgsql security definer set search_path = public;
