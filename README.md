# Aleks's AI mindmap

A shared context drop-off under the stars: projects, notes, files, images and dictation.
Hosted on GitHub Pages, data in Supabase (free tier is plenty).

```
index.html      the page
app.js          the app
config.js       your Supabase address and public key  ← you edit this
.nojekyll       tells GitHub Pages to serve files as they are
supabase/
  schema.sql                     database, security rules, file storage
  functions/admin-users/index.ts server function for creating users / passwords
  functions/context/index.ts     read links for AI tools
  functions/ingest/index.ts      write links for agents
```

Setup takes about 20 minutes, once.

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com), sign in (GitHub login works) and click **New project**.
2. Name it `mindmap`, set a database password (save it somewhere), region **Central EU (Frankfurt)**.
3. Wait until the project is ready.

## 2. Create the database

1. Left menu → **SQL Editor** → **New query**.
2. Paste the whole content of `supabase/schema.sql` and click **Run**.
   It should end with "Success. No rows returned".

## 3. Turn off public sign-up

Only you create accounts.

1. **Authentication** → **Sign In / Providers**.
2. Switch off **Allow new users to sign up**. Leave the **Email** provider itself on.

## 4. Create your admin account

1. **Authentication** → **Users** → **Add user** → **Create new user**.
2. Email: `aleks@mindmap.local` (your username + `@mindmap.local`), choose a password, tick **Auto Confirm User**.
3. Back in **SQL Editor**, run:

   ```sql
   update public.profiles set is_admin = true, can_create = true where username = 'aleks';
   ```

## 5. Deploy the user-management function

1. Left menu → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Name it exactly `admin-users`.
3. Replace the example code with the content of `supabase/functions/admin-users/index.ts`.
4. Click **Deploy function**. Leave "Verify JWT" on.

## 6. Put your keys into config.js

1. **Project Settings** → **Data API**: copy the **Project URL**.
2. **Project Settings** → **API Keys**: copy the **anon / publishable** key.
3. Paste both into `config.js`.

The anon key is meant to be public; the security rules in the database protect the data.
Never put the `service_role` / secret key in any file here.

## 7. Publish on GitHub Pages

1. On GitHub create a new repository, e.g. `ai-mindmap`.
2. **Add file → Upload files**, drag in everything from this folder (including `.nojekyll`), commit.
   On a Mac, press Cmd+Shift+. in Finder to see `.nojekyll`. If it doesn't upload, create an empty file with that name in GitHub.
3. **Settings → Pages** → Source: **Deploy from a branch**, branch `main`, folder `/ (root)` → Save.
4. After a minute the site is at `https://YOUR-NAME.github.io/ai-mindmap/`.

Log in with `aleks` and your password.

---

## Daily use

- **Users:** sidebar → **Uporabniki**. Create accounts, tick which projects each person sees,
  allow or block creating projects, make someone admin, set a new password, remove accounts.
- **First login:** every account you create starts with a temporary password. On first login the person must pick their own before they can continue.
- **Forgotten password:** the person tells you, you set a new temporary one in **Uporabniki**, and they change it again on their next login. No emails involved.
- **Changing your own password:** sidebar → **Geslo**. This also logs you out on all your other devices.
- **Resetting someone's password** logs them out everywhere, and they choose a new one at next login.
- **Blokiraj / Odblokiraj** pauses an account without deleting anything. A blocked person is logged out everywhere and can't log in until you unblock them.
- **Removing a user** keeps their entries; their name stays on them.
- **Privacy between users:** people only see the usernames of others who share a project with them. Admins see everyone.
- **Nazadnje aktiven** in Uporabniki shows when each person last opened the app.
- **Rename or delete a project** (admin only): buttons under the project title. Deleting asks for confirmation and removes all its entries and files.
- **Your data is permanent.** Notes and files stay in Supabase until someone deletes them. Only the temporary viewing links for files expire (6 hours in the app, 7 days in the AI export); the files themselves never do.
- **Dictation** works in Chrome, Edge and Safari. The browser asks for microphone access the first time.
- **Kontekst za umetno inteligenco** copies the whole project as text for any AI chat.

## Work and personal spaces

Every project is in **delo** (work) or **osebno** (personal). Choose it when you create a project; as admin, change it with **Preimenuj**. The filter above the project list shows all, work only or personal only.

## Skills and prompts

Entry types **skill** and **prompt** hold AI instructions. Attaching a `.md` or `.txt` file puts its text into the entry (so it is searchable and AI-readable) instead of storing it as a file. Skills show formatted, with **Kopiraj** and **Prenesi .md** buttons.

## Sharing with work AI tools (no connector needed)

**Deli z AI** (admin) creates a secret read-only link for one project or a whole space. Paste it into any AI that can open links:
*"Preberi moj kontekst s te povezave: https://…/functions/v1/context?t=…"*. The AI sees only that project or space, can't change anything, and you can revoke the link any time.

This uses a second Edge Function, `context` (`supabase/functions/context/index.ts`), deployed with **Verify JWT turned off**, because the secret token in the link is the access check.

## To-dos

Tick the box next to a to-do to mark it done (anyone with access to the project can). **skrij opravljene** hides finished ones. Exports show `[x]` / `[ ]`.

## Meetings

Entry type **sestanek** (meeting) opens its own form: title, date and time, participants, the **transcript** and the **zapisnik** (minutes).

- **Transcript:** paste it, or import a file: `.vtt` (Teams, Zoom), `.srt`, `.txt` or `.docx` (Google Meet and Teams downloads). Captions are cleaned into `Name: text` paragraphs, and speakers become the participants. Dropping a `.vtt` or `.srt` into the normal composer opens the meeting form too. Up to 400,000 characters (a 3–4 hour meeting).
- **Minutes without an API:** **Kopiraj prompt za zapisnik** copies a ready prompt with the transcript. Paste it into any AI, then paste its answer back with **Prilepi odgovor iz AI**. You can also write the minutes yourself or add them later with Uredi.
- **Decisions and to-dos:** if the minutes have `## Odločitve` and `## Naloge` sections, one tick adds each line as its own decision or to-do, linked to the meeting (↳ chip). The to-dos can be ticked off like any other.
- **What AI reads:** the minutes. Read links list each meeting's minutes plus a separate link to its full transcript, which the AI opens only if it needs details. Tick **Celoten transkript samo v aplikaciji** for client calls or anything sensitive; then read links get the minutes only.
- **Search** also looks inside transcripts (3+ letters) and marks those hits *zadetek v transkriptu*.
- **Agents** can send meetings through a write link: `{"kind": "sestanek", "title": "...", "date": "2026-11-17T10:00", "participants": ["Ana"], "summary": "...", "transcript": "..."}`, or a `.vtt` / `.srt` / `.txt` file. Direct database writes: `select add_meeting_as('claude', '<project id>', 'title', 'minutes', 'transcript', now(), array['Ana']);`.

## Agents (AI tools) and their links

Sidebar → project → **Agenti**.

- **An agent** is a permanent, reserved name for an AI tool: `@claude`, `@grok`, `@barabin`, `@claude-delo`. No person and no other agent can ever take that name. Each agent has a **space** (delo or osebno), a **color**, an optional **tool icon** (the tool's own website icon) and can be marked as a **shared work account**.
- **Links** belong to an agent: *Pisanje v ta projekt* (write-only), *Branje projekta*, *Branje celega prostora*. Whatever comes through a link is signed with the agent's name; the agent can't choose its own name.
- **Work agents** (space delo) can only get links to delo projects, and this is checked on every use. Moving a project to osebno immediately cuts every work link to it.
- **Links are shown once.** Only a SHA-256 fingerprint is stored, so nobody, not even with database access, can read a working link back. Lost it? **Obnovi** creates a new one and kills the old one; the agent keeps its name and history.
- Links expire (30 / 90 days / 1 year). **Onemogoči** on an agent stops all its links at once.
- Write links: one project, add-only, max 60 entries + files per hour, 20,000 characters per entry.
- **Skills, prompts and files through write links.** An agent can send `"kind": "skill"` or `"prompt"`, and attach files (`"files": [{"name": "x.pdf", "data": "<base64>"}]` or multipart/form-data). Allowed: png, jpg, gif, webp, pdf, csv, docx, xlsx, md, txt; up to 5 files of 8 MB each. `.md` and `.txt` files are turned into text. Anything else (programs, web pages, archives) is refused.
- **Review step.** Skills and prompts written by agents arrive marked **ZA PREGLED**. Until you click **Odobri** they are left out of every read link and the AI export; **Zavrni** deletes them. Only admins can approve.
- **Versions.** A skill or prompt with a name (`"name": "pisanje-clankov"`, or the `name:` line in a SKILL.md header) is versioned per agent and project. Sending the same name again arrives as **v2, v3…**, marked for review. **Odobri** makes it the current version; the older ones fold under **Prejšnje različice** with Kopiraj / Prenesi .md. AI tools only ever see the current approved version. **Zavrni** deletes the proposal and leaves the current one untouched. Deleting the current version brings back the previous one.
- In the log, people show as 👤 **@name**; agents as their colored **@name** with icon and an **AGENT** tag; text you pasted from an AI as **@you · prek ChatGPT** (use **Prilepi iz AI** and the source dropdown). On the star chart, agent entries are hollow squares.
- Direct database access (Claude's Supabase connector) writes through `select add_entry_as('claude', '<project id>', 'text', 'misel');`. For a named, versioned skill: `select add_entry_as('claude', '<project id>', 'text', 'skill', 'ime-skilla');`. This is a convention, not a lock, so use the Supabase connector only on your personal Claude. Work tools get links.

## Letting Claude read the mindmap directly

1. In Claude: **Settings → Connectors**, add **Supabase** and sign in.
2. Ask, for example: *"Read the ADVANA project from my mindmap"*.
   Claude can query the ready-made view:

   ```sql
   select * from ai_context where project = 'ADVANA – spletna stran';
   ```

The connector has full access to the Supabase account, so connect it only from your own Claude account.

## If you get locked out

You are the only admin, so keep a way back in:

- **Best:** create a second admin account for emergencies (e.g. `aleks-backup`), keep its password in your password manager.
- **Last resort:** Supabase → **SQL Editor**, change `NovoGeslo123` and run:

  ```sql
  update auth.users
     set encrypted_password = extensions.crypt('NovoGeslo123', extensions.gen_salt('bf')),
         banned_until = null
   where email = 'aleks@mindmap.local';
  update public.profiles set blocked = false, is_admin = true where username = 'aleks';
  ```

## Backups

The free Supabase plan doesn't give you downloadable backups. Once in a while, export what matters:
**Table Editor → entries → Export → CSV**, or use **Kontekst za umetno inteligenco** per project.

## Limits worth knowing

- Files up to 8 MB each. The free Supabase plan includes 1 GB of file storage.
- A free Supabase project pauses after a week with no activity. Opening the dashboard and clicking **Restore** wakes it.
- Changes from other people appear when you switch back to the tab (it refreshes after 20 seconds away).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Page says *manjka nastavitev* | `config.js` still has the placeholder values. |
| *Napačno uporabniško ime ali geslo* for a new user | Check the user exists in Authentication → Users as `name@mindmap.local`. |
| Creating a user fails with a message about the email | Change `USER_DOMAIN` in `config.js` to e.g. `example.com`, and use that same domain for your own admin account. |
| *Uporabniki* panel shows a function error | The Edge Function is missing or not named exactly `admin-users`. |
| You see no projects as admin | Step 4's SQL `update` didn't run, so you're not admin yet. |
