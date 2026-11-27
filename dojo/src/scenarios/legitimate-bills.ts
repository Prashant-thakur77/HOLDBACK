/** Honest requests from companies and professionals: bills, fees and renewals. */
import type { Scenario } from '../types';

export const LEGITIMATE_BILLS: Scenario[] = [
  {
    id: 'electricity-bill-due',
    truth: 'legitimate',
    category: 'utility_bill',
    basis: "Ordinary utility bill reminder that names the account and matches the provider's app",
    region: 'india',
    channel: 'sms',
    from: 'SMS from the registered sender ID of your power company',
    transcript: [
      'Bill for consumer no. ending 4417 for October: 2,690. Due date 05 Dec.',
      'Pay in the app or at any counter. Supply may be disconnected for bills unpaid 15 days after the due date.',
      'Ignore if already paid.',
    ],
    ask: {
      amount: 32,
      to: 'C69GBsyXrHjcv5WoPAp4LZCzDq82feQUvFPvFwSvd7Gc',
      purpose: 'October electricity bill',
    },
    clues: [
      {
        text: 'The consumer number ending matches the one printed on your paper bills.',
        signal: 'legitimate',
      },
      {
        text: 'The amount is close to what you paid in the same month last year.',
        signal: 'legitimate',
      },
      {
        text: 'The message contains no link and no phone number, only the app and the counter.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: 'You open the power company app yourself. It shows the same bill, the same amount and this payment address under "Pay with USDC".',
      signal: 'legitimate',
    },
    tells: [
      'Names your consumer number',
      'Sends you to the official app, not to a person',
      'A normal due date instead of a deadline tonight',
      'The app shows the same bill',
    ],
    lesson: "A real bill survives being looked up in the provider's own app.",
  },
  {
    id: 'landlord-rent-overdue',
    truth: 'legitimate',
    category: 'rent',
    basis:
      'Landlord chasing rent that is genuinely late, from a saved contact and to the usual address',
    region: 'india',
    channel: 'whatsapp',
    from: 'WhatsApp from "Mr. Sharma (Landlord)", a saved contact',
    transcript: [
      'Mr. Sharma: Namaste. Kiraya do din late ho gaya hai. (The rent is two days late.)',
      'Mr. Sharma: Please send it today, I have the society maintenance to pay tomorrow.',
      'Mr. Sharma: Same account as always.',
    ],
    ask: {
      amount: 420,
      to: '9nxoL7KiurRVpJfykatoGS7w1Fzm8yv1dcfaGNESXwwK',
      purpose: 'Monthly rent',
    },
    clues: [
      {
        text: 'The rent really is two days late: you were travelling on the first.',
        signal: 'legitimate',
      },
      {
        text: 'The chat with this number goes back fourteen months, including photos of the flat and your signed agreement.',
        signal: 'legitimate',
      },
      {
        text: 'The address is the same one your last eleven rent payments went to.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: 'You call Mr. Sharma on his saved number. He picks up, confirms the message and thanks you.',
      signal: 'legitimate',
    },
    tells: [
      'A saved contact with a long history',
      'The debt is real and you know why',
      'The same address as every month',
    ],
    lesson:
      'Urgency alone is not a scam sign. A known person, a real debt and an unchanged address is.',
  },
  {
    id: 'school-term-fee',
    truth: 'legitimate',
    category: 'tuition',
    basis: 'School fee notice that matches the published fee schedule and the parent portal',
    region: 'latam',
    channel: 'email',
    from: "Email from the administration office of your daughter's school",
    transcript: [
      'Asunto: Cuota del segundo trimestre',
      'Estimadas familias: la cuota del trimestre vence el día 10. (Dear families: the term fee is due on the 10th.)',
      'Pueden pagar en la secretaría o por el portal de padres. Adjuntamos el detalle de su hija.',
    ],
    ask: {
      amount: 350,
      to: '8NCNzx9RkFrmMSiXF2wSYFCCY47QGmLhBn1RaTxJso4H',
      purpose: 'School fee for the term',
    },
    clues: [
      {
        text: "The attachment lists your daughter's name, class and student number correctly.",
        signal: 'legitimate',
      },
      {
        text: 'The amount equals the fee in the schedule the school handed out in March.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: 'You log in to the parent portal from your bookmark. It shows the same invoice and the same payment address.',
      signal: 'legitimate',
    },
    tells: [
      'Matches the published fee schedule',
      'Correct student details',
      'Payable at the office or the portal',
    ],
    lesson: 'Expected, scheduled and visible in the portal: pay it.',
  },
  {
    id: 'internet-plan-renewal',
    truth: 'legitimate',
    category: 'subscription',
    basis: 'Monthly internet invoice for an existing plan, same amount as every month',
    region: 'global',
    channel: 'email',
    from: "Email from your internet provider's billing address",
    transcript: [
      'Subject: Your invoice for December is ready',
      'Plan: Fibre 300. Amount due: 29.00. Due date: 12 December.',
      'You can view and pay this invoice in your account. Thank you for being a customer since 2023.',
    ],
    ask: {
      amount: 29,
      to: 'DoZzhwwbeBNJuYx7eQSZ6BrH3hHmiREG4arzDEWaVsD8',
      purpose: 'Monthly internet plan',
    },
    clues: [
      {
        text: 'The amount and plan name are the same as the last eight invoices.',
        signal: 'legitimate',
      },
      {
        text: 'The email addresses you by name and shows your customer number.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: "You type the provider's site into the browser and sign in. The December invoice is there with the same payment address.",
      signal: 'legitimate',
    },
    tells: [
      'The same amount as every month',
      'Your name and customer number',
      'Visible in your account',
    ],
    lesson: 'Routine and checkable is what an honest bill looks like.',
  },
  {
    id: 'clinic-visit-invoice',
    truth: 'legitimate',
    category: 'medical_bill',
    basis: 'Clinic invoice sent the day after an appointment you attended',
    region: 'latam',
    channel: 'whatsapp',
    from: "WhatsApp from the clinic's reception number, the one you booked with",
    transcript: [
      "Olá! Aqui é a recepção da Clínica Vida. Segue a cobrança da consulta de ontem. (Here is the bill for yesterday's appointment.)",
      'Consulta com a Dra. Helena, 14h30. Valor conforme combinado na recepção.',
      'Pode pagar por aqui ou na próxima visita. Obrigada!',
    ],
    ask: {
      amount: 60,
      to: '2jm8BcTUM1jTzm2JsdecYoytyvRWURyKEEVhme3DtWwf',
      purpose: "Doctor's appointment",
    },
    clues: [
      {
        text: 'You did see Dra. Helena yesterday at 14:30, and reception told you the bill would follow by message.',
        signal: 'legitimate',
      },
      {
        text: 'This is the same number that confirmed your booking last week.',
        signal: 'legitimate',
      },
      {
        text: 'There is no deadline: you may also pay at your next visit.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: "You call the clinic's landline from its website. Reception confirms the invoice and the address.",
      signal: 'legitimate',
    },
    tells: ['A service you actually received', 'The number you already dealt with', 'No pressure'],
    lesson:
      'You know what you bought, from whom and when. That is the opposite of a surprise demand.',
  },
  {
    id: 'garage-repair-ready',
    truth: 'legitimate',
    category: 'service_invoice',
    basis: 'Garage asking for payment of a repair you ordered, at the quoted price',
    region: 'global',
    channel: 'sms',
    from: 'SMS from the garage where you left your car on Monday',
    transcript: [
      'Hi, your car is ready. Brake pads and front discs replaced as quoted: 280 total.',
      'We close at 6 today. You can pay on collection or ahead to this address to save time.',
      'Old parts are in the boot if you want to see them. - Ray, Northside Motors',
    ],
    ask: { amount: 280, to: '5Kg3JYmPzzvCT9VK38doRXejejB4MS8iW91pDm9Xc8Ug', purpose: 'Car repair' },
    clues: [
      {
        text: 'The total equals the written quote Ray gave you on Monday.',
        signal: 'legitimate',
      },
      {
        text: 'Paying ahead is optional: you can also pay when you collect the car.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: "You ring the garage's number from the quote sheet. Ray answers, confirms the address and says the car is parked out front.",
      signal: 'legitimate',
    },
    tells: [
      'Work you ordered, at the quoted price',
      'Paying in person is offered',
      'A named person you already met',
    ],
    lesson: 'When paying face to face is on offer, nobody is trying to rush you past a check.',
  },
  {
    id: 'import-duty-own-order',
    truth: 'legitimate',
    category: 'customs_duty',
    basis: "Real import duty on a parcel you ordered from abroad, shown in the courier's app",
    region: 'global',
    channel: 'email',
    from: 'Email from the courier named in your order confirmation',
    transcript: [
      'Subject: Duties and taxes due for shipment 1Z-7730-5521',
      'Your parcel from the keyboard shop has arrived in the country. Import duty and VAT of 41.00 are payable before delivery.',
      'Pay in the app or to the driver on delivery. The parcel is stored for 10 days.',
    ],
    ask: {
      amount: 41,
      to: '7zMhpvZkBvXwc7fUP47mw1V6WYQzUKkResDFhD7FPPuA',
      purpose: 'Import duty on an ordered parcel',
    },
    clues: [
      {
        text: 'You ordered a keyboard from abroad two weeks ago, and the shop warned that duty would be charged on arrival.',
        signal: 'legitimate',
      },
      {
        text: "The shipment number is the one in the shop's dispatch email.",
        signal: 'legitimate',
      },
      {
        text: 'Paying the driver at the door is offered as an alternative.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: "You enter the shipment number in the courier's app yourself. It shows the parcel, the same charge and the same payment address.",
      signal: 'legitimate',
    },
    tells: [
      'A parcel you ordered and expected to pay duty on',
      "The tracking number matches the shop's",
      'Payable in the official app or at the door',
    ],
    lesson:
      "The same words as a parcel scam, but every detail checks out on the carrier's own app.",
  },
  {
    id: 'gym-annual-renewal',
    truth: 'legitimate',
    category: 'subscription',
    basis: 'Gym membership renewal offered in person and followed up by message',
    region: 'india',
    channel: 'whatsapp',
    from: "WhatsApp from your gym's front desk number",
    transcript: [
      'Hi! Your annual membership ends on the 30th. As discussed at the desk yesterday, renewal is 9,200 for the year.',
      'You can pay here or at the counter any time this month.',
      'Membership card stays the same. See you at the 7 am batch!',
    ],
    ask: {
      amount: 110,
      to: '4PNF9DXkYkkZy8zD1J4KTLoje9LkGktsmiazjy6RWED6',
      purpose: 'Annual gym membership',
    },
    clues: [
      {
        text: 'You talked to the front desk about renewing yesterday, and the price is the one on the board at the entrance.',
        signal: 'legitimate',
      },
      {
        text: 'Your membership does end on the 30th, according to your card.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: 'The address in the message is the same one printed on the payment poster at the gym counter, which you photographed last month.',
      signal: 'legitimate',
    },
    tells: [
      'Follows a conversation you had in person',
      'The price is the posted price',
      'A month to pay, at the counter if you prefer',
    ],
    lesson: 'A request that continues something you started yourself is rarely a trap.',
  },
  {
    id: 'accountant-filing-fee',
    truth: 'legitimate',
    category: 'service_invoice',
    basis: "Accountant's invoice for a tax filing, as agreed in the engagement letter",
    region: 'global',
    channel: 'email',
    from: 'Email from your accountant, in the thread where you sent your documents',
    transcript: [
      "Subject: RE: Documents for this year's return",
      'Your return was filed this morning; the confirmation is attached. My invoice for the filing is also attached: 240, as per our engagement letter.',
      'Payment within 14 days is fine. Same details as last year.',
    ],
    ask: {
      amount: 240,
      to: '7gXjf5cq6wdnpKz5GXBv4y6WfHkyjPff6WrgujV3FXty',
      purpose: 'Tax filing fee',
    },
    clues: [
      {
        text: "The filing confirmation carries your tax ID and today's date.",
        signal: 'legitimate',
      },
      {
        text: 'The fee is the figure in the engagement letter you signed in January.',
        signal: 'legitimate',
      },
      {
        text: 'The address is identical to the one you paid last year.',
        signal: 'legitimate',
      },
    ],
    identity: {
      text: "The tax portal shows your return as received today, filed by your accountant's registered agent number.",
      signal: 'legitimate',
    },
    tells: [
      'Work you commissioned, with proof it was done',
      'The agreed fee',
      'The same payment details as last year',
      'Fourteen days to pay',
    ],
    lesson:
      'Agreed in advance, delivered, unchanged details: this is what paying for a service looks like.',
  },
];
