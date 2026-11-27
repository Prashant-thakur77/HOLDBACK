# Web design pass: progress

One line per finished stage, so a restart knows where to pick up.

- [x] a. Reference capture and moves notes (local, git-ignored); main reference fully noted, backups briefly
- [x] b. Direction chosen by style tile ("Counter ticket"); `.design/DESIGN.md` written
- [x] c. Tokens, fonts, logo mark and art kit (`src/styles/tokens.css`, `base.css`, `art.css`, `src/components/art/*`)
- [x] d. Header, contents sheet, footer, page turn (`src/components/site/*`, `src/styles/chrome.css`)
- [x] e. Home page (`src/app/page.tsx`, `src/components/home/*`, `src/styles/home.css`)
- [x] f. Receipt `/h/[holdPda]` (ticket, clock, evidence list, verify the hash)
- [x] g. Dashboard `/app` (`src/components/app/*`)
- [x] h. Scam Dojo `/dojo` (playable against `/api/dojo`) and spectator `/dojo/watch/[runId]`
- [x] h2. `/pay` slip
- [x] i. Inner pages (how it works, evidence, results, integrations, docs) and 404 / error pages written; visual check pending
- [x] Build gate after stage i: `tsc --noEmit`, `vitest run` (98 tests), `next build`, `opennextjs-cloudflare build` all pass
- [x] j. Verify: Lighthouse mobile (home 98 / 100 / 100 / 100, CLS 0), keyboard pass, 360 and 1920 overflow check, reduced motion, no-script, four languages; one critic round and its top fixes applied. A second critic round was not run.
