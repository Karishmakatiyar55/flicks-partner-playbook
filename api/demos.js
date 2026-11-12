// Shared demo links for the playbook.
// Storage: Upstash Redis (add it in Vercel → Storage / Marketplace → Upstash for Redis,
// connected to this project). Vercel then sets KV_REST_API_URL and KV_REST_API_TOKEN.
//
// GET  /api/demos                         -> { demos: { partnerId: [{label,url}] } }
// POST /api/demos  {partner, op:"add", label, url, base}
// POST /api/demos  {partner, op:"remove", url, base}
//   "base" is the partner's current list on the page; it seeds storage the first
//   time a partner is changed, so demos written in the code are kept.

const KEY = "flicks-playbook:demos";
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

async function readAll(s) {
  const raw = await redis(s, ["GET", KEY]);
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}

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
    if (req.method === "GET") return res.status(200).json({ demos: await readAll(s) });

    if (req.method !== "POST") return res.status(405).json({ error: "Use GET or POST" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { partner, op } = body;
    if (!/^[a-z0-9-]{1,40}$/.test(partner || "")) return res.status(400).json({ error: "Unknown partner" });

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
      return res.status(400).json({ error: "op must be add or remove" });
    }

    all[partner] = list;
    await redis(s, ["SET", KEY, JSON.stringify(all)]);
    return res.status(200).json({ demos: list });
  } catch (e) {
    return res.status(500).json({ error: "Could not save. Try again." });
  }
};
