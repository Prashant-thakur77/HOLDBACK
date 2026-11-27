/**
 * Social-engineering cues in the sender's own words, in English, Hindi
 * (Devanagari and romanised), Spanish and Portuguese.
 *
 * These regular expressions are the backstop that always runs. They are
 * deliberately literal: each pattern is a phrase scammers coach victims to
 * repeat ("verification transfer", "do not tell anyone", "AnyDesk").
 *
 * Text is matched after `foldText`: lowercased with Latin accents removed,
 * so Spanish and Portuguese patterns are written without accents.
 * JavaScript's `\b` does not understand Devanagari, so Hindi patterns carry
 * no word boundaries.
 */
import type { Lang } from '@holdback/sdk';

export const CUE_IDS = [
  'urgency',
  'authority',
  'secrecy',
  'verification_transfer',
  'remote_access',
  'guaranteed_returns',
  'account_unlock',
  'secret_request',
  'advance_fee',
  'gift_cards',
] as const;
export type CueId = (typeof CUE_IDS)[number];

/** Lowercase, compatibility-normalised, Latin combining accents stripped. Devanagari is untouched. */
export function foldText(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase();
}

type Patterns = Record<Lang, RegExp[]>;

export const CUE_PATTERNS: Record<CueId, Patterns> = {
  urgency: {
    en: [
      /\b(urgent(ly)?|immediately|right (now|away)|last chance|act (now|fast)|hurry|asap|before (it'?s|it is) too late)\b/,
      /\bwithin (the )?(next )?\d+ ?(min|mins|minutes|hours?)\b/,
    ],
    hi: [
      /(तुरंत|अभी के अभी|जल्दी|फौरन|फ़ौरन|आखिरी मौका|आख़िरी मौका)/,
      /\b(turant|jaldi|abhi ke abhi|fauran|aakhri mauka)\b/,
    ],
    es: [
      /\b(urgente|urgentemente|inmediatamente|de inmediato|ahora mismo|ya mismo|cuanto antes|ultima oportunidad|antes de que sea tarde)\b/,
    ],
    pt: [
      /\b(urgente|urgentemente|imediatamente|agora mesmo|o quanto antes|ultima chance|antes que seja tarde)\b/,
    ],
  },
  authority: {
    en: [
      /\b(police|cbi|fbi|irs|customs|court|warrant|arrest(ed)?|narcotics|interpol|digital arrest|enforcement directorate|income tax|cyber ?crime)\b/,
      /\b(exchange|binance|coinbase|wallet|phantom|bank) (support|security|team|agent|helpdesk|officer)\b/,
      /\b(government|tax|customs) (official|officer|agency|department)\b/,
    ],
    hi: [
      /(पुलिस|सीबीआई|कस्टम|गिरफ्तार|गिरफ़्तार|वारंट|अदालत|कोर्ट|आयकर|इनकम टैक्स|साइबर क्राइम|नारकोटिक्स|डिजिटल अरेस्ट|अधिकारी)/,
      /\b(giraftar|giraftaar|adalat|thana|adhikari|sarkari afsar)\b/,
    ],
    es: [
      /\b(policia|aduana|aduanas|fiscalia|juzgado|tribunal|orden de arresto|arresto|arrestad[oa]|hacienda|guardia civil|interpol)\b/,
      /\b(agente|oficial) (de|del) (soporte|banco|seguridad|aduana)\b/,
      /\bsoporte de (binance|coinbase|phantom|la billetera|el exchange)\b/,
    ],
    pt: [
      /\b(policia|delegado|alfandega|receita federal|tribunal|juiz|mandado de prisao|prisao|interpol)\b/,
      /\b(agente|oficial) d[eoa] (suporte|banco|seguranca|alfandega)\b/,
      /\bsuporte d[ae] (binance|coinbase|phantom|carteira|corretora)\b/,
    ],
  },
  secrecy: {
    en: [
      /\b(don'?t|do not|not to|never) tell (anyone|anybody|your (family|bank|husband|wife|parents|friends))\b/,
      /\b(keep (it|this) (a )?secret|confidential|between us|tell no ?one|stay on the (call|line)|(don'?t|do not) hang up)\b/,
    ],
    hi: [
      /(किसी को (मत|नहीं) बताना|किसी को न बताएं|किसी से मत कहना|गुप्त रख|राज़ रख|राज रख|फोन मत काट|कॉल मत काट)/,
      /\b(kisi ko (mat|nahi) batana|secret rakh|phone mat kaat|call mat kaat)\b/,
    ],
    es: [
      /\b(no (se )?lo (digas|diga|cuentes|cuente) a nadie|no (le )?(digas|diga|decir|cuentes|cuente|contar) (nada )?a nadie|mantenlo en secreto|en secreto|es confidencial|entre nosotros|no cuelgues)\b/,
    ],
    pt: [
      /\b(nao (conte|contar|fale|falar|diga|dizer) (nada )?(a|para|pra|com) ninguem|mantenha (em )?segredo|em segredo|e confidencial|entre nos|nao desligue)\b/,
    ],
  },
  verification_transfer: {
    en: [
      /\b(verify|verification of|verifying) (my |your |the )?(account|wallet|identity|transfer|payment|deposit)\b/,
      /\b(test|verification) (transfer|transaction|payment|deposit|fee)\b/,
      /\b(safe|secure) (account|wallet)\b/,
      /\b(refundable deposit|will be refunded|refund(ed)? (it )?(back|immediately|right after))\b/,
    ],
    hi: [
      /(वेरिफिकेशन|सत्यापन|वेरिफाई|वेरीफाई|टेस्ट ट्रांसफर|सुरक्षित खाते|सेफ अकाउंट|वापस कर देंगे|रिफंड हो जाएगा)/,
      /\b(verify karne ke liye|verification ke liye|safe account|test transfer|wapas kar denge|refund ho jayega)\b/,
    ],
    es: [
      /\bverificar (mi |tu |la |su )?(cuenta|billetera|identidad|transferencia)\b/,
      /\b(verificacion de (la )?(cuenta|identidad)|transferencia de (prueba|verificacion)|pago de verificacion|cuenta segura|deposito reembolsable|sera reembolsad[oa]|me lo (devuelven|devolveran))\b/,
    ],
    pt: [
      /\bverificar (minha |sua |a )?(conta|carteira|identidade|transferencia)\b/,
      /\b(verificacao d[ae] (conta|identidade)|transferencia de (teste|verificacao)|pagamento de verificacao|conta segura|deposito reembolsavel|sera (reembolsado|devolvido)|vao me devolver)\b/,
    ],
  },
  remote_access: {
    en: [
      /\b(anydesk|any desk|teamviewer|team viewer|quicksupport|quick support|rustdesk|ultraviewer|airdroid|supremo)\b/,
      /\b(screen ?shar(e|ing)|remote (access|desktop|control))\b/,
    ],
    hi: [
      /(स्क्रीन शेयर|एनीडेस्क|टीमव्यूअर|रिमोट एक्सेस|ऐप डाउनलोड करवाया)/,
      /\b(screen share kar|app download karwaya)\b/,
    ],
    es: [
      /\b(compartir (mi |la )?pantalla|acceso remoto|escritorio remoto|control remoto de (mi|tu))\b/,
    ],
    pt: [
      /\b(compartilhar (minha |a )?tela|acesso remoto|area de trabalho remota|controle remoto d[oe] (meu|seu))\b/,
    ],
  },
  guaranteed_returns: {
    en: [
      /\b(guaranteed (returns?|profits?|income)|double (my|your) (money|investment)|risk[- ]free)\b/,
      /\b\d+ ?% (daily|per day|a day|weekly|per week|monthly)\b/,
      /\b((daily|weekly) (returns?|profits?)|(investment|trading|mining) (group|platform|scheme|plan|pool|bot|signals?))\b/,
    ],
    hi: [
      /(पक्का मुनाफा|गारंटीड रिटर्न|पैसा डबल|दोगुना|रोज़ाना कमाई|रोज का मुनाफा|निवेश योजना)/,
      /\b(paisa double|guaranteed return|pakka munafa|roz ka profit)\b/,
    ],
    es: [
      /\b(ganancias? garantizadas?|rendimientos? garantizados?|duplicar (mi|tu) (dinero|inversion)|sin riesgo|(grupo|plataforma) de inversion)\b/,
      /\b\d+ ?% (diario|al dia|semanal|mensual)\b/,
    ],
    pt: [
      /\b(lucros? garantidos?|retornos? garantidos?|rendimento garantido|dobrar (meu|seu) (dinheiro|investimento)|sem risco|(grupo|plataforma) de investimento)\b/,
      /\b\d+ ?% (ao dia|por dia|diario|semanal|ao mes)\b/,
    ],
  },
  account_unlock: {
    en: [
      /\b(unlock|unfreeze|unblock|reactivate|restore) (my |your |the )?(account|wallet|funds|card)\b/,
      /\b(account|wallet|withdrawal|sim) (is |was |will be |got )?(frozen|blocked|suspended|locked|deactivated)\b/,
      /\bkyc\b/,
    ],
    hi: [
      /(खाता (बंद|ब्लॉक|फ्रीज)|अकाउंट (बंद|ब्लॉक|फ्रीज)|केवाईसी|सिम बंद|खाता चालू)/,
      /\b(account (band|block|freeze) (ho|kar)|sim band)\b/,
    ],
    es: [
      /\b(desbloquear|descongelar|reactivar) (mi |tu |la )?(cuenta|billetera|tarjeta)\b/,
      /\b(cuenta (esta |fue |sera )?(bloqueada|congelada|suspendida)|fondos (bloqueados|congelados)|retiro bloqueado)\b/,
    ],
    pt: [
      /\b(desbloquear|descongelar|reativar) (minha |sua |a )?(conta|carteira|cartao)\b/,
      /\b(conta (esta |foi |sera )?(bloqueada|congelada|suspensa)|fundos (bloqueados|congelados)|saque bloqueado)\b/,
    ],
  },
  secret_request: {
    en: [
      /\b(otp|one[- ]time (password|code|pin)|seed ?phrase|recovery phrase|secret phrase|private key|12 words|24 words|cvv|verification code|passcode)\b/,
      /\b(card|upi|atm) pin\b/,
    ],
    hi: [/(ओटीपी|सीड फ्रेज|सीड फ़्रेज़|प्राइवेट की|पिन बताओ|पिन नंबर|गुप्त कोड)/, /\b(otp bata|pin bata)/],
    es: [
      /\b(frase semilla|frase de recuperacion|clave privada|codigo de verificacion|codigo otp|12 palabras|24 palabras|clave secreta|pin de (la|mi) tarjeta)\b/,
    ],
    pt: [
      /\b(frase semente|frase de recuperacao|chave privada|codigo de verificacao|codigo otp|12 palavras|24 palavras|senha do cartao|codigo de seguranca)\b/,
    ],
  },
  advance_fee: {
    en: [
      /\b(processing|release|clearance|customs|registration|activation|withdrawal|legal|handling|unlock) (fee|charge|tax|duty)\b/,
      /\bpay (a |the )?(fee|tax|charge) (first|before|to (receive|release|claim|withdraw))\b/,
      /\b(won|win|winner of) (a |the )?(lottery|prize|lucky draw|jackpot)\b/,
      /\b(inheritance|parcel (is )?(held|stuck|seized)|(claim|release) (my|your|the) (prize|winnings|funds|parcel|package))\b/,
    ],
    hi: [
      /(लॉटरी|इनाम|प्रोसेसिंग फीस|कस्टम ड्यूटी|पार्सल (रुका|पकड़ा|जब्त)|रजिस्ट्रेशन फीस|लोन अप्रूव)/,
      /\b(inaam|processing fees?|parcel (ruka|pakda)|registration fees?)\b/,
    ],
    es: [
      /\b(tarifa|cargo|tasa) de (procesamiento|liberacion|activacion|retiro|aduana)\b/,
      /\bpagar (una |la )?(tarifa|comision|tasa|impuesto) (primero|antes|para (recibir|liberar|retirar|reclamar))\b/,
      /\b(gane|ganaste|gano) (la |una |el |un )?(loteria|premio|sorteo)\b/,
      /\b(herencia|paquete (retenido|detenido)|reclamar (mi|tu|el) premio)\b/,
    ],
    pt: [
      /\btaxa de (processamento|liberacao|ativacao|saque|alfandega)\b/,
      /\bpagar (uma |a )?(taxa|comissao|imposto) (primeiro|antes|para (receber|liberar|sacar|resgatar))\b/,
      /\b(ganhei|ganhou) (na |a |um |o )?(loteria|premio|sorteio)\b/,
      /\b(heranca|encomenda (retida|presa)|resgatar (meu|seu|o) premio)\b/,
    ],
  },
  gift_cards: {
    en: [
      /\b(gift ?cards?|voucher codes?|prepaid cards?|scratch (the )?card)\b/,
      /\b(google play|itunes|apple|steam|amazon) (gift )?(cards?|codes?|vouchers?)\b/,
    ],
    hi: [/(गिफ्ट कार्ड|गिफ़्ट कार्ड|वाउचर कोड|गूगल प्ले कार्ड)/, /\b(gift card kharid|voucher code)/],
    es: [
      /\b(tarjetas? de regalo|tarjetas? prepago|vales? de regalo|codigos? de (regalo|google play|steam|amazon))\b/,
    ],
    pt: [
      /\b(cartao[- ]presente|cartoes[- ]presente|vale[- ]presente|cartao pre[- ]pago|codigos? d[eoa] (google play|steam|amazon))\b/,
    ],
  },
};

export interface CueMatch {
  cue: CueId;
  /** Languages whose patterns matched. */
  langs: Lang[];
}

/**
 * Patterns with their source folded the same way as the text, so a letter
 * typed precomposed in one and decomposed in the other still matches.
 */
const FOLDED_PATTERNS = Object.fromEntries(
  CUE_IDS.map((cue) => [
    cue,
    (Object.entries(CUE_PATTERNS[cue]) as [Lang, RegExp[]][]).map(
      ([lang, patterns]) =>
        [lang, patterns.map((pattern) => new RegExp(foldText(pattern.source)))] as const,
    ),
  ]),
) as Record<CueId, (readonly [Lang, RegExp[]])[]>;

/** Every cue whose patterns match `text`, in `CUE_IDS` order. */
export function detectCues(text: string): CueMatch[] {
  const folded = foldText(text);
  const matches: CueMatch[] = [];
  for (const cue of CUE_IDS) {
    const langs = FOLDED_PATTERNS[cue]
      .filter(([, patterns]) => patterns.some((pattern) => pattern.test(folded)))
      .map(([lang]) => lang);
    if (langs.length > 0) matches.push({ cue, langs });
  }
  return matches;
}
