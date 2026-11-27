import type { Tone } from '@/lib/evidence';
import { PollarFlowError } from '@/lib/pollarFlow';
import { WalletActionError, errorDetail } from '@/lib/walletErrors';
import type { Translate } from '@/i18n/translate';

export interface FailureMessage {
  text: string;
  tone: Tone;
  /** True when the user backed out on purpose; shown quietly, never as an error. */
  cancelled: boolean;
}

/**
 * Turns anything a wallet action can throw into one localized sentence.
 * `where` picks the wording for the screen the action started on.
 */
export function describeFailure(
  error: unknown,
  t: Translate,
  where: 'send' | 'hold',
): FailureMessage {
  if (error instanceof PollarFlowError) {
    return {
      text: t(`pollar.error.${error.code}`, { detail: error.message }),
      tone: error.code === 'needs_approval' || error.code === 'busy' ? 'caution' : 'alert',
      cancelled: false,
    };
  }
  if (error instanceof WalletActionError) {
    switch (error.kind) {
      case 'cancelled':
        return { text: t(`${where}.cancelled`), tone: 'neutral', cancelled: true };
      case 'no_wallet':
        return { text: t('onboarding.noWallet'), tone: 'caution', cancelled: false };
      case 'expired':
        return { text: t('send.expired'), tone: 'caution', cancelled: false };
      case 'timeout':
        return { text: t('send.timeout'), tone: 'caution', cancelled: false };
      default:
        break;
    }
  }
  const detail = errorDetail(error);
  return {
    text: where === 'send' ? t('send.failed', { detail }) : t('hold.actionFailed', { detail }),
    tone: 'alert',
    cancelled: false,
  };
}
