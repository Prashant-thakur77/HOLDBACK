/** Honest requests in trade: invoices, purchases, donations and tickets. */
import type { Scenario } from '../types';

export const LEGITIMATE_COMMERCE: Scenario[] = [
  {
    id: 'freelancer-logo-invoice',
    truth: 'legitimate',
    category: 'freelance_invoice',
    basis: "Freelancer's invoice for finished work at the agreed price",
    region: 'global',
    channel: 'email',
    from: 'Email from Ines, the designer you hired last month',
    transcript: [
      'Subject: Final files + invoice',
      'Hi! The final logo files are in the shared folder, all formats. Invoice attached: 400, as in the quote you approved.',
      'Payment terms are 15 days. Thanks, it was a nice project. Ines',
    ],
    ask: {
      amount: 400,
      to: '9ohaHiA3qp3qivtZ2sYoGNDGz76PRrF9G3WP31TEWDTA',
      purpose: 'Logo design invoice',
    },
    clues: [
      {
        text: 'The files are in the shared folder and they are the versions you approved on the call.',
        signal: 'legitimate',
      },
      {
        text: 'The amount equals the quote you accepted by email three weeks ago.',
        signal: 'legitimate',
      },
      {
        text: 'The payout address is the one written in that original quote.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: 'You message Ines on the freelance platform where you found her. She confirms the invoice number and the address.',
      signal: 'legitimate',
    },
    tells: [
      'Work delivered before payment was asked',
      'The quoted amount',
      'The address from the original quote',
      'Fifteen days to pay',
    ],
    lesson: 'Delivered first, priced as agreed, details unchanged since the quote.',
  },
  {
    id: 'used-bike-in-person',
    truth: 'legitimate',
    category: 'marketplace_purchase',
    basis: 'Buying a used item in person after inspecting it',
    region: 'global',
    channel: 'dm',
    from: 'Marketplace chat with the seller of a used bicycle, while you stand next to it',
    transcript: [
      'Seller: Glad you like it. 180 as listed, and I will add the lock.',
      'Seller: Here is my address. Send it while we are both here and I will hand you the key and the receipt from the shop.',
    ],
    ask: {
      amount: 180,
      to: 'GwK5FKi3n5CsDNhufcQe8qjKczd1qP93LxoyNbYfWYMf',
      purpose: 'Used bicycle, bought in person',
    },
    clues: [
      {
        text: 'You have ridden the bike around the block and checked the frame number against the shop receipt.',
        signal: 'legitimate',
      },
      {
        text: "The seller's marketplace profile is four years old with 60 completed sales.",
        signal: 'legitimate',
      },
    ],
    identity: {
      text: 'The seller shows you the wallet app on their own phone. The receiving address on the screen matches what they sent you.',
      signal: 'legitimate',
    },
    tells: [
      'You are the buyer and you have inspected the goods',
      'The exchange happens face to face',
      'The price is the listed price',
    ],
    lesson: 'Goods in your hands, seller in front of you: pay.',
  },
  {
    id: 'supplier-monthly-invoice',
    truth: 'legitimate',
    category: 'supplier_invoice',
    basis: 'Regular supplier invoice with unchanged payment details',
    region: 'global',
    channel: 'email',
    from: 'Email from accounts at Meridian Packaging, your regular supplier',
    transcript: [
      'Subject: Invoice 2304 for November deliveries',
      'Please find attached invoice 2304 for the three November deliveries, total 1,100. Terms 30 days as usual.',
      'Payment details are unchanged. Regards, Accounts',
    ],
    ask: {
      amount: 1100,
      to: 'A6jQYaukQx2FNxJgjWqpqAYRKgzECyVybiyBAfwyAKNY',
      purpose: 'Supplier invoice 2304',
    },
    clues: [
      {
        text: 'Your warehouse signed for three deliveries in November, and the quantities on the invoice match the delivery notes.',
        signal: 'legitimate',
      },
      {
        text: "The sender's domain is spelled exactly as in the contract.",
        signal: 'legitimate',
      },
      {
        text: 'The payout address is the one your last six payments to this supplier went to.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: 'You call your usual contact at the supplier on the number from the contract. They confirm invoice 2304 and that nothing has changed.',
      signal: 'legitimate',
    },
    tells: ['Matches the delivery notes', 'Payment details unchanged', 'Normal 30-day terms'],
    lesson:
      'A large amount is not a warning sign by itself. Changed details would be, and nothing changed.',
  },
  {
    id: 'registered-ngo-flood-appeal',
    truth: 'legitimate',
    category: 'donation',
    basis:
      'Appeal from a registered charity you already support, with the address published on its site',
    region: 'india',
    channel: 'email',
    from: 'Email newsletter from a relief organisation you have donated to for three years',
    transcript: [
      'Subject: Flood response update and appeal',
      'Our teams reached 14 villages this week with dry rations and medical camps. A full report with accounts will follow next month, as always.',
      'If you wish to help, donation options including USDC are listed on our website. Thank you for standing with us.',
    ],
    ask: {
      amount: 50,
      to: '2dtrtrhroSUonA4tkbfnewSkAeLqz4uLYbzKdwcY16PF',
      purpose: 'Donation to a flood response',
    },
    clues: [
      {
        text: 'You are on this mailing list because you donated before, and you received tax receipts each year.',
        signal: 'legitimate',
      },
      {
        text: 'The email asks for nothing by a deadline and sends you to the website instead of giving an address in the mail.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: 'The organisation appears in the government charity register under the same name and number. The address on its website is the one you are about to pay.',
      signal: 'legitimate',
    },
    tells: [
      'A registered organisation you already know',
      'The address comes from its own website',
      'Reports and receipts, no deadline',
    ],
    lesson: 'The honest version of a disaster appeal: registered, accountable and in no hurry.',
  },
  {
    id: 'online-store-checkout',
    truth: 'legitimate',
    category: 'purchase',
    basis: 'Checkout payment for an order you just placed in a shop you chose',
    region: 'global',
    channel: 'email',
    from: 'Email from an online shop, seconds after you pressed "place order"',
    transcript: [
      'Subject: Complete your order #58213',
      'Thanks for your order: 1 x trail running shoes, size 43. Total 64.00 including shipping.',
      'To finish, pay the amount below within 30 minutes. After that the items go back into stock and nothing is charged.',
    ],
    ask: {
      amount: 64,
      to: 'DkVYw1hU23MnxGeMDRJ6kEiRBTipZauzXVKGg1hB4Mkx',
      purpose: 'Online order #58213',
    },
    clues: [
      {
        text: 'You placed this order yourself a minute ago, and the item, size and total are what your basket showed.',
        signal: 'legitimate',
      },
      {
        text: 'The 30-minute limit only releases the stock again. Nothing bad happens if you let it expire.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: 'The order page in your shop account, opened from your own bookmark, shows order #58213 awaiting payment to the same address.',
      signal: 'legitimate',
    },
    tells: [
      'You started the transaction',
      'The details match your basket',
      'The time limit has no penalty',
    ],
    lesson: 'A timer is not always pressure. Ask what happens when it runs out: here, nothing.',
  },
  {
    id: 'community-meetup-ticket',
    truth: 'legitimate',
    category: 'purchase',
    basis: "Ticket for a local community event bought from the organiser's official page",
    region: 'latam',
    channel: 'dm',
    from: 'DM from the organiser account of a developer meetup you follow',
    transcript: [
      '¡Hola! Gracias por anotarte al meetup del jueves.',
      'La entrada cuesta 12 y cubre pizza y bebida. (The ticket costs 12 and covers pizza and a drink.)',
      'Puedes pagar aquí o en la puerta. Te esperamos.',
    ],
    ask: {
      amount: 12,
      to: 'GEgrMQ1hNz43WPGqoEAHsVRh2MSz2YnYVmzTHfgWw7EF',
      purpose: 'Meetup ticket',
    },
    clues: [
      {
        text: "You filled in the sign-up form on the meetup's page this morning.",
        signal: 'legitimate',
      },
      {
        text: 'The account has run monthly events for two years, and you attended one in the spring.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: "The event page on the meetup's website lists the same price and the same address, and says you may also pay at the door.",
      signal: 'legitimate',
    },
    tells: ['You signed up first', 'Paying at the door is allowed', 'A long public track record'],
    lesson: 'Small, expected, and you could pay in person instead.',
  },
  {
    id: 'contractor-address-change-confirmed',
    truth: 'legitimate',
    category: 'supplier_invoice',
    basis:
      'Genuine change of payment details, announced in advance and confirmed on a known phone number',
    region: 'global',
    channel: 'email',
    from: 'Email from Okafor Electrical, the contractor wiring your office',
    transcript: [
      'Subject: Stage 2 invoice and new payment details',
      'Stage 2 is complete and the invoice for 900 is attached. As I mentioned on site last week, we have moved to a new business wallet.',
      'Please ring me on my usual mobile before you pay so we can check the new address together. - Chidi',
    ],
    ask: {
      amount: 900,
      to: 'BhkpmJLwrET1geoAYW3jBSqViMSGJmLvJFncfxcM2bEB',
      purpose: 'Stage 2 of electrical work',
    },
    clues: [
      {
        text: 'Changed payment details by email are a classic fraud pattern, so this needs checking before it is trusted.',
        signal: 'unclear',
      },
      {
        text: 'Chidi did tell you about the new wallet in person on site last Tuesday.',
        signal: 'legitimate',
      },
      {
        text: 'The email asks you to call the number you already have, rather than a new one.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: 'You call Chidi on the mobile number from the original contract. He reads out the new address and it matches the invoice.',
      signal: 'legitimate',
    },
    tells: [
      'The change was announced in person beforehand',
      'You are asked to verify on a number you already hold',
      'The call confirms the address',
    ],
    lesson:
      'Changed details are fine once confirmed by voice on a number you had before the change.',
  },
  {
    id: 'domain-name-renewal',
    truth: 'legitimate',
    category: 'subscription',
    basis: 'Domain renewal notice from the registrar where the domain is actually registered',
    region: 'global',
    channel: 'email',
    from: "Email from the registrar that holds your website's domain",
    transcript: [
      'Subject: Your domain expires in 30 days',
      'Your domain is due for renewal on 27 December. Renewal for one year costs 18.00.',
      'Auto-renew is off for this domain. Sign in to your account to renew or to turn auto-renew on.',
    ],
    ask: {
      amount: 18,
      to: 'BdnHW9DZgGz1KK3bMuMMLcreavgd22RR1PSxPzNcGaMf',
      purpose: 'One-year domain renewal',
    },
    clues: [
      {
        text: 'This registrar is where you bought the domain, and the expiry date is the one in your own notes.',
        signal: 'legitimate',
      },
      {
        text: 'The price is the same as last year.',
        signal: 'legitimate',
      },
      {
        text: 'Similar-looking renewal letters from unknown companies do exist, so the sender matters.',
        signal: 'unclear',
      },
    ],
    identity: {
      text: 'You sign in to the registrar by typing its address. The dashboard shows the same expiry date, price and payment address.',
      signal: 'legitimate',
    },
    tells: [
      'From the registrar you actually use',
      'A month of notice',
      'The dashboard shows the same thing',
    ],
    lesson: 'Renewal notices are common bait, so check the account, and then pay the real one.',
  },
];
