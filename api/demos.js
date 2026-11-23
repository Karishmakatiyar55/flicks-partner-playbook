// Shared demo links for the playbook.
// Storage: Upstash Redis (add it in Vercel → Storage / Marketplace → Upstash for Redis,
// connected to this project). Vercel then sets KV_REST_API_URL and KV_REST_API_TOKEN.
//
// GET  /api/demos                         -> { demos: { partnerId: [{label,url}] } }
// POST /api/demos  {partner, op:"add", label, url, base}
// POST /api/demos  {partner, op:"remove", url, base}
//   "base" is the partner's current list on the page; it seeds storage the first
//   time a partner is changed, so demos written in the code are kept.
// POST /api/demos  {partner, op:"edit", old, label, url, base}   old = the demo's current link
// POST /api/demos  {partner, op:"stage", stage:0-3, note}
//   Deal stage tracker. GET also returns { stages: { partnerId: {stage,note} } }.
//
// Brand tracker. GET also returns { brands: { partnerId: [{id,name,site,stage}] } }.
// POST /api/demos  {partner, op:"brand-add", site, name}   site = the brand's website; name is optional
//   Only the domain is stored. The page shows the brand's logo from that domain.
// POST /api/demos  {partner, op:"brand-stage", id, stage:0-3}
// POST /api/demos  {partner, op:"brand-remove", id}
//
// Decks. GET also returns { decks: { partnerId: url } }.
// POST /api/demos  {partner, op:"deck", url}   an empty url removes the deck
//
// Case studies. GET also returns { cases: [{id,title,kind,url,name,size}] }.
// POST /api/demos  {op:"case-add", title, kind:"link", url}
// PDFs up to 20 MB go up in pieces (a Vercel function call carries at most 4.5 MB):
// POST /api/demos  {op:"pdf-start", title, name, size, parts}   -> {id}
// POST /api/demos  {op:"pdf-part", id, n, data}                  data = base64 of one piece
// POST /api/demos  {op:"pdf-done", id}                           -> {cases}
// GET  /api/demos?file=<id>&part=<n>                             one piece, raw bytes
// POST /api/demos  {op:"case-remove", id}
// Unfinished uploads expire after an hour.

const KEY = "flicks-playbook:demos";
const STAGE_KEY = "flicks-playbook:stages";
const CASES_KEY = "flicks-playbook:cases";
const BRANDS_KEY = "flicks-playbook:brands";
const DECKS_KEY = "flicks-playbook:decks";
const MAX_BRANDS = 100;
const FILE_KEY = (id) => "flicks-playbook:case-file:" + id;
const MAX_PDF = 20 * 1024 * 1024;
const PART = 2.5 * 1024 * 1024;           // raw bytes per piece
const PART_KEY = (id, n) => FILE_KEY(id) + ":" + n;
const PENDING_KEY = (id) => "flicks-playbook:case-pending:" + id;
const TTL = 3600;
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
      if (fileId && q.has("part")) {
        const n = Number(q.get("part"));
        if (!/^[a-z0-9]{6,24}$/.test(fileId) || !Number.isInteger(n) || n < 0 || n > 20) return res.status(400).json({ error: "Unknown file" });
        const b64 = await redis(s, ["GET", PART_KEY(fileId, n)]);
        if (!b64) return res.status(404).json({ error: "File not found" });
        const buf = Buffer.from(b64, "base64");
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", buf.length);
        res.setHeader("Cache-Control", "private, max-age=86400, immutable");
        return res.end(buf);
      }
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
      const [demos, stages, cases, brands, decks] = await Promise.all([readAll(s), readAll(s, STAGE_KEY), readCases(s), readAll(s, BRANDS_KEY), readAll(s, DECKS_KEY)]);
      return res.status(200).json({ demos, stages, cases, brands, decks });
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
      } else {
        return res.status(400).json({ error: "Use pdf-start to upload a PDF" });
      }
      cases.unshift(item);
      await redis(s, ["SET", CASES_KEY, JSON.stringify(cases)]);
      return res.status(200).json({ cases });
    }
    if (op === "pdf-start") {
      const title = String(body.title || "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (!title) return res.status(400).json({ error: "Give the case study a name" });
      const size = Number(body.size), parts = Number(body.parts);
      if (!Number.isInteger(size) || size <= 0) return res.status(400).json({ error: "Choose a PDF file" });
      if (size > MAX_PDF) return res.status(400).json({ error: "PDF is over 20 MB" });
      if (parts !== Math.ceil(size / PART)) return res.status(400).json({ error: "Upload pieces don't match the file size" });
      if ((await readCases(s)).length >= MAX_CASES) return res.status(400).json({ error: "Too many case studies" });
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const name = String(body.name || "case-study.pdf").slice(0, 100);
      await redis(s, ["SET", PENDING_KEY(id), JSON.stringify({ id, title, kind: "pdf", name, size, parts }), "EX", TTL]);
      return res.status(200).json({ id });
    }
    if (op === "pdf-part" || op === "pdf-done") {
      if (!/^[a-z0-9]{6,24}$/.test(body.id || "")) return res.status(400).json({ error: "Unknown upload" });
      const raw = await redis(s, ["GET", PENDING_KEY(body.id)]);
      if (!raw) return res.status(400).json({ error: "Upload expired. Try again." });
      const item = JSON.parse(raw);
      if (op === "pdf-part") {
        const n = Number(body.n);
        if (!Number.isInteger(n) || n < 0 || n >= item.parts) return res.status(400).json({ error: "Unknown piece" });
        const buf = Buffer.from(String(body.data || ""), "base64");
        const want = n < item.parts - 1 ? PART : item.size - PART * (item.parts - 1);
        if (buf.length !== want) return res.status(400).json({ error: "A piece arrived damaged. Try again." });
        if (n === 0 && buf.slice(0, 5).toString() !== "%PDF-") return res.status(400).json({ error: "That file isn't a PDF" });
        await redis(s, ["SET", PART_KEY(item.id, n), buf.toString("base64"), "EX", TTL]);
        return res.status(200).json({ ok: true });
      }
      for (let n = 0; n < item.parts; n++) {
        if (!(await redis(s, ["EXISTS", PART_KEY(item.id, n)]))) return res.status(400).json({ error: "Upload is missing a piece. Try again." });
      }
      for (let n = 0; n < item.parts; n++) await redis(s, ["PERSIST", PART_KEY(item.id, n)]);
      await redis(s, ["DEL", PENDING_KEY(item.id)]);
      const cases = await readCases(s);
      cases.unshift(item);
      await redis(s, ["SET", CASES_KEY, JSON.stringify(cases)]);
      return res.status(200).json({ cases });
    }
    if (op === "case-remove") {
      const cases = await readCases(s);
      const i = cases.findIndex((c) => c.id === body.id);
      if (i >= 0) {
        if (cases[i].kind === "pdf") {
          const keys = [FILE_KEY(cases[i].id)];
          for (let n = 0; n < (cases[i].parts || 0); n++) keys.push(PART_KEY(cases[i].id, n));
          await redis(s, ["DEL"].concat(keys));
        }
        cases.splice(i, 1);
        await redis(s, ["SET", CASES_KEY, JSON.stringify(cases)]);
      }
      return res.status(200).json({ cases });
    }
    if (!/^[a-z0-9-]{1,40}$/.test(partner || "")) return res.status(400).json({ error: "Unknown partner" });

    if (op === "deck") {
      const url = String(body.url || "").trim();
      if (url && (!isUrl(url) || url.length > 600)) return res.status(400).json({ error: "Paste a full link starting with https://" });
      const decks = await readAll(s, DECKS_KEY);
      if (url) decks[partner] = url; else delete decks[partner];
      await redis(s, ["SET", DECKS_KEY, JSON.stringify(decks)]);
      return res.status(200).json({ deck: url });
    }
    if (op === "brand-add" || op === "brand-stage" || op === "brand-remove") {
      const all = await readAll(s, BRANDS_KEY);
      const list = Array.isArray(all[partner]) ? all[partner] : [];
      if (op === "brand-add") {
        const site = String(body.site || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[\/?#:]/)[0];
        if (!/^(?=.{4,100}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(site)) return res.status(400).json({ error: "Paste the brand's website, like nykaa.com" });
        const label = site.split(".")[0];
        const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 60) || label.charAt(0).toUpperCase() + label.slice(1);
        if (list.some((b) => b.site === site)) return res.status(400).json({ error: site + " is already on this list" });
        if (list.length >= MAX_BRANDS) return res.status(400).json({ error: "Too many brands" });
        list.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, site, stage: 0 });
      } else {
        const i = list.findIndex((b) => b.id === body.id);
        if (i < 0) return res.status(200).json({ brands: list });
        if (op === "brand-remove") list.splice(i, 1);
        else {
          const stage = Number(body.stage);
          if (!Number.isInteger(stage) || stage < 0 || stage > 3) return res.status(400).json({ error: "Unknown stage" });
          list[i].stage = stage;
        }
      }
      all[partner] = list;
      await redis(s, ["SET", BRANDS_KEY, JSON.stringify(all)]);
      return res.status(200).json({ brands: list });
    }

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
    } else if (op === "edit") {
      if (!isUrl(body.url)) return res.status(400).json({ error: "Paste a full link starting with https://" });
      const i = list.findIndex((d) => d.url === body.old);
      if (i < 0) return res.status(400).json({ error: "That demo was changed by someone else. Refresh and try again." });
      list[i] = { label: String(body.label || "").trim().slice(0, 40) || list[i].label, url: body.url };
    } else if (op === "remove") {
      const i = list.findIndex((d) => d.url === body.url);
      if (i >= 0) list.splice(i, 1);
    } else {
      return res.status(400).json({ error: "op must be add, edit, remove or stage" });
    }

    all[partner] = list;
    await redis(s, ["SET", KEY, JSON.stringify(all)]);
    return res.status(200).json({ demos: list });
  } catch (e) {
    return res.status(500).json({ error: "Could not save. Try again." });
  }
};
