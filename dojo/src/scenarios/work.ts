/** Scams built on the promise of work or credit. */
import type { Scenario } from '../types';
import { ADVISORY } from './sources';

export const WORK_SCAMS: Scenario[] = [
  {
    id: 'task-job-prepaid-order',
    truth: 'scam',
    category: 'job_fee',
    basis:
      'Task scam: small paid tasks, then a "prepaid task" that needs your own money to unlock earnings',
    sources: [ADVISORY.jobs],
    region: 'india',
    channel: 'whatsapp',
    from: 'WhatsApp from "HR Priya - Part Time Work"',
    transcript: [
      'Priya: Well done! You completed 12 rating tasks and earned 900. Your earnings are in the work wallet.',
      'Priya: Next is the merchant order task with 30% commission. You top up first, complete the order and withdraw everything together.',
      "Priya: Aaj ka batch 20 minute mein band hoga. (Today's batch closes in 20 minutes.)",
    ],
    ask: {
      amount: 180,
      to: 'GxS4m6uQzupEfiBQ42Xsq3agetMoQZFUAtj4DAtysacy',
      purpose: 'Top-up for a prepaid task',
    },
    clues: [
      {
        text: 'The first two payouts of a few rupees were real. Since then every withdrawal has needed "one more task".',
        signal: 'scam',
      },
      {
        text: 'The work wallet exists only on a website Priya sent. It is not a bank or a known payment app.',
        signal: 'scam',
      },
      {
        text: 'A group member says she topped up three times and was then told her account is "frozen for a mistake".',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'The company Priya claims to recruit for says on its careers page that it never hires through chat apps or asks workers to pay.',
      signal: 'scam',
    },
    tells: [
      'You pay in order to earn',
      'Earnings you cannot withdraw',
      'Small real payouts first',
      'A batch that closes in minutes',
    ],
    lesson: 'A job that asks for your money is not a job. Early small payouts are bait.',
  },
  {
    id: 'remote-job-equipment-kit',
    truth: 'scam',
    category: 'job_fee',
    basis:
      'Fake remote job offer: hired without an interview, then asked to buy an equipment kit that will be "reimbursed"',
    sources: [ADVISORY.jobs],
    region: 'global',
    channel: 'email',
    from: 'Email from "Talent Onboarding" at a company you applied to through a job board',
    transcript: [
      'Subject: Offer of employment - Remote Data Assistant',
      'We are pleased to offer you the position at 38 per hour. No interview is needed based on your profile.',
      'Before your start date you must order the pre-configured work kit from our approved vendor. The cost is reimbursed with your first pay.',
    ],
    ask: {
      amount: 220,
      to: 'DkfiesVcy1P9cE9Yju5WgBikniEbx1gnLD4h2EY16kta',
      purpose: 'Work equipment kit from an approved vendor',
    },
    clues: [
      {
        text: 'The pay is about double the usual rate for this kind of work.',
        signal: 'unclear',
      },
      {
        text: "The offer letter has no company address, and the sender's domain differs from the company site by one letter.",
        signal: 'scam',
      },
      {
        text: 'The "approved vendor" is a wallet address with no shop, invoice or return policy.',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'You write to the company through the contact form on its real site. HR answers that the role does not exist and they never ask staff to buy equipment.',
      signal: 'scam',
    },
    tells: [
      'Hired with no interview',
      'You pay before you start',
      'A look-alike domain',
      'Pay well above the market',
    ],
    lesson:
      'Employers provide equipment. An offer that costs you money before day one is not an offer.',
  },
  {
    id: 'instant-loan-insurance-fee',
    truth: 'scam',
    category: 'loan_fee',
    basis:
      'Advance-fee loan: instant approval without checks, with an insurance or processing fee first',
    region: 'india',
    channel: 'sms',
    from: 'SMS from sender "AX-LOANOK"',
    transcript: [
      'Your personal loan of 5,00,000 is APPROVED without documents. Interest 1% only.',
      'Loan bina kisi document ke approve ho gaya hai. (The loan is approved without any documents.)',
      'Pay the refundable insurance fee today to receive the amount in 30 minutes.',
    ],
    ask: {
      amount: 45,
      to: '4VpkLHverrsPDqnAH4HXxVV7sneMWaT7FX55v7Dyk6WT',
      purpose: 'Refundable loan insurance fee',
    },
    clues: [
      {
        text: 'You did not apply for a loan anywhere.',
        signal: 'scam',
      },
      {
        text: 'The agent on the phone will not name the lending company, only "our finance partner".',
        signal: 'scam',
      },
      {
        text: 'You ask to have the fee deducted from the loan. He says the "insurance file" must be opened from your side first.',
        signal: 'scam',
      },
    ],
    identity: {
      text: "The central bank's list of registered lenders has no entry matching the sender or the agent's company.",
      signal: 'scam',
    },
    tells: [
      'A loan you never applied for',
      'No documents, tiny interest',
      'A fee before the loan',
      'An unnamed lender',
    ],
    lesson: 'Real lenders take their fees out of the loan. A fee first means there is no loan.',
  },
  {
    id: 'overseas-job-visa-agent',
    truth: 'scam',
    category: 'job_fee',
    basis: 'Overseas job agent: a guaranteed position abroad once a visa processing fee is paid',
    sources: [ADVISORY.jobs],
    region: 'latam',
    channel: 'whatsapp',
    from: 'WhatsApp from "Agencia Trabajo Global"',
    transcript: [
      'Buenas tardes. Su perfil fue aprobado para trabajar en un hotel en Canadá, sueldo de 4.200 al mes.',
      'El puesto está garantizado. Solo falta el pago del trámite de visa. (The position is guaranteed. Only the visa processing payment is missing.)',
      'Quedan dos cupos. Envíe el pago hoy y mañana recibe el contrato.',
    ],
    ask: {
      amount: 500,
      to: '84qUaGcLYEfud8sHzVjz3jDmJoyz6cdmiX3VTV1MeGT6',
      purpose: 'Visa processing for a job abroad',
    },
    clues: [
      {
        text: 'You never spoke to anyone from the hotel, and the agency cannot name the hotel "until the contract".',
        signal: 'scam',
      },
      {
        text: "The agency's office address is a shopping centre with no such office.",
        signal: 'scam',
      },
      {
        text: "Visa fees for that country are paid to its government site by the applicant, not to an agent's wallet.",
        signal: 'scam',
      },
    ],
    identity: {
      text: "The labour ministry's register of licensed recruitment agencies does not list this agency.",
      signal: 'scam',
    },
    tells: [
      'A guaranteed job abroad',
      'Payment before any contract',
      'An unnamed employer',
      'Only two places left',
    ],
    lesson: 'Visa fees go to governments, and real recruiters are paid by the employer.',
  },
];
