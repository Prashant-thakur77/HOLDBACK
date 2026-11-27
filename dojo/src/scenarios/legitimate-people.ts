/** Honest requests from people you know: friends, family and neighbours. */
import type { Scenario } from '../types';

export const LEGITIMATE_PEOPLE: Scenario[] = [
  {
    id: 'friend-dinner-split',
    truth: 'legitimate',
    category: 'friend_split',
    basis: 'Friend splitting a restaurant bill from a dinner you were at',
    region: 'global',
    channel: 'whatsapp',
    from: 'WhatsApp from Aisha, in your long-running chat',
    transcript: [
      'Aisha: Last night was fun! I put the whole bill on my card.',
      'Aisha: Your share comes to 23 with the tip. Photo of the receipt attached.',
      'Aisha: No rush, whenever.',
    ],
    ask: {
      amount: 23,
      to: '2eV67UEqzEvUJCCqePLabWfGbQLecAvt7DkcVMj7ctBF',
      purpose: 'Your share of a dinner bill',
    },
    clues: [
      {
        text: 'You were at that dinner, and Aisha did pay at the table.',
        signal: 'legitimate',
      },
      {
        text: "The receipt photo shows the restaurant, last night's date and four covers.",
        signal: 'legitimate',
      },
    ],
    identity: {
      text: 'You send her a voice note asking if the address is still the same. She replies by voice: yes, same one as the cinema tickets.',
      signal: 'legitimate',
    },
    tells: ['An event you were part of', 'A receipt that fits', 'No rush at all'],
    lesson: 'Small, expected and unhurried, from someone whose voice you can hear.',
  },
  {
    id: 'sister-scooter-breakdown',
    truth: 'legitimate',
    category: 'family_support',
    basis: 'Real family emergency: a relative calls from her own number and can be called back',
    region: 'india',
    channel: 'call',
    from: "Call from your sister Neha's saved number",
    transcript: [
      'Neha: Bhaiya, scooter kharab ho gayi hai highway par. (Brother, the scooter has broken down on the highway.)',
      'Neha: The mechanic here wants an advance before he tows it. My wallet is nearly empty. Can you send it to me, I will pay him?',
      'Neha: I am sending you my address on chat. Call me back if it does not come through.',
    ],
    ask: {
      amount: 55,
      to: '8ifNJgagpadEaG63XHiNiruAh8g4iTvc29CZka411zaj',
      purpose: "Advance for a relative's scooter repair",
    },
    clues: [
      {
        text: "It is her voice, and she mentions that she is on the way back from the cousin's place you both visited on Sunday.",
        signal: 'legitimate',
      },
      {
        text: 'The address arrives in your existing chat with her and matches the one saved in your wallet as "Neha".',
        signal: 'legitimate',
      },
      {
        text: 'The money goes to her own wallet, not to the mechanic or any third person.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: 'You call her back on the saved number. She answers from the roadside and you can hear traffic and the mechanic.',
      signal: 'legitimate',
    },
    tells: [
      'Her own number, and she invites a call back',
      'Money goes to her saved address',
      'Details only she would know',
    ],
    lesson: 'A real emergency welcomes a call back. This one did.',
  },
  {
    id: 'mother-monthly-support',
    truth: 'legitimate',
    category: 'family_support',
    basis: 'Regular monthly support to a parent, same wallet every month',
    region: 'latam',
    channel: 'whatsapp',
    from: 'WhatsApp from "Mamá", a saved contact',
    transcript: [
      "Mamá: Hijo, ¿me mandas lo del mes cuando puedas? (Son, can you send this month's money when you can?)",
      'Mamá: Ya llegó el recibo de la luz y quiero pagarlo el viernes.',
      'Mamá: Un beso. Abrígate que hace frío.',
    ],
    ask: {
      amount: 200,
      to: 'EeZALoKKuHcysykNh3Sv5iURMWdyMw7x6gKbuTYgnKuA',
      purpose: 'Monthly support for your mother',
    },
    clues: [
      {
        text: 'You send her this amount around this date every month.',
        signal: 'legitimate',
      },
      {
        text: 'The address in your wallet\'s contact "Mamá" is the one filled in. Nobody sent a new one.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: 'You call her. She answers, complains about the electricity bill and asks whether you are eating properly.',
      signal: 'legitimate',
    },
    tells: [
      'A routine you set up yourself',
      'The saved address, unchanged',
      'Her own number and her own voice',
    ],
    lesson: 'Same person, same amount, same address, no new instructions.',
  },
  {
    id: 'roommate-utilities-share',
    truth: 'legitimate',
    category: 'friend_split',
    basis: 'Flatmate asking for half of the utilities, with the bill attached',
    region: 'global',
    channel: 'dm',
    from: "DM from Jonas in your flat's group chat",
    transcript: [
      'Jonas: Gas and water bill came in, 94 for the two months. Screenshot below.',
      'Jonas: I paid it from my account, so 47 each. Send whenever you are back.',
    ],
    ask: {
      amount: 47,
      to: 'D24kfGUDVNadiUN5HDQbWgW2nNymVktcJpYnM3N1NrLA',
      purpose: "Half of the flat's utilities",
    },
    clues: [
      {
        text: "The screenshot shows your flat's address and the billing period you both lived there.",
        signal: 'legitimate',
      },
      {
        text: 'Jonas has paid the utilities and split them with you the same way for a year.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: 'Jonas is in the next room. You ask him through the door and he says "yes, 47, same wallet".',
      signal: 'legitimate',
    },
    tells: ['A bill for your own address', 'The usual arrangement', 'You can ask him face to face'],
    lesson: 'When you can confirm in person, do, and then pay without worry.',
  },
  {
    id: 'friend-new-wallet-confirmed',
    truth: 'legitimate',
    category: 'friend_repayment',
    basis:
      'Friend who changed wallets and asks for a repayment to the new address, confirmed by voice',
    region: 'global',
    channel: 'whatsapp',
    from: 'WhatsApp from Dev, a friend you owe money to',
    transcript: [
      'Dev: Hey, about the 150 for the flight. I moved to a new wallet last week, the old phone died.',
      'Dev: New address below. Please do not use the old one, I cannot open it any more.',
      'Dev: Call me if this looks weird, I know how it sounds.',
    ],
    ask: {
      amount: 150,
      to: '6tutqS7uAvbetZ9kziEPV9iVSCWRD7T26LpHozALBP4c',
      purpose: 'Repay a friend for a flight ticket',
    },
    clues: [
      {
        text: 'A changed address is exactly what a scammer would say, so the message alone proves nothing.',
        signal: 'unclear',
      },
      {
        text: 'You do owe Dev 150 for the flight, and only the two of you know the amount.',
        signal: 'legitimate',
      },
      {
        text: 'He told you at lunch on Saturday that his phone had died and he was setting up a new wallet.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: 'You video-call Dev. He picks up, laughs, and reads the new address aloud. It matches the message character by character.',
      signal: 'legitimate',
    },
    tells: [
      'He invites you to call and check',
      'The change was mentioned in person before',
      'The address is confirmed on a live call',
    ],
    lesson:
      'A new address is a reason to verify, not a reason to refuse. Verified by voice, it is fine.',
  },
  {
    id: 'office-farewell-collection',
    truth: 'legitimate',
    category: 'group_collection',
    basis: "Workplace collection for a colleague's leaving gift, run by a known organiser",
    region: 'global',
    channel: 'dm',
    from: "Message in your team's work chat from Grace, the office manager",
    transcript: [
      "Grace: As you know, Farid's last day is Friday. We are collecting for a gift and a card.",
      'Grace: Suggested 15 each, totally optional. Send to me and I will post the receipt here.',
      'Grace: Card is on my desk for signing.',
    ],
    ask: {
      amount: 15,
      to: '38sDULSTuh72kDXH2jEGhyqFUos76WYohc1twxMLHdrX',
      purpose: "Contribution to a colleague's leaving gift",
    },
    clues: [
      {
        text: "Farid announced he was leaving at Monday's team meeting.",
        signal: 'legitimate',
      },
      {
        text: 'Grace ran the last two collections the same way and posted the receipts afterwards.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: "You walk past Grace's desk. The card is there, and she confirms the address on her screen.",
      signal: 'legitimate',
    },
    tells: [
      'Optional and small',
      "Posted in the company's own chat by a known organiser",
      'Receipts are promised in public',
    ],
    lesson: 'Optional, public and run by someone accountable to the whole team.',
  },
  {
    id: 'cousin-wedding-gift',
    truth: 'legitimate',
    category: 'gift',
    basis: 'Wedding gift to a relative using the address on the invitation',
    region: 'india',
    channel: 'whatsapp',
    from: 'WhatsApp from your cousin Ananya, in the family group',
    transcript: [
      'Ananya: Thank you all for the blessings! For those abroad who asked how to send shagun, our wallet address is on the invitation card and below.',
      'Ananya: Shaadi 14 tareekh ko hai, sab zaroor aana. (The wedding is on the 14th, everyone please come.)',
      'Ananya: Please do not feel obliged, your presence is the gift.',
    ],
    ask: {
      amount: 100,
      to: 'CNRauZhkF9vHM7VmnVWmk3sXRZWNyC9Ndk7b6tzECBoz',
      purpose: 'Wedding gift for a cousin',
    },
    clues: [
      {
        text: 'You asked in the family group yesterday how to send a gift from abroad. This message answers you.',
        signal: 'legitimate',
      },
      {
        text: 'The address matches the QR code on the printed invitation your parents received.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: "Your aunt, the bride's mother, confirms on a call that the address is Ananya's and reads out the last six characters.",
      signal: 'legitimate',
    },
    tells: [
      'You asked for the address first',
      'It matches the printed invitation',
      'No obligation and no deadline',
    ],
    lesson: 'You started this one, and two independent sources give the same address.',
  },
  {
    id: 'trip-house-deposit',
    truth: 'legitimate',
    category: 'group_collection',
    basis: "Friend organising a group trip collecting each person's share of the house booking",
    region: 'latam',
    channel: 'whatsapp',
    from: 'WhatsApp from Bruno in the group "Praia Janeiro"',
    transcript: [
      'Bruno: Pessoal, reservei a casa! Print da reserva aqui. (Guys, I booked the house! Screenshot of the booking here.)',
      'Bruno: Fica 130 para cada um. Paguei o sinal do meu bolso, então quem puder já manda.',
      'Bruno: Quem desistir até dia 20 recebe tudo de volta.',
    ],
    ask: {
      amount: 130,
      to: '7u6oLGRv7PWeDoY4J7rqGz8gCmt2bT1hTZRzZ9DcZhLd',
      purpose: 'Your share of a holiday house',
    },
    clues: [
      {
        text: 'The six of you agreed on this house and this price in the group last week.',
        signal: 'legitimate',
      },
      {
        text: "The booking screenshot shows the house, the dates and Bruno's name as the guest.",
        signal: 'legitimate',
      },
      {
        text: 'Two friends in the group have already paid him and said so.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: 'You call Bruno. He confirms the address and forwards you the booking confirmation email from the rental site.',
      signal: 'legitimate',
    },
    tells: [
      'A plan the whole group made together',
      'Proof of the booking in his name',
      'A refund date instead of a deadline',
    ],
    lesson: 'A shared plan, visible proof and a way out: nothing here is hidden.',
  },
  {
    id: 'tutor-monthly-fee',
    truth: 'legitimate',
    category: 'service_invoice',
    basis: "Private tutor's monthly fee for lessons that took place",
    region: 'india',
    channel: 'sms',
    from: "SMS from Mrs. Iyer, your son's maths tutor",
    transcript: [
      'Good evening. Fees for November: 8 classes, 6,000 as usual.',
      'Rohan did well in the unit test, 18 out of 20. Please pay by the 5th as always.',
      'Regards, Mrs. Iyer',
    ],
    ask: {
      amount: 70,
      to: 'DC64Mi9thLfa6UQQNfMQ1RzDoLXJLu3WCCQftgr4BZLL',
      purpose: 'Monthly tuition fee',
    },
    clues: [
      {
        text: 'Rohan attended eight classes in November and did score 18 out of 20.',
        signal: 'legitimate',
      },
      {
        text: 'The fee and the date are the same every month.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: 'Rohan has class with her tomorrow at your home. The address matches the one you have paid since April.',
      signal: 'legitimate',
    },
    tells: [
      'A regular fee for classes that happened',
      'Details only the tutor would know',
      'The address you have always paid',
    ],
    lesson: 'Recurring, expected and from someone who will be at your door tomorrow.',
  },
];
