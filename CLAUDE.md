# Working rules for this repo

- After every change to this codebase, commit it and push to `main` on GitHub straight away. Vercel deploys from `main`, so an unpushed change never reaches the live site.
- Internal team playbook on a public URL: never add confidential client data (contract terms, signing dates, real revenue figures). Calculator defaults stay labelled as examples. Facts in the `PARTNERS` list need a source link.
- Static pages: `index.html` (playbook), `osmos.html` (Osmos calculator page, also embedded as `osmos.html#calculator`), `assets/`. One Vercel function, `api/demos.js`, stores demo links shared by everyone (Upstash Redis via `KV_REST_API_URL` / `KV_REST_API_TOKEN`). No build step, no npm dependencies.
- Style follows Flam branding: warm near-black background, rose-beige gradient headings, Flicks-orange accent pills and buttons (`--accent`, taken from the Flicks logo; no olive or green), Inter medium. Keep every new colour in that warm family. Money-flow diagrams stay static.
- On partner pages the demo section comes before pricing.
- The spelling is "Flicks", never "Flix".
