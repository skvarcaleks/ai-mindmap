// Aleks's AI mindmap – ingest
// Write-only links for agents:
//   POST .../functions/v1/ingest?t=<key>
//     JSON:      {"text": "...", "kind": "misel", "files": [{"name": "a.pdf", "type": "application/pdf", "data": "<base64>"}]}
//                {"text": "...", "kind": "skill", "name": "blog-writer"}  same name again = new version
//                {"kind": "sestanek", "title": "...", "date": "2026-11-17T10:00", "participants": ["Ana"], "summary": "...", "transcript": "..."}
//     multipart: fields text, kind; one or more "file" parts
//     plain text body also works (kind via &kind=...)
//   GET  .../functions/v1/ingest?t=<key>   short instructions for the agent
// Adds entries to ONE project as ONE named agent. Cannot read, change or delete anything.
// The agent's name comes from the link, never from the request.
// Skills and prompts from agents are marked "for review" until the owner approves them.
// Deploy with "Verify JWT" OFF (the secret key in the link is the access check).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const KINDS = ["misel", "odlocitev", "todo", "povezava", "skill", "prompt", "datoteka", "sestanek"];
const NEEDS_REVIEW = ["skill", "prompt"];
const MAX_CHARS = 20000;
const MAX_TRANSCRIPT = 400000;    // a 3–4 hour meeting
const CAPTION_EXT = ["vtt", "srt"];
const MAX_PER_HOUR = 60;          // entries + files per link per hour
const MAX_FILES = 5;
const MAX_FILE_BYTES = 8 * 1048576;
const TEXT_EXT = ["md", "markdown", "txt"];      // become entry text, not stored as files
const FILE_TYPES: Record<string, string> = {      // extension → stored content type
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  pdf: "application/pdf", csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
const md = (b: string, s = 200) => new Response(b, { status: s, headers: { ...cors, "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" } });
const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");
const ext = (n: string) => (n.split(".").pop() ?? "").toLowerCase();
const safeName = (n: string) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "datoteka";
const slug = (n: string) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\.(md|markdown|txt)$/, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const b64ToBytes = (b: string) => Uint8Array.from(atob(b.replace(/^data:[^,]*,/, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));

type InFile = { name: string; bytes: Uint8Array };

// .vtt / .srt captions → "Name: text" paragraphs
function tidyCaptions(t: string): string {
  const lines = t.replace(/\r\n?/g, "\n").split("\n");
  const out: { who: string | null; text: string }[] = [];
  let skip = false;
  const push = (who: string | null, text: string) => {
    text = text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.who === who && (who || last.text.length < 450)) last.text += " " + text;
    else out.push({ who, text });
  };
  for (let i = 0; i < lines.length; i++) {
    const tl = lines[i].trim();
    if (/^WEBVTT/.test(tl) || /^(NOTE|STYLE|REGION)\b/.test(tl)) { skip = true; continue; }
    if (!tl) { skip = false; continue; }
    if (skip || tl.includes("-->") || (lines[i + 1] ?? "").includes("-->")) continue;
    const v = tl.match(/^<v(?:\.[\w.-]+)?\s+([^>]+)>(.*?)(?:<\/v>)?$/);
    if (v) { push(v[1].trim(), v[2]); continue; }
    const sp = tl.match(/^([^\s:][^:]{0,40}):\s+(.+)$/);
    if (sp && !/^https?$/i.test(sp[1])) { push(sp[1].trim(), sp[2]); continue; }
    push(out.length ? out[out.length - 1].who : null, tl);
  }
  return out.map((o) => (o.who ? `${o.who}: ${o.text}` : o.text)).join("\n\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const key = url.searchParams.get("t") ?? "";
  if (!/^[a-f0-9]{32,64}$/.test(key)) return json({ error: "invalid link" }, 404);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: link } = await db.from("share_links").select("*").eq("token_hash", await sha256(key)).eq("mode", "write").maybeSingle();
  if (!link || link.revoked || (link.expires_at && new Date(link.expires_at) < new Date())) return json({ error: "link revoked, expired or unknown" }, 404);

  const { data: project } = await db.from("projects").select("name,space").eq("id", link.project_id).maybeSingle();
  if (!project) return json({ error: "project not found" }, 404);

  let agent: any = null;
  if (link.agent_id) {
    const { data } = await db.from("agents").select("id,name,space,disabled").eq("id", link.agent_id).maybeSingle();
    agent = data;
    if (!agent || agent.disabled) return json({ error: "agent disabled" }, 403);
    // checked on every use: a work agent can never write into a personal project
    if (agent.space !== project.space) return json({ error: "project is outside this agent's space" }, 403);
  }
  const name = agent?.name ?? link.label ?? "agent";

  if (req.method === "GET") {
    return md([
      `# @${name} → projekt »${project.name}« (Aleks's AI mindmap)`,
      "",
      `This link only ADDS entries to one project, signed as @${name}. It cannot read or change anything.`,
      "",
      "POST to this same URL. JSON:",
      '`{"text": "what you did or found", "kind": "misel"}`',
      'With files: `{"text": "...", "files": [{"name": "report.pdf", "type": "application/pdf", "data": "<base64>"}]}`',
      "Or multipart/form-data with fields `text`, `kind` and one or more `file` parts.",
      "",
      "kind: `misel` (note, default), `odlocitev` (decision), `todo` (task), `povezava` (link), `skill` (AI instructions), `prompt`, `datoteka` (file).",
      "Skills and prompts are held for the owner's review before they are used.",
      'Give a skill or prompt a short name: `{"kind": "skill", "name": "blog-writer", "text": "..."}`. Sending the same name again creates a new version; once approved it replaces the old one (kept as history). Without a name, the `name:` line of the skill front matter is used, then the file name.',
      `Files: ${Object.keys(FILE_TYPES).join(", ")}; .md/.txt are stored as text. Max ${MAX_FILES} files, 8 MB each.`,
      `Limits: ${MAX_PER_HOUR} entries+files per hour, ${MAX_CHARS} characters per entry.`,
      'Meeting: `{"kind": "sestanek", "title": "Weekly team meeting", "date": "2026-11-17T10:00", "participants": ["Ana", "Marko"], "summary": "## Povzetek ...", "transcript": "full transcript"}`. The transcript can also be a .vtt, .srt or .txt file. The summary is what AI tools read; keep decisions under `## Odločitve` and tasks under `## Naloge`.',
      "Short, factual entries, in Slovenian if possible. One entry per finished step or problem.",
    ].join("\n"));
  }
  if (req.method !== "POST") return json({ error: "use POST" }, 405);

  // ---- read the request ----
  let body = "", kind = url.searchParams.get("kind") ?? "", rawName = url.searchParams.get("name") ?? "";
  const files: InFile[] = [];
  let fileName = "";
  // meeting fields
  let mTitle = "", mDate = "", mWho: string[] = [], mSummary = "", mTranscript = "", mPrivate = false;
  const whoList = (v: unknown) => (Array.isArray(v) ? v : String(v ?? "").split(/[,;\n]/)).map((x) => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 40);
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const j = await req.json();
      body = String(j.text ?? j.content ?? j.message ?? "");
      if (j.kind) kind = String(j.kind);
      if (j.name) rawName = String(j.name);
      mTitle = String(j.title ?? ""); mDate = String(j.date ?? j.meeting_at ?? ""); mWho = whoList(j.participants);
      mSummary = String(j.summary ?? ""); mTranscript = String(j.transcript ?? ""); mPrivate = j.private === true;
      for (const f of Array.isArray(j.files) ? j.files : []) {
        if (!f?.name || !f?.data) return json({ error: "each file needs name and base64 data" }, 400);
        files.push({ name: String(f.name), bytes: b64ToBytes(String(f.data)) });
      }
    } else if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      body = String(form.get("text") ?? "");
      if (form.get("kind")) kind = String(form.get("kind"));
      if (form.get("name")) rawName = String(form.get("name"));
      mTitle = String(form.get("title") ?? ""); mDate = String(form.get("date") ?? ""); mWho = whoList(form.get("participants"));
      mSummary = String(form.get("summary") ?? ""); mTranscript = String(form.get("transcript") ?? ""); mPrivate = form.get("private") === "true";
      for (const v of form.getAll("file")) {
        if (v instanceof File) files.push({ name: v.name, bytes: new Uint8Array(await v.arrayBuffer()) });
      }
    } else {
      body = await req.text();
    }
  } catch {
    return json({ error: "could not read the request (check JSON / base64)" }, 400);
  }

  // ---- check files ----
  if (files.length > MAX_FILES) return json({ error: `max ${MAX_FILES} files per entry` }, 400);
  const stored: InFile[] = [];
  for (const f of files) {
    const e = ext(f.name);
    if (f.bytes.byteLength > MAX_FILE_BYTES) return json({ error: `${f.name} is larger than 8 MB` }, 400);
    if (CAPTION_EXT.includes(e) || (kind === "sestanek" && TEXT_EXT.includes(e))) {
      // transcripts: captions are cleaned up, plain text kept as is
      const t = new TextDecoder().decode(f.bytes);
      const clean = CAPTION_EXT.includes(e) ? tidyCaptions(t) : t.replace(/\r\n/g, "\n").trim();
      mTranscript = mTranscript.trim() ? `${mTranscript.trim()}\n\n${clean}` : clean;
      kind = "sestanek";
      if (!mTitle) mTitle = f.name.replace(/\.[^.]+$/, "").replace(/_+/g, " ");
    } else if (TEXT_EXT.includes(e)) {
      const t = new TextDecoder().decode(f.bytes).replace(/\r\n/g, "\n").trim();
      body = body.trim() ? `${body.trim()}\n\n---\n\n${t}` : t;
      if (!kind && (e === "md" || e === "markdown")) kind = "skill";
      if (!fileName) fileName = f.name;
    } else if (FILE_TYPES[e]) {
      stored.push(f);
    } else {
      return json({ error: `file type .${e} is not allowed` }, 400);
    }
  }

  body = body.trim();
  // ---- meetings: summary (what AI reads) + full transcript ----
  let meeting: Record<string, unknown> = {};
  if (!kind && (mTranscript.trim() || mSummary.trim())) kind = "sestanek";
  if (kind === "sestanek") {
    body = (mSummary.trim() || body).trim();
    const tr = mTranscript.trim();
    if (!body && !tr) return json({ error: "a meeting needs a summary or a transcript" }, 400);
    if (tr.length > MAX_TRANSCRIPT) return json({ error: `transcript longer than ${MAX_TRANSCRIPT} characters` }, 400);
    const at = mDate ? new Date(mDate) : new Date();
    meeting = {
      title: (mTitle.trim() || "Sestanek").slice(0, 140),
      meeting_at: isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString(),
      participants: mWho, transcript: tr || null, transcript_private: mPrivate,
    };
  }
  if (!body && !stored.length && kind !== "sestanek") return json({ error: "nothing to save (no text and no files)" }, 400);
  if (body.length > MAX_CHARS) return json({ error: `text longer than ${MAX_CHARS} characters` }, 400);
  if (!kind) kind = stored.length && !body ? "datoteka" : "misel";
  if (!KINDS.includes(kind)) kind = "misel";

  // ---- named skills/prompts get version numbers ----
  const review = NEEDS_REVIEW.includes(kind);
  // name: given explicitly > "name:" in the skill's front matter > file name (unless generic like SKILL.md)
  if (review && !rawName) {
    const fm = body.match(/^---\n[\s\S]*?^name:\s*["']?([^"'\n]+)["']?\s*$/m);
    if (fm && body.startsWith("---")) rawName = fm[1];
    else if (fileName && !/^(skill|readme|prompt|index)\.(md|markdown|txt)$/i.test(fileName)) rawName = fileName;
  }
  const skillName = review && rawName ? slug(rawName) || null : null;
  let version: number | null = null;
  if (skillName) {
    let vq = db.from("entries").select("version").eq("project_id", link.project_id).eq("skill_name", skillName);
    vq = agent ? vq.eq("agent_id", agent.id) : vq.eq("author_name", name);
    const { data: vs } = await vq.order("version", { ascending: false, nullsFirst: false }).limit(1);
    version = (vs?.[0]?.version ?? 0) + 1;
  }

  // ---- rate limit per agent and project (entries + files) ----
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { data: recent } = await db.from("entries").select("files")
    .eq("project_id", link.project_id).eq("author_name", name).eq("source", "agent").gte("created_at", since);
  const used = (recent ?? []).reduce((n: number, r: any) => n + 1 + (r.files?.length ?? 0), 0);
  if (used + 1 + stored.length > MAX_PER_HOUR) return json({ error: "hourly limit reached, try later" }, 429);

  // ---- store files privately, under the project ----
  const saved: { name: string; type: string; size: number; path: string }[] = [];
  for (const f of stored) {
    const type = FILE_TYPES[ext(f.name)];
    const path = `${link.project_id}/${crypto.randomUUID()}/${safeName(f.name)}`;
    const { error } = await db.storage.from("files").upload(path, f.bytes, { contentType: type, upsert: false });
    if (error) {
      if (saved.length) await db.storage.from("files").remove(saved.map((s) => s.path));
      return json({ error: `upload failed: ${error.message}` }, 500);
    }
    saved.push({ name: f.name, type, size: f.bytes.byteLength, path });
  }

  const { data, error } = await db.from("entries").insert({
    project_id: link.project_id, kind, text: body, files: saved, author: null,
    author_name: name, agent_id: agent?.id ?? null, source: "agent", review, skill_name: skillName, version, ...meeting,
  }).select("id").single();
  if (error) {
    if (saved.length) await db.storage.from("files").remove(saved.map((s) => s.path));
    return json({ error: error.message }, 500);
  }

  await db.from("share_links").update({ last_used_at: new Date().toISOString(), use_count: (link.use_count ?? 0) + 1 }).eq("id", link.id);
  return json({ ok: true, id: data.id, project: project.name, as: "@" + name, kind, files: saved.length, review, ...(skillName ? { name: skillName, version } : {}) });
});
