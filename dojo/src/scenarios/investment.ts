/** Scams that promise money: returns, giveaways, prizes and presales. */
import type { Scenario } from '../types';
import { ADVISORY } from './sources';

export const INVESTMENT_SCAMS: Scenario[] = [
  {
    id: 'vip-signals-daily-returns',
    truth: 'scam',
    category: 'investment',
    basis: 'Messaging-group investment club with guaranteed daily returns and a minimum deposit',
    sources: [ADVISORY.cryptocurrency],
    region: 'india',
    channel: 'whatsapp',
    from: 'WhatsApp group "Elite Wealth Circle 47", message from the admin',
    transcript: [
      'Admin: Congratulations, you are selected for the VIP signals plan. Guaranteed 3% profit daily, capital fully protected.',
      'Admin: Members here made 40,000 last week. Screenshots above.',
      'Admin: Sirf aaj ke liye seat khuli hai. (The seat is open only today.) Deposit the joining capital to the address below.',
    ],
    ask: {
      amount: 500,
      to: '3FuSo1CsmppkaE78nxiboRrpKozFwgjRA2cHvBwNGZuQ',
      purpose: 'Joining capital for a VIP trading plan',
    },
    clues: [
      {
        text: 'You were added to the group by an unknown number. Most members joined on the same day.',
        signal: 'scam',
      },
      {
        text: 'You ask which licensed broker holds the money. The admin says licences are "for small players".',
        signal: 'scam',
      },
      {
        text: 'A member who asked about withdrawals yesterday has been removed from the group.',
        signal: 'scam',
      },
    ],
    identity: {
      text: "The securities regulator's public register has no adviser under the admin's name or the group's name.",
      signal: 'scam',
    },
    tells: [
      'Guaranteed daily profit',
      'You were added by a stranger',
      'No licensed entity',
      'A seat that closes today',
    ],
    lesson: "Guaranteed returns do not exist. A real adviser is on the regulator's register.",
  },
  {
    id: 'trading-platform-withdrawal-tax',
    truth: 'scam',
    category: 'investment',
    basis:
      'Fake trading platform introduced by an online friend: profits on screen, then a "tax" to withdraw',
    sources: [ADVISORY.cryptocurrency, ADVISORY.romance],
    region: 'global',
    channel: 'dm',
    from: 'DM from Lena, a contact you met online two months ago',
    transcript: [
      "Lena: See? Your balance on the platform is already 4,870. I told you my uncle's signals work.",
      'Lena: To withdraw, the platform needs the 12% profit tax paid first. It is normal, I paid it too.',
      'Lena: Pay it today or the account gets locked for audit. I will be so sad if you lose it all.',
    ],
    ask: {
      amount: 600,
      to: 'Awd5q9AR4AamU65MemfWZfSd8anZacHnzQ8XBRgsqEka',
      purpose: 'Profit tax to unlock a withdrawal',
    },
    clues: [
      {
        text: 'You have never met Lena or spoken on a video call. Her camera is "broken".',
        signal: 'scam',
      },
      {
        text: 'You ask why the tax cannot be deducted from the balance. Support says the balance is "frozen until tax is paid from outside".',
        signal: 'scam',
      },
      {
        text: 'The platform is not in any app store and its web address was registered six weeks ago.',
        signal: 'scam',
      },
    ],
    identity: {
      text: "The financial regulator's warning list names this platform as an unlicensed clone. No tax office collects tax through a trading site.",
      signal: 'scam',
    },
    tells: [
      'A fee or tax before you can withdraw',
      'An online friend you have never seen',
      'A balance that exists only on their site',
      'Lock threat today',
    ],
    lesson: 'If you must send new money to withdraw your own money, the balance is fiction.',
  },
  {
    id: 'giveaway-send-to-double',
    truth: 'scam',
    category: 'giveaway',
    basis: 'Celebrity giveaway: send crypto to an address and get double back',
    sources: [ADVISORY.cryptocurrency],
    region: 'global',
    channel: 'dm',
    from: "DM from an account using a famous founder's name and photo",
    transcript: [
      'To celebrate our milestone we are giving back to the community!',
      'Send any amount between 50 and 5,000 USDC to the event address and receive 2x back instantly.',
      'Only the first 500 participants. 37 places left.',
    ],
    ask: {
      amount: 100,
      to: 'AZmv4HVHjHumgLHcaRCFeSvBii2A8fynxBRinyQV9Bfx',
      purpose: 'Giveaway entry, doubled on return',
    },
    clues: [
      {
        text: 'The account handle has a zero where the real one has the letter O.',
        signal: 'scam',
      },
      {
        text: 'The replies under the post are all from new accounts posting the same "it worked!" screenshot.',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'The founder\'s verified account posted last week: "I will never ask you to send crypto. Every giveaway that does is fake."',
      signal: 'scam',
    },
    tells: [
      'Send money to receive more money',
      'A look-alike handle',
      'A countdown of places',
      'Copy-paste testimonials',
    ],
    lesson: 'Nobody doubles money you send them. A giveaway never needs a payment.',
  },
  {
    id: 'presale-last-spots',
    truth: 'scam',
    category: 'investment',
    basis:
      'Token presale pushed by an influencer account: private allocation that closes in minutes',
    region: 'latam',
    channel: 'dm',
    from: 'DM from a crypto influencer account with a large following',
    transcript: [
      'Fala! Consegui uma alocação privada no pré-lançamento do token NOVA.',
      'Últimas vagas, fecha em 30 minutos. (Last spots, closes in 30 minutes.)',
      'Envie USDC para o endereço da pré-venda e os tokens chegam no lançamento. Retorno mínimo de 10x.',
    ],
    ask: {
      amount: 300,
      to: 'BzFvb7zztgr4HvfrYCDkaPN9chjwWHFxQZUwqm6MLbrh',
      purpose: 'Private presale allocation',
    },
    clues: [
      {
        text: 'The presale address is a normal wallet, not a contract, and the project has no published documents.',
        signal: 'scam',
      },
      {
        text: "The influencer's public posts do not mention the token at all.",
        signal: 'unclear',
      },
      {
        text: 'You ask for a vesting schedule or sale terms. The answer is a rocket emoji and "trust, 10x minimum".',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'The influencer\'s public channel has a warning posted today: "My account on that app was cloned. I am not selling any presale."',
      signal: 'scam',
    },
    tells: [
      'A minimum return promise',
      'A 30-minute window',
      'Funds go to a personal wallet',
      'No terms in writing',
    ],
    lesson:
      'A presale with a promised multiple and a countdown is a collection address, not an investment.',
  },
  {
    id: 'lottery-processing-fee',
    truth: 'scam',
    category: 'lottery_prize',
    basis: 'Prize or lottery win that needs a processing fee before the prize is released',
    region: 'india',
    channel: 'whatsapp',
    from: 'WhatsApp from a number with a foreign country code',
    transcript: [
      'Congratulations!! Your mobile number has won 25,00,000 in the Lucky Customer Draw.',
      'Aapka number lucky draw mein chuna gaya hai. (Your number was picked in the lucky draw.)',
      'To release the prize, pay the processing and tax fee today and send your ID photo to the claims manager.',
    ],
    ask: {
      amount: 60,
      to: '8uTE5N6L5tqGvdZ8SSu52oQHwqs99f14GaWAxMz2ShZ6',
      purpose: 'Processing fee to release a prize',
    },
    clues: [
      {
        text: 'You never entered any draw.',
        signal: 'scam',
      },
      {
        text: 'The certificate image has two different company names and a misspelled signature line.',
        signal: 'scam',
      },
      {
        text: 'You ask them to deduct the fee from the prize. The manager says "government rule" forbids it.',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'The company named on the certificate says on its website that it runs no lottery and that such messages are fraud.',
      signal: 'scam',
    },
    tells: [
      'A prize for a draw you never entered',
      'A fee before the prize',
      'A request for ID photos',
      'A foreign number',
    ],
    lesson: 'You cannot win a draw you did not enter, and real prizes never cost a fee.',
  },
];
