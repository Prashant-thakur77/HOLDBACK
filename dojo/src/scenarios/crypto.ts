/** Scams that only exist on-chain: poisoned addresses, drainers, fake escrow and migrations. */
import type { Scenario } from '../types';
import { ADVISORY } from './sources';

export const CRYPTO_SCAMS: Scenario[] = [
  {
    id: 'address-poisoning-friend',
    truth: 'scam',
    category: 'address_poisoning',
    basis:
      'Address poisoning: a look-alike address planted in your history by a dust transfer, copied when repaying a friend',
    region: 'global',
    channel: 'dm',
    from: 'DM from your friend Maya, then your own wallet history',
    transcript: [
      'Maya: Hey, can you send back the 85 from the concert tickets when you get a chance? Same wallet as last time.',
      'You open your wallet history and copy the most recent entry labelled 5Acj…kUu1.',
      'The payment screen is filled in and ready to send.',
    ],
    // Shares its first and last four characters with Maya's real address below.
    ask: {
      amount: 85,
      to: '5AcjL4DD1rv7YLjYv2JdWiMBnB6nLBTxvg9Tf6HkUu1',
      purpose: 'Repay a friend for concert tickets',
    },
    clues: [
      {
        text: 'The entry you copied is an incoming transfer of 0.000001 from yesterday, from an address you never dealt with.',
        signal: 'scam',
      },
      {
        text: 'Your payment to Maya three weeks ago went to 5AcjLKqJQUD4Z1TEYf4XJwbr4npChctABgx8aGWkUu1. The middle is different from the address on screen.',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'You ask Maya to send her address again. It starts 5AcjLKqJ and does not match the one you copied.',
      signal: 'scam',
    },
    tells: [
      'An address copied from history instead of from the person',
      'Only the first and last characters match',
      'A tiny unexplained incoming transfer',
    ],
    lesson:
      'Compare the whole address, not the ends. Copy it from the person or a saved contact, never from history.',
  },
  {
    id: 'address-poisoning-contractor',
    truth: 'scam',
    category: 'address_poisoning',
    basis:
      'Address poisoning in a routine payment: a monthly contractor payout pasted from a poisoned recent-transactions list',
    region: 'global',
    channel: 'email',
    from: "Email from Tomas, your contractor, then your wallet's recent list",
    transcript: [
      'Subject: November invoice',
      'Hi, invoice for November attached, same amount and same wallet as every month. Thanks! Tomas',
      'You pick the top "recent recipient" in your wallet, shown as 4RVj…A3gs, and paste it.',
    ],
    // Shares its first and last four characters with Tomas's real address below.
    ask: {
      amount: 640,
      to: '4RVj716bxLScY5yauMtxT11DuvoUuJunaQKauNbXA3gs',
      purpose: 'Monthly contractor invoice',
    },
    clues: [
      {
        text: "The invoice itself is normal: the right amount, the usual wording and Tomas's real email address.",
        signal: 'unclear',
      },
      {
        text: 'The top recent entry is a zero-value transfer that appeared two days ago. You did not make it.',
        signal: 'scam',
      },
      {
        text: "Last month's payout went to 4RVj72MzhswH7jNNJVw6VifdSQCvrZLHWLt4pMZ4A3gs. The pasted address differs after the fifth character.",
        signal: 'scam',
      },
    ],
    identity: {
      text: "The address printed on Tomas's invoice PDF is 4RVj72Mz…Z4A3gs. The one in the payment screen is not that address.",
      signal: 'scam',
    },
    tells: [
      'The request is real but the address is not',
      'A zero-value transfer you did not make',
      'Matching ends, different middle',
    ],
    lesson:
      'A genuine invoice can still be paid to the wrong address. Check it against the invoice, character by character.',
  },
  {
    id: 'airdrop-claim-activation',
    truth: 'scam',
    category: 'airdrop_drainer',
    basis:
      'Fake airdrop: tokens appear in your wallet and the claim site asks for an "activation" payment',
    sources: [ADVISORY.cryptocurrency],
    region: 'global',
    channel: 'dm',
    from: 'DM from "Airdrop Notifier" plus an unknown token in your wallet',
    transcript: [
      'You are eligible! 4,200 ZENX (about 1,900 USD) has been reserved for your wallet.',
      'Claim before the snapshot ends in 3 hours. A one-time activation payment is required to unlock the tokens.',
      'Send the activation to the claim address and the tokens become transferable at once.',
    ],
    ask: {
      amount: 35,
      to: 'GAuvHzwvwHN9bd3j1nUFSdFvVotyB977PE9fUCNqpSKT',
      purpose: 'Activation payment to unlock an airdrop',
    },
    clues: [
      {
        text: 'You never used any project called ZENX. The token arrived unrequested, together with thousands of other wallets.',
        signal: 'scam',
      },
      {
        text: 'The token has no trading pool anywhere. The "1,900 USD" figure appears only on the claim site.',
        signal: 'scam',
      },
      {
        text: 'The claim site also asks you to approve unlimited spending of your USDC.',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'No project by that name has a public team, code or announcement. Your wallet app marks the token as "unverified, possible scam".',
      signal: 'scam',
    },
    tells: [
      'Paying to claim something free',
      'A token you never asked for',
      'An unlimited approval request',
      'A three-hour countdown',
    ],
    lesson:
      'Free tokens that need a payment or an approval are a hook. Ignore tokens you did not expect.',
  },
  {
    id: 'free-mint-wallet-drainer',
    truth: 'scam',
    category: 'airdrop_drainer',
    basis:
      'Drainer link: a "free mint" from a hacked community account with a small mint fee and a blind approval',
    region: 'global',
    channel: 'dm',
    from: "Announcement in a collectors' chat you belong to, posted by a moderator account",
    transcript: [
      '@everyone SURPRISE MINT IS LIVE. 500 free passes for holders, first come first served.',
      'Mint fee only, no whitelist needed. Link below. 12 minutes left.',
      'Do not ask in general chat, mods are busy. Just mint.',
    ],
    ask: {
      amount: 90,
      to: 'D3BAnLCMknMoybgimvCMXmZp3JQWpBkWYiX6bGkdNEVV',
      purpose: 'Mint fee for a free pass',
    },
    clues: [
      {
        text: "The link goes to a site whose name has a hyphen the project's real site does not have.",
        signal: 'scam',
      },
      {
        text: "Your wallet's preview shows the transaction would also give the site control of all your tokens.",
        signal: 'scam',
      },
      {
        text: "The chat's general channel was locked one minute before the announcement.",
        signal: 'scam',
      },
    ],
    identity: {
      text: 'The project\'s official account on another platform says: "Our chat server is compromised. There is NO mint. Do not click anything."',
      signal: 'scam',
    },
    tells: [
      'A surprise mint with minutes left',
      'A look-alike site name',
      'The transaction asks for far more than the fee',
      'Questions are discouraged',
    ],
    lesson:
      'Read what a transaction takes, not what the page says. A moderator account can be stolen like any other.',
  },
  {
    id: 'otc-fake-escrow-admin',
    truth: 'scam',
    category: 'fake_escrow',
    basis:
      'Fake escrow: an over-the-counter trade where the "escrow admin" in the chat is a look-alike account',
    region: 'latam',
    channel: 'dm',
    from: 'Group chat with a seller and an account named "Escrow Admin - OTC Latam"',
    transcript: [
      'Seller: Tengo los tokens listos. Usamos el escrow del grupo para que los dos estemos seguros.',
      'Escrow Admin: Confirmado. Envíe sus USDC a la dirección de custodia. (Confirmed. Send your USDC to the custody address.)',
      'Escrow Admin: Cuando llegue su pago, el vendedor libera y yo cierro la operación. Tasa de 1%.',
    ],
    ask: {
      amount: 1000,
      to: '3sAnLU9MNbj9n4TZ7oVeCj8dsM6igNV7Ti8MCymSEmam',
      purpose: 'Payment into escrow for an over-the-counter trade',
    },
    clues: [
      {
        text: 'The seller created the group chat and added the admin himself.',
        signal: 'scam',
      },
      {
        text: "The admin's username uses a capital I where the community's known escrow account has a lowercase l.",
        signal: 'scam',
      },
      {
        text: 'You propose the on-chain escrow program the community normally uses. Both say it is "broken this week".',
        signal: 'scam',
      },
    ],
    identity: {
      text: "You message the escrow account listed in the community's pinned post. It answers that it is not in your group and has no open deal with that seller.",
      signal: 'scam',
    },
    tells: [
      'The other party brought the escrow agent',
      'A look-alike username',
      'They refuse an on-chain escrow',
    ],
    lesson:
      'An escrow agent chosen by the other side is the other side. Contact the agent through the pinned source yourself.',
  },
  {
    id: 'token-migration-v2',
    truth: 'scam',
    category: 'fake_migration',
    basis:
      'Fake token migration: an email says a protocol is moving to a new version and tokens must be sent in to be swapped',
    sources: [ADVISORY.phishing],
    region: 'global',
    channel: 'email',
    from: 'Email from "Protocol Team" <migration@orbit-stake-v2.example>',
    transcript: [
      'Subject: Mandatory migration to V2 - deadline in 24 hours',
      'All V1 deposits must be migrated. Send your USDC to the migration address and V2 tokens are issued 1:1 with a 5% loyalty bonus.',
      'Deposits not migrated before the deadline cannot be recovered.',
    ],
    ask: {
      amount: 650,
      to: 'AHqta6XrjbQHyzQGhBon82QWjbMH6YmN73Zwn923jXYX',
      purpose: 'Migrate a deposit to the new version',
    },
    clues: [
      {
        text: "The protocol's app shows your deposit as normal, with no banner about any migration.",
        signal: 'scam',
      },
      {
        text: "The migration address is a plain wallet. Real upgrades run through the protocol's own program.",
        signal: 'scam',
      },
      {
        text: 'You have a deposit in this protocol, which is why the email felt relevant. The list of depositor addresses is public on-chain.',
        signal: 'unclear',
      },
    ],
    identity: {
      text: "The protocol's official site and its governance forum have no migration announcement. A forum post from today warns about this exact email.",
      signal: 'scam',
    },
    tells: [
      'Send funds in to "migrate"',
      'A bonus for hurrying',
      'Funds "cannot be recovered" after a deadline',
      'No announcement on official channels',
    ],
    lesson:
      'Upgrades are announced where the protocol lives. Nobody migrates by posting funds to an emailed address.',
  },
];
