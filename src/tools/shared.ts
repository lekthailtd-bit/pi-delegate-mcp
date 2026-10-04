import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { z, type ZodRawShape } from "zod";

/** Every tool answers with pretty JSON, so a human reading the transcript can follow it. */
export const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

let initialised = false;

export const markInitialised = (): void => {
  initialised = true;
};

/** Every tool but `init` refuses until the caller has read the operating instructions. */
function requireInit(): void {
  if (!initialised)
    throw new Error(
      "Call `init` first. It reports the models available here, the tools this server permits, " +
        "and how to drive a delegate. One call, then everything else unlocks.",
    );
}

export interface ToolMeta<A extends ZodRawShape> {
  description: string;
  inputSchema: A;
}

type GatedHandler<A extends ZodRawShape> = (
  args: z.infer<z.ZodObject<A>>,
  ctx: ServerContext,
) => ReturnType<typeof json> | Promise<ReturnType<typeof json>>;

/**
 * Register a tool that is unavailable until `init` has run. v2 expects a Standard
 * Schema, so raw Zod shapes are wrapped here once rather than relying on the
 * deprecated raw-shape overload at every call site.
 */
export function gated<A extends ZodRawShape>(
  server: McpServer,
  name: string,
  meta: ToolMeta<A>,
  handler: GatedHandler<A>,
): void {
  const inputSchema = z.object(meta.inputSchema);
  server.registerTool(
    name,
    { description: meta.description, inputSchema },
    async (args, ctx) => {
      requireInit();
      return handler(args, ctx);
    },
  );
}
