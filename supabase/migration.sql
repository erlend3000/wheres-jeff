-- Where's Jeff? — Database Schema
-- Run this in Supabase SQL Editor (supabase.com → SQL Editor → New Query)

-- === Profiles (extends Supabase auth.users) ===

create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    name text not null,
    email text not null,
    total_score int not null default 0,
    wins int not null default 0,
    jeff_karma int not null default 0,
    is_admin boolean not null default false,
    created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiles are viewable by all authenticated users"
    on public.profiles for select
    to authenticated
    using (true);

create policy "Users can update own profile"
    on public.profiles for update
    to authenticated
    using (auth.uid() = id);

create policy "Admins can update any profile"
    on public.profiles for update
    to authenticated
    using (
        exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    );

create policy "Admins can delete profiles"
    on public.profiles for delete
    to authenticated
    using (
        exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    );

-- Auto-create profile on sign-up
create or replace function public.handle_new_user()
returns trigger as $$
begin
    insert into public.profiles (id, name, email)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'name', ''),
        new.email
    );
    return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();


-- === Seasons ===

create table public.seasons (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    starts_at timestamptz not null default now(),
    ends_at timestamptz,
    active boolean not null default true,
    created_at timestamptz not null default now()
);

alter table public.seasons enable row level security;

create policy "Seasons are viewable by all authenticated users"
    on public.seasons for select
    to authenticated
    using (true);

create policy "Admins can manage seasons"
    on public.seasons for all
    to authenticated
    using (
        exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    );


-- === Season Members ===

create table public.season_members (
    season_id uuid not null references public.seasons(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    primary key (season_id, user_id)
);

alter table public.season_members enable row level security;

create policy "Season members are viewable by authenticated users"
    on public.season_members for select
    to authenticated
    using (true);

create policy "Admins can manage season members"
    on public.season_members for all
    to authenticated
    using (
        exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    );


-- === Mysteries ===

create table public.mysteries (
    id uuid primary key default gen_random_uuid(),
    season_id uuid not null references public.seasons(id) on delete cascade,
    title text not null default '',
    type text not null default 'location',
    image_url text,
    answer jsonb not null default '{}',
    published_at timestamptz,
    reveals_at timestamptz,
    sort_order int not null default 0,
    created_at timestamptz not null default now()
);

alter table public.mysteries enable row level security;

create policy "Published mysteries are viewable by authenticated users"
    on public.mysteries for select
    to authenticated
    using (published_at is not null and published_at <= now());

create policy "Admins can manage mysteries"
    on public.mysteries for all
    to authenticated
    using (
        exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    );


-- === Guesses ===

create table public.guesses (
    id uuid primary key default gen_random_uuid(),
    mystery_id uuid not null references public.mysteries(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    guess jsonb not null default '{}',
    distance_m float,
    score int not null default 0,
    submitted_at timestamptz not null default now(),
    unique (mystery_id, user_id)
);

alter table public.guesses enable row level security;

create policy "Guesses are viewable by authenticated users"
    on public.guesses for select
    to authenticated
    using (true);

create policy "Users can insert own guesses"
    on public.guesses for insert
    to authenticated
    with check (auth.uid() = user_id);


-- === Storage bucket for mystery images ===

insert into storage.buckets (id, name, public)
values ('mystery-images', 'mystery-images', true)
on conflict (id) do nothing;

create policy "Anyone can view mystery images"
    on storage.objects for select
    using (bucket_id = 'mystery-images');

create policy "Admins can upload mystery images"
    on storage.objects for insert
    to authenticated
    with check (
        bucket_id = 'mystery-images'
        and exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    );


-- === Utility functions ===

create or replace function public.email_exists(check_email text)
returns boolean as $$
begin
    return exists (select 1 from public.profiles where email = check_email);
end;
$$ language plpgsql security definer;


-- === Auto-guess for expired mysteries ===

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
begin
    for r in
        select m.id as mystery_id,
               sm.user_id,
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
        rand_lat := (random() * 180.0) - 90.0;
        rand_lng := (random() * 360.0) - 180.0;

        answer_lat := r.ans_lat;
        answer_lng := r.ans_lng;

        d_lat := radians(answer_lat - rand_lat);
        d_lng := radians(answer_lng - rand_lng);
        a_val := sin(d_lat / 2) ^ 2
                 + cos(radians(rand_lat)) * cos(radians(answer_lat)) * sin(d_lng / 2) ^ 2;
        dist_m := 6371000.0 * 2.0 * atan2(sqrt(a_val), sqrt(1.0 - a_val));

        -- Time multiplier is 1.0 for auto-guesses (submitted_at = reveals_at, so time_remaining = 0)
        sc := greatest(0, round(2500 - 220 * ln(1.0 + dist_m / 1000.0)));

        insert into guesses (mystery_id, user_id, guess, distance_m, score, submitted_at)
        values (
            r.mystery_id,
            r.user_id,
            jsonb_build_object('lat', rand_lat, 'lng', rand_lng, 'location', '[]'::jsonb),
            dist_m,
            sc,
            r.reveals_at
        )
        on conflict (mystery_id, user_id) do nothing;
    end loop;
end;
$$ language plpgsql security definer;
