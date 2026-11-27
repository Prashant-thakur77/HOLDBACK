# References

External figures and prior work cited in this repository. Each figure is quoted with the scope
its source gives it. Our own measurements are not here: they live in `eval/results.json`.

## The problem, in official numbers

| Figure                                                                                    | Scope, as stated by the source                                                                                                                                                                                        | Source                                                                                                                         |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Rs 22,845.73 crore lost to cyber fraud in India in 2024                                   | Losses reported by citizens on the national cybercrime portal and the financial-fraud reporting system (I4C), calendar 2024. The 2023 figure was Rs 7,465.18 crore, which makes the rise about 206% (our arithmetic). | [Lok Sabha Unstarred Question 432, 2 Dec 2025](https://sansad.in/getFile/lsapps/loksabhaquestions/annex/186/AU432_SwJL90.pdf)  |
| More than Rs 11,158 crore saved across 32.80 lakh complaints                              | Cumulative since the reporting system launched in 2021, to 30 Jun 2026: money stopped before it was siphoned off after a prompt report.                                                                               | [Lok Sabha Unstarred Question 274, 21 Jul 2026](https://sansad.in/getFile/lsapps/loksabhaquestions/annex/188/AU274_O0xDcj.pdf) |
| About $17 billion stolen in crypto scams and fraud in 2025                                | An estimate; at least $14 billion was received on-chain. Impersonation scams grew "more than 1400%" over 2024, and the average scam payment rose from $782 to $2,764.                                                 | [Chainalysis, "Crypto Scams 2026", 13 Jan 2026](https://www.chainalysis.com/blog/crypto-scams-2026/)                           |
| $11.366 billion in cryptocurrency-related losses in 2025                                  | 181,565 complaints to the FBI's Internet Crime Complaint Center; of this, cryptocurrency investment fraud was $7.278 billion.                                                                                         | [FBI IC3 2025 Annual Report](https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf)                                      |
| More than 3,962 Skype IDs and 83,668 WhatsApp accounts blocked for "digital arrest" scams | Accounts blocked by I4C, as of March 2025.                                                                                                                                                                            | [Press Information Bureau, 12 Mar 2025](https://pib.gov.in/PressReleasePage.aspx?PRID=2110809)                                 |

## Reversibility already works where it exists

| Mechanism                                                    | What it does                                                                                                                                                                                                           | Source                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brazil: Pix Special Return Mechanism (MED)                   | In force since 16 Nov 2021. On well-founded suspicion of fraud, funds are blocked in the recipient's account and can be returned; the victim has up to 80 days to file. Return depends on the funds still being there. | [Resolução BCB 103, 8 Jun 2021](https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?tipo=Resolu%C3%A7%C3%A3o%20BCB&numero=103)                                                                                                                                            |
| UK: payment delay on suspicion of fraud                      | Since 30 Oct 2024 a payment provider may delay an outbound payment until the end of the fourth business day when it has reasonable grounds to suspect fraud or dishonesty.                                             | [Payment Services (Amendment) Regulations 2024, SI 2024/1013](https://www.legislation.gov.uk/uksi/2024/1013/made); [FCA FG24/6](https://www.fca.org.uk/publication/finalised-guidance/fg24-6.pdf)                                                                                  |
| UK: mandatory reimbursement of authorised push payment scams | Since 7 Oct 2024, up to £85,000 per claim. In 2025, £576.4 million was lost to such scams and 61% was reimbursed.                                                                                                      | [Payment Systems Regulator](https://www.psr.org.uk/news-and-updates/latest-news/news/groundbreaking-new-protections-for-victims-of-app-scams-start-today/); [UK Finance, 15 Jun 2026](https://www.ukfinance.org.uk/news-and-insight/press-release/fraud-report-2026-press-release) |
| UK: independent evaluation of the reimbursement policy       | Value of such scams about 21% lower after the policy, with some added payment friction.                                                                                                                                | [Frontier Economics for the PSR, 1 Jul 2026](https://www.frontier-economics.com/media/2ctd3jq2/app-fraud-evaluation-final-summary-report-26-06-26.pdf)                                                                                                                             |

HOLDBACK brings the same idea to a chain where transfers are final by default, and enforces
it in a program instead of a rulebook.

## Research this design draws on

1. Wang, K., Wang, Q., Boneh, D. "ERC-20R and ERC-721R: Reversible Transactions on Ethereum."
   arXiv:2208.00543, 2022. <https://arxiv.org/abs/2208.00543>
   Reversal inside a short dispute window after judges freeze the assets. HOLDBACK keeps the
   window but removes the judges and the frozen-balance bookkeeping by holding funds in a
   per-payment vault that only the sender can undo.
2. Tsuchiya, T., Dong, J.-D., Soska, K., Christin, N. "Blockchain Address Poisoning." USENIX
   Security 2025. <https://arxiv.org/abs/2501.16681>
   270 million poisoning attempts against 17 million victims on two chains. Motivates the
   look-alike check and the default window for never-seen recipients.
3. Li, Z., Jiang, Z., Fang, M., Chen, J., Wu, Z., Wu, J., Zhang, L., Zheng, Z. "SolPhishHunter:
   Towards Detecting and Understanding Phishing on Solana." arXiv:2505.04094, 2025.
   <https://arxiv.org/abs/2505.04094>
   Solana-specific phishing transactions and their on-chain patterns.
4. He, B., Hu, Y., Chen, Z., Chen, Y., Yu, T., Chang, R., Wu, L., Zhou, Y. "Unmasking the
   Shadow Economy: A Deep Dive into Drainer-as-a-Service Phishing on Ethereum." ACM IMC 2025.
   <https://doi.org/10.1145/3730567.3764476>
   The affiliate economy behind wallet drainers; informs the sweep and drain heuristics.
5. Wu, J., Yuan, Q., Lin, D., You, W., Chen, W., Chen, C., Zheng, Z. "Who Are the Phishers?
   Phishing Scam Detection on Ethereum via Network Embedding." IEEE Transactions on Systems,
   Man, and Cybernetics: Systems, 2020. <https://doi.org/10.1109/TSMC.2020.3016821>
   Amount- and time-aware transaction-graph features separate phishing addresses.
6. Griffin, J. M., Mei, K. "How Do Crypto Flows Finance Slavery? The Economics of Pig
   Butchering." Working paper, SSRN 4742235, 2024.
   <https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4742235>
   Follows victim funds into exchange deposit accounts; shows how quickly funds move on.
7. Oak, R., Shafiq, Z. "'Hello, is this Anna?': Unpacking the Lifecycle of Pig-Butchering
   Scams." SOUPS 2025. <https://www.usenix.org/conference/soups2025/presentation/oak-butchering>
   Victim interviews showing staged trust-building and repeated pressure to pay.
8. Stajano, F., Wilson, P. "Understanding Scam Victims: Seven Principles for Systems
   Security." Communications of the ACM 54(3), 2011. <https://doi.org/10.1145/1897852.1897872>
   Scams reduce to a few principles, among them social compliance and time pressure. The
   context collector looks for exactly these cues, and the window removes the time pressure.
9. Egelman, S., Cranor, L. F., Hong, J. "You've Been Warned: An Empirical Study of the
   Effectiveness of Web Browser Phishing Warnings." CHI 2008.
   <https://doi.org/10.1145/1357054.1357219>
   Active warnings were heeded far more often than passive ones.
10. Akhawe, D., Felt, A. P. "Alice in Warningland: A Large-Scale Field Study of Browser
    Security Warning Effectiveness." USENIX Security 2013.
    <https://www.usenix.org/conference/usenixsecurity13/technical-sessions/presentation/akhawe>
    Warning design changes how often people click through. HOLDBACK does not rely on the
    warning being heeded at the moment of payment: the undo remains available afterwards.
11. Tu, H., Doupé, A., Zhao, Z., Ahn, G.-J. "Users Really Do Answer Telephone Scams." USENIX
    Security 2019. <https://www.usenix.org/conference/usenixsecurity19/presentation/tu>
    Phone scams work on a large share of people, more so with spoofed caller identity.
12. Hasegawa, A. A., Yamashita, N., Akiyama, M., Mori, T. "Why They Ignore English Emails: The
    Challenges of Non-Native Speakers in Identifying Phishing Emails." SOUPS 2021.
    <https://www.usenix.org/conference/soups2021/presentation/hasegawa>
    Non-native speakers inspect English messages less carefully than messages in their own
    language, which is why warnings here are written and spoken in the user's language.
13. U.S. Department of the Treasury, OFAC. "Sanctions Compliance Guidance for the Virtual
    Currency Industry." October 2021. <https://ofac.treasury.gov/media/913571/download?inline>

## Specifications implemented

- Solana Actions and Blinks: <https://solana.com/docs/advanced/actions>
- Mobile Wallet Adapter 2.0: <https://solana-mobile.github.io/mobile-wallet-adapter/spec/spec.html>
- Token-2022 (token extensions): <https://www.solana-program.com/docs/token-2022>
- Sign In With Solana: <https://github.com/phantom/sign-in-with-solana>
- Model Context Protocol: <https://modelcontextprotocol.io>
