-- Where's Jeff? — Invite Flow & Waiting Image Migration
-- Run this in Supabase SQL Editor AFTER the initial migration.sql

-- === New columns on seasons ===

alter table public.seasons add column if not exists max_players int not null default 15;
alter table public.seasons add column if not exists waiting_image_url text;
alter table public.seasons add column if not exists auto_generated boolean not null default false;


-- === Pending members (admin pre-enrollment by email) ===

create table if not exists public.pending_members (
    season_id uuid not null references public.seasons(id) on delete cascade,
    email text not null,
    primary key (season_id, email)
);

alter table public.pending_members enable row level security;

create policy "Pending members viewable by admins"
    on public.pending_members for select
    to authenticated
    using (
        exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    );

create policy "Admins can manage pending members"
    on public.pending_members for all
    to authenticated
    using (
        exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    );


-- === App settings (global key-value store) ===

create table if not exists public.app_settings (
    key text primary key,
    value text
);

alter table public.app_settings enable row level security;

create policy "App settings are viewable by authenticated users"
    on public.app_settings for select
    to authenticated
    using (true);

create policy "Admins can manage app settings"
    on public.app_settings for all
    to authenticated
    using (
        exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    );


-- === Mystery templates (group instances across games) ===

alter table public.mysteries add column if not exists template_id uuid;
update public.mysteries set template_id = id where template_id is null;


-- === RPC: get next mystery start time (bypasses RLS on future mysteries) ===

create or replace function public.get_next_mystery_info(p_season_id uuid)
returns json as $$
    select json_build_object('published_at', published_at, 'type', type)
    from public.mysteries
    where season_id = p_season_id
      and published_at is not null
      and published_at > now()
    order by published_at asc
    limit 1;
$$ language sql security definer;


-- === RPC: check if email is confirmed (for cross-browser polling) ===

create or replace function public.is_email_confirmed(p_email text)
returns boolean as $$
    select exists(
        select 1 from auth.users
        where email = p_email
        and email_confirmed_at is not null
    );
$$ language sql security definer;

-- === Updated handle_new_user trigger: auto-enrollment ===

create or replace function public.handle_new_user()
returns trigger as $$
declare
    v_season_id uuid;
    v_count int;
    v_pending record;
    v_found_pending boolean := false;
    v_name text;
begin
    -- 1. Create profile
    insert into public.profiles (id, name, email)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'name', ''),
        new.email
    );

    -- 2. Check pending_members for pre-enrollment by admin
    for v_pending in
        select season_id from public.pending_members where email = new.email
    loop
        v_found_pending := true;
        insert into public.season_members (season_id, user_id)
        values (v_pending.season_id, new.id)
        on conflict do nothing;
    end loop;

    if v_found_pending then
        delete from public.pending_members where email = new.email;
        return new;
    end if;

    -- 3. Auto-enroll in newest auto-generated game with room AND no published mysteries
    select s.id into v_season_id
    from public.seasons s
    where s.active = true and s.auto_generated = true
      and (select count(*) from public.season_members sm where sm.season_id = s.id) < s.max_players
      and not exists (
          select 1 from public.mysteries m
          where m.season_id = s.id
            and m.published_at is not null
            and m.published_at <= now()
      )
    order by s.created_at desc
    limit 1;

    if v_season_id is null then
        -- 4. Create new auto-generated game: label "Autogame #N", display "Season 1"
        select 'Autogame #' || (coalesce(
            (select count(*) from public.seasons where auto_generated = true), 0
        ) + 1) into v_name;

        insert into public.seasons (name, display_title, auto_generated)
        values (v_name, 'Season 1', true)
        returning id into v_season_id;
    end if;

    insert into public.season_members (season_id, user_id)
    values (v_season_id, new.id)
    on conflict do nothing;

    return new;
end;
$$ language plpgsql security definer set search_path = public;

-- === RPC: fully delete a user (admin only) ===

create or replace function public.delete_user_completely(p_user_id uuid)
returns void as $$
declare
    v_email text;
begin
    if not exists (
        select 1 from public.profiles where id = auth.uid() and is_admin = true
    ) then
        raise exception 'Not authorized';
    end if;

    select email into v_email from public.profiles where id = p_user_id;

    if v_email is not null then
        delete from public.pending_members where email = v_email;
    end if;

    delete from auth.users where id = p_user_id;
end;
$$ language plpgsql security definer;

-- === Image dimensions on mysteries ===

alter table mysteries add column if not exists image_width integer;
alter table mysteries add column if not exists image_height integer;
