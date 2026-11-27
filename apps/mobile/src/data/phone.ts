import { agentRequest } from './agentExtras';
import { isUnsupported } from './guardian';

/** `sent`: a code is on its way. `unsupported`: this agent has no phone verification. */
export type PhoneStart = 'sent' | 'unsupported';

/** Asks the agent to text a verification code to `phone` (E.164) for `wallet`. */
export async function startPhoneVerification(wallet: string, phone: string): Promise<PhoneStart> {
  try {
    await agentRequest('POST', '/v1/phone/start', { wallet, phone });
    return 'sent';
  } catch (error) {
    if (isUnsupported(error)) return 'unsupported';
    throw error;
  }
}

/** Confirms the code. Resolves `true` when the number is now verified for `wallet`. */
export async function confirmPhoneCode(
  wallet: string,
  phone: string,
  code: string,
): Promise<boolean> {
  const result = await agentRequest<{ verified?: boolean }>('POST', '/v1/phone/verify', {
    wallet,
    phone,
    code,
  });
  return result.verified === true;
}
