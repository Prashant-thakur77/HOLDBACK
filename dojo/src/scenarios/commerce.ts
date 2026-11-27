/** Scams around buying, selling, renting, shipping and giving. */
import type { Scenario } from '../types';
import { ADVISORY } from './sources';

export const COMMERCE_SCAMS: Scenario[] = [
  {
    id: 'marketplace-scan-to-receive',
    truth: 'scam',
    category: 'marketplace',
    basis:
      'Marketplace buyer who sends a payment request or QR code and says you must approve it "to receive" the money',
    region: 'india',
    channel: 'whatsapp',
    from: 'WhatsApp from a buyer answering your sofa listing',
    transcript: [
      'Buyer: I like the sofa, price is fine. I am in the army, posted away, my driver will collect it.',
      'Buyer: I am sending you the payment now. Scan the code and approve it to receive the amount in your wallet.',
      'Buyer: Jaldi approve kijiye, payment pending dikha raha hai. (Approve quickly, the payment is showing as pending.)',
    ],
    ask: {
      amount: 150,
      to: '2TXEYdpZvp7yi58ZYm9rD4yxKGgtsu6btG9ueayhnpnd',
      purpose: 'Approve a request "to receive" payment for a sofa',
    },
    clues: [
      {
        text: 'The buyer never asked to see the sofa or bargained on the price.',
        signal: 'unclear',
      },
      {
        text: 'The code opens a payment request: approving it sends money from you to him.',
        signal: 'scam',
      },
      {
        text: 'You ask him to send a normal transfer to your address. He says his account "only supports request mode".',
        signal: 'scam',
      },
    ],
    identity: {
      text: "The marketplace safety page says: you never scan a code or approve anything to receive money. The buyer's profile was created yesterday.",
      signal: 'scam',
    },
    tells: [
      'Approving or scanning "to receive" money',
      'A buyer who never inspects the item',
      'A third person will collect',
      'Pressure to approve quickly',
    ],
    lesson:
      'Receiving money needs nothing from you. If you are approving or scanning, you are paying.',
  },
  {
    id: 'buyer-overpaid-refund',
    truth: 'scam',
    category: 'marketplace',
    basis: 'Overpayment: a buyer "sends too much by mistake" and asks you to refund the difference',
    sources: [ADVISORY.overpayment],
    region: 'global',
    channel: 'email',
    from: 'Email from the buyer of your used camera',
    transcript: [
      'Subject: Payment sent - small mistake on my side',
      'I transferred 760 instead of 500 for the camera, my assistant typed the wrong figure. The receipt is attached.',
      'Please send back the 260 difference today so my accounts balance, and ship the camera when you can.',
    ],
    ask: {
      amount: 260,
      to: 'HumBK693fp5jGXru3dWEAXkZBEBN77RwERCmBh3pLg5v',
      purpose: 'Refund of an overpayment',
    },
    clues: [
      {
        text: 'The "receipt" is an image. Your wallet shows no incoming transfer at all.',
        signal: 'scam',
      },
      {
        text: 'The buyer says the transfer is "held by the network until you return the excess".',
        signal: 'scam',
      },
      {
        text: 'The refund address is different from the address the receipt claims the money came from.',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'You look up the transaction ID from the receipt on a block explorer. It does not exist.',
      signal: 'scam',
    },
    tells: [
      'A refund requested before any money arrived',
      'A receipt image instead of a real transfer',
      'Funds "held until you pay"',
      'Refund to a different address',
    ],
    lesson: 'Refund only money that has actually arrived, and only back to where it came from.',
  },
  {
    id: 'supplier-new-payout-address',
    truth: 'scam',
    category: 'invoice_fraud',
    basis:
      "Invoice fraud: a familiar supplier's email thread announces new payment details just before an invoice is due",
    region: 'global',
    channel: 'email',
    from: 'Email in your existing thread with Meridian Packaging, your regular supplier',
    transcript: [
      'Subject: RE: Invoice 2291 - updated payment details',
      'Hi, following our treasury migration, please note our payout address has changed. The new one is below.',
      'Kindly use it for invoice 2291, due Friday, and confirm once sent. The old address is being closed. Regards, Accounts.',
    ],
    ask: {
      amount: 1150,
      to: 'D4rdi8t4CJDfChQpoi3dmNF1fv7HwhjHNEZgQbRDme7G',
      purpose: 'Supplier invoice 2291',
    },
    clues: [
      {
        text: 'The invoice number and amount match your order exactly.',
        signal: 'unclear',
      },
      {
        text: "The sender's domain is meridian-packagng.example: one letter is missing compared with every earlier mail.",
        signal: 'scam',
      },
      {
        text: 'The previous six invoices were all paid to the same address, which still receives payments from other customers this week.',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'You phone your usual contact at the supplier on the number from the signed contract. They have not changed any payment details.',
      signal: 'scam',
    },
    tells: [
      'Payment details changed by email',
      'A one-letter difference in the sender domain',
      'Timed just before a real invoice',
      'The "old address is being closed"',
    ],
    lesson: 'Any change of payment details is confirmed by phone on a number you already had.',
  },
  {
    id: 'rental-owner-abroad-deposit',
    truth: 'scam',
    category: 'rental_deposit',
    basis:
      'Rental listing scam: a flat priced below the market, an owner abroad, and a deposit to "hold" it before any viewing',
    sources: [ADVISORY.rentalListing],
    region: 'global',
    channel: 'email',
    from: 'Email from the owner of a flat you asked about on a listings site',
    transcript: [
      'Thank you for your interest. The flat is still free. I moved abroad for work, so I cannot show it myself.',
      'Many people are asking. If you send the holding deposit today, I will take the listing down and courier the keys with the contract.',
      'If you do not like the flat after seeing it, I refund you in full.',
    ],
    ask: {
      amount: 800,
      to: '3BGPDZGEgbc5tHfzfDYkJXmsFUhL3WMswDLRfBsFhGC9',
      purpose: 'Holding deposit for a rental flat',
    },
    clues: [
      {
        text: 'The rent is about 40% below similar flats on the same street.',
        signal: 'unclear',
      },
      {
        text: "The same photos appear in a sale listing from last year under an agency's name.",
        signal: 'scam',
      },
      {
        text: 'You offer to have a friend view it with the building caretaker. The owner says nobody has keys and viewing is only possible after the deposit.',
        signal: 'scam',
      },
    ],
    identity: {
      text: "You call the agency from the older listing. The flat was sold last year and they know of no rental. The owner's name is not in the property record.",
      signal: 'scam',
    },
    tells: [
      'Deposit before any viewing',
      'An owner who is abroad',
      'A price far below the market',
      'Photos copied from another listing',
    ],
    lesson: 'See the flat and meet someone with keys before any money moves.',
  },
  {
    id: 'parcel-held-customs-fee',
    truth: 'scam',
    category: 'parcel_fee',
    basis:
      'Parcel text: a package is held and a small customs or redelivery fee must be paid through a link',
    sources: [ADVISORY.phishing],
    region: 'latam',
    channel: 'sms',
    from: 'SMS from an unknown mobile number',
    transcript: [
      'Serviço postal: Sua encomenda está retida na alfândega. (Your parcel is held at customs.)',
      'Pague a taxa de liberação em até 12 horas ou o pacote será devolvido.',
      'Rastreamento: BR-4471-XX. Pagamento pelo endereço abaixo.',
    ],
    ask: {
      amount: 18,
      to: 'H8Lzc9KM5wEmvw3dbpKcLX3N3LkFE4LwBUamxhCcuurc',
      purpose: 'Customs release fee for a parcel',
    },
    clues: [
      {
        text: 'You are not expecting any international parcel.',
        signal: 'scam',
      },
      {
        text: 'The tracking code has the wrong format: real codes have two letters, nine digits and two letters.',
        signal: 'scam',
      },
    ],
    identity: {
      text: "The postal service's official tracking page does not recognise the code, and your account there shows no parcels.",
      signal: 'scam',
    },
    tells: [
      'A parcel you did not order',
      'A tracking code in the wrong format',
      'Sent from a personal number',
      'A 12-hour return threat',
    ],
    lesson:
      "Check the tracking code on the carrier's own site. Small fees are how card and wallet theft starts.",
  },
  {
    id: 'disaster-relief-personal-wallet',
    truth: 'scam',
    category: 'charity',
    basis:
      'Fake disaster charity: an emotional appeal right after a flood, collecting into a personal wallet',
    region: 'global',
    channel: 'dm',
    from: 'DM from an account named "Flood Relief Volunteers"',
    transcript: [
      'Thousands of families lost everything last night. We are volunteers on the ground buying food and blankets.',
      'Banks are too slow, so we collect in USDC. 100% goes to the victims. Photo attached.',
      'Please give in the next hour, the truck leaves tonight.',
    ],
    ask: {
      amount: 75,
      to: 'EtFPekVHneVqdwk26BC2EAwciMdNFzCdzNdZanVYB7Ft',
      purpose: 'Donation for flood relief',
    },
    clues: [
      {
        text: 'The account was opened two days ago and has no history before the flood.',
        signal: 'scam',
      },
      {
        text: 'The attached photo is from a different flood three years ago, according to an image search.',
        signal: 'scam',
      },
      {
        text: 'You ask for the organisation\'s registration number. They answer that paperwork "wastes time while people suffer".',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'The national charity register has no organisation by that name. Registered relief groups working in the area list different donation addresses on their sites.',
      signal: 'scam',
    },
    tells: [
      'A brand-new account',
      'No registration number',
      'A recycled photo',
      'Give within the hour',
    ],
    lesson: 'Give through a charity you can find on a register, using the address on its own site.',
  },
];
