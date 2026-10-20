export type ProviderId = 'openai' | 'gemini' | 'anthropic';
export type JsonObject = Readonly<Record<string, unknown>>;
export interface Continuation {
  readonly provider: ProviderId;
  readonly origin: string;
  readonly model: string;
  /** Sensitive opaque state. Never log or forward to a different scope. */
  readonly data: JsonObject;
}
export interface ToolCall { readonly id: string; readonly name: string; readonly arguments: JsonObject; readonly continuation?: Continuation }
export interface Tool { readonly name: string; readonly description: string; readonly inputSchema: JsonObject }
export type ContentBlock = { readonly type: 'text'; readonly text: string } | { readonly type: 'tool_call'; readonly call: ToolCall } | { readonly type: 'tool_result'; readonly toolCallId: string; readonly text: string; readonly isError?: boolean };
export interface Message {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content?: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly toolCallId?: string;
  readonly isError?: boolean;
  readonly continuation?: Continuation;
}
export interface ChatRequest {
  readonly messages: readonly Message[];
  readonly tools?: readonly Tool[];
  readonly systemPrompt?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly signal?: AbortSignal;
  readonly metadata?: Readonly<Record<string, string>>;
}
export interface Usage { readonly input: number; readonly output: number; readonly cachedInput: number; readonly cacheCreationInput: number; readonly total: number }
export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'refusal' | 'unknown';
export interface ChatResponse {
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
  readonly usage: Usage;
  readonly finishReason: FinishReason;
  readonly continuation?: Continuation;
  readonly recoveredFromReasoning?: true;
}
export type FailureKind = 'auth' | 'rate_limit' | 'invalid_request' | 'protocol' | 'server' | 'timeout' | 'network' | 'cancelled' | 'limit';
export interface Failure { readonly kind: FailureKind; readonly retryable: boolean; readonly status?: number }
export type StreamEvent = { readonly type: 'text'; readonly text: string } | { readonly type: 'tool_arguments'; readonly index: number; readonly delta: string } | { readonly type: 'complete'; readonly response: ChatResponse };
export interface Provider {
  readonly id: ProviderId;
  chat(request: ChatRequest): Promise<ChatResponse>;
  chatStream(request: ChatRequest): AsyncIterable<StreamEvent>;
}
export interface Scope { readonly provider: ProviderId; readonly origin: string; readonly model: string }
