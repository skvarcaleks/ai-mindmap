// Aleks's AI mindmap – admin-users
// Lets an admin create accounts, set passwords and remove accounts.
// Deploy in Supabase → Edge Functions → Deploy a new function → Via Editor,
// name it exactly: admin-users
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // who is calling?
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user }, error: authErr } = await admin.auth.getUser(jwt);
    if (authErr || !user) return json({ error: "Niste prijavljeni." }, 401);
    const { data: caller } = await admin.from("profiles").select("is_admin,blocked").eq("id", user.id).single();
    if (!caller?.is_admin || caller.blocked) return json({ error: "To lahko naredi samo admin." }, 403);

    const body = await req.json();
    const domain = String(body.domain || "mindmap.local").replace(/[^a-z0-9.-]/gi, "");

    if (body.action === "create") {
      const username = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!/^[a-z0-9._-]{2,30}$/.test(username)) return json({ error: "Neveljavno uporabniško ime." }, 400);
      if (password.length < 6) return json({ error: "Geslo naj ima vsaj 6 znakov." }, 400);

      const { data, error } = await admin.auth.admin.createUser({
        email: `${username}@${domain}`,
        password,
        email_confirm: true,
        user_metadata: { username },
      });
      if (error) {
        const msg = /already|registered|exists/i.test(error.message) ? "Uporabnik s tem imenom že obstaja." : error.message;
        return json({ error: msg }, 400);
      }
      const id = data.user.id;
      await admin.from("profiles").upsert({
        id, username, is_admin: !!body.is_admin, can_create: body.can_create !== false, must_change_pw: true,
      });
      const projects: string[] = Array.isArray(body.projects) ? body.projects : [];
      if (projects.length) {
        await admin.from("project_members").insert(projects.map((project_id) => ({ project_id, user_id: id })));
      }
      return json({ ok: true, id });
    }

    if (body.action === "set_password") {
      const password = String(body.password || "");
      if (password.length < 6) return json({ error: "Geslo naj ima vsaj 6 znakov." }, 400);
      const { error } = await admin.auth.admin.updateUserById(String(body.user_id), { password });
      if (error) return json({ error: error.message }, 400);
      // a password the admin picked for someone else is temporary: they change it on next login,
      // and every device they were logged in on is logged out
      const other = body.user_id !== user.id;
      await admin.from("profiles").update({ must_change_pw: other }).eq("id", String(body.user_id));
      if (other) await admin.rpc("revoke_sessions", { uid: String(body.user_id) });
      return json({ ok: true });
    }

    if (body.action === "block") {
      if (body.user_id === user.id) return json({ error: "Samega sebe ne moreš blokirati." }, 400);
      const blocked = !!body.blocked;
      const { error } = await admin.auth.admin.updateUserById(String(body.user_id), { ban_duration: blocked ? "876000h" : "none" });
      if (error) return json({ error: error.message }, 400);
      await admin.from("profiles").update({ blocked }).eq("id", String(body.user_id));
      if (blocked) await admin.rpc("revoke_sessions", { uid: String(body.user_id) });
      return json({ ok: true });
    }

    if (body.action === "delete") {
      if (body.user_id === user.id) return json({ error: "Samega sebe ne moreš odstraniti." }, 400);
      const { error } = await admin.auth.admin.deleteUser(String(body.user_id));
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Neznano dejanje." }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
