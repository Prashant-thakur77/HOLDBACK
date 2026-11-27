/** Scams that borrow the voice of the state: police, courts, tax offices, utilities. */
import type { Scenario } from '../types';
import { ADVISORY } from './sources';

export const AUTHORITY_SCAMS: Scenario[] = [
  {
    id: 'digital-arrest-parcel',
    truth: 'scam',
    category: 'authority_impersonation',
    basis:
      'Police impersonation with a "digital arrest": a parcel in your name, a video call you may not leave, and a transfer to a "safe account"',
    sources: [ADVISORY.governmentImpersonation],
    region: 'india',
    channel: 'call',
    from: 'Video call from an unknown number, caller in a police uniform',
    transcript: [
      'Caller: This is Inspector Rane, Crime Branch. A parcel booked with your ID was stopped at the airport with banned substances inside.',
      'Caller: Aap digital arrest mein hain. Call mat kaatiye. (You are under digital arrest. Do not end the call.)',
      'Caller: Do not speak to family or your bank. To prove your funds are clean, move them to the verification account now. They come back in two hours.',
    ],
    ask: {
      amount: 1200,
      to: 'ESJ2H1W1nTnmttzX41Nmrzod7fJbw9K3WAEvPij9nc2A',
      purpose: 'Fund verification during an investigation',
    },
    clues: [
      {
        text: 'You ask for the case number and the station. He gives a long number, says the station is "headquarters" and warns that questions will add charges.',
        signal: 'unclear',
      },
      {
        text: 'You say you will come to the station in person. He says leaving the camera is an offence and the transfer must happen within ten minutes.',
        signal: 'scam',
      },
      {
        text: 'You ask why money is needed at all. He says it is a refundable deposit held by the reserve bank and sends a letter with a blurred seal.',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'You call the police station on its listed number from another phone. The desk officer says no one is arrested by video call and no officer asks for money.',
      signal: 'scam',
    },
    tells: [
      'Arrest by video call does not exist',
      'You are told to stay on the line and tell nobody',
      'Money is moved to a "safe" or "verification" account',
      'A ten-minute deadline',
    ],
    lesson:
      'No police force arrests by video call or clears your name with a transfer. Hang up and call the station yourself.',
  },
  {
    id: 'tax-office-freeze',
    truth: 'scam',
    category: 'authority_impersonation',
    basis: 'Tax office impersonation: a debt you never heard of and an account freeze today',
    sources: [ADVISORY.governmentImpersonation],
    region: 'latam',
    channel: 'whatsapp',
    from: 'WhatsApp business account "Oficina Tributaria - Cobranza"',
    transcript: [
      'Aviso final: usted registra una deuda fiscal del año pasado.',
      'Su cuenta bancaria será bloqueada hoy a las 18:00. (Your bank account will be frozen today at 18:00.)',
      'Pague ahora en USDC a la dirección indicada para detener el proceso. Un agente le enviará el recibo.',
    ],
    ask: {
      amount: 310,
      to: '7NrqZkBq1aFXSwD6heUaJtP5ejXPrsoxwpaiSzxKw3VK',
      purpose: 'Settle a tax debt before an account freeze',
    },
    clues: [
      {
        text: 'You ask which tax return the debt comes from. The agent answers "the system shows it" and repeats the 18:00 deadline.',
        signal: 'unclear',
      },
      {
        text: 'You ask to pay through the tax portal instead. The agent says the portal is down for you and only this address stops the freeze.',
        signal: 'scam',
      },
      {
        text: 'The account was created nine days ago and its profile photo is a cropped copy of the tax office logo.',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'You log in to the official tax portal. It shows no debt, no notice and nothing pending under your tax ID.',
      signal: 'scam',
    },
    tells: [
      'A tax office that collects through a chat app',
      'Payment to a personal crypto address',
      'The official portal is "down" only for you',
      'A same-day freeze threat',
    ],
    lesson:
      'Tax debts appear in the official portal. If the portal shows nothing, there is nothing to pay.',
  },
  {
    id: 'traffic-fine-discount',
    truth: 'scam',
    category: 'authority_impersonation',
    basis: 'Fake traffic fine with a discount that expires today',
    region: 'latam',
    channel: 'sms',
    from: 'SMS from short code 28190',
    transcript: [
      'Departamento de Trânsito: multa registrada no seu veículo.',
      'Multa com 40% de desconto somente hoje. (Fine with a 40% discount today only.)',
      'Depois de hoje o valor dobra e a habilitação é suspensa. Pague pelo endereço abaixo.',
    ],
    ask: {
      amount: 95,
      to: '39qLmxtFhiDKxMUfx4iK7M6WU1ewsCAZDCQD5oPAjVvu',
      purpose: 'Discounted traffic fine',
    },
    clues: [
      {
        text: 'The message does not name a plate number, a date or a place for the offence.',
        signal: 'scam',
      },
      {
        text: 'You reply asking for the infraction number. An automatic answer repeats the discount and the address.',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'You check your plate in the traffic department app. There are no fines on the vehicle.',
      signal: 'scam',
    },
    tells: [
      'No plate, date or place in the notice',
      'A discount that ends today',
      'A government fine paid to a wallet address',
    ],
    lesson: 'A real fine names the vehicle and the offence and shows up in the official app.',
  },
  {
    id: 'court-summons-bond',
    truth: 'scam',
    category: 'authority_impersonation',
    basis: 'Fake court summons: a missed hearing and a bond payable in crypto to avoid a warrant',
    sources: [ADVISORY.governmentImpersonation],
    region: 'global',
    channel: 'email',
    from: 'Email from "Clerk of Court" <clerk@district-court-notices.example>',
    transcript: [
      'Subject: FAILURE TO APPEAR - warrant pending',
      'You did not appear for jury service on the assigned date. A bench warrant will be issued at close of business today.',
      'You may post a refundable bond in USDC to cancel the warrant. Do not contact the courthouse while the matter is sealed.',
    ],
    ask: {
      amount: 450,
      to: 'Az7j4h8szYmedqcghkQ4FtaaBHgkumdrZR1ghGxZxcWt',
      purpose: 'Refundable bond to cancel a warrant',
    },
    clues: [
      {
        text: 'You never received a jury notice by post, and the email gives no case number.',
        signal: 'unclear',
      },
      {
        text: 'The reply address is a free webmail account that differs from the sender name.',
        signal: 'scam',
      },
      {
        text: 'You ask whether you can pay at the courthouse counter. The reply says counter payments take 30 days and the warrant will already be active.',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'You phone the court clerk using the number on the court website. They have no record of you and say courts never take bonds in cryptocurrency.',
      signal: 'scam',
    },
    tells: [
      'A court that asks for cryptocurrency',
      'You are told not to contact the courthouse',
      'The reply address does not match the sender',
      'A warrant "by close of business"',
    ],
    lesson:
      'Courts send paper, give case numbers and never ask you to keep away from the courthouse.',
  },
  {
    id: 'electricity-cut-tonight',
    truth: 'scam',
    category: 'utility_threat',
    basis: 'Fake electricity disconnection notice with a personal number to call or pay',
    region: 'india',
    channel: 'sms',
    from: 'SMS from a ten-digit mobile number',
    transcript: [
      'Dear consumer, your electricity power will be disconnected tonight 9:30 PM because previous month bill was not update.',
      'Aaj raat bijli kat jayegi. (The power will be cut tonight.)',
      'Immediately pay update charge to our electricity officer on the address below and send screenshot.',
    ],
    ask: {
      amount: 38,
      to: 'FippMrN2WMsNDHawyQXEygHvF94snTz5e3Dr45KiGwTo',
      purpose: 'Bill update charge to stop disconnection',
    },
    clues: [
      {
        text: 'The message has no consumer number, and you paid last month by auto-debit.',
        signal: 'scam',
      },
      {
        text: 'You call the number. A man says the system did not record your payment and you must pay the "officer" directly within the hour.',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'The power company app shows your last bill as paid and no dues. Its notices page warns about messages from mobile numbers.',
      signal: 'scam',
    },
    tells: [
      'Sent from a personal mobile number',
      'No consumer number',
      'Payment to an "officer" instead of the company',
      'A cut-off time tonight',
    ],
    lesson:
      "Utilities bill through their own app or counter, never through an officer's personal wallet.",
  },
];
