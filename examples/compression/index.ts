/**
 * Context Compression Example
 *
 * Demonstrates how to configure and observe automatic context compression.
 *
 * How compression works:
 * - The core library checks token usage at the start of each turn.
 * - When `totalTokenCount >= compressionThreshold * modelContextWindowSize`,
 *   the history is automatically summarized and a ChatCompressed event is emitted.
 * - For models with large context windows (e.g. 1M tokens), compression
 *   only triggers after very long conversations.
 *
 * To observe compression in practice, use a low compressionThreshold (e.g. 0.3)
 * and run many turns with long responses. In production agents that run
 * continuously, compression will fire naturally as conversations grow.
 */
import { GeminiAgent, GeminiEventType } from "../../src/index.js";

const agent = new GeminiAgent({
  instructions: [
    "You are a helpful assistant.",
    "Always give extremely detailed and comprehensive responses.",
    "Include examples, code snippets, and historical context.",
  ].join(" "),
  compressionThreshold: 0.01,
});

const topics = [
  "the complete history of computing from the abacus to quantum computers",
  "CPU architecture: pipelining, branch prediction, cache coherence, and NUMA",
  "operating system internals: scheduling, virtual memory, and file systems",
  "distributed systems: CAP theorem, Paxos, Raft, and CRDTs",
  "programming language evolution from Fortran to Rust",
  "compiler construction: parsing, type checking, SSA, and LLVM",
  "database internals: B-trees, WAL, MVCC, and query optimization",
  "networking: TCP/IP, TLS 1.3, HTTP/2, QUIC, and WebRTC",
  "machine learning: CNNs, transformers, RLHF, and diffusion models",
  "cryptography: AES, RSA, ECC, zero-knowledge proofs, and post-quantum",
  "cloud computing: containers, Kubernetes, service mesh, and serverless",
  "computer graphics: ray tracing, PBR, and GPU architecture",
  "software engineering: design patterns, SOLID, and DDD",
  "type systems: System F, dependent types, and effect systems",
  "concurrency: lock-free data structures, memory ordering, and CSP",
  "web security: OWASP top 10, CSP headers, and OAuth 2.0 flows",
  "formal methods: Hoare logic, model checking, and theorem provers",
  "information theory: Shannon entropy and error-correcting codes",
  "computer architecture: VLIW, vector machines, and chiplet design",
  "summarize every topic we discussed with specific technical details",
];

let turnCount = 0;
let compressed = false;

for (const topic of topics) {
  turnCount++;
  const prompt = `Write an extremely detailed essay about ${topic}. Include as many specific technical details and examples as possible.`;

  console.log(`\n=== Turn ${turnCount}/${topics.length} ===`);
  console.log(`Topic: ${topic}`);

  let responseLength = 0;
  for await (const event of agent.sendStream(prompt)) {
    if (event.type === GeminiEventType.Content) {
      const text = String(event.value);
      responseLength += text.length;
      if (responseLength <= 200) {
        process.stdout.write(text);
      } else if (responseLength <= 210) {
        process.stdout.write("\n  ... [truncated] ...\n");
      }
    }
    if (event.type === GeminiEventType.ChatCompressed) {
      compressed = true;
      console.log("\n*** [ChatCompressed event received] ***");
      console.log(
        "  Compression info:",
        JSON.stringify(event.value, null, 2),
      );
    }
  }
  console.log(`  (Response: ${responseLength} chars)`);

  if (compressed) {
    console.log("\nCompression triggered! Example complete.");
    break;
  }
}

if (!compressed) {
  console.log(
    "\nChatCompressed was not triggered during this run.",
    "\nCompression fires when: totalTokenCount >= compressionThreshold * modelContextWindow.",
    "\nWith a 1M token context window and threshold 0.3, ~300K tokens are needed.",
    "\nIn production, long-running agents will naturally trigger compression.",
  );
}
