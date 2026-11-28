/**
 * Interface copy in the four product languages.
 *
 * English is the language of the whole site. The headline, the primary
 * actions and the warning copy exist in Hindi, Spanish and Portuguese as
 * well, because those are the lines a frightened sender has to understand at
 * once. Long-form pages stay in English.
 *
 * Voice rules (from the product): verdict first, hedged, short. The word
 * "safe" is never promised; a clean result reads "no warning signs found".
 */
import type { Lang, TierName } from '@holdback/sdk';

/** The product languages, in the order the switch shows them. */
export const SITE_LANGS: readonly Lang[] = ['en', 'hi', 'es', 'pt'];

export const LANG_NAMES: Record<Lang, string> = {
  en: 'English',
  hi: 'हिन्दी',
  es: 'Español',
  pt: 'Português',
};

const en = {
  'nav.home': 'Home',
  'nav.how': 'How it works',
  'nav.evidence': 'Evidence',
  'nav.results': 'Results',
  'nav.integrations': 'Integrations',
  'nav.dojo': 'Scam Dojo',
  'nav.docs': 'Docs',
  'nav.proof': 'Proof',
  'nav.try': 'Try it',
  'nav.contents': 'Contents',
  'nav.close': 'Close',
  'nav.app': 'Open the app',
  'status.devnet': 'Devnet. Unaudited.',
  'hero.line1': 'Every payment gets',
  'hero.line2': 'an undo window.',
  'hero.dek':
    'HOLDBACK holds a Solana payment on-chain for a set time. A risk agent sets that time from scam evidence you can check. Until it ends, one tap takes the money back.',
  'cta.send': 'Send a protected payment',
  'cta.dojo': 'Play Scam Dojo',
  'demo.question': 'Who are you paying?',
  'demo.trusted': 'Someone I trust',
  'demo.unknown': 'Someone new',
  'demo.suspicious': 'Looks suspicious',
  'demo.flagged': 'Flagged wallet',
  'demo.note': 'A demonstration. Thirty seconds here stand for the whole window.',
  'demo.again': 'Float it again',
  'demo.left': 'Left to undo',
  'demo.lifted': 'Taken back. The full amount is with the sender again.',
  'demo.sunk':
    'The window ended. The payment went to the recipient and can no longer be taken back.',
  'demo.instant': 'Paid at once. People you trust skip the wait.',
  'demo.slider': 'Time since you paid',
  'demo.drag': 'Drag to move the clock',
  'demo.still': 'You can still take it back.',
  'demo.late': 'Too late: it has gone to the recipient.',
  'cta.receipt': 'Open a live receipt',
  'sound.on': 'Sound on',
  'sound.off': 'Sound off',
  'ticket.grid': 'Hours you can take it back',
  'ticket.held': 'Held on-chain',
  'ticket.foot': 'Punched by the risk agent. Final once signed.',
  'ticket.specimen': 'Specimen',
  'window.none': 'No wait',
  'action.undo': 'Take it back',
  'action.releaseEarly': 'Release now',
  'action.release': 'Release to recipient',
  'action.review': 'Review payment',
  'action.sign': 'Sign and send',
  'action.connect': 'Connect a wallet',
  'action.verify': 'Verify the hash',
  'stamp.takenBack': 'Taken back',
  'stamp.released': 'Released',
  'stamp.held': 'Held',
  'stamp.paid': 'Paid at once',
  'tier.TRUSTED': 'Trusted',
  'tier.UNKNOWN': 'New recipient',
  'tier.SUSPICIOUS': 'Suspicious',
  'tier.FLAGGED': 'Flagged',
  'tier.SANCTIONED': 'Sanctioned',
  'warn.TRUSTED': 'You trust this recipient. No wait.',
  'warn.UNKNOWN': 'No warning signs found. The recipient is new to you, so the money waits.',
  'warn.SUSPICIOUS':
    'Some warning signs. The money waits longer, and you can take it back at any time before the window ends.',
  'warn.FLAGGED':
    'Careful: this wallet has scam reports against it. The money waits a full day. Take it back if anything feels wrong.',
  'warn.SANCTIONED':
    'This address is on a sanctions list. Sending to it may be illegal where you live. You must type a confirmation to continue.',
  'warn.pressure': 'Nobody honest needs your money this minute. Urgency is how scams work.',
} as const;

export type MessageKey = keyof typeof en;
type Messages = Record<MessageKey, string>;

const hi: Messages = {
  'nav.home': 'मुखपृष्ठ',
  'nav.how': 'यह कैसे काम करता है',
  'nav.evidence': 'सबूत',
  'nav.results': 'नतीजे',
  'nav.integrations': 'एकीकरण',
  'nav.dojo': 'Scam Dojo',
  'nav.docs': 'दस्तावेज़',
  'nav.proof': 'प्रमाण',
  'nav.try': 'आज़माएँ',
  'nav.contents': 'विषय-सूची',
  'nav.close': 'बंद करें',
  'nav.app': 'ऐप खोलें',
  'status.devnet': 'डेवनेट। ऑडिट नहीं हुआ है।',
  'hero.line1': 'हर भुगतान के साथ',
  'hero.line2': 'वापस लेने का समय।',
  'hero.dek':
    'HOLDBACK आपके Solana भुगतान को तय समय तक ऑन-चेन रोककर रखता है। यह समय एक रिस्क एजेंट धोखाधड़ी के उन सबूतों से तय करता है जिन्हें आप ख़ुद जाँच सकते हैं। समय पूरा होने से पहले, एक टैप में पैसा वापस।',
  'cta.send': 'संरक्षित भुगतान भेजें',
  'cta.dojo': 'Scam Dojo खेलें',
  'demo.question': 'आप किसे पैसे भेज रहे हैं?',
  'demo.trusted': 'जिस पर भरोसा है',
  'demo.unknown': 'कोई नया व्यक्ति',
  'demo.suspicious': 'संदिग्ध लग रहा है',
  'demo.flagged': 'चिह्नित वॉलेट',
  'demo.note': 'यह एक प्रदर्शन है। यहाँ के तीस सेकंड पूरे समय के बराबर हैं।',
  'demo.again': 'फिर से तैराएँ',
  'demo.left': 'वापस लेने का बचा समय',
  'demo.lifted': 'वापस ले लिया। पूरी रकम फिर से भेजने वाले के पास है।',
  'demo.sunk': 'समय पूरा हुआ। भुगतान पाने वाले को मिल गया और अब वापस नहीं लिया जा सकता।',
  'demo.instant': 'तुरंत भुगतान। भरोसेमंद लोगों के लिए इंतज़ार नहीं।',
  'demo.slider': 'भुगतान के बाद बीता समय',
  'demo.drag': 'घड़ी आगे-पीछे करने के लिए खींचें',
  'demo.still': 'आप अब भी वापस ले सकते हैं।',
  'demo.late': 'देर हो गई: पैसा पाने वाले के पास जा चुका है।',
  'cta.receipt': 'एक असली रसीद खोलें',
  'sound.on': 'आवाज़ चालू',
  'sound.off': 'आवाज़ बंद',
  'ticket.grid': 'इतने घंटे तक वापस ले सकते हैं',
  'ticket.held': 'ऑन-चेन रुका हुआ',
  'ticket.foot': 'छेद रिस्क एजेंट ने किया है। बाद में नहीं बदलता।',
  'ticket.specimen': 'नमूना',
  'window.none': 'कोई इंतज़ार नहीं',
  'action.undo': 'वापस लें',
  'action.releaseEarly': 'अभी दे दें',
  'action.release': 'पाने वाले को दे दें',
  'action.review': 'भुगतान जाँचें',
  'action.sign': 'हस्ताक्षर करके भेजें',
  'action.connect': 'वॉलेट जोड़ें',
  'action.verify': 'हैश जाँचें',
  'stamp.takenBack': 'वापस लिया',
  'stamp.released': 'दे दिया',
  'stamp.held': 'रुका हुआ',
  'stamp.paid': 'तुरंत भुगतान',
  'tier.TRUSTED': 'भरोसेमंद',
  'tier.UNKNOWN': 'नया प्राप्तकर्ता',
  'tier.SUSPICIOUS': 'संदिग्ध',
  'tier.FLAGGED': 'चिह्नित',
  'tier.SANCTIONED': 'प्रतिबंधित',
  'warn.TRUSTED': 'आप इस प्राप्तकर्ता पर भरोसा करते हैं। कोई इंतज़ार नहीं।',
  'warn.UNKNOWN': 'कोई चेतावनी संकेत नहीं मिला। यह प्राप्तकर्ता आपके लिए नया है, इसलिए पैसा कुछ देर रुका रहेगा।',
  'warn.SUSPICIOUS':
    'कुछ चेतावनी संकेत मिले हैं। पैसा ज़्यादा देर रुका रहेगा, और समय पूरा होने से पहले आप कभी भी वापस ले सकते हैं।',
  'warn.FLAGGED':
    'सावधान: इस वॉलेट के ख़िलाफ़ धोखाधड़ी की रिपोर्टें हैं। पैसा पूरे एक दिन रुका रहेगा। कुछ भी ग़लत लगे तो वापस ले लें।',
  'warn.SANCTIONED':
    'यह पता प्रतिबंध सूची में है। इसे पैसा भेजना आपके यहाँ ग़ैरक़ानूनी हो सकता है। आगे बढ़ने के लिए आपको पुष्टि लिखनी होगी।',
  'warn.pressure': 'कोई ईमानदार व्यक्ति आपसे इसी मिनट पैसा नहीं माँगता। जल्दबाज़ी ही ठगी का तरीक़ा है।',
};

const es: Messages = {
  'nav.home': 'Inicio',
  'nav.how': 'Cómo funciona',
  'nav.evidence': 'Pruebas',
  'nav.results': 'Resultados',
  'nav.integrations': 'Integraciones',
  'nav.dojo': 'Scam Dojo',
  'nav.docs': 'Documentación',
  'nav.proof': 'Comprobación',
  'nav.try': 'Pruébalo',
  'nav.contents': 'Contenido',
  'nav.close': 'Cerrar',
  'nav.app': 'Abrir la app',
  'status.devnet': 'Devnet. Sin auditar.',
  'hero.line1': 'Cada pago tiene',
  'hero.line2': 'un plazo para deshacerlo.',
  'hero.dek':
    'HOLDBACK retiene un pago de Solana en la cadena durante un tiempo fijo. Un agente de riesgo decide ese tiempo con pruebas de estafa que puedes revisar. Hasta que termine, un toque devuelve el dinero.',
  'cta.send': 'Enviar un pago protegido',
  'cta.dojo': 'Jugar a Scam Dojo',
  'demo.question': '¿A quién le pagas?',
  'demo.trusted': 'Alguien de confianza',
  'demo.unknown': 'Alguien nuevo',
  'demo.suspicious': 'Parece sospechoso',
  'demo.flagged': 'Billetera denunciada',
  'demo.note': 'Es una demostración. Treinta segundos aquí equivalen a todo el plazo.',
  'demo.again': 'Ponerlo a flote otra vez',
  'demo.left': 'Tiempo para deshacer',
  'demo.lifted': 'Deshecho. Todo el importe volvió a quien lo envió.',
  'demo.sunk': 'El plazo terminó. El pago se entregó al destinatario y ya no se puede deshacer.',
  'demo.instant': 'Pagado al instante. La gente de confianza no espera.',
  'demo.slider': 'Tiempo desde que pagaste',
  'demo.drag': 'Arrastra para mover el reloj',
  'demo.still': 'Todavía puedes deshacer el pago.',
  'demo.late': 'Demasiado tarde: ya llegó al destinatario.',
  'cta.receipt': 'Abrir un comprobante real',
  'sound.on': 'Sonido activado',
  'sound.off': 'Sonido desactivado',
  'ticket.grid': 'Horas para deshacer el pago',
  'ticket.held': 'Retenido en la cadena',
  'ticket.foot': 'Perforado por el agente de riesgo. No se edita.',
  'ticket.specimen': 'Muestra',
  'window.none': 'Sin espera',
  'action.undo': 'Deshacer el pago',
  'action.releaseEarly': 'Entregar ahora',
  'action.release': 'Entregar al destinatario',
  'action.review': 'Revisar el pago',
  'action.sign': 'Firmar y enviar',
  'action.connect': 'Conectar una billetera',
  'action.verify': 'Verificar el hash',
  'stamp.takenBack': 'Devuelto',
  'stamp.released': 'Entregado',
  'stamp.held': 'Retenido',
  'stamp.paid': 'Pagado al instante',
  'tier.TRUSTED': 'De confianza',
  'tier.UNKNOWN': 'Destinatario nuevo',
  'tier.SUSPICIOUS': 'Sospechoso',
  'tier.FLAGGED': 'Denunciado',
  'tier.SANCTIONED': 'Sancionado',
  'warn.TRUSTED': 'Confías en este destinatario. Sin espera.',
  'warn.UNKNOWN':
    'No se encontraron señales de alerta. El destinatario es nuevo para ti, así que el dinero espera.',
  'warn.SUSPICIOUS':
    'Hay algunas señales de alerta. El dinero espera más tiempo y puedes deshacer el pago en cualquier momento antes de que termine el plazo.',
  'warn.FLAGGED':
    'Cuidado: esta billetera tiene denuncias de estafa. El dinero espera un día entero. Deshaz el pago si algo no te convence.',
  'warn.SANCTIONED':
    'Esta dirección está en una lista de sanciones. Enviarle dinero puede ser ilegal donde vives. Debes escribir una confirmación para continuar.',
  'warn.pressure':
    'Nadie honesto necesita tu dinero en este mismo minuto. La prisa es el método de las estafas.',
};

const pt: Messages = {
  'nav.home': 'Início',
  'nav.how': 'Como funciona',
  'nav.evidence': 'Evidências',
  'nav.results': 'Resultados',
  'nav.integrations': 'Integrações',
  'nav.dojo': 'Scam Dojo',
  'nav.docs': 'Documentação',
  'nav.proof': 'Comprovação',
  'nav.try': 'Experimente',
  'nav.contents': 'Conteúdo',
  'nav.close': 'Fechar',
  'nav.app': 'Abrir o app',
  'status.devnet': 'Devnet. Sem auditoria.',
  'hero.line1': 'Todo pagamento tem',
  'hero.line2': 'um prazo para desfazer.',
  'hero.dek':
    'O HOLDBACK retém um pagamento Solana na blockchain por um prazo definido. Um agente de risco define esse prazo com evidências de golpe que você pode conferir. Até o prazo acabar, um toque traz o dinheiro de volta.',
  'cta.send': 'Enviar um pagamento protegido',
  'cta.dojo': 'Jogar Scam Dojo',
  'demo.question': 'Para quem você está pagando?',
  'demo.trusted': 'Alguém de confiança',
  'demo.unknown': 'Alguém novo',
  'demo.suspicious': 'Parece suspeito',
  'demo.flagged': 'Carteira denunciada',
  'demo.note': 'É uma demonstração. Trinta segundos aqui valem pelo prazo inteiro.',
  'demo.again': 'Pôr para flutuar de novo',
  'demo.left': 'Tempo para desfazer',
  'demo.lifted': 'Desfeito. O valor inteiro voltou para quem enviou.',
  'demo.sunk':
    'O prazo acabou. O pagamento foi liberado para o destinatário e não pode mais ser desfeito.',
  'demo.instant': 'Pago na hora. Quem é de confiança não espera.',
  'demo.slider': 'Tempo desde o pagamento',
  'demo.drag': 'Arraste para mover o relógio',
  'demo.still': 'Você ainda pode desfazer.',
  'demo.late': 'Tarde demais: já foi para o destinatário.',
  'cta.receipt': 'Abrir um comprovante real',
  'sound.on': 'Som ligado',
  'sound.off': 'Som desligado',
  'ticket.grid': 'Horas para desfazer o pagamento',
  'ticket.held': 'Retido na blockchain',
  'ticket.foot': 'Perfurado pelo agente de risco. Não se edita.',
  'ticket.specimen': 'Amostra',
  'window.none': 'Sem espera',
  'action.undo': 'Desfazer',
  'action.releaseEarly': 'Liberar agora',
  'action.release': 'Liberar para o destinatário',
  'action.review': 'Revisar o pagamento',
  'action.sign': 'Assinar e enviar',
  'action.connect': 'Conectar uma carteira',
  'action.verify': 'Verificar o hash',
  'stamp.takenBack': 'Estornado',
  'stamp.released': 'Liberado',
  'stamp.held': 'Retido',
  'stamp.paid': 'Pago na hora',
  'tier.TRUSTED': 'De confiança',
  'tier.UNKNOWN': 'Destinatário novo',
  'tier.SUSPICIOUS': 'Suspeito',
  'tier.FLAGGED': 'Denunciado',
  'tier.SANCTIONED': 'Sancionado',
  'warn.TRUSTED': 'Você confia neste destinatário. Sem espera.',
  'warn.UNKNOWN':
    'Nenhum sinal de alerta encontrado. O destinatário é novo para você, então o dinheiro espera.',
  'warn.SUSPICIOUS':
    'Há alguns sinais de alerta. O dinheiro espera mais tempo, e você pode desfazer a qualquer momento antes do fim do prazo.',
  'warn.FLAGGED':
    'Cuidado: esta carteira tem denúncias de golpe. O dinheiro espera um dia inteiro. Desfaça se algo parecer errado.',
  'warn.SANCTIONED':
    'Este endereço está em uma lista de sanções. Enviar dinheiro para ele pode ser ilegal onde você mora. É preciso digitar uma confirmação para continuar.',
  'warn.pressure':
    'Ninguém honesto precisa do seu dinheiro neste minuto. A pressa é o método dos golpes.',
};

export const MESSAGES: Record<Lang, Messages> = { en, hi, es, pt };

export function translate(lang: Lang, key: MessageKey): string {
  return MESSAGES[lang][key];
}

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

/** Digits in the reader's own numerals: Devanagari for Hindi, unchanged otherwise. */
export function localDigits(text: string, lang: Lang): string {
  return lang === 'hi' ? text.replace(/\d/g, (digit) => DEVANAGARI_DIGITS[Number(digit)]!) : text;
}

const UNITS: Record<Lang, { minute: [string, string]; hour: [string, string] }> = {
  en: { minute: ['minute', 'minutes'], hour: ['hour', 'hours'] },
  hi: { minute: ['मिनट', 'मिनट'], hour: ['घंटा', 'घंटे'] },
  es: { minute: ['minuto', 'minutos'], hour: ['hora', 'horas'] },
  pt: { minute: ['minuto', 'minutos'], hour: ['hora', 'horas'] },
};

/** A whole undo window in words: `30 minutes`, `6 hours`, or the "no wait" line for zero. */
export function windowLabel(seconds: number, lang: Lang): string {
  if (seconds <= 0) return translate(lang, 'window.none');
  const hours = seconds / 3600;
  const [value, unit] =
    hours < 1
      ? [Math.round(seconds / 60), UNITS[lang].minute]
      : [Math.round(hours), UNITS[lang].hour];
  return localDigits(`${value} ${value === 1 ? unit[0] : unit[1]}`, lang);
}

/** `HH:MM:SS` for a countdown, in the reader's numerals. */
export function clockLabel(seconds: number, lang: Lang): string {
  const total = Math.max(0, Math.ceil(seconds));
  const pad = (value: number) => String(value).padStart(2, '0');
  const text = `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  return localDigits(text, lang);
}

/** The ink that prints a tier's ticket. Position and label carry the meaning; ink repeats it. */
export const TIER_INK: Record<TierName, 'green' | 'blue' | 'ochre' | 'magenta' | 'red'> = {
  TRUSTED: 'green',
  UNKNOWN: 'blue',
  SUSPICIOUS: 'ochre',
  FLAGGED: 'magenta',
  SANCTIONED: 'red',
};

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'hi' || value === 'es' || value === 'pt';
}
