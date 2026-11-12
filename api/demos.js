// Shared demo links for the playbook.
// Storage: Upstash Redis (add it in Vercel → Storage / Marketplace → Upstash for Redis,
// connected to this project). Vercel then sets KV_REST_API_URL and KV_REST_API_TOKEN.
//
// GET  /api/demos                         -> { demos: { partnerId: [{label,url}] } }
// POST /api/demos  {partner, op:"add", label, url, base}
// POST /api/demos  {partner, op:"remove", url, base}
//   "base" is the partner's current list on the page; it seeds storage the first
//   time a partner is changed, so demos written in the code are kept.
// POST /api/demos  {partner, op:"stage", stage:0-3, note}
//   Deal stage tracker. GET also returns { stages: { partnerId: {stage,note} } }.
//
// Case studies. GET also returns { cases: [{id,title,kind,url,name,size}] }.
// POST /api/demos  {op:"case-add", title, kind:"link", url}
// POST /api/demos  {op:"case-add", title, kind:"pdf", name, data}   data = base64 PDF, up to 3 MB
// POST /api/demos  {op:"case-remove", id}
// GET  /api/demos?file=<id>[&download=1]   streams an uploaded PDF

const KEY = "flicks-playbook:demos";
const STAGE_KEY = "flicks-playbook:stages";
const CASES_KEY = "flicks-playbook:cases";
const FILE_KEY = (id) => "flicks-playbook:case-file:" + id;
const MAX_PDF = 3 * 1024 * 1024;
const MAX_CASES = 60;
const MAX_PER_PARTNER = 30;

function store() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

async function redis(s, command) {
  const r = await fetch(s.url, {
    method: "POST",
    headers: { Authorization: "Bearer " + s.token, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!r.ok) throw new Error("storage " + r.status);
  return (await r.json()).result;
}

async function readAll(s, key, empty) {
  const raw = await redis(s, ["GET", key || KEY]);
  try { return raw ? JSON.parse(raw) : empty || {}; } catch (e) { return empty || {}; }
}
const readCases = async (s) => { const c = await readAll(s, CASES_KEY, []); return Array.isArray(c) ? c : []; };

const isUrl = (u) => typeof u === "string" && u.length <= 500 && /^https?:\/\/[^\s.]+\.[^\s]+$/.test(u);
const clean = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((d) => d && isUrl(d.url))
    .slice(0, MAX_PER_PARTNER)
    .map((d) => ({ label: String(d.label || "Demo").slice(0, 40), url: d.url }));

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const s = store();
  if (!s) return res.status(503).json({ error: "Shared storage is not connected" });

  try {
    if (req.method === "GET") {
      const q = new URL(req.url || "/", "http://x").searchParams;
      const fileId = q.get("file");
      if (fileId) {
        if (!/^[a-z0-9]{6,24}$/.test(fileId)) return res.status(400).json({ error: "Unknown file" });
        const [b64, cases] = await Promise.all([redis(s, ["GET", FILE_KEY(fileId)]), readCases(s)]);
        if (!b64) return res.status(404).json({ error: "File not found" });
        const item = cases.find((c) => c.id === fileId) || {};
        const name = String(item.name || "case-study.pdf").replace(/[^\w.\- ]+/g, "_");
        const buf = Buffer.from(b64, "base64");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Length", buf.length);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Disposition", (q.get("download") ? "attachment" : "inline") + '; filename="' + name + '"');
        return res.end(buf);
      }
      const [demos, stages, cases] = await Promise.all([readAll(s), readAll(s, STAGE_KEY), readCases(s)]);
      return res.status(200).json({ demos, stages, cases });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Use GET or POST" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { partner, op } = body;

    if (op === "case-add") {
      const title = String(body.title || "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (!title) return res.status(400).json({ error: "Give the case study a name" });
      const cases = await readCases(s);
      if (cases.length >= MAX_CASES) return res.status(400).json({ error: "Too many case studies" });
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      let item;
      if (body.kind === "link") {
        if (!isUrl(body.url)) return res.status(400).json({ error: "Paste a full link starting with https://" });
        item = { id, title, kind: "link", url: body.url };
      } else if (body.kind === "pdf") {
        const data = String(body.data || "");
        const buf = Buffer.from(data, "base64");
        if (!buf.length) return res.status(400).json({ error: "Choose a PDF file" });
        if (buf.length > MAX_PDF) return res.status(400).json({ error: "PDF is over 3 MB. Add it as a link instead." });
        if (buf.slice(0, 5).toString() !== "%PDF-") return res.status(400).json({ error: "That file isn't a PDF" });
        const name = String(body.name || "case-study.pdf").slice(0, 100);
        await redis(s, ["SET", FILE_KEY(id), buf.toString("base64")]);
        item = { id, title, kind: "pdf", name, size: buf.length };
      } else {
        return res.status(400).json({ error: "kind must be pdf or link" });
      }
      cases.unshift(item);
      await redis(s, ["SET", CASES_KEY, JSON.stringify(cases)]);
      return res.status(200).json({ cases });
    }
    if (op === "case-remove") {
      const cases = await readCases(s);
      const i = cases.findIndex((c) => c.id === body.id);
      if (i >= 0) {
        if (cases[i].kind === "pdf") await redis(s, ["DEL", FILE_KEY(cases[i].id)]);
        cases.splice(i, 1);
        await redis(s, ["SET", CASES_KEY, JSON.stringify(cases)]);
      }
      return res.status(200).json({ cases });
    }
    if (!/^[a-z0-9-]{1,40}$/.test(partner || "")) return res.status(400).json({ error: "Unknown partner" });

    if (op === "stage") {
      const stage = Number(body.stage);
      if (!Number.isInteger(stage) || stage < 0 || stage > 3) return res.status(400).json({ error: "Unknown stage" });
      const note = String(body.note == null ? "" : body.note).replace(/\s+/g, " ").trim().slice(0, 140);
      const stages = await readAll(s, STAGE_KEY);
      stages[partner] = { stage, note };
      await redis(s, ["SET", STAGE_KEY, JSON.stringify(stages)]);
      return res.status(200).json({ deal: stages[partner] });
    }

    const all = await readAll(s);
    let list = Array.isArray(all[partner]) ? clean(all[partner]) : clean(body.base);

    if (op === "add") {
      if (!isUrl(body.url)) return res.status(400).json({ error: "Paste a full link starting with https://" });
      if (list.length >= MAX_PER_PARTNER) return res.status(400).json({ error: "Too many demos for this partner" });
      const label = String(body.label || "").trim().slice(0, 40) || "Demo " + (list.length + 1);
      list.push({ label, url: body.url });
    } else if (op === "remove") {
      const i = list.findIndex((d) => d.url === body.url);
      if (i >= 0) list.splice(i, 1);
    } else {
      return res.status(400).json({ error: "op must be add, remove or stage" });
    }

    all[partner] = list;
    await redis(s, ["SET", KEY, JSON.stringify(all)]);
    return res.status(200).json({ demos: list });
  } catch (e) {
    return res.status(500).json({ error: "Could not save. Try again." });
  }
};
