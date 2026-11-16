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
