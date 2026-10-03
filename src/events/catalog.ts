export interface EventDefinition {
  name: string;
  description: string;
  delivery: readonly ["webhook"];
  inputSchema: Record<string, unknown>;
  payloadSchema: Record<string, unknown>;
}

export const EVENT_DEFINITIONS: readonly EventDefinition[] = [
  {
    name: "delegation.completed",
    description: "A delegated pi session reached a successful terminal state. Emission is wired in Turn 2.",
    delivery: ["webhook"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    payloadSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        label: { type: ["string", "null"] },
        terminalState: { type: "string", enum: ["done"] },
        resultHash: { type: "string" },
        finishedAt: { type: "string", format: "date-time" },
        providerModel: { type: ["string", "null"] },
      },
      required: ["sessionId", "terminalState", "resultHash", "finishedAt"],
      additionalProperties: false,
    },
  },
] as const;

export function eventDefinition(name: string): EventDefinition | undefined {
  return EVENT_DEFINITIONS.find((event) => event.name === name);
}

export function validateArguments(name: string, args: Record<string, unknown>): void {
  const definition = eventDefinition(name);
  if (!definition) throw new Error(`Unknown event: ${name}`);
  if (Object.keys(args).length !== 0)
    throw new Error(`${name} does not accept subscription arguments yet`);
}
