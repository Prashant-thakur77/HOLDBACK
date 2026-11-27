import {
  GuardianError,
  fetchHold,
  hashEvidence,
  toHex,
  type EvidenceDocument,
} from '@holdback/sdk';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { parseAddress, requireGuardian, type ToolContext } from '../context';
import { ToolError } from '../errors';
import { address, tier } from '../schemas';
import { registerTool } from '../tool';

/** Fetches the document, treating "the service has no such document" as an answer. */
async function fetchDocument(ctx: ToolContext, hash: string): Promise<EvidenceDocument | null> {
  try {
    return await requireGuardian(ctx.deps).evidence(hash);
  } catch (failure) {
    if (failure instanceof GuardianError && failure.status === 404) return null;
    throw failure;
  }
}

export function registerEvidenceTools(server: McpServer, ctx: ToolContext): void {
  const { deps } = ctx;

  registerTool(server, {
    name: 'verify_evidence',
    title: 'Verify the evidence behind a hold',
    description:
      'Proves that a hold’s undo window was set from a specific evidence document. Reads the ' +
      'evidence hash stored in the on-chain hold, fetches the document published under that ' +
      'hash, recomputes sha256 over its canonical JSON locally and compares the two. ' +
      '`verified: true` means the document is exactly what the risk service committed to ' +
      'on-chain; false means it is missing or was altered. Read-only.',
    input: { hold: address('Hold address to verify. The hold must still exist on-chain.') },
    output: {
      hold: z.string(),
      verified: z.boolean(),
      onChainHash: z.string().describe('Hex hash stored in the hold account.'),
      recomputedHash: z
        .string()
        .nullable()
        .describe('Hex hash recomputed from the fetched document; null when none was found.'),
      documentFound: z.boolean(),
      describesThisHold: z
        .boolean()
        .nullable()
        .describe(
          'Whether the document names this hold’s sender and recipient. A verified document ' +
            'about other parties means the hash was reused; null when no document was found.',
        ),
      policyVersion: z.string().nullable(),
      assessedAt: z.string().nullable(),
      tier: tier.nullable(),
      windowSecs: z.number().nullable(),
      detail: z.string().describe('The result in one sentence.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run(args) {
      const target = parseAddress(args.hold, 'hold');
      const hold = await fetchHold(deps.connection, target);
      if (!hold) {
        throw new ToolError(
          'hold_not_found',
          'No open hold exists at this address, so there is no on-chain hash to compare with.',
        );
      }
      const onChainHash = toHex(hold.evidenceHash);
      const base = { hold: target.toBase58(), onChainHash };

      const document = await fetchDocument(ctx, onChainHash);
      if (!document) {
        return {
          ...base,
          verified: false,
          recomputedHash: null,
          documentFound: false,
          describesThisHold: null,
          policyVersion: null,
          assessedAt: null,
          tier: null,
          windowSecs: null,
          detail: 'The risk service has no document for the hash stored on-chain.',
        };
      }

      const recomputedHash = toHex(hashEvidence(document));
      const verified = recomputedHash === onChainHash;
      const describesThisHold =
        document.sender === hold.sender.toBase58() &&
        document.recipient === hold.recipient.toBase58();
      return {
        ...base,
        verified,
        recomputedHash,
        documentFound: true,
        describesThisHold,
        policyVersion: document.policyVersion,
        assessedAt: document.assessedAt,
        tier: document.tier,
        windowSecs: document.windowSecs,
        detail: verified
          ? 'The document hashes to the value stored on-chain: this is the evidence the window was set from.'
          : 'The document does not hash to the value stored on-chain: it is not the evidence the window was set from.',
      };
    },
  });
}
