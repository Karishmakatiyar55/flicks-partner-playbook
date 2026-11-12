# Flicks partner playbook

Internal dashboard for Flicks partnerships: one page per partner with what they run today, where Flicks fits, live demos, pricing models and next steps. Static site, no build step.

| File | What it is |
|---|---|
| `index.html` | The playbook |
| `osmos.html` | Osmos fixed-fee model with live calculator, embedded on the Osmos page |
| `assets/fields.js` | Makes every calculator number typeable as well as draggable |
| `assets/logos/` | Partner logos, one file per partner id |

## Updating
- **Partner content:** edit the `PARTNERS` list near the top of the script in `index.html`. Every page is drawn from it.
- **Logos:** add `assets/logos/<partner id>.png` (for example `jiohotstar.png`). Without a file the page shows initials.
- **Demos:** add `{label, url}` to that partner's `demos` list. People can also add demos on the live page; those save only in their own browser until someone sends them via **Copy changes** and they are added here.

## Deploy on Vercel
Import this repo, set **Framework Preset: Other**, leave build and output settings empty. Every push to `main` redeploys.
