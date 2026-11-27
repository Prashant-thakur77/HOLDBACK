/** Push notification copy in the four languages. */
import type { Lang } from '@holdback/sdk';

import { spokenDuration } from '../llm/phrases';

export type PushKind = 'hold_placed' | 'risk_rose' | 'pre_release' | 'released' | 'reclaimed';

/** Closing words while the payment can still be undone. */
const TAP_TO_UNDO: Record<Lang, string> = {
  en: 'Tap to undo',
  hi: 'वापस लेने के लिए टैप करें',
  es: 'Toca para deshacer',
  pt: 'Toque para desfazer',
};

interface Copy {
  title: string;
  /** `{to}` is the short recipient address, `{window}` the time left in words. */
  body: string;
  undoable: boolean;
}

const COPY: Record<PushKind, Record<Lang, Copy>> = {
  hold_placed: {
    en: {
      title: 'Payment on hold',
      body: 'Your payment to {to} is held for {window}.',
      undoable: true,
    },
    hi: {
      title: 'भुगतान रोका गया',
      body: '{to} को आपका भुगतान {window} के लिए रोका गया है।',
      undoable: true,
    },
    es: {
      title: 'Pago retenido',
      body: 'Tu pago a {to} queda retenido durante {window}.',
      undoable: true,
    },
    pt: {
      title: 'Pagamento retido',
      body: 'Seu pagamento para {to} fica retido por {window}.',
      undoable: true,
    },
  },
  risk_rose: {
    en: {
      title: 'New warning signs',
      body: 'New warning signs about {to}. Your payment is now held for {window} more.',
      undoable: true,
    },
    hi: {
      title: 'नए चेतावनी संकेत',
      body: '{to} के बारे में नए चेतावनी संकेत मिले हैं। आपका भुगतान अब {window} और रोका गया है।',
      undoable: true,
    },
    es: {
      title: 'Nuevas señales de alerta',
      body: 'Hay nuevas señales de alerta sobre {to}. Tu pago queda retenido {window} más.',
      undoable: true,
    },
    pt: {
      title: 'Novos sinais de alerta',
      body: 'Há novos sinais de alerta sobre {to}. Seu pagamento fica retido por mais {window}.',
      undoable: true,
    },
  },
  pre_release: {
    en: {
      title: 'Releasing in 5 minutes',
      body: 'Your payment to {to} will be released in 5 minutes.',
      undoable: true,
    },
    hi: {
      title: '5 मिनट में भुगतान जारी होगा',
      body: '{to} को आपका भुगतान 5 मिनट में जारी हो जाएगा।',
      undoable: true,
    },
    es: {
      title: 'Se libera en 5 minutos',
      body: 'Tu pago a {to} se liberará en 5 minutos.',
      undoable: true,
    },
    pt: {
      title: 'Liberação em 5 minutos',
      body: 'Seu pagamento para {to} será liberado em 5 minutos.',
      undoable: true,
    },
  },
  released: {
    en: { title: 'Payment released', body: 'Your payment to {to} was released.', undoable: false },
    hi: { title: 'भुगतान जारी हुआ', body: '{to} को आपका भुगतान जारी कर दिया गया।', undoable: false },
    es: { title: 'Pago liberado', body: 'Tu pago a {to} fue liberado.', undoable: false },
    pt: {
      title: 'Pagamento liberado',
      body: 'Seu pagamento para {to} foi liberado.',
      undoable: false,
    },
  },
  reclaimed: {
    en: {
      title: 'Money returned',
      body: 'Your payment to {to} was undone and the money is back in your wallet.',
      undoable: false,
    },
    hi: {
      title: 'पैसा वापस आ गया',
      body: '{to} को आपका भुगतान वापस ले लिया गया और पैसा आपके वॉलेट में लौट आया है।',
      undoable: false,
    },
    es: {
      title: 'Dinero devuelto',
      body: 'Tu pago a {to} se deshizo y el dinero volvió a tu billetera.',
      undoable: false,
    },
    pt: {
      title: 'Dinheiro devolvido',
      body: 'Seu pagamento para {to} foi desfeito e o dinheiro voltou para sua carteira.',
      undoable: false,
    },
  },
};

export const shortAddress = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

export interface PushText {
  title: string;
  body: string;
}

/** The notification for `kind`. `secondsLeft` is the time until release. */
export function pushText(
  kind: PushKind,
  lang: Lang,
  recipient: string,
  secondsLeft: number,
): PushText {
  const copy = COPY[kind][lang];
  const body = copy.body
    .replace('{to}', shortAddress(recipient))
    .replace('{window}', spokenDuration(Math.max(60, secondsLeft), lang));
  return { title: copy.title, body: copy.undoable ? `${body} ${TAP_TO_UNDO[lang]}` : body };
}
