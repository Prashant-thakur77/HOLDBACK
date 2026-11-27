#!/usr/bin/env node
/**
 * The `holdback-mcp` binary: reads the environment and serves the tools over
 * stdio. stdout carries the protocol, so every log line goes to stderr.
 */
import { GuardianClient } from '@holdback/sdk';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Connection } from '@solana/web3.js';

import { ConfigError, loadConfig } from './config';
import { createServer } from './server';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const server = createServer({
    connection: new Connection(config.rpcUrl, 'confirmed'),
    guardian: config.guardianUrl ? new GuardianClient({ baseUrl: config.guardianUrl }) : null,
    signer: config.signer,
    maxAmount: config.maxAmount,
  });
  await server.connect(new StdioServerTransport());

  // Hosts only: RPC URLs often carry an API key in their path or query.
  const summary = [
    `rpc=${new URL(config.rpcUrl).host}`,
    `guardian=${config.guardianUrl ? new URL(config.guardianUrl).host : 'not configured'}`,
    `signer=${config.signer ? config.signer.publicKey.toBase58() : 'none (unsigned transactions)'}`,
    `cap=${config.maxAmount ?? 'none'}`,
  ];
  console.error(`holdback-mcp ready: ${summary.join(', ')}`);
}

main().catch((failure: unknown) => {
  // Configuration messages are written to be shown; anything else is
  // reported by name only so no secret can reach the log through a message.
  const reason =
    failure instanceof ConfigError
      ? failure.message
      : failure instanceof Error
        ? failure.name
        : 'unknown error';
  console.error(`holdback-mcp failed to start: ${reason}`);
  process.exit(1);
});
