/** Scams that pose as customer support, security teams or helpers. */
import type { Scenario } from '../types';
import { ADVISORY } from './sources';

export const SUPPORT_SCAMS: Scenario[] = [
  {
    id: 'exchange-support-dm',
    truth: 'scam',
    category: 'fake_support',
    basis:
      'Fake exchange support that replies to a public complaint and asks for a "sync" transfer',
    sources: [ADVISORY.cryptocurrency],
    region: 'global',
    channel: 'dm',
    from: 'DM from "CoinHarbor Support Desk" two minutes after your public post about a stuck withdrawal',
    transcript: [
      'Hello, we saw your post. Your withdrawal is stuck because your wallet is not synchronised with our hot wallet.',
      'Send a small sync transfer to the address below. The system returns it with your withdrawal in five minutes.',
      'Please do not open another ticket, it resets your place in the queue.',
    ],
    ask: {
      amount: 150,
      to: 'DjtHrPye8Fn5hwrDYHRX4f1FcTiJbMJWfFtUtATiVzDz',
      purpose: 'Wallet synchronisation transfer',
    },
    clues: [
      {
        text: 'The account has 41 followers and its handle ends in an extra underscore.',
        signal: 'scam',
      },
      {
        text: 'You ask for your ticket number. The agent asks you to tell them the number instead.',
        signal: 'scam',
      },
      {
        text: 'You say you will wait for the ticket. The agent says the withdrawal will be cancelled in 15 minutes without the sync.',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'In the exchange app, your real ticket says "processing, no action needed". The help centre states that support never starts a conversation by DM.',
      signal: 'scam',
    },
    tells: [
      'Support contacted you first, by DM',
      'A transfer to "sync" or "verify" a wallet',
      'You are told not to use the official ticket',
      'A look-alike handle',
    ],
    lesson:
      'Real support answers inside the app and never needs you to send money to fix a withdrawal.',
  },
  {
    id: 'screen-share-refund',
    truth: 'scam',
    category: 'remote_access',
    basis:
      'Refund call that asks you to install a screen-sharing app and make a small "test" payment',
    sources: [ADVISORY.techSupport],
    region: 'india',
    channel: 'call',
    from: "Call from a mobile number, caller says he is from your bank's refund team",
    transcript: [
      'Caller: Sir, a wrong charge was made on your account and the refund is ready.',
      'Caller: Please install the QuickAssist Desk app from the link I am sending and read me the nine-digit code.',
      'Caller: Then send a small activation payment so the refund channel opens. Refund aate hi yeh wapas mil jayega. (You get it back as soon as the refund arrives.)',
    ],
    ask: {
      amount: 12,
      to: '9LcNowwDDx5vEaggBb2JkY5dZtyryyD8gn4tufXZQogG',
      purpose: 'Activation payment to open a refund channel',
    },
    clues: [
      {
        text: 'You do not remember any wrong charge, and your statement shows none.',
        signal: 'scam',
      },
      {
        text: 'The app he wants installed lets another person see and control your screen.',
        signal: 'scam',
      },
      {
        text: 'You ask him to send the refund without the app. He says the bank server requires screen confirmation.',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'You call the number printed on your card. The bank has no refund for you and says staff never ask customers to install an app or share a screen.',
      signal: 'scam',
    },
    tells: [
      'A refund you did not ask for',
      'A screen-sharing app',
      'Paying money in order to receive money',
      'The caller rang you',
    ],
    lesson:
      'Nobody needs to see your screen to send you a refund. Remote access plus a payment is always a scam.',
  },
  {
    id: 'p2p-verification-transfer',
    truth: 'scam',
    category: 'verification_transfer',
    basis:
      'Peer-to-peer trade where an "agent" demands a verification transfer before funds are released',
    region: 'latam',
    channel: 'whatsapp',
    from: 'WhatsApp from "Agente de Liberación P2P"',
    transcript: [
      'Hola, soy el agente de su operación P2P. El comprador ya pagó.',
      'Para liberar los fondos debe enviar una transferencia de verificación. Se devuelve automáticamente. (To release the funds you must send a verification transfer. It is returned automatically.)',
      'Es un requisito contra el lavado de dinero. Tiene 20 minutos.',
    ],
    ask: {
      amount: 200,
      to: '5d1bb2hq3FKnSkivkg38cVBTeJMo1QKr2PzBEC6vGemT',
      purpose: 'Verification transfer to release a trade',
    },
    clues: [
      {
        text: 'Your bank account shows no incoming payment from the buyer.',
        signal: 'scam',
      },
      {
        text: 'The trade page on the platform has no agent assigned and still says "waiting for buyer payment".',
        signal: 'scam',
      },
      {
        text: "The agent sends a screenshot of a rule. The text is not in the platform's help pages.",
        signal: 'scam',
      },
    ],
    identity: {
      text: 'Platform chat support replies: agents never contact users outside the platform, and no trade requires the seller to send money first.',
      signal: 'scam',
    },
    tells: [
      'A "verification transfer" that will be "returned"',
      'Contact outside the trading platform',
      "The buyer's payment never arrived",
      'A 20-minute deadline',
    ],
    lesson: 'A transfer that proves who you are does not exist. If you must pay to get paid, stop.',
  },
  {
    id: 'kyc-expired-reactivation',
    truth: 'scam',
    category: 'account_unlock',
    basis: 'KYC expiry message: the account will be blocked unless a reactivation fee is paid',
    sources: [ADVISORY.phishing],
    region: 'india',
    channel: 'sms',
    from: 'SMS from sender "VK-KYCUPD"',
    transcript: [
      'Dear customer, your wallet KYC has expired and the account will be blocked in 24 hrs.',
      'Complete re-KYC now by paying the reactivation fee to the address below, then share the payment reference with our executive.',
      'Ignore if already updated.',
    ],
    ask: {
      amount: 25,
      to: 'C98gFt67WiPeCnNtLjBYdrPPkCHiHGm2eMQ3fMFYLEnV',
      purpose: 'KYC reactivation fee',
    },
    clues: [
      {
        text: 'The message does not say which wallet or bank it is from.',
        signal: 'scam',
      },
      {
        text: 'You completed full KYC with your wallet provider four months ago, with a video check.',
        signal: 'unclear',
      },
      {
        text: 'An "executive" calls right after you open the message and asks for the code you just received by SMS.',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'The wallet app shows "KYC verified, no action needed". Its help page says KYC is free and is only done inside the app.',
      signal: 'scam',
    },
    tells: [
      'A fee for KYC',
      'The sender does not name the provider',
      'A request for an SMS code',
      'A 24-hour block threat',
    ],
    lesson:
      "KYC is free and happens inside the provider's own app. Fees and codes over SMS are theft.",
  },
  {
    id: 'security-team-safe-vault',
    truth: 'scam',
    category: 'fake_support',
    basis:
      'Fake wallet security alert: move your funds to a "secure vault" address before a hacker drains them',
    sources: [ADVISORY.phishing],
    region: 'global',
    channel: 'email',
    from: 'Email from "Wallet Security Team" <alerts@wallet-secure-notice.example>',
    transcript: [
      'Subject: Unusual sign-in detected - action required',
      'A new device in another country signed in to your wallet eleven minutes ago.',
      'To protect your assets, move them now to your temporary secure vault address. Our team returns them once your wallet is re-secured.',
    ],
    ask: {
      amount: 900,
      to: '86rxe3vhEvsMshq4NxQDHVHvoa6xKi1nxjLEEDv1KSx7',
      purpose: 'Move funds to a temporary secure vault',
    },
    clues: [
      {
        text: 'Your wallet is self-custodial. No company holds your keys or can see your sign-ins.',
        signal: 'scam',
      },
      {
        text: 'The greeting is "Dear user" and the email went to an address you never gave to a wallet company.',
        signal: 'scam',
      },
      {
        text: 'The "vault" address was created today and has received funds from several wallets, all forwarded on within minutes.',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'The wallet maker\'s official site has a pinned notice: "We never email about sign-ins and we never ask you to move funds."',
      signal: 'scam',
    },
    tells: [
      'Moving money to a "safe" address someone else controls',
      'A security alert for a wallet that has no accounts',
      'A generic greeting',
      'Minutes of pressure',
    ],
    lesson:
      'An address someone else gives you is never safer than your own. Security teams do not hold funds for you.',
  },
  {
    id: 'popup-firewall-licence',
    truth: 'scam',
    category: 'remote_access',
    basis:
      'Tech support pop-up: a locked browser, a phone number and a "licence" payable in crypto',
    sources: [ADVISORY.techSupport],
    region: 'global',
    channel: 'call',
    from: 'You called the number shown on a full-screen browser warning',
    transcript: [
      'Agent: Thank you for calling certified computer support. Your device is sending your banking data to an unknown server.',
      'Agent: I have connected and I can see 1,482 infected files. You need the lifetime firewall licence today.',
      'Agent: Card payments are compromised on your machine, so the licence must be paid in USDC.',
    ],
    ask: {
      amount: 299,
      to: '7cXgySEYGzxVfK8r6U2Prquu8xaqd4Whp7ArdyyEtfh2',
      purpose: 'Lifetime firewall licence',
    },
    clues: [
      {
        text: 'The warning appeared on a recipe site and vanished when you closed the browser from the task manager.',
        signal: 'scam',
      },
      {
        text: 'The "infected files" he shows are the normal system log that every computer has.',
        signal: 'scam',
      },
      {
        text: "You ask for the company's registered name. He gives three different names during the call.",
        signal: 'scam',
      },
    ],
    identity: {
      text: "You call the computer maker's official support line. They say they never show phone numbers in browser warnings and sell nothing by phone.",
      signal: 'scam',
    },
    tells: [
      'A browser pop-up with a phone number',
      'Remote access to "scan" the computer',
      'Payment only in crypto because "cards are compromised"',
      'Scare numbers',
    ],
    lesson: 'Real security warnings never carry a phone number. Close the browser and call nobody.',
  },
  {
    id: 'fund-recovery-agent',
    truth: 'scam',
    category: 'recovery_scam',
    basis:
      'Recovery scam: someone who knows you lost money offers to get it back for an upfront fee',
    sources: [ADVISORY.cryptocurrency],
    region: 'global',
    channel: 'dm',
    from: 'DM from "Chain Recovery Legal" after you wrote about losing money to a fake platform',
    transcript: [
      'We are sorry about your loss. Our forensic team has already located your funds in a frozen wallet.',
      'We can release them to you within 48 hours. Success rate 97%.',
      'We only need the legal filing fee first. It is refunded from the recovered amount.',
    ],
    ask: {
      amount: 250,
      to: 'GhXzJbxwCJHDSNhWTnGJkFvQjJbmd9WTPxVQjPzgu841',
      purpose: 'Legal filing fee for fund recovery',
    },
    clues: [
      {
        text: 'They cannot tell you which wallet holds the funds "for confidentiality".',
        signal: 'scam',
      },
      {
        text: 'You ask whether the fee can be taken from the recovered money. They say regulations forbid it.',
        signal: 'scam',
      },
      {
        text: 'The firm\'s website was registered three weeks ago and its "lawyers" use stock photos.',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'The bar association has no firm or lawyer by that name. The police cybercrime desk says recovery never requires a fee to a private wallet.',
      signal: 'scam',
    },
    tells: [
      'They found you after a public post about your loss',
      'An upfront fee to recover money',
      'A guaranteed success rate',
      'No verifiable firm',
    ],
    lesson:
      'People who lost money are targeted again. Anyone charging upfront to recover it is the second scam.',
  },
];
