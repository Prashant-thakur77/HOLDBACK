import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';

import { toErrorBody } from './errors';

export interface ToolSpec<I extends z.ZodRawShape, O extends z.ZodRawShape> {
  name: string;
  title: string;
  /** Written for a model: when to call the tool, what it changes, what comes back. */
  description: string;
  input: I;
  output: O;
  annotations: ToolAnnotations;
  run(args: z.output<z.ZodObject<I>>): Promise<z.input<z.ZodObject<O>>>;
}

/**
 * Registers a tool whose handler returns plain data or throws.
 *
 * Success becomes `structuredContent` (validated against `output`) plus the
 * same JSON as text for clients that only read text. A throw becomes an
 * `isError` result carrying `{ error: { code, message, details } }` as text;
 * error results deliberately have no `structuredContent`, because clients
 * validate that field against the success schema.
 */
export function registerTool<I extends z.ZodRawShape, O extends z.ZodRawShape>(
  server: McpServer,
  spec: ToolSpec<I, O>,
): void {
  const handler = async (args: z.output<z.ZodObject<I>>): Promise<CallToolResult> => {
    try {
      const data = await spec.run(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        structuredContent: data as Record<string, unknown>,
      };
    } catch (failure) {
      const error = toErrorBody(failure);
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error }, null, 2) }],
      };
    }
  };

  server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.input,
      outputSchema: spec.output,
      annotations: spec.annotations,
    },
    // The SDK types the callback through its own zod-compat inference; the
    // arguments it passes are exactly `z.output` of the input shape.
    handler as unknown as ToolCallback<I>,
  );
}
