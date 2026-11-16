-- =====================================================================
-- Aleks's AI mindmap – database setup
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run again: it only creates what is missing.
-- =====================================================================

-- ---------- tables ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null,
  is_admin    boolean not null default false,
  can_create  boolean not null default true,
  created_at  timestamptz not null default now()
);

-- must_change_pw: true for accounts made by the admin, until the person picks their own password
alter table public.profiles add column if not exists must_change_pw boolean not null default false;
-- blocked: admin paused this account (data kept). last_seen_at: last time the person opened the app
alter table public.profiles add column if not exists blocked boolean not null default false;
alter table public.profiles add column if not exists last_seen_at timestamptz;

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  code        text not null default 'NEW',
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  primary key (project_id, user_id)
);

create table if not exists public.entries (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  author      uuid references public.profiles(id) on delete set null default auth.uid(),
  kind        text not null default 'misel' check (kind in ('misel','odlocitev','todo','povezava','datoteka')),
  text        text not null default '',
  files       jsonb not null default '[]'::jsonb,   -- [{name,type,size,path}]
  created_at  timestamptz not null default now(),
  edited_at   timestamptz
);
create index if not exists entries_project_idx on public.entries(project_id, created_at);
-- the author's name is kept on the entry, so it stays readable even if the account is removed
alter table public.entries add column if not exists author_name text;

-- ---------- helper functions (used by the security rules) ----------
-- (a blocked account gets false from all of these, even if its login is still open somewhere)
create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select not blocked from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin and not blocked from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.can_create_projects() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (can_create or is_admin) and not blocked from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.can_access(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active() and (
         public.is_admin()
      or exists (select 1 from public.project_members m where m.project_id = p and m.user_id = auth.uid()));
$$;

-- true if the logged-in person and `other` are both members of at least one project
create or replace function public.shares_project(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_members a
    join public.project_members b on b.project_id = a.project_id
    where a.user_id = auth.uid() and b.user_id = other);
$$;

-- the app calls this on open, so the admin can see who is active
create or replace function public.touch_seen() returns void
language sql security definer set search_path = public as $$
  update public.profiles set last_seen_at = now() where id = auth.uid();
$$;
revoke all on function public.touch_seen() from public, anon;
grant execute on function public.touch_seen() to authenticated;

-- used only by the admin-users function: logs a person out on every device
create or replace function public.revoke_sessions(uid uuid) returns void
language sql security definer set search_path = public, auth as $$
  delete from auth.sessions where user_id = uid;
$$;
revoke all on function public.revoke_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_sessions(uuid) to service_role;

-- stamp each new entry with its author's name
create or replace function public.set_author_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author_name := (select username from public.profiles where id = new.author);
  return new;
end $$;
drop trigger if exists on_entry_insert on public.entries;
create trigger on_entry_insert before insert on public.entries
  for each row execute function public.set_author_name();

-- fill in names for entries written before this column existed
update public.entries e set author_name = p.username
from public.profiles p where p.id = e.author and e.author_name is null;

-- called by the app right after a person sets their own password
create or replace function public.password_changed() returns void
language sql security definer set search_path = public as $$
  update public.profiles set must_change_pw = false where id = auth.uid();
$$;
revoke all on function public.password_changed() from public, anon;
grant execute on function public.password_changed() to authenticated;

-- new login account -> profile row (username = part before @, or metadata)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- whoever creates a project automatically gets access to it
create or replace function public.add_creator_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null then
    insert into public.project_members (project_id, user_id) values (new.id, new.created_by)
    on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists on_project_created on public.projects;
create trigger on_project_created after insert on public.projects
  for each row execute function public.add_creator_member();

-- ---------- row level security ----------
alter table public.profiles        enable row level security;
alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.entries         enable row level security;

-- profiles: everyone logged in can see usernames; only admins change rights
drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles admin"  on public.profiles;
create policy "profiles read"  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin() or public.shares_project(id));
create policy "profiles admin" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- projects
drop policy if exists "projects read"   on public.projects;
drop policy if exists "projects create" on public.projects;
drop policy if exists "projects admin"  on public.projects;
drop policy if exists "projects delete" on public.projects;
create policy "projects read"   on public.projects for select to authenticated using (public.can_access(id) or created_by = auth.uid());
create policy "projects create" on public.projects for insert to authenticated with check (created_by = auth.uid() and public.can_create_projects());
create policy "projects admin"  on public.projects for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "projects delete" on public.projects for delete to authenticated using (public.is_admin());

-- project access list: admins manage it, users see their own rows
drop policy if exists "members read"   on public.project_members;
drop policy if exists "members insert" on public.project_members;
drop policy if exists "members delete" on public.project_members;
create policy "members read"   on public.project_members for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "members insert" on public.project_members for insert to authenticated with check (public.is_admin());
create policy "members delete" on public.project_members for delete to authenticated using (public.is_admin());

-- entries: anyone with access to the project reads and adds; author or admin edits/deletes
drop policy if exists "entries read"   on public.entries;
drop policy if exists "entries insert" on public.entries;
drop policy if exists "entries update" on public.entries;
drop policy if exists "entries delete" on public.entries;
create policy "entries read"   on public.entries for select to authenticated using (public.can_access(project_id));
create policy "entries insert" on public.entries for insert to authenticated with check (public.can_access(project_id) and author = auth.uid());
create policy "entries update" on public.entries for update to authenticated using (author = auth.uid() or public.is_admin()) with check (public.can_access(project_id));
create policy "entries delete" on public.entries for delete to authenticated using (author = auth.uid() or public.is_admin());

-- ---------- file storage (private bucket, files grouped by project) ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 8388608)
on conflict (id) do nothing;

create or replace function public.path_project(path text) returns uuid
language plpgsql immutable as $$
begin
  return (split_part(path, '/', 1))::uuid;
exception when others then
  return null;
end $$;

drop policy if exists "files read"   on storage.objects;
drop policy if exists "files upload" on storage.objects;
drop policy if exists "files delete" on storage.objects;
create policy "files read"   on storage.objects for select to authenticated using (bucket_id = 'files' and public.can_access(public.path_project(name)));
create policy "files upload" on storage.objects for insert to authenticated with check (bucket_id = 'files' and public.can_access(public.path_project(name)));
create policy "files delete" on storage.objects for delete to authenticated using (bucket_id = 'files' and public.can_access(public.path_project(name)));

-- ---------- one readable view for AI assistants ----------
-- Lets Claude (via the Supabase connector) read everything in one query:
--   select * from ai_context where project = 'ADVANA – spletna stran';
create or replace view public.ai_context with (security_invoker = true) as
select p.name                                   as project,
       e.created_at,
       e.kind,
       e.author_name                            as author,
       e.text,
       (select string_agg(f->>'name', ', ') from jsonb_array_elements(e.files) f) as attachments
from public.entries e
join public.projects p on p.id = e.project_id
order by p.name, e.created_at;
