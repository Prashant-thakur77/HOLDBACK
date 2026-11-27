# Scam Dojo

A turn-based game about one question: _should I pay this?_ Each run is eight payment requests.
Some are honest (rent, a bill, a friend splitting dinner) and some are scams (a "digital arrest"
call, a poisoned address, a supplier whose payment details "changed"). The player investigates,
decides, and learns the tells after every round.

The package is `@holdback/dojo`. It has no runtime dependencies. Its parts:

| Layer   | File                             | What it is                                                    |
| ------- | -------------------------------- | ------------------------------------------------------------- |
| Engine  | `src/engine.ts`                  | Pure and deterministic: state in, move in, state out          |
| Corpus  | `src/scenarios/*.ts`             | 65 scenarios with ground truth, tells and clue ladders        |
| HTTP    | `src/http.ts`, `src/stores.ts`   | A Fetch API handler plus memory and Supabase run stores       |
| Scripts | `scripts/*.ts`                   | Local server, simulations, report collector, Byte doc checker |
| Byte    | [`BYTE_GAME.md`](./BYTE_GAME.md) | The game document an agent on Byte Arena plays from           |

The web app serves the handler at `/api/dojo` and a spectator page at `/dojo/watch/[runId]`. The
mobile app plays the same engine offline.

## Rules

A run has 8 rounds, 3 lives and a practice wallet of 10,000 USDC. Every run deals 3 or 4 honest
requests (4 in one run out of five), so 40% of requests are honest on average.

Each round starts worth 150 points. Investigating lowers what the round is worth:

| Move              | Reveals                                            | Cost                          |
| ----------------- | -------------------------------------------------- | ----------------------------- |
| `ask_question`    | The next clue (2 or 3 per scenario)                | 10                            |
| `verify_identity` | What the official channel says (once per round)    | 20                            |
| `check_address`   | The HOLDBACK risk agent's verdict on the recipient | 10, or 0 if it is unavailable |

Then one decision ends the round. "Available" is what the round is still worth:

| Decision            | If it was a scam                               | If it was honest      |
| ------------------- | ---------------------------------------------- | --------------------- |
| `refuse`            | available                                      | 0 points, lose a life |
| `report`            | available + 25                                 | 0 points, lose a life |
| `pay_with_holdback` | half of available; the undo recovers the money | 80% of available      |
| `pay`               | 0 points, lose the money and a life            | available             |

The run is **lost** when the lives reach 0. After round 8 it is **won** with 900 points or more
and lost below that. The score never goes down. All of these numbers live in `src/rules.ts`; the
engine, the tests and the checker for `BYTE_GAME.md` read them from there.

## State

Every response carries the whole state. Field names are whole words because a language model
reads them raw.

```
run_id, player, status (playing|won|lost), done, turn, round, max_rounds, rounds_survived,
lives, score, win_score, wallet, money_at_risk, money_lost, money_recovered,
scenario { channel, from, transcript[], ask { amount, currency, to, purpose } } | null,
revealed_clues[] { source, text }, points_available, legal_moves[],
last_round { round, scenario_id, category, was_scam, decision, outcome, correct, points,
             amount, tells[], lesson } | null,
history[] { turn, round, move, outcome, points },
result { outcome, reason, score, rounds_survived, correct_decisions, money_lost,
         money_recovered, history_sha256, memo, memo_status, memo_signature } | null,
error (string or null; why this call changed nothing)
```

The answer to the round being played is never in the state. `last_round` reveals it once the
player has decided.

## HTTP API

Mounted at `<site>/api/dojo`. All bodies are JSON; CORS is open because the spectator page may
live on another origin.

| Call                        | Auth         | Does                                                                                    |
| --------------------------- | ------------ | --------------------------------------------------------------------------------------- |
| `POST /runs`                | none         | Starts a run. Body `{"player": "name"}` (optional). Returns the state plus `play_token` |
| `GET /runs/{run_id}`        | none         | Returns the state. No side effects                                                      |
| `POST /runs/{run_id}/moves` | Bearer token | Body `{"move": "...", "turn": n}`. Returns the state                                    |
| `GET /runs/{run_id}/watch`  | none         | The state plus `rounds[]`, the truth about every decided round                          |
| `POST /runs/{run_id}/memo`  | Bearer token | Retries the end-of-run memo if it was not written                                       |
| `GET /`                     | none         | Name, moves, rules and endpoint list                                                    |

`turn` is the `turn` value of the state the move was decided on. A move with any other turn is
not applied, and the `error` says which turn to send. That makes a retry after a timeout safe.
`turn` may be a number or a numeric string; a move sent without one is applied to the current
turn, without that protection.

Rule violations (illegal move, wrong turn, finished run) answer `200` with `error` set and the
unchanged state, so an agent can read the reason and recover. `401` means a missing or wrong
token, `400` an unreadable body, `404` an unknown run, `503` a store failure. The first two
still include the state.

The seed that deals a run and its play token are both derived from a server secret with
HMAC-SHA-256 over the run id. Neither is stored, which matters because the `dojo_runs` table is
publicly readable.

### End-of-run memo

When a run ends the handler calls `writeMemo({ runId, score, historyHash })` once and shows the
returned signature in `result.memo_signature`. The memo text is
`holdback-dojo:<run_id>:<score>:<sha256(history)>`. The hash is over one line per move,
`turn|round|move|outcome|points`, joined by `\n` (`canonicalHistory` in `src/engine.ts`), so
anyone can rebuild it from the public state and compare it with the chain. If the write fails or
takes longer than 7 s, the result is returned with `memo_status: "unavailable"` and can be
retried through `POST /runs/{run_id}/memo`.

### `check_address` and the real agent

`check_address` calls the injected `assess` function with the scenario's recipient address, the
amount in USDC base units and the transcript as `context`, which is the shape of the agent's
`POST /v1/assess`. The verdict (tier, score, undo window, spoken summary) becomes a clue. If the
agent does not answer within 7 s, fails, or returns something else, the clue reads "Verdict
unavailable", costs nothing, and the run continues.

The recipient addresses are throwaway keys with no on-chain history, so the agent's verdict on
them comes mostly from the wording of the request. `scamAddressFixtures()` lists the scam
addresses in case the agent's seed data should mark them as training fixtures.

## Game spec compliance

The rules for games on Byte Arena are published at `https://app.bytearena.fun/api/game-spec`.
This is what was implemented against it, in our words:

- [x] **Played over public HTTPS.** The handler has no host of its own; the web app serves it.
- [x] **Every response is the complete state as JSON**, including rejections.
- [x] **Moves are a closed list.** Seven actions, one per move, declared in `BYTE_GAME.md`.
- [x] **One call starts a run** and returns everything else needs (`run_id`, `play_token`).
- [x] **The end is visible:** `status` becomes `won` or `lost`; `finish` and `result.win` read it,
      `result.score` reads `score`. Both stay in the final answer.
- [x] **The end is sticky.** A finished run keeps answering with its final state; nothing is deleted.
- [x] **State reads have no side effects.**
- [x] **A repeated action is safe and legibly rejected,** keyed by `turn`.
- [x] **A progress counter** (`turn`) goes up on every accepted move.
- [x] **Idle runs wait.** Nothing is timed; the prose says so.
- [x] **At most 400 calls per run.** The longest possible run is 48 moves; with a state read after
      each move and the start call that is 97 calls (asserted in the tests).
- [x] **Under 12 s per call.** The only slow dependencies are time-boxed at 7 s each and never
      both run in one call.
- [x] **Responses under 64 KB.** The largest seen in the tests is about 8.5 KB (asserted on every
      response of every HTTP test).
- [x] **Errors in words**, in a field named `error`.
- [x] **No credential in the state.** The token appears once, in the start response, in a field
      named `play_token`.
- [x] **Prose within the prompt budget.** 2,165 characters; the spec asks for about 2,000 and
      truncates at 4,000 (`npm run byte:doc` prints the count and fails above 2,200).
- [x] **Bets are pure functions of the state:** one `win` and two `reach` events on `score` and
      `rounds_survived`. Both fields only ever go up.
- [x] **Commit moves are marked `decision`** so narration finishes before they fire. The game is
      turn-based, so waiting costs nothing.
- [ ] **Spectator page (`watchUrl`).** Served by the web app, not by this package. It has to be
      `https`, arrive as `text/html`, need no login or clicks, resolve as a deep link, and poll
      `GET /api/dojo/runs/{id}/watch` without pausing when the tab is hidden. It must send this as
      a real response header, not a meta tag:
      `Content-Security-Policy: frame-ancestors https://app.bytearena.fun`.
      Check it with `curl -sS -D- -o /dev/null <url>` (a GET, not `curl -I`).

Two things in the document could not be checked without an account on the platform and are worth
a look in its preview before saving: the `turn` parameter is declared as type `string` (the only
type the spec shows for action parameters; the server accepts numbers too), and `bets` sits
inside `api` next to `result`. If the preview does not list the three bets, move the `bets` array
up one level, next to `name`.

## Scenario corpus

65 scenarios: 39 scams in 25 categories and 26 honest requests in 17 (40.0% honest). By channel:
19 email, 17 WhatsApp, 16 direct message, 8 SMS, 5 call transcripts. By setting: 17 India,
13 Latin America, 35 global. Several include a short Hindi, Spanish or Portuguese line with its
English meaning.

Every scenario is written from scratch with invented people and details. Its `basis` field names
the publicly known pattern it stands for. 24 scenarios also list `sources`: consumer-protection
advisories that describe the pattern and were opened and read while the corpus was written. The
nine pages are in `src/scenarios/sources.ts`. Scenarios without `sources` rest on the pattern
being common knowledge, not on a citation.

Recipient addresses are valid 32-byte base58 values. All but two are public keys of freshly
generated key pairs whose private halves were thrown away (`npm run new-addresses`). The two
address-poisoning scenarios use constructed look-alikes that share the first and last four
characters with the "real" contact address in their clues. None is a real person's wallet.

Honest scenarios are deliberately not all calm (a landlord chasing late rent, a real customs
charge, a contractor who really did change wallets), and several scams look routine. The tests
check that no clue ever points the wrong way and that asking every question always settles a
round.

### Collecting public reports

`scripts/collect-reports.ts` uses Firecrawl's v2 API to search the web for each pattern (search
with scraping) and to scrape the cited advisory pages, then writes one JSON line per page to
`data/reports.jsonl`: URL, title, published date when the page states one, collection time,
category and a short excerpt.

```bash
cp dojo/.env.example dojo/.env        # then set FIRECRAWL_API_KEY
npm run collect --workspace dojo      # about 19 searches of 5 results and 9 scrapes
```

**The collector has not been run:** no Firecrawl key was available when this package was built,
so `data/reports.jsonl` does not exist yet and no scenario was derived from collected reports.
Its request and response handling is tested against the documented response shapes only.

## Simulations and bets

`npm run simulate --workspace dojo` plays scripted players over seeded runs. Output for 2,000
runs each:

| player                   | mean | p10  | median | p90  | max  | won % | survived 8 % | ≥600 % | ≥800 % | ≥900 % | ≥1000 % | ≥1100 % | moves |
| ------------------------ | ---- | ---- | ------ | ---- | ---- | ----- | ------------ | ------ | ------ | ------ | ------- | ------- | ----- |
| always pay               | 260  | 0    | 300    | 450  | 600  | 0     | 0            | 4.5    | 0      | 0      | 0       | 0       | 4.7   |
| always refuse            | 515  | 150  | 600    | 750  | 750  | 0     | 0            | 54.7   | 0      | 0      | 0       | 0       | 6.4   |
| always report            | 601  | 175  | 700    | 875  | 875  | 0     | 0            | 54.7   | 30.7   | 0      | 0       | 0       | 6.4   |
| always pay_with_holdback | 744  | 735  | 735    | 780  | 780  | 0     | 100          | 100    | 0      | 0      | 0       | 0       | 8     |
| coin flip pay/refuse     | 407  | 0    | 300    | 900  | 1200 | 13.1  | 13.1         | 33.2   | 13.1   | 13.1   | 3.3     | 0.1     | 5.6   |
| one question             | 1028 | 952  | 1050   | 1120 | 1120 | 97.1  | 100          | 100    | 100    | 97.1   | 64.5    | 18.9    | 16    |
| exhaustive               | 943  | 925  | 945    | 955  | 985  | 100   | 100          | 100    | 100    | 100    | 0       | 0       | 37.7  |
| informed, 70% accurate   | 720  | 285  | 855    | 1035 | 1165 | 27.5  | 54.8         | 64.6   | 54.8   | 27.5   | 22.9    | 6.2     | 14.2  |
| informed, 80% accurate   | 886  | 570  | 905    | 1165 | 1165 | 51.4  | 79.6         | 85.2   | 79.6   | 51.4   | 45.2    | 15.8    | 15.3  |
| informed, 90% accurate   | 1034 | 855  | 1035   | 1165 | 1165 | 81.3  | 96.1         | 97.2   | 96.1   | 81.3   | 76.8    | 42.1    | 15.9  |
| informed                 | 1160 | 1140 | 1165   | 1165 | 1165 | 100   | 100          | 100    | 100    | 100    | 100     | 100     | 16    |

What the table shows:

- No blind strategy ever wins. Always paying or refusing runs out of lives; always using the undo
  window survives every run but tops out at 780, under the win score.
- "Informed" checks the official channel, asks questions while the evidence is unclear and hedges
  with `pay_with_holdback` if it stays unclear. It beats always-refuse on every seed tested.
- A lucky guesser can still win about one run in eight.

The scripted players are models, not measurements of a language-model agent: "informed" reads
the hidden signal of each revealed clue, and the "N% accurate" players then misjudge that share
of rounds on purpose. They never use `check_address`, because its value depends on the live
agent.

The bets in `BYTE_GAME.md` come from this table:

- `wins`: the win score of 900 sits above every blind strategy's best run (875) and below what a
  careful player reaches. The modelled win rate moves from 27.5% to 81.3% between 70% and 90%
  accuracy, so the outcome is uncertain enough to bet on.
- `score` at 600, 800, 900, 1000, 1100: from "more likely than not for a blind player" (600) to
  "needs fast, accurate play" (1100, which the exhaustive player never reaches).
- `survives` (`rounds_survived`) at 4, 6, 8: the 70%-accurate player survives all eight rounds in
  54.8% of runs and the 90%-accurate one in 96.1%.

## Run it locally

From the repository root:

```bash
npm install
npm run typecheck --workspace dojo
npm test --workspace dojo
npm run build --workspace dojo        # writes dojo/dist, which the web and mobile apps import

npm run dev --workspace dojo          # API on http://localhost:8787/api/dojo, runs kept in memory
curl -s -X POST localhost:8787/api/dojo/runs -H 'content-type: application/json' -d '{"player":"me"}'
curl -s -X POST localhost:8787/api/dojo/runs/<run_id>/moves \
  -H 'authorization: Bearer <play_token>' -H 'content-type: application/json' \
  -d '{"move":"verify_identity","turn":0}'
```

`npm run dev` reads `dojo/.env` if it exists (see `.env.example`). With `AGENT_URL` set,
`check_address` asks that agent; with `DOJO_SECRET` set too, the memo is requested from the
agent's `POST /v1/dojo/memo`. Without them both show as unavailable and the game still plays.

## Use it from the web app

```ts
// apps/web: app/api/dojo/[[...path]]/route.ts (a sketch; the client, the agent call and env are the app's own)
import { createDojoHandler, supabaseStore } from '@holdback/dojo';

const handler = (request: Request) =>
  createDojoHandler({
    store: supabaseStore(serviceRoleClient()), // or memoryStore() on one long-lived process
    assess: (assessRequest) => guardian.assess(assessRequest),
    writeMemo: async (memo) => (await postToAgent('/v1/dojo/memo', memo)).signature,
    baseUrl: `${siteOrigin}/api/dojo`,
    secret: env.DOJO_SECRET, // at least 16 characters
  })(request);

export { handler as GET, handler as POST, handler as OPTIONS };
```

`supabaseStore` takes a `@supabase/supabase-js` client created with the service role key and
writes to `dojo_runs`: the public state as `state`, plus `score`, `done`, `result` and
`memo_signature`. Updates are compare-and-set on the stored turn, so two concurrent moves cannot
both land. On Cloudflare the client and the secret exist per request, so build the handler inside
the route as above.

Offline (the mobile Dojo tab) needs no handler:

```ts
import { applyMove, startRun } from '@holdback/dojo';

let state = startRun({ runId, seed }); // seed: any random string kept on the device
({ state } = applyMove(state, seed, 'ask_question', state.turn));
```

## Upload to Byte Arena

1. Deploy the web app and note its public origin, for example `https://your.site`. Check that
   `POST https://your.site/api/dojo/runs` answers with a state and that
   `https://your.site/dojo/watch/<run_id>` passes the GET check above.
2. Produce the document with that origin filled in (it replaces `https://holdback.example` in
   `baseUrl` and `watchUrl`, and refuses anything that is not a public https origin):

   ```bash
   npm run --silent byte:doc --workspace dojo -- https://your.site > game.md
   ```

3. Open `https://app.bytearena.fun/games/new` (or _upload a game_ on `/games`), paste the whole
   contents of `game.md`, and read the preview. It should show host `your.site`, the seven
   actions and the three bets, and report that the watch page accepts the iframe.
4. Save, then press play to run it once with your own account. A game stays private until
   reviewed.
5. Request review in the editor to publish it. Bets only switch on once the game is published.

The same can be done with an upload token from the _for devs_ section of `/games`:

```bash
BODY=$(jq -Rn --rawfile t game.md '{text:$t, name:"HOLDBACK Scam Dojo"}')
curl -sS https://app.bytearena.fun/api/my-games/preview \
  -H "Authorization: Bearer $BYTE_GAME_TOKEN" -H 'content-type: application/json' -d "$BODY"
curl -sS https://app.bytearena.fun/api/my-games \
  -H "Authorization: Bearer $BYTE_GAME_TOKEN" -H 'content-type: application/json' -d "$BODY"
```

## Known limits

- The corpus is public, so someone who reads this repository can look up a recipient address and
  know the answer. The seed is secret, but the scenario on screen is not. Declared bets on Byte
  run on points only.
- Starting a run is unauthenticated and writes a row. Put a rate limit in front of
  `POST /api/dojo/runs` in production (a Cloudflare rate limiting rule is enough).
- No run has been played by a Byte agent yet, and the document has not been through the
  platform's preview.
