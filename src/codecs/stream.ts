import type { ProviderId, StreamEvent } from '../types.js';
import { ProviderError, record } from '../errors.js';
/** Per-turn accumulator; there is no process-global stream or continuation state. */
export class StreamAccumulator {
  private text = '';
  private reasoning = '';
  private calls = new Map<number, any>();
  private parts: any[] = [];
  private blocks = new Map<number, any>();
  private counts: any = {};
  private reason: unknown;
  private terminal = false;
  constructor(private readonly provider: ProviderId) {}
  push(value: unknown): readonly StreamEvent[] {
    const root = record(value);
    if (root.error || root.type === 'error') throw new ProviderError('protocol');
    const events: StreamEvent[] = [];
    if (this.provider === 'openai') {
      const choice = root.choices?.[0];
      if (root.usage) this.counts = root.usage;
      if (!choice) return events;
      if (choice.finish_reason) { this.reason = choice.finish_reason; this.terminal = true; }
      const delta = choice.delta ?? {};
      if (typeof delta.content === 'string') { this.text += delta.content; events.push({ type: 'text', text: delta.content }); }
      if (delta.refusal) { this.reason = 'refusal'; this.terminal = true; }
      if (typeof delta.reasoning_content === 'string') this.reasoning += delta.reasoning_content;
      for (const part of delta.tool_calls ?? []) {
        const index = part.index;
        if (!Number.isInteger(index) || index < 0 || index >= 32) throw new ProviderError('protocol');
        const call = this.calls.get(index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (part.id) call.id += part.id;
        if (part.function?.name) call.function.name += part.function.name;
        if (typeof part.function?.arguments === 'string') {
          call.function.arguments += part.function.arguments;
          events.push({ type: 'tool_arguments', index, delta: part.function.arguments });
        }
        this.calls.set(index, call);
      }
    } else if (this.provider === 'gemini') {
      const candidate = root.candidates?.[0];
      if (root.usageMetadata) this.counts = root.usageMetadata;
      if (root.promptFeedback?.blockReason) { this.reason = 'SAFETY'; this.terminal = true; }
      if (!candidate) return events;
      if (candidate.finishReason) { this.reason = candidate.finishReason; this.terminal = true; }
      for (const part of candidate.content?.parts ?? []) {
        this.parts.push(structuredClone(part));
        if (typeof part.text === 'string' && !part.thought) events.push({ type: 'text', text: part.text });
      }
    } else {
      switch (root.type) {
        case 'message_start': this.counts = root.message?.usage ?? {}; break;
        case 'content_block_start': {
          if (!Number.isInteger(root.index) || root.index < 0 || root.index >= 128 || this.blocks.has(root.index)) throw new ProviderError('protocol');
          this.blocks.set(root.index, structuredClone(record(root.content_block)));
          if (root.content_block.type === 'text' && root.content_block.text) events.push({ type: 'text', text: root.content_block.text });
          break;
        }
        case 'content_block_delta': {
          const block = this.blocks.get(root.index);
          if (!block) throw new ProviderError('protocol');
          const delta = record(root.delta);
          if (delta.type === 'text_delta') { block.text = (block.text ?? '') + delta.text; events.push({ type: 'text', text: delta.text }); }
          else if (delta.type === 'thinking_delta') block.thinking = (block.thinking ?? '') + delta.thinking;
          else if (delta.type === 'signature_delta') block.signature = (block.signature ?? '') + delta.signature;
          else if (delta.type === 'input_json_delta') {
            block.partial = (block.partial ?? '') + delta.partial_json;
            events.push({ type: 'tool_arguments', index: root.index, delta: delta.partial_json });
          }
          break;
        }
        case 'message_delta': this.reason = root.delta?.stop_reason; this.counts = { ...this.counts, ...root.usage }; break;
        case 'message_stop': this.terminal = true; break;
        case 'content_block_stop': case 'ping': break;
        default: throw new ProviderError('protocol');
      }
    }
    return events;
  }
  finish(): unknown {
    if (!this.terminal) throw new ProviderError('protocol');
    if (this.provider === 'openai') return { choices: [{ message: { content: this.text, reasoning_content: this.reasoning, tool_calls: [...this.calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c) }, finish_reason: this.reason }], usage: this.counts };
    if (this.provider === 'gemini') return { candidates: [{ content: { parts: this.parts }, finishReason: this.reason }], usageMetadata: this.counts };
    return { content: [...this.blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => {
      if (b.partial !== undefined) { try { b.input = JSON.parse(b.partial); } catch { throw new ProviderError('protocol'); } delete b.partial; }
      return b;
    }), stop_reason: this.reason, usage: this.counts };
  }
}
