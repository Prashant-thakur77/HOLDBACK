import { DECISION_RULES, RULES, SCENARIOS, type Decision } from '@holdback/dojo';
import type { Metadata } from 'next';

import { DojoGame } from '@/components/dojo/DojoGame';
import { DECISION_LABELS, INVESTIGATION_LABELS } from '@/components/dojo/labels';
import { PageOpener, SectionHead } from '@/components/site/blocks';

export const metadata: Metadata = {
  title: 'Scam Dojo',
  description:
    'Eight payment requests, some honest and some scams. Investigate, decide, and learn the tells.',
};

const ORDER: Decision[] = ['refuse', 'report', 'pay_with_holdback', 'pay'];

function effect(truth: 'scam' | 'legitimate', decision: Decision): string {
  const rule = DECISION_RULES[truth][decision];
  const points =
    rule.pointsPercent === 0
      ? '0 points'
      : rule.pointsPercent === 100
        ? `what the round is worth${rule.bonus ? ` + ${rule.bonus}` : ''}`
        : `${rule.pointsPercent}% of what the round is worth`;
  const money =
    rule.money === 'lost'
      ? ', the money is gone'
      : rule.money === 'recovered'
        ? ', the undo gets the money back'
        : '';
  return `${points}${rule.costsLife ? ', lose a life' : ''}${money}`;
}

export default function DojoPage() {
  return (
    <main>
      <PageOpener
        word="Scam Dojo"
        ink="red"
        page={6}
        motif="slips"
        lead="A game about one question: should I pay this? Eight requests. Some are honest, some are scams. Look closer, decide, and learn the tells after every round."
      />

      <section className="section--tight wrap" aria-label="Play">
        <DojoGame costs={RULES.investigationCost} roundPoints={RULES.roundPoints} />
      </section>

      <section className="section wrap" aria-labelledby="rules">
        <SectionHead id="rules" title="The rules" ink="red" />
        <div className="two-col">
          <div className="prose">
            <p>
              A run has {RULES.maxRounds} rounds, {RULES.startingLives} lives and a practice wallet
              of {RULES.startingWallet.toLocaleString('en-US')} USDC. Every run deals{' '}
              {RULES.legitimatePerRun.usual} or {RULES.legitimatePerRun.sometimes} honest requests,
              so refusing everything loses.
            </p>
            <p>
              The run is lost when the lives reach 0. After round {RULES.maxRounds} it is won with{' '}
              {RULES.winScore} points or more. The requests are drawn from {SCENARIOS.length}{' '}
              written scenarios.
            </p>
            <p>
              <strong>Check the address</strong> asks the real HOLDBACK risk agent about the
              recipient. If the agent does not answer, the clue reads "Verdict unavailable", costs
              nothing, and the run goes on.
            </p>
            <p>
              When a run ends, its score and a hash of every move are written to Solana devnet as a
              memo, so a result can be checked against the chain.
            </p>
          </div>
          <div>
            <div className="table-scroll">
              <table className="table">
                <caption className="visually-hidden">Ways to look closer</caption>
                <thead>
                  <tr>
                    <th scope="col">Look closer</th>
                    <th scope="col">Reveals</th>
                    <th scope="col">Costs</th>
                  </tr>
                </thead>
                <tbody>
                  {(['ask_question', 'verify_identity', 'check_address'] as const).map((move) => (
                    <tr key={move}>
                      <td>{INVESTIGATION_LABELS[move].label}</td>
                      <td>{INVESTIGATION_LABELS[move].hint}</td>
                      <td>{RULES.investigationCost[move]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="table-scroll rules-table">
          <table className="table">
            <caption className="visually-hidden">What each decision does</caption>
            <thead>
              <tr>
                <th scope="col">Decision</th>
                <th scope="col">If it was a scam</th>
                <th scope="col">If it was honest</th>
              </tr>
            </thead>
            <tbody>
              {ORDER.map((decision) => (
                <tr key={decision}>
                  <td>{DECISION_LABELS[decision]}</td>
                  <td>{effect('scam', decision)}</td>
                  <td>{effect('legitimate', decision)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="prose rules-note">
          Paying with a hold is the hedge. It never costs a life: a scam paid this way earns half,
          because the undo window got the money back but you still fell for it, and an honest payee
          who has to wait out the window earns most of the round.
        </p>
      </section>
    </main>
  );
}
