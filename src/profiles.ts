import type { ProviderId } from './types.js';
/** Protocol capabilities, not a model catalogue or live compatibility promise. */
export const profiles: Readonly<Record<ProviderId, { readonly protocol: string; readonly streaming: boolean }>> = Object.freeze({
  openai: Object.freeze({ protocol: 'Chat Completions', streaming: true }),
  gemini: Object.freeze({ protocol: 'generateContent', streaming: true }),
  anthropic: Object.freeze({ protocol: 'Messages', streaming: true })
});
