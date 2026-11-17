// Aleks's AI mindmap – context
// Read-only share links: GET .../functions/v1/context?t=<token>
// Returns one project, or every project in one space, as plain Markdown an AI can read.
// Deploy with "Verify JWT" OFF (the secret token in the link is the access check).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const LABEL: Record<string, string> = {
  odlocitev: "Odločitve", todo: "Za narediti", skill: "Skills (navodila za AI)", prompt: "Prompti",
  misel: "Misli", povezava: "Povezave", datoteka: "Datoteke",
};
const ORDER = ["odlocitev", "todo", "skill", "prompt", "misel", "povezava", "datoteka"];
const SPACE: Record<string, string> = { delo: "Delo", osebno: "Osebno" };

const reply = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
const day = (t: string) => t.slice(0, 16).replace("T", " ");
const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");

const who = (e: any) => `@${e.author_name ?? "?"}${e.source === "agent" ? " (AI agent)" : e.via ? ` (prek ${e.via})` : ""}`;

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!/^[a-f0-9]{32,64}$/.test(token)) return reply("Ta povezava ni veljavna.", 404);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: link } = await db.from("share_links").select("*").eq("token_hash", await sha256(token)).eq("mode", "read").maybeSingle();
  if (!link || link.revoked || (link.expires_at && new Date(link.expires_at) < new Date())) {
    return reply("Ta povezava ne obstaja več, je potekla ali je bila preklicana.", 404);
  }
  let agent: any = null;
  if (link.agent_id) {
    const { data } = await db.from("agents").select("name,space,disabled").eq("id", link.agent_id).maybeSingle();
    agent = data;
    if (!agent || agent.disabled) return reply("Ta agent je onemogočen.", 403);
    if (link.space && link.space !== agent.space) return reply("Ta povezava ni več veljavna za prostor tega agenta.", 403);
  }

  let pq = db.from("projects").select("id,name,space").order("created_at");
  pq = link.project_id ? pq.eq("id", link.project_id) : pq.eq("space", link.space);
  if (agent) pq = pq.eq("space", agent.space); // checked on every use: a work agent never sees personal projects
  const { data: projects } = await pq;
  const ids = (projects ?? []).map((p) => p.id);

  const { data: entries } = ids.length
    ? await db.from("entries").select("project_id,kind,text,files,created_at,author_name,done_at,done_by,source,via,review,skill_name,version,superseded_by").in("project_id", ids).order("created_at")
    : { data: [] as any[] };

  // temporary download links for attachments (24 h)
  const paths = (entries ?? []).filter((e: any) => !e.review && !e.superseded_by).flatMap((e: any) => (e.files ?? []).map((f: any) => f.path)).filter(Boolean);
  const urls: Record<string, string> = {};
  if (paths.length) {
    const { data: signed } = await db.storage.from("files").createSignedUrls(paths, 60 * 60 * 24);
    (signed ?? []).forEach((s: any) => { if (s.signedUrl) urls[s.path] = s.signedUrl; });
  }

  const scope = link.project_id ? `projekt »${projects?.[0]?.name ?? "?"}«` : `vsi projekti v prostoru ${SPACE[link.space] ?? link.space}`;
  const out: string[] = [
    `# Kontekst iz Aleks's AI mindmap`,
    `> Samo za branje. Obseg: ${scope}. Izvoženo ${day(new Date().toISOString())} UTC.`,
    `> Za AI: to je zbirka zapiskov, odločitev in navodil, ki jih uporabnik hrani za svoje delo. Uporabi jih kot kontekst.`,
    "",
  ];
  for (const p of projects ?? []) {
    // skills/prompts written by agents stay out until the owner approves them
    const all = (entries ?? []).filter((e: any) => e.project_id === p.id);
    const es = all.filter((e: any) => !e.review && !e.superseded_by); // only approved, current versions
    const pending = all.filter((e: any) => e.review && !e.superseded_by).length;
    out.push(`## ${p.name}`, `_${SPACE[p.space] ?? p.space} · ${es.length} vnosov${pending ? ` · ${pending} čaka na pregled (ni vključeno)` : ""}_`, "");
    for (const k of ORDER) {
      const group = es.filter((e: any) => e.kind === k);
      if (!group.length) continue;
      out.push(`### ${LABEL[k]}`, "");
      for (const e of group) {
        const files = (e.files ?? []).map((f: any) => (urls[f.path] ? `[${f.name}](${urls[f.path]})` : f.name));
        if (k === "skill" || k === "prompt") {
          const title = e.skill_name ? `${e.skill_name}${e.version ? ` (v${e.version})` : ""} · ` : "";
          out.push(`#### ${title}${day(e.created_at)} · ${who(e)}`, "", e.text ?? "", "");
        } else {
          const box = k === "todo" ? (e.done_at ? "[x] " : "[ ] ") : "";
          const doneNote = e.done_at ? ` (opravljeno ${day(e.done_at)}${e.done_by ? " @" + e.done_by : ""})` : "";
          out.push(`- ${box}[${day(e.created_at)} ${who(e)}] ${(e.text ?? "").replace(/\n+/g, " / ")}${doneNote}`);
        }
        if (files.length) out.push(`  - priponke: ${files.join(", ")}`);
      }
      out.push("");
    }
  }
  if (!(projects ?? []).length) out.push("_V tem obsegu še ni projektov._");

  await db.from("share_links").update({ last_used_at: new Date().toISOString(), use_count: (link.use_count ?? 0) + 1 }).eq("id", link.id);
  return reply(out.join("\n"));
});
