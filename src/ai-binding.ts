// Workaround for duplicated streaming text with workers-ai-provider.
//
// Bug: Workers AI's Llama 3.3 stream sends every token twice in the same SSE
// chunk, once as `response` and once as `choices[0].delta.content`.
// workers-ai-provider (3.3.1, and still in 4.0.0) emits a text-delta for each
// field, so every streamed token reaches the UI twice ("ForFor reversing
// reversing...").
//
// Fix: wrap the AI binding and drop `response` from streamed chunks that also
// carry `choices`, so the provider only sees the OpenAI-style delta.
//
// Remove when: workers-ai-provider reads only one of the two fields (check
// the stream parser in its dist/index.mjs for `chunk.response`). The
// "no repeated consecutive chunks/words" check in test/roundtrip.mjs should
// still pass with `dedupeStreamingBinding` removed.

function stripDuplicateResponseField(): TransformStream<
  Uint8Array,
  Uint8Array
> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const rewrite = (line: string): string => {
    if (!line.startsWith("data: ")) return line;
    const payload = line.slice("data: ".length);
    if (payload.trim() === "[DONE]") return line;
    try {
      const chunk = JSON.parse(payload);
      if (Array.isArray(chunk.choices) && "response" in chunk) {
        delete chunk.response;
        return `data: ${JSON.stringify(chunk)}`;
      }
    } catch {
      // Not JSON: pass through untouched.
    }
    return line;
  };

  return new TransformStream({
    transform(bytes, controller) {
      buffer += decoder.decode(bytes, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${rewrite(line)}\n`));
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer) controller.enqueue(encoder.encode(rewrite(buffer)));
    }
  });
}

export function dedupeStreamingBinding(ai: Ai): Ai {
  return new Proxy(ai, {
    get(target, prop, receiver) {
      if (prop !== "run") return Reflect.get(target, prop, receiver);
      return async (...args: unknown[]) => {
        const run = target.run.bind(target) as (
          ...a: unknown[]
        ) => Promise<unknown>;
        const result = await run(...args);
        return result instanceof ReadableStream
          ? result.pipeThrough(stripDuplicateResponseField())
          : result;
      };
    }
  });
}
