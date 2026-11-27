/** Scams that use a relationship: a partner, a relative, a friend or a boss. */
import type { Scenario } from '../types';
import { ADVISORY } from './sources';

export const RELATIONSHIP_SCAMS: Scenario[] = [
  {
    id: 'romance-offshore-engineer',
    truth: 'scam',
    category: 'romance',
    basis:
      'Romance scam: a partner working abroad who has never been seen needs money to come home',
    sources: [ADVISORY.romance],
    region: 'global',
    channel: 'whatsapp',
    from: 'WhatsApp from Daniel, whom you met on a dating app three months ago',
    transcript: [
      'Daniel: My love, the contract on the platform is finished and I can finally fly to you.',
      'Daniel: The company holds my pay until I am on shore, and the agent needs the exit permit fee before he books the helicopter.',
      'Daniel: I hate to ask. I will give it all back the day I land. Please do not tell your sister, she will not understand us.',
    ],
    ask: {
      amount: 700,
      to: 'CLr1c41WGL1S9JbPo1G5RCRwBHkZRiYJgSkwyVRa36xi',
      purpose: 'Exit permit fee so a partner can travel',
    },
    clues: [
      {
        text: 'Every planned video call has failed because of "the rig connection". You have only seen photos.',
        signal: 'scam',
      },
      {
        text: 'This is the third request. The first two were for a phone repair and a medical bill.',
        signal: 'scam',
      },
      {
        text: 'A reverse image search finds his photos on the profile of a doctor in another country with a different name.',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'The company he named replies by email: nobody with that name works for them, and staff never pay for transport.',
      signal: 'scam',
    },
    tells: [
      'Never met, never on video',
      'Money needed to travel to you',
      'Asks you to keep it from family',
      'Repeated requests with new reasons',
    ],
    lesson:
      'Do not send money to someone you have not met in person, however long you have talked.',
  },
  {
    id: 'romance-hospital-deposit',
    truth: 'scam',
    category: 'romance',
    basis: 'Romance scam: a sudden hospital bill for an online partner, payable only in crypto',
    sources: [ADVISORY.romance],
    region: 'global',
    channel: 'dm',
    from: 'DM from Sofia, an online contact of five weeks',
    transcript: [
      'Sofia: I am writing from the hospital. My mother collapsed this morning.',
      'Sofia: They will not start the surgery without a deposit, and my bank card is blocked abroad.',
      'Sofia: The hospital cashier takes USDC. I am sending you the address. You are the only one I trust.',
    ],
    ask: {
      amount: 450,
      to: '94UcfU5tiGpyAnTT43JUet2DHjd9rpmAZg7czZXrev4w',
      purpose: "Hospital deposit for a partner's mother",
    },
    clues: [
      {
        text: 'You ask which hospital it is so you can call. She says phones are not allowed in the ward and changes the subject.',
        signal: 'scam',
      },
      {
        text: 'The address is a personal wallet. Hospitals bill through their own accounts.',
        signal: 'scam',
      },
      {
        text: 'Last week she mentioned her mother lives in a different city from where she now says the hospital is.',
        signal: 'unclear',
      },
    ],
    identity: {
      text: 'You call the hospital she finally names. They have no patient under that name and do not accept cryptocurrency.',
      signal: 'scam',
    },
    tells: [
      'A sudden emergency from someone met online',
      'Only crypto is accepted',
      'She avoids any way to verify',
      '"You are the only one I trust"',
    ],
    lesson: 'An emergency you cannot verify, from someone you have never met, is a script.',
  },
  {
    id: 'child-new-number',
    truth: 'scam',
    category: 'family_emergency',
    basis:
      '"Hi mum, this is my new number": a message from an unknown number posing as your child with an urgent bill',
    sources: [ADVISORY.fakeEmergency],
    region: 'latam',
    channel: 'whatsapp',
    from: 'WhatsApp from an unknown number with no profile photo',
    transcript: [
      'Hola mamá, se me rompió el teléfono. Este es mi número nuevo. (Hi mum, my phone broke. This is my new number.)',
      'Tengo que pagar una cuenta hoy y la app del banco no funciona en este teléfono.',
      '¿Me ayudas? Te lo devuelvo mañana. Te paso la dirección.',
    ],
    ask: {
      amount: 380,
      to: 'AJqhvn78SvMHNHWtFU1eQWYZy3mvWsQL7oiLaf3W4xjo',
      purpose: 'Urgent bill for your child',
    },
    clues: [
      {
        text: 'You ask "which of my children are you?" The reply is "the oldest, mamá, who else".',
        signal: 'unclear',
      },
      {
        text: 'You ask for a voice note. The reply says the microphone is also broken.',
        signal: 'scam',
      },
      {
        text: 'The address belongs to "a friend who will pay the bill for me".',
        signal: 'scam',
      },
    ],
    identity: {
      text: "You call your child's old number. They answer at once: the phone is fine and they sent you nothing.",
      signal: 'scam',
    },
    tells: [
      'A new number you cannot confirm',
      'No voice, no call',
      'Money goes to a third person',
      'Needed today',
    ],
    lesson:
      'When a relative writes from a new number, call the old one before you do anything else.',
  },
  {
    id: 'nephew-bail-lawyer',
    truth: 'scam',
    category: 'family_emergency',
    basis:
      'Family emergency call: a crying relative, an accident, and a lawyer who needs bail money in secret',
    sources: [ADVISORY.fakeEmergency],
    region: 'global',
    channel: 'call',
    from: 'Call from a withheld number at 6:40 in the morning',
    transcript: [
      "Voice (crying): It's me. I was in an accident, they say it was my fault. Please don't tell mom and dad.",
      'Second voice: This is his public defender. Your nephew can be released this morning if bail is posted before the hearing at nine.',
      'Second voice: The court kiosk accepts digital dollars. I will read you the address. Stay on the line while you send it.',
    ],
    ask: {
      amount: 1000,
      to: 'APbnTaggRt2RQuJL3MNehG854DQUDLdVXvd9iwovAiWM',
      purpose: 'Bail for a relative before a morning hearing',
    },
    clues: [
      {
        text: "The crying voice never said a name. You said your nephew's name first.",
        signal: 'scam',
      },
      {
        text: 'You ask the lawyer which court and which police station. He says there is no time and the hearing is "sealed".',
        signal: 'scam',
      },
      {
        text: 'You ask your nephew what his dog is called. The line goes quiet, then the lawyer takes the phone back.',
        signal: 'scam',
      },
    ],
    identity: {
      text: "You hang up and call your nephew's own phone. He is at home asleep and has not been in any accident.",
      signal: 'scam',
    },
    tells: [
      'A request to keep it secret from the family',
      'You supplied the name, not the caller',
      'Bail paid to a wallet address',
      'You are kept on the line while paying',
    ],
    lesson:
      'Hang up and call the person on the number you already have. A real emergency survives a call back.',
  },
  {
    id: 'boss-urgent-vendor',
    truth: 'scam',
    category: 'boss_impersonation',
    basis:
      'Executive impersonation: the "CEO" asks an employee for an urgent, confidential payment',
    region: 'global',
    channel: 'email',
    from: "Email from your managing director's name, sent from a personal mail address",
    transcript: [
      'Subject: quick favour - confidential',
      'I am in a board session and cannot talk. We are closing an acquisition and the advisor must be paid a retainer in the next hour.',
      'Use the company wallet and send it to the address below. Keep this between us until the announcement. I am counting on you.',
    ],
    ask: {
      amount: 950,
      to: 'Aat3ckbxSa86UGEw31DNA6MZeNp7RNSyA1dMB5rYuSZg',
      purpose: 'Confidential retainer for an acquisition advisor',
    },
    clues: [
      {
        text: 'The email comes from a free webmail address, not the company domain.',
        signal: 'scam',
      },
      {
        text: 'It skips the two-person approval that every company payment needs.',
        signal: 'scam',
      },
      {
        text: 'You reply asking for a call. The answer comes in seconds: "No calls. Just do it, I will explain later."',
        signal: 'scam',
      },
    ],
    identity: {
      text: 'You message the director on the company chat. She replies from her desk: she sent nothing and there is no acquisition.',
      signal: 'scam',
    },
    tells: [
      'Urgent and confidential at once',
      'A personal address instead of the company one',
      'Bypasses the normal approval',
      'Refuses a call',
    ],
    lesson:
      'A payment request that must skip the process and stay secret is checked through the process, out loud.',
  },
  {
    id: 'friend-account-taken-over',
    truth: 'scam',
    category: 'friend_impersonation',
    basis:
      "Hijacked social account: a real friend's profile asks for a quick loan sent to someone else's address",
    region: 'india',
    channel: 'dm',
    from: "DM from your college friend Karan's real profile",
    transcript: [
      "Karan: Bhai urgent hai, kal lauta dunga. (Brother, it's urgent, I will return it tomorrow.)",
      'Karan: My payment app limit is over for today and I have to pay someone right now.',
      "Karan: Send to this address, it is my cousin's. Do not call, I am in a meeting.",
    ],
    ask: {
      amount: 120,
      to: 'DgRYSY8R3unQAQbmjtXZ8Us8Yj9JZiuCXYSVYhXAhPny',
      purpose: 'One-day loan to a friend',
    },
    clues: [
      {
        text: 'Karan usually writes in full Hindi sentences and has never asked you for money.',
        signal: 'unclear',
      },
      {
        text: 'Two mutual friends received the same message in the last ten minutes.',
        signal: 'scam',
      },
      {
        text: 'You ask what you two ate at the canteen every Friday. The reply is "bro no time for this, send fast".',
        signal: 'scam',
      },
    ],
    identity: {
      text: "You call Karan's phone. He says his account was taken over this morning and he is trying to get it back.",
      signal: 'scam',
    },
    tells: [
      "Money goes to a third person's address",
      '"Do not call"',
      'The same message went to several friends',
      'Cannot answer a personal question',
    ],
    lesson: 'A familiar profile is not a familiar person. Call before you lend.',
  },
];
