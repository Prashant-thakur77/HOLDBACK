/**
 * External figures shown on the site. Each one is copied from
 * `docs/REFERENCES.md` with the scope its source gives it; nothing here is
 * our own measurement (those come from the eval data).
 */
export interface ExternalFigure {
  figure: string;
  claim: string;
  scope: string;
  source: string;
  url: string;
}

export const PROBLEM_FIGURES: ExternalFigure[] = [
  {
    figure: 'Rs 22,845.73 crore',
    claim: 'lost to cyber fraud in India in 2024',
    scope:
      'Losses reported by citizens on the national cybercrime portal and the financial-fraud reporting system, calendar 2024. The 2023 figure was Rs 7,465.18 crore, a rise of about 206% (our arithmetic).',
    source: 'Lok Sabha Unstarred Question 432, 2 Dec 2025',
    url: 'https://sansad.in/getFile/lsapps/loksabhaquestions/annex/186/AU432_SwJL90.pdf',
  },
  {
    figure: 'About $17 billion',
    claim: 'stolen in crypto scams and fraud in 2025',
    scope:
      'An estimate; at least $14 billion was received on-chain. The average scam payment rose from $782 to $2,764.',
    source: 'Chainalysis, "Crypto Scams 2026", 13 Jan 2026',
    url: 'https://www.chainalysis.com/blog/crypto-scams-2026/',
  },
  {
    figure: '$11.366 billion',
    claim: 'in cryptocurrency-related losses reported to the FBI in 2025',
    scope:
      '181,565 complaints to the Internet Crime Complaint Center; of this, cryptocurrency investment fraud was $7.278 billion.',
    source: 'FBI IC3 2025 Annual Report',
    url: 'https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf',
  },
  {
    figure: 'More than Rs 11,158 crore',
    claim: 'saved in India by stopping transfers after a prompt report',
    scope:
      'Cumulative since the reporting system launched in 2021, to 30 Jun 2026, across 32.80 lakh complaints: money stopped before it was siphoned off.',
    source: 'Lok Sabha Unstarred Question 274, 21 Jul 2026',
    url: 'https://sansad.in/getFile/lsapps/loksabhaquestions/annex/188/AU274_O0xDcj.pdf',
  },
];

export interface Precedent {
  place: string;
  what: string;
  source: string;
  url: string;
}

/** Places where a payment can already be stopped or returned. */
export const PRECEDENTS: Precedent[] = [
  {
    place: 'Brazil',
    what: 'The Pix Special Return Mechanism, in force since 16 Nov 2021. On well-founded suspicion of fraud, funds are blocked in the recipient’s account and can be returned; the victim has up to 80 days to file. Return depends on the funds still being there.',
    source: 'Resolução BCB 103, 8 Jun 2021',
    url: 'https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?tipo=Resolu%C3%A7%C3%A3o%20BCB&numero=103',
  },
  {
    place: 'United Kingdom',
    what: 'Since 30 Oct 2024 a payment provider may delay an outbound payment until the end of the fourth business day when it has reasonable grounds to suspect fraud or dishonesty.',
    source: 'Payment Services (Amendment) Regulations 2024, SI 2024/1013',
    url: 'https://www.legislation.gov.uk/uksi/2024/1013/made',
  },
  {
    place: 'India',
    what: 'The national reporting system stops fraudulent transfers after a prompt report: more than Rs 11,158 crore saved across 32.80 lakh complaints from 2021 to 30 Jun 2026.',
    source: 'Lok Sabha Unstarred Question 274, 21 Jul 2026',
    url: 'https://sansad.in/getFile/lsapps/loksabhaquestions/annex/188/AU274_O0xDcj.pdf',
  },
];
