/**
 * Minimal A2A echo server for the subagent-md example.
 *
 * Receives a message and echoes it back in UPPER CASE.
 * Uses Node.js `http` module + @a2a-js/sdk server primitives —
 * no Express dependency required.
 */
import http from "node:http";
import type { AgentCard, Message } from "@a2a-js/sdk";
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  type AgentExecutor,
  type RequestContext,
  type ExecutionEventBus,
} from "@a2a-js/sdk/server";
import { JsonRpcTransportHandler } from "@a2a-js/sdk/server";

// ---------------------------------------------------------------------------
// Agent executor — converts incoming text to UPPER CASE
// ---------------------------------------------------------------------------

const echoExecutor: AgentExecutor = {
  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus) {
    const inputText = requestContext.userMessage.parts
      .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
      .map((p) => p.text)
      .join("\n");

    const reply: Message = {
      kind: "message",
      messageId: crypto.randomUUID(),
      role: "agent",
      parts: [{ kind: "text", text: inputText.toUpperCase() }],
    };

    console.log(`Received message: ${inputText}`);
    console.log(`Replying with: ${reply.parts[0]?.kind === "text" ? reply.parts[0].text : "(no text part)"}`);

    eventBus.publish(reply);
    eventBus.finished();
  },

  async cancelTask(_taskId: string, eventBus: ExecutionEventBus) {
    eventBus.finished();
  },
};

// ---------------------------------------------------------------------------
// Build the A2A request handler stack
// ---------------------------------------------------------------------------

function buildAgentCard(port: number): AgentCard {
  return {
    name: "echo-upper",
    description: "Echoes the input text in UPPER CASE",
    url: `http://localhost:${port}`,
    version: "1.0.0",
    protocolVersion: "0.2.4",
    capabilities: { streaming: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "echo-upper",
        name: "Echo Upper",
        description: "Converts text to uppercase",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

export interface A2AServer {
  port: number;
  close: () => Promise<void>;
}

export async function startA2AServer(port = 51898): Promise<A2AServer> {
  const taskStore = new InMemoryTaskStore();
  const agentCard = buildAgentCard(port);
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    taskStore,
    echoExecutor,
  );
  const rpcHandler = new JsonRpcTransportHandler(requestHandler);

  const server = http.createServer(async (req, res) => {
    // Agent card endpoint
    if (
      req.method === "GET" &&
      req.url === "/.well-known/agent-card.json"
    ) {
      // Update URL in card to reflect actual port
      const card = { ...agentCard, url: `http://localhost:${actualPort}` };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(card));
      return;
    }

    // JSON-RPC endpoint (POST /)
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

      try {
        const result = await rpcHandler.handle(body);

        // Streaming responses (AsyncGenerator) are not expected in this example
        if (typeof (result as AsyncGenerator).next === "function") {
          const gen = result as AsyncGenerator;
          const parts: unknown[] = [];
          for await (const chunk of gen) {
            parts.push(chunk);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(parts[parts.length - 1]));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        }
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: err instanceof Error ? err.message : String(err),
            },
            id: body?.id ?? null,
          }),
        );
      }
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  let actualPort = port;

  await new Promise<void>((resolve) => {
    server.listen(port, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        actualPort = addr.port;
      }
      resolve();
    });
  });

  return {
    port: actualPort,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
