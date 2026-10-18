-- Run once in the Supabase SQL editor. Creates the RSVP table, two locked-down RPCs, and a pg_cron job
-- that wipes everything 10 days from now. The table has RLS on and NO policies: anon can only use the RPCs.
create extension if not exists pg_cron;

create table if not exists public.rsvps (
  name_key   text primary key,
  name       text not null,
  response   text not null check (response in ('going','not_going')),
  note       text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.rsvps enable row level security;

-- Event details live here (not in the public repo). Seed/edit them in the dashboard; see supabase/event_seed.sql (kept local).
create table if not exists public.event (
  id      int primary key check (id = 1),
  title   text not null default 'Birthday Party',
  date    text not null default '',   -- YYYY-MM-DD, empty = hidden
  start   text not null default '',
  "end"   text not null default '',
  address text not null default ''
);
alter table public.event enable row level security;

create or replace function public.get_event() returns json
language sql security definer set search_path = public as $$
  select coalesce((select row_to_json(e) from (select title, date, start, "end", address from event where id = 1) e), '{}'::json);
$$;

create or replace function public.list_rsvps() returns json
language sql security definer set search_path = public as $$
  select json_build_object(
    'going',    coalesce((select json_agg(json_build_object('name', name, 'note', note) order by updated_at) from rsvps where response = 'going'), '[]'::json),
    'notGoing', coalesce((select json_agg(json_build_object('name', name, 'note', note) order by updated_at) from rsvps where response = 'not_going'), '[]'::json));
$$;

create or replace function public.put_rsvp(p_name text, p_response text, p_note text default '') returns json
language plpgsql security definer set search_path = public as $$
declare n text := left(btrim(regexp_replace(coalesce(p_name,''), '[[:cntrl:]\s]+', ' ', 'g')), 40);
        t text := left(btrim(regexp_replace(coalesce(p_note,''), '[[:cntrl:]\s]+', ' ', 'g')), 200);
begin
  if n = '' then raise exception 'name needed'; end if;
  if p_response not in ('going','not_going') then raise exception 'going or not going?'; end if;
  if p_response = 'going' then t := ''; end if;
  if (select count(*) from rsvps) >= 300 and not exists (select 1 from rsvps where name_key = lower(n)) then raise exception 'full'; end if;
  insert into rsvps (name_key, name, response, note) values (lower(n), n, p_response, t)
  on conflict (name_key) do update set name = excluded.name, response = excluded.response, note = excluded.note, updated_at = now();
  return public.list_rsvps();
end $$;

revoke all on function public.get_event(), public.list_rsvps(), public.put_rsvp(text,text,text) from public;
grant execute on function public.get_event(), public.list_rsvps(), public.put_rsvp(text,text,text) to anon;

-- Takedown: 10 days from running this script, delete all data and the API functions, then remove the job.
do $$
declare t timestamptz := now() + interval '10 days';
begin
  perform cron.unschedule('mevite-takedown') where exists (select 1 from cron.job where jobname = 'mevite-takedown');
  perform cron.schedule('mevite-takedown', '*/30 * * * *', format($j$
    do $x$ begin
      if now() >= %L then
        drop function if exists public.put_rsvp(text,text,text);
        drop function if exists public.list_rsvps();
        drop function if exists public.get_event();
        drop table if exists public.rsvps;
        drop table if exists public.event;
        perform cron.unschedule('mevite-takedown');
      end if;
    end $x$;$j$, t));
end $$;
