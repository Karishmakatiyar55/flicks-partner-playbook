# Flicks partner playbook

Internal dashboard for Flicks partnerships: one page per partner with what they run today, where Flicks fits, live demos, pricing models and next steps. Static pages plus one small Vercel function for shared demos; no build step.

| File | What it is |
|---|---|
| `index.html` | The playbook |
| `osmos.html` | Osmos fixed-fee model with live calculator, embedded on the Osmos page |
| `assets/fields.js` | Makes every calculator number typeable as well as draggable |
| `assets/logos/` | Partner logos, one file per partner id |
| `api/demos.js` | Shared storage: demo links, deal stages and case studies (links and PDFs up to 3 MB) added on the live site show for everyone |
| `assets/case-studies/` | Optional: larger case-study PDFs committed to the repo, listed in `CASES` in `index.html` |

## Updating
- **Partner content:** edit the `PARTNERS` list near the top of the script in `index.html`. Every page is drawn from it.
- **Logos:** add `assets/logos/<partner id>.png` (for example `jiohotstar.png`). Without a file the page shows initials.
- **Case studies:** add a PDF (up to 3 MB) or a link on the Case studies page. For a bigger PDF, commit it to `assets/case-studies/` and add it to the `CASES` list.
- **Deal stages:** set them on each partner page.
- **Demos:** add or remove them on the live page; with shared storage connected, the change shows for everyone. Demos in the code's `demos` lists are the starting set.

## Deploy on Vercel
Import this repo, set **Framework Preset: Other**, leave build and output settings empty. Every push to `main` redeploys.

### Shared demos (one-time setup)
1. In the Vercel project, open **Storage** and add **Upstash for Redis** (free plan) from the Marketplace.
2. Connect it to this project for all environments. Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. Redeploy once. The demo section then says demos show for everyone.

Without this, demos added on the page save only in that person's browser, and the page says so.
