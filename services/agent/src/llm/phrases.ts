/**
 * The words of the template explanation, per language. One clause per
 * scored rule (it completes "The strongest sign: ..."), plus the sentences
 * around it. Written to be read aloud: short, calm, no jargon. None of it
 * calls a payment "safe" and none of it tells anyone to send money.
 */
import type { Lang } from '@holdback/sdk';

type Phrases = Record<Lang, string>;

/** Rule id -> the clause that names it. Rules that add no risk have no clause. */
export const RULE_PHRASES: Record<string, Phrases> = {
  'onchain_reputation.onchain_flags': {
    en: 'other HOLDBACK users have flagged this address',
    hi: 'दूसरे HOLDBACK उपयोगकर्ताओं ने इस पते को फ़्लैग किया है',
    es: 'otros usuarios de HOLDBACK han denunciado esta dirección',
    pt: 'outros usuários do HOLDBACK denunciaram este endereço',
  },
  'onchain_reputation.reclaimed_majority': {
    en: 'most people who paid this address took their money back',
    hi: 'इस पते को भुगतान करने वाले ज़्यादातर लोगों ने अपना पैसा वापस ले लिया',
    es: 'la mayoría de quienes pagaron a esta dirección recuperaron su dinero',
    pt: 'a maioria das pessoas que pagaram a este endereço pegou o dinheiro de volta',
  },
  'onchain_reputation.reclaimed_often': {
    en: 'several people who paid this address took their money back',
    hi: 'इस पते को भुगतान करने वाले कई लोगों ने अपना पैसा वापस ले लिया',
    es: 'varias personas que pagaron a esta dirección recuperaron su dinero',
    pt: 'várias pessoas que pagaram a este endereço pegaram o dinheiro de volta',
  },
  'onchain_reputation.offchain_flags': {
    en: 'this address has been reported to HOLDBACK',
    hi: 'इस पते की HOLDBACK को शिकायत की गई है',
    es: 'esta dirección fue denunciada ante HOLDBACK',
    pt: 'este endereço foi denunciado ao HOLDBACK',
  },
  'helius.wallet_new_1d': {
    en: 'this wallet was created less than a day ago',
    hi: 'यह वॉलेट एक दिन से भी कम पुराना है',
    es: 'esta billetera se creó hace menos de un día',
    pt: 'esta carteira foi criada há menos de um dia',
  },
  'helius.wallet_new_7d': {
    en: 'this wallet is less than a week old',
    hi: 'यह वॉलेट एक हफ़्ते से भी कम पुराना है',
    es: 'esta billetera tiene menos de una semana',
    pt: 'esta carteira tem menos de uma semana',
  },
  'helius.no_history': {
    en: 'this address has never been used before',
    hi: 'यह पता पहले कभी इस्तेमाल नहीं हुआ',
    es: 'esta dirección nunca se ha usado antes',
    pt: 'este endereço nunca foi usado antes',
  },
  'helius.sweep_pattern': {
    en: 'this wallet collects money from many people and passes it straight on',
    hi: 'यह वॉलेट कई लोगों से पैसा लेकर तुरंत आगे भेज देता है',
    es: 'esta billetera recibe dinero de muchas personas y lo reenvía enseguida',
    pt: 'esta carteira recebe dinheiro de muitas pessoas e repassa logo em seguida',
  },
  'helius.instant_drain': {
    en: 'money sent to this wallet is moved out within minutes',
    hi: 'इस वॉलेट में आया पैसा कुछ ही मिनटों में निकाल लिया जाता है',
    es: 'el dinero que llega a esta billetera sale en pocos minutos',
    pt: 'o dinheiro que chega a esta carteira sai em poucos minutos',
  },
  'helius.dust_sprayer': {
    en: 'this wallet sends tiny amounts to many strangers, a common trick',
    hi: 'यह वॉलेट कई अनजान लोगों को बहुत छोटी रकम भेजता है, जो एक आम चाल है',
    es: 'esta billetera envía cantidades mínimas a muchos desconocidos, un truco habitual',
    pt: 'esta carteira envia valores mínimos a muitos desconhecidos, um truque comum',
  },
  'helius.burst_activity': {
    en: 'this new wallet is unusually busy',
    hi: 'यह नया वॉलेट असामान्य रूप से सक्रिय है',
    es: 'esta billetera nueva tiene una actividad inusual',
    pt: 'esta carteira nova tem uma atividade incomum',
  },
  'helius.known_bad_counterparty': {
    en: 'this wallet has dealt with an address on a scam list',
    hi: 'इस वॉलेट का लेन-देन धोखाधड़ी सूची में दर्ज एक पते से हुआ है',
    es: 'esta billetera ha operado con una dirección que figura en una lista de estafas',
    pt: 'esta carteira negociou com um endereço que está em uma lista de golpes',
  },
  'helius.funded_by_known_bad': {
    en: 'this wallet was first funded by an address on a scam list',
    hi: 'इस वॉलेट में पहला पैसा धोखाधड़ी सूची में दर्ज एक पते से आया था',
    es: 'esta billetera recibió sus primeros fondos de una dirección que figura en una lista de estafas',
    pt: 'esta carteira recebeu os primeiros fundos de um endereço que está em uma lista de golpes',
  },
  'blocklist.ofac_sanctioned': {
    en: 'this address is on the OFAC sanctions list',
    hi: 'यह पता OFAC की प्रतिबंध सूची में है',
    es: 'esta dirección está en la lista de sanciones de la OFAC',
    pt: 'este endereço está na lista de sanções da OFAC',
  },
  'blocklist.scam_list_address': {
    en: 'this address is on a published scam list',
    hi: 'यह पता एक प्रकाशित धोखाधड़ी सूची में है',
    es: 'esta dirección está en una lista pública de estafas',
    pt: 'este endereço está em uma lista pública de golpes',
  },
  'blocklist.phishing_domain_in_context': {
    en: 'the website you mentioned is on a phishing list',
    hi: 'आपने जिस वेबसाइट का ज़िक्र किया वह फ़िशिंग सूची में है',
    es: 'el sitio web que mencionaste está en una lista de phishing',
    pt: 'o site que você mencionou está em uma lista de phishing',
  },
  'chainabuse.confirmed_reports': {
    en: 'there are scam reports about this address on Chainabuse',
    hi: 'Chainabuse पर इस पते के ख़िलाफ़ धोखाधड़ी की रिपोर्टें हैं',
    es: 'hay denuncias de estafa contra esta dirección en Chainabuse',
    pt: 'há denúncias de golpe contra este endereço no Chainabuse',
  },
  'chainabuse.unconfirmed_reports': {
    en: 'someone has reported this address on Chainabuse',
    hi: 'किसी ने Chainabuse पर इस पते की रिपोर्ट की है',
    es: 'alguien denunció esta dirección en Chainabuse',
    pt: 'alguém denunciou este endereço no Chainabuse',
  },
  'web_reports.scam_report': {
    en: 'web pages describe this exact address as a scam',
    hi: 'वेब पर इसी पते को धोखाधड़ी बताया गया है',
    es: 'hay páginas web que describen esta misma dirección como una estafa',
    pt: 'há páginas na web que descrevem este mesmo endereço como um golpe',
  },
  'web_reports.recipient_is_token_mint': {
    en: "this address belongs to a token, not to a person's wallet",
    hi: 'यह पता एक टोकन का है, किसी व्यक्ति के वॉलेट का नहीं',
    es: 'esta dirección es de un token, no la billetera de una persona',
    pt: 'este endereço é de um token, não a carteira de uma pessoa',
  },
  'web_reports.recipient_is_program': {
    en: "this address belongs to a program, not to a person's wallet",
    hi: 'यह पता एक प्रोग्राम का है, किसी व्यक्ति के वॉलेट का नहीं',
    es: 'esta dirección es de un programa, no la billetera de una persona',
    pt: 'este endereço é de um programa, não a carteira de uma pessoa',
  },
  'sns.lookalike_name': {
    en: 'its name imitates a well-known name',
    hi: 'इसका नाम एक जाने-माने नाम की नकल करता है',
    es: 'su nombre imita un nombre conocido',
    pt: 'o nome dele imita um nome conhecido',
  },
  'context.remote_access': {
    en: 'someone asked you to install a screen-sharing or remote-access app',
    hi: 'किसी ने आपसे स्क्रीन शेयर या रिमोट एक्सेस ऐप डालने को कहा है',
    es: 'alguien te pidió instalar una aplicación de acceso remoto o para compartir pantalla',
    pt: 'alguém pediu que você instalasse um aplicativo de acesso remoto ou de compartilhamento de tela',
  },
  'context.secret_request': {
    en: 'someone asked for a code, PIN or secret phrase, which no real service ever needs',
    hi: 'किसी ने आपसे कोड, पिन या गुप्त शब्द माँगे हैं, जो कोई असली सेवा कभी नहीं माँगती',
    es: 'alguien te pidió un código, PIN o frase secreta, algo que ningún servicio real necesita',
    pt: 'alguém pediu um código, PIN ou frase secreta, algo que nenhum serviço de verdade precisa',
  },
  'context.authority': {
    en: 'someone claiming to be police, an official or support staff is asking for this payment',
    hi: 'खुद को पुलिस, अधिकारी या सपोर्ट बताने वाला कोई व्यक्ति यह भुगतान माँग रहा है',
    es: 'alguien que dice ser policía, funcionario o de soporte te pide este pago',
    pt: 'alguém que diz ser da polícia, de um órgão oficial ou do suporte está pedindo este pagamento',
  },
  'context.verification_transfer': {
    en: 'you were told this is a verification or test payment, which real services do not ask for',
    hi: 'आपसे कहा गया है कि यह वेरिफिकेशन या टेस्ट भुगतान है, जो असली सेवाएँ नहीं माँगतीं',
    es: 'te dijeron que es un pago de verificación o de prueba, algo que los servicios reales no piden',
    pt: 'disseram que este é um pagamento de verificação ou de teste, algo que serviços de verdade não pedem',
  },
  'context.advance_fee': {
    en: 'you are asked to pay a fee first to receive money or a prize',
    hi: 'पैसा या इनाम पाने के लिए आपसे पहले फ़ीस माँगी जा रही है',
    es: 'te piden pagar una tarifa antes de recibir dinero o un premio',
    pt: 'pedem que você pague uma taxa antes de receber dinheiro ou um prêmio',
  },
  'context.guaranteed_returns': {
    en: 'you were promised guaranteed profits, which nobody can promise',
    hi: 'आपसे पक्के मुनाफ़े का वादा किया गया है, जो कोई नहीं कर सकता',
    es: 'te prometieron ganancias garantizadas, algo que nadie puede prometer',
    pt: 'prometeram lucros garantidos, algo que ninguém pode prometer',
  },
  'context.account_unlock': {
    en: 'you were told to pay to unlock an account',
    hi: 'आपसे खाता खुलवाने के लिए भुगतान करने को कहा गया है',
    es: 'te dijeron que pagues para desbloquear una cuenta',
    pt: 'disseram para você pagar para desbloquear uma conta',
  },
  'context.gift_cards': {
    en: 'gift cards or voucher codes are being asked for',
    hi: 'आपसे गिफ़्ट कार्ड या वाउचर कोड माँगे जा रहे हैं',
    es: 'te piden tarjetas de regalo o códigos de vales',
    pt: 'estão pedindo cartões-presente ou códigos de vale',
  },
  'context.secrecy': {
    en: 'you were told to keep this payment secret',
    hi: 'आपसे यह भुगतान गुप्त रखने को कहा गया है',
    es: 'te pidieron mantener este pago en secreto',
    pt: 'pediram que você mantivesse este pagamento em segredo',
  },
  'context.urgency': {
    en: 'you are being rushed',
    hi: 'आप पर जल्दी करने का दबाव डाला जा रहा है',
    es: 'te están metiendo prisa',
    pt: 'estão apressando você',
  },
  'baseline.prior_reclaim_from_recipient': {
    en: 'you took back a payment to this recipient before',
    hi: 'आप पहले भी इस व्यक्ति को भेजा पैसा वापस ले चुके हैं',
    es: 'ya recuperaste antes un pago a este destinatario',
    pt: 'você já pegou de volta um pagamento a este destinatário',
  },
  'baseline.amount_far_above_typical': {
    en: 'this is far more than you usually pay',
    hi: 'यह रकम आपके आम भुगतान से बहुत ज़्यादा है',
    es: 'es mucho más de lo que sueles pagar',
    pt: 'é muito mais do que você costuma pagar',
  },
  'baseline.amount_above_typical': {
    en: 'this is more than you usually pay',
    hi: 'यह रकम आपके आम भुगतान से ज़्यादा है',
    es: 'es más de lo que sueles pagar',
    pt: 'é mais do que você costuma pagar',
  },
  'baseline.unusual_hour': {
    en: 'you rarely pay at this time of day',
    hi: 'आप इस समय पर बहुत कम भुगतान करते हैं',
    es: 'rara vez pagas a esta hora',
    pt: 'você raramente paga a esta hora',
  },
};

export type Opener =
  | 'sanctioned'
  | 'flagged'
  | 'suspicious'
  | 'minor'
  | 'clean'
  | 'unchecked'
  | 'trusted_account'
  | 'trusted_history';

export const OPENERS: Record<Opener, Phrases> = {
  sanctioned: {
    en: 'Please stop for a moment: this address is on a government sanctions list.',
    hi: 'कृपया एक पल रुकिए: यह पता सरकारी प्रतिबंध सूची में है।',
    es: 'Por favor, detente un momento: esta dirección está en una lista de sanciones del gobierno.',
    pt: 'Por favor, pare um momento: este endereço está em uma lista de sanções do governo.',
  },
  flagged: {
    en: 'I found serious warning signs about this recipient.',
    hi: 'मुझे इस प्राप्तकर्ता के बारे में गंभीर चेतावनी संकेत मिले हैं।',
    es: 'Encontré señales de alerta graves sobre este destinatario.',
    pt: 'Encontrei sinais de alerta graves sobre este destinatário.',
  },
  suspicious: {
    en: 'I found warning signs about this recipient.',
    hi: 'मुझे इस प्राप्तकर्ता के बारे में चेतावनी संकेत मिले हैं।',
    es: 'Encontré señales de alerta sobre este destinatario.',
    pt: 'Encontrei sinais de alerta sobre este destinatário.',
  },
  minor: {
    en: 'There is one thing you should know about this recipient.',
    hi: 'इस प्राप्तकर्ता के बारे में एक बात आपको जाननी चाहिए।',
    es: 'Hay algo que debes saber sobre este destinatario.',
    pt: 'Há algo que você precisa saber sobre este destinatário.',
  },
  clean: {
    en: 'No warning signs found for this recipient, but it is new to you.',
    hi: 'इस प्राप्तकर्ता के बारे में कोई चेतावनी संकेत नहीं मिला, लेकिन यह आपके लिए नया है।',
    es: 'No se encontraron señales de alerta sobre este destinatario, pero es nuevo para ti.',
    pt: 'Nenhum sinal de alerta foi encontrado sobre este destinatário, mas ele é novo para você.',
  },
  unchecked: {
    en: 'I could not complete all my checks on this recipient.',
    hi: 'मैं इस प्राप्तकर्ता की सारी जाँच पूरी नहीं कर पाया।',
    es: 'No pude completar todas mis comprobaciones sobre este destinatario.',
    pt: 'Não consegui concluir todas as minhas verificações sobre este destinatário.',
  },
  trusted_account: {
    en: 'You marked this recipient as trusted.',
    hi: 'आपने इस प्राप्तकर्ता को भरोसेमंद चुना है।',
    es: 'Marcaste a este destinatario como de confianza.',
    pt: 'Você marcou este destinatário como de confiança.',
  },
  trusted_history: {
    en: 'You have paid this recipient before without any problem, and no warning signs were found.',
    hi: 'आप इस प्राप्तकर्ता को पहले भी बिना किसी परेशानी के भुगतान कर चुके हैं, और कोई चेतावनी संकेत नहीं मिला।',
    es: 'Ya le has pagado a este destinatario sin problemas, y no se encontraron señales de alerta.',
    pt: 'Você já pagou a este destinatário sem problemas, e nenhum sinal de alerta foi encontrado.',
  },
};

/** `{phrase}` is replaced by a clause from `RULE_PHRASES`. */
export const STRONGEST: Phrases = {
  en: 'The strongest sign: {phrase}.',
  hi: 'सबसे बड़ा संकेत: {phrase}।',
  es: 'La señal más fuerte: {phrase}.',
  pt: 'O sinal mais forte: {phrase}.',
};

/** `{duration}` is replaced by the undo window in words. */
export const HELD: Phrases = {
  en: 'Your money is held for {duration}, and you can undo the payment at any time before then.',
  hi: 'आपका पैसा {duration} तक रोका गया है, और उससे पहले आप कभी भी भुगतान वापस ले सकते हैं।',
  es: 'Tu dinero queda retenido durante {duration}, y puedes deshacer el pago en cualquier momento antes de eso.',
  pt: 'Seu dinheiro fica retido por {duration}, e você pode desfazer o pagamento a qualquer momento antes disso.',
};

export const NOT_HELD: Phrases = {
  en: 'The payment is not held and arrives right away.',
  hi: 'यह भुगतान रोका नहीं जाएगा और तुरंत पहुँच जाएगा।',
  es: 'El pago no se retiene y llega de inmediato.',
  pt: 'O pagamento não fica retido e chega na hora.',
};

export const ABOUT_A_MINUTE: Phrases = {
  en: 'The payment completes in about a minute.',
  hi: 'यह भुगतान लगभग एक मिनट में पूरा हो जाएगा।',
  es: 'El pago se completa en aproximadamente un minuto.',
  pt: 'O pagamento é concluído em cerca de um minuto.',
};

const UNITS: Record<
  Lang,
  { minute: [string, string]; hour: [string, string]; day: [string, string] }
> = {
  en: { minute: ['minute', 'minutes'], hour: ['hour', 'hours'], day: ['day', 'days'] },
  hi: { minute: ['मिनट', 'मिनट'], hour: ['घंटे', 'घंटे'], day: ['दिन', 'दिन'] },
  es: { minute: ['minuto', 'minutos'], hour: ['hora', 'horas'], day: ['día', 'días'] },
  pt: { minute: ['minuto', 'minutos'], hour: ['hora', 'horas'], day: ['dia', 'dias'] },
};

/** The window in spoken words: whole days from two days up, else hours, else minutes. */
export function spokenDuration(seconds: number, lang: Lang): string {
  const units = UNITS[lang];
  const say = (count: number, [one, many]: [string, string]) =>
    `${count} ${count === 1 ? one : many}`;
  if (seconds >= 2 * 86_400 && seconds % 86_400 === 0) return say(seconds / 86_400, units.day);
  if (seconds >= 3_600) return say(Math.round(seconds / 3_600), units.hour);
  return say(Math.max(1, Math.ceil(seconds / 60)), units.minute);
}
