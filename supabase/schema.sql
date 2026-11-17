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
  kind        text not null default 'misel',
  text        text not null default '',
  files       jsonb not null default '[]'::jsonb,   -- [{name,type,size,path}]
  created_at  timestamptz not null default now(),
  edited_at   timestamptz
);
create index if not exists entries_project_idx on public.entries(project_id, created_at);
-- entry kinds (skill and prompt hold AI instructions, sestanek holds a meeting)
alter table public.entries drop constraint if exists entries_kind_check;
alter table public.entries add constraint entries_kind_check
  check (kind in ('misel','odlocitev','todo','povezava','datoteka','skill','prompt','sestanek'));

-- work / personal space for each project
alter table public.projects add column if not exists space text not null default 'osebno';
alter table public.projects drop constraint if exists projects_space_check;
alter table public.projects add constraint projects_space_check check (space in ('delo','osebno'));

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

-- ---------- read-only share links (served by the "context" edge function) ----------
create table if not exists public.share_links (
  id          uuid primary key default gen_random_uuid(),
  token       text unique not null default replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''),
  project_id  uuid references public.projects(id) on delete cascade,
  space       text check (space in ('delo','osebno')),
  label       text,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  revoked     boolean not null default false,
  last_used_at timestamptz,
  check ((project_id is null) <> (space is null))
);
alter table public.share_links enable row level security;
drop policy if exists "share admin read"   on public.share_links;
drop policy if exists "share admin insert" on public.share_links;
drop policy if exists "share admin update" on public.share_links;
drop policy if exists "share admin delete" on public.share_links;
create policy "share admin read"   on public.share_links for select to authenticated using (public.is_admin());
create policy "share admin insert" on public.share_links for insert to authenticated with check (public.is_admin() and created_by = auth.uid());
create policy "share admin update" on public.share_links for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "share admin delete" on public.share_links for delete to authenticated using (public.is_admin());

-- ---------- to-dos and agent entries ----------
alter table public.entries add column if not exists done_at timestamptz;
alter table public.entries add column if not exists done_by text;
alter table public.entries add column if not exists source text;
alter table public.share_links add column if not exists mode text not null default 'read';
alter table public.share_links drop constraint if exists share_links_mode_check;
alter table public.share_links add constraint share_links_mode_check
  check (mode in ('read','write') and (mode = 'read' or project_id is not null));

create or replace function public.set_author_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.author is not null then
    new.author_name := (select username from public.profiles where id = new.author);
  end if;
  return new;
end $$;

create or replace function public.set_todo_done(eid uuid, done boolean) returns void
language sql security definer set search_path = public as $$
  update public.entries
     set done_at = case when done then now() else null end,
         done_by = case when done then (select username from public.profiles where id = auth.uid()) else null end
   where id = eid and kind = 'todo' and public.can_access(project_id);
$$;
revoke all on function public.set_todo_done(uuid, boolean) from public, anon;
grant execute on function public.set_todo_done(uuid, boolean) to authenticated;

-- ---------- personal planning of to-dos (the "Danes" screen) ----------
-- each person plans their own day; "done" stays shared on the entry
create table if not exists public.todo_plans (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  entry_id   uuid not null references public.entries(id) on delete cascade,
  horizon    text check (horizon in ('danes','teden','dolgorocno')),   -- null = unplanned
  plan_day   date,                                                    -- day it was put on "danes" (carry-over counter)
  due_on     date,                                                    -- personal deadline
  importance smallint not null default 0 check (importance between 0 and 3),
  updated_at timestamptz not null default now(),
  primary key (user_id, entry_id)
);
create index if not exists todo_plans_entry_idx on public.todo_plans(entry_id);
alter table public.todo_plans enable row level security;
drop policy if exists "own plans: read"   on public.todo_plans;
drop policy if exists "own plans: add"    on public.todo_plans;
drop policy if exists "own plans: change" on public.todo_plans;
drop policy if exists "own plans: remove" on public.todo_plans;
create policy "own plans: read" on public.todo_plans for select to authenticated
  using (user_id = auth.uid());
create policy "own plans: add" on public.todo_plans for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.entries e where e.id = entry_id and e.kind = 'todo' and public.can_access(e.project_id)));
create policy "own plans: change" on public.todo_plans for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.entries e where e.id = entry_id and e.kind = 'todo' and public.can_access(e.project_id)));
create policy "own plans: remove" on public.todo_plans for delete to authenticated
  using (user_id = auth.uid());
grant select, insert, update, delete on public.todo_plans to authenticated;

-- ---------- agents: permanent, reserved identities for AI tools ----------
create table if not exists public.agents (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null check (name ~ '^[a-z0-9][a-z0-9._-]{1,29}$'),
  space       text not null check (space in ('delo','osebno')),
  color       text not null default '#9be564' check (color ~ '^#[0-9a-fA-F]{6}$'),
  tool        text,
  note        text,
  shared      boolean not null default false,
  disabled    boolean not null default false,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
alter table public.agents enable row level security;
drop policy if exists "agents admin all" on public.agents;
drop policy if exists "agents seen in my projects" on public.agents;
create policy "agents admin all" on public.agents for all to authenticated using (public.is_admin()) with check (public.is_admin());
alter table public.entries add column if not exists agent_id uuid references public.agents(id) on delete set null;
alter table public.entries add column if not exists via text;
-- skills/prompts written by agents wait for the owner's approval (left out of AI context until then)
alter table public.entries add column if not exists review boolean not null default false;
-- named skills/prompts from agents keep versions; older approved versions stay as history
alter table public.entries add column if not exists skill_name text;
alter table public.entries add column if not exists version integer;
alter table public.entries add column if not exists superseded_by uuid references public.entries(id) on delete set null;
create index if not exists entries_skill_idx on public.entries(project_id, skill_name) where skill_name is not null;
-- meetings: text holds the minutes (what AI reads), transcript holds the full transcript
alter table public.entries add column if not exists title text;
alter table public.entries add column if not exists meeting_at timestamptz;
alter table public.entries add column if not exists participants text[] not null default '{}';
alter table public.entries add column if not exists transcript text;
alter table public.entries add column if not exists transcript_private boolean not null default false;  -- true: read links get only the minutes
alter table public.entries add column if not exists parent_id uuid references public.entries(id) on delete set null;  -- decisions/to-dos taken from a meeting
alter table public.entries add column if not exists transcript_words integer generated always as (
  case when transcript is null or btrim(transcript) = '' then 0
       else coalesce(array_length(regexp_split_to_array(btrim(transcript), '\s+'), 1), 0) end) stored;
create index if not exists entries_parent_idx on public.entries(parent_id) where parent_id is not null;
alter table public.entries drop constraint if exists entries_transcript_len;
alter table public.entries add constraint entries_transcript_len check (transcript is null or length(transcript) <= 400000);
create policy "agents seen in my projects" on public.agents for select to authenticated
  using (exists (select 1 from public.entries e where e.agent_id = agents.id and public.can_access(e.project_id)));

create or replace function public.name_taken(n text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where username = lower(n))
      or exists (select 1 from public.agents where name = lower(n));
$$;
create or replace function public.agents_check_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.name := lower(new.name);
  if exists (select 1 from public.profiles where username = new.name) then
    raise exception 'To ime že uporablja oseba.';
  end if;
  return new;
end $$;
drop trigger if exists agents_name_guard on public.agents;
create trigger agents_name_guard before insert or update of name on public.agents
  for each row execute function public.agents_check_name();

-- links: bound to an agent; only a SHA-256 fingerprint of the key is stored
alter table public.share_links add column if not exists agent_id uuid references public.agents(id) on delete cascade;
alter table public.share_links add column if not exists token_hash text unique;
alter table public.share_links add column if not exists token_hint text;
alter table public.share_links add column if not exists use_count integer not null default 0;

create or replace function public.add_entry_as(p_agent text, p_project uuid, p_text text, p_kind text default 'misel')
returns uuid language plpgsql security definer set search_path = public as $$
declare a public.agents; sp text; new_id uuid;
begin
  select * into a from public.agents where name = lower(p_agent);
  if a.id is null then raise exception 'Agent % ne obstaja.', p_agent; end if;
  if a.disabled then raise exception 'Agent % je onemogočen.', p_agent; end if;
  select space into sp from public.projects where id = p_project;
  if sp is null then raise exception 'Projekt ne obstaja.'; end if;
  if sp <> a.space then raise exception 'Projekt ni v prostoru agenta %.', p_agent; end if;
  if p_kind not in ('misel','odlocitev','todo','povezava','skill','prompt') then p_kind := 'misel'; end if;
  insert into public.entries (project_id, kind, text, author, author_name, agent_id, source, review)
  values (p_project, p_kind, p_text, null, a.name, a.id, 'agent', p_kind in ('skill','prompt')) returning id into new_id;
  return new_id;
end $$;
revoke all on function public.add_entry_as(text, uuid, text, text) from public, anon, authenticated;

-- direct (connector) writes of a named skill/prompt: select add_entry_as('claude', '<project id>', 'text', 'skill', 'ime-skilla');
create or replace function public.add_entry_as(p_agent text, p_project uuid, p_text text, p_kind text, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare a public.agents; sp text; nm text; v integer; new_id uuid;
begin
  select * into a from public.agents where name = lower(p_agent);
  if a.id is null then raise exception 'Agent % ne obstaja.', p_agent; end if;
  if a.disabled then raise exception 'Agent % je onemogočen.', p_agent; end if;
  select space into sp from public.projects where id = p_project;
  if sp is null then raise exception 'Projekt ne obstaja.'; end if;
  if sp <> a.space then raise exception 'Projekt ni v prostoru agenta %.', p_agent; end if;
  if p_kind not in ('skill','prompt') then raise exception 'Ime in različice so samo za skill in prompt.'; end if;
  nm := nullif(left(trim(both '-' from regexp_replace(lower(coalesce(p_name,'')), '[^a-z0-9._-]+', '-', 'g')), 60), '');
  if nm is null then raise exception 'Manjka ime skilla.'; end if;
  select coalesce(max(version), 0) + 1 into v from public.entries
   where project_id = p_project and skill_name = nm and agent_id = a.id;
  insert into public.entries (project_id, kind, text, author, author_name, agent_id, source, review, skill_name, version)
  values (p_project, p_kind, p_text, null, a.name, a.id, 'agent', true, nm, v) returning id into new_id;
  return new_id;
end $$;
revoke all on function public.add_entry_as(text, uuid, text, text, text) from public, anon, authenticated;

-- direct (connector) writes of a meeting:
-- select add_meeting_as('claude', '<project id>', 'naslov', 'zapisnik', 'transkript', '2026-11-17 10:00+01', array['Aleks','Julija']);
create or replace function public.add_meeting_as(p_agent text, p_project uuid, p_title text, p_summary text,
  p_transcript text default null, p_at timestamptz default now(), p_participants text[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare a public.agents; sp text; new_id uuid;
begin
  select * into a from public.agents where name = lower(p_agent);
  if a.id is null then raise exception 'Agent % ne obstaja.', p_agent; end if;
  if a.disabled then raise exception 'Agent % je onemogočen.', p_agent; end if;
  select space into sp from public.projects where id = p_project;
  if sp is null then raise exception 'Projekt ne obstaja.'; end if;
  if sp <> a.space then raise exception 'Projekt ni v prostoru agenta %.', p_agent; end if;
  insert into public.entries (project_id, kind, text, title, meeting_at, participants, transcript, author, author_name, agent_id, source)
  values (p_project, 'sestanek', coalesce(p_summary, ''), left(p_title, 140), coalesce(p_at, now()), coalesce(p_participants, '{}'),
          nullif(btrim(coalesce(p_transcript, '')), ''), null, a.name, a.id, 'agent') returning id into new_id;
  return new_id;
end $$;
revoke all on function public.add_meeting_as(text, uuid, text, text, text, timestamptz, text[]) from public, anon, authenticated;

-- approve a skill/prompt; a named one replaces the earlier versions from the same author (they stay as history)
create or replace function public.approve_entry(eid uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare e public.entries; newer uuid; n integer := 0;
begin
  if not public.is_admin() then raise exception 'Samo admin lahko odobri.'; end if;
  select * into e from public.entries where id = eid;
  if e.id is null then raise exception 'Vnos ne obstaja.'; end if;
  update public.entries set review = false where id = eid;
  if e.skill_name is null then return 0; end if;
  -- an even newer version is already approved: this one goes straight into history
  select id into newer from public.entries x
   where x.project_id = e.project_id and x.skill_name = e.skill_name and x.id <> eid and not x.review
     and coalesce(x.agent_id::text, x.author_name) is not distinct from coalesce(e.agent_id::text, e.author_name)
     and x.created_at > e.created_at
   order by x.created_at desc limit 1;
  if newer is not null then
    update public.entries set superseded_by = newer where id = eid;
    return 0;
  end if;
  update public.entries x set superseded_by = eid
   where x.project_id = e.project_id and x.skill_name = e.skill_name and x.id <> eid
     and x.created_at < e.created_at
     and coalesce(x.agent_id::text, x.author_name) is not distinct from coalesce(e.agent_id::text, e.author_name);
  get diagnostics n = row_count;
  update public.entries set superseded_by = null where id = eid;
  return n;
end $$;
revoke all on function public.approve_entry(uuid) from public, anon;
grant execute on function public.approve_entry(uuid) to authenticated;

-- ---------- one readable view for AI assistants ----------
-- Lets Claude (via the Supabase connector) read everything in one query:
--   select * from ai_context where project = 'ADVANA – spletna stran';
create or replace view public.ai_context with (security_invoker = true) as
select p.name                                   as project,
       e.created_at,
       e.kind,
       e.author_name                            as author,
       e.text,
       (select string_agg(f->>'name', ', ') from jsonb_array_elements(e.files) f) as attachments,
       p.space                                  as space,
       e.done_at,
       e.source,
       e.via,
       (e.agent_id is not null)                 as is_agent,
       e.review,
       e.skill_name,
       e.version,
       e.title,
       e.meeting_at,
       e.participants,
       e.transcript_words,
       e.parent_id
from public.entries e
join public.projects p on p.id = e.project_id
where e.superseded_by is null and not e.review
order by p.name, e.created_at;
