# HOLDBACK Scam Dojo

Eight payment requests arrive, one per round: a message or call transcript and an ask to send USDC to an address. About 40% are honest (rent, bills, friends); the rest are scams. You win by finishing all 8 rounds with a life left and at least 900 points.

## Rules

- Every move needs `turn`: copy `turn` from the latest state. A wrong turn changes nothing.
- Investigating lowers this round's `points_available` (starts at 150): `ask_question` -10 (next clue), `verify_identity` -20 (what the official channel says, usually the strongest evidence), `check_address` -10 (the live HOLDBACK risk agent's verdict on the address; free if unavailable).
- Then decide. Scam: `refuse` earns `points_available`, `report` earns that +25, `pay_with_holdback` earns half (the undo window recovers the money), `pay` earns 0 and costs the money and a life. Honest: `pay` earns `points_available`, `pay_with_holdback` 80%, `refuse` or `report` earn 0 and cost a life.
- 3 lives; at 0 the run is lost. The score never goes down.
- Nothing is timed: an idle run waits, a finished run keeps returning its final state.

## Strategy

Blind play loses: always paying or refusing runs out of lives, always using holdback ends below 900. One or two checks per round is usually enough. Honest requests can be urgent and scams can look routine, so judge by evidence: who contacted whom, whether payment details changed, whether the official channel confirms it, whether you are told to hurry, keep it secret, or pay to receive money. Compare addresses character by character. Use `pay_with_holdback` when evidence stays mixed and `report` when you are sure.

## State

`scenario` is the request, `revealed_clues` what you learned this round, `legal_moves` what you may send now, `last_round` the truth about the round you just decided, `error` why a move was rejected. If this text and the state disagree, believe the state.

## Narrate

Say what smells wrong or right, what each clue changes, and commit out loud before deciding. Tense moments: the last life, an urgent request that turns out honest, a routine one with a poisoned address, the final rounds near 900.

```json
{
  "name": "HOLDBACK Scam Dojo",
  "api": {
    "baseUrl": "https://holdback.prashantthakur.dev",
    "start": {
      "method": "POST",
      "path": "/api/dojo/runs",
      "body": { "player": "{{callsign}}" },
      "save": { "dojoRun": "run_id", "playToken": "play_token" }
    },
    "auth": { "header": "Authorization", "value": "Bearer {{playToken}}" },
    "state": { "method": "GET", "path": "/api/dojo/runs/{{dojoRun}}" },
    "actions": [
      {
        "name": "ask_question",
        "description": "Ask the requester a question and reveal the next clue. Costs 10 of this round's points.",
        "method": "POST",
        "path": "/api/dojo/runs/{{dojoRun}}/moves",
        "body": { "move": "ask_question", "turn": "{{turn}}" },
        "params": { "turn": { "type": "string", "required": true } }
      },
      {
        "name": "verify_identity",
        "description": "Check with the official channel (call back, app, register). Costs 20. Once per round.",
        "method": "POST",
        "path": "/api/dojo/runs/{{dojoRun}}/moves",
        "body": { "move": "verify_identity", "turn": "{{turn}}" },
        "params": { "turn": { "type": "string", "required": true } }
      },
      {
        "name": "check_address",
        "description": "Ask the HOLDBACK risk agent about the recipient address. Costs 10, free if unavailable. Once per round.",
        "method": "POST",
        "path": "/api/dojo/runs/{{dojoRun}}/moves",
        "body": { "move": "check_address", "turn": "{{turn}}" },
        "params": { "turn": { "type": "string", "required": true } }
      },
      {
        "name": "pay",
        "description": "Pay the request in full. Right if it is honest; a scam takes the money and a life.",
        "method": "POST",
        "path": "/api/dojo/runs/{{dojoRun}}/moves",
        "body": { "move": "pay", "turn": "{{turn}}" },
        "params": { "turn": { "type": "string", "required": true } },
        "decision": true
      },
      {
        "name": "pay_with_holdback",
        "description": "Pay with an undo window. A scam is recovered for half points; an honest payee waits, 80% points.",
        "method": "POST",
        "path": "/api/dojo/runs/{{dojoRun}}/moves",
        "body": { "move": "pay_with_holdback", "turn": "{{turn}}" },
        "params": { "turn": { "type": "string", "required": true } },
        "decision": true
      },
      {
        "name": "refuse",
        "description": "Do not pay. Right if it is a scam; refusing an honest request costs a life.",
        "method": "POST",
        "path": "/api/dojo/runs/{{dojoRun}}/moves",
        "body": { "move": "refuse", "turn": "{{turn}}" },
        "params": { "turn": { "type": "string", "required": true } },
        "decision": true
      },
      {
        "name": "report",
        "description": "Refuse and report it as a scam for +25. Reporting an honest request costs a life.",
        "method": "POST",
        "path": "/api/dojo/runs/{{dojoRun}}/moves",
        "body": { "move": "report", "turn": "{{turn}}" },
        "params": { "turn": { "type": "string", "required": true } },
        "decision": true
      }
    ],
    "finish": { "path": "status", "equals": ["won", "lost"] },
    "result": {
      "win": { "path": "status", "equals": ["won"] },
      "score": { "path": "score", "label": "pts" }
    },
    "watchUrl": "https://holdback.prashantthakur.dev/dojo/watch/{{dojoRun}}",
    "bets": [
      { "id": "wins", "type": "win" },
      {
        "id": "score",
        "type": "reach",
        "path": "score",
        "label": "score",
        "at": [600, 800, 900, 1000, 1100]
      },
      {
        "id": "survives",
        "type": "reach",
        "path": "rounds_survived",
        "label": "rounds survived",
        "at": [4, 6, 8]
      }
    ]
  }
}
```
