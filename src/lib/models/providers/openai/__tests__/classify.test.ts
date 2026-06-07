import { describe, it, expect } from 'vitest';
import { classifyOpenAIModels } from '../classify';

describe('classifyOpenAIModels', () => {
  it('routes chat models to chat and embeddings to embedding', () => {
    const { chat, embedding } = classifyOpenAIModels([
      'gpt-4o',
      'o3',
      'gpt-5.1',
      'text-embedding-3-large',
      'text-embedding-3-small',
    ]);
    expect(chat.map((m) => m.key)).toEqual(['gpt-4o', 'gpt-5.1', 'o3']); // sorted
    expect(embedding.map((m) => m.key)).toEqual([
      'text-embedding-3-large',
      'text-embedding-3-small',
    ]);
  });

  it('drops non-chat models (audio/image/moderation/legacy)', () => {
    const { chat, embedding } = classifyOpenAIModels([
      'whisper-1',
      'tts-1',
      'gpt-4o-mini-tts',
      'dall-e-3',
      'gpt-image-1',
      'omni-moderation-latest',
      'gpt-4o-audio-preview',
      'davinci-002',
      'gpt-4o', // the one real chat model
    ]);
    expect(chat.map((m) => m.key)).toEqual(['gpt-4o']);
    expect(embedding).toEqual([]);
  });

  it('lists OpenRouter-style namespaced chat models', () => {
    const { chat } = classifyOpenAIModels([
      'openai/gpt-4o',
      'anthropic/claude-3.5-sonnet',
      'meta-llama/llama-3.1-70b-instruct',
      'openai/dall-e-3', // still dropped as non-chat
    ]);
    expect(chat.map((m) => m.key)).toEqual([
      'anthropic/claude-3.5-sonnet',
      'meta-llama/llama-3.1-70b-instruct',
      'openai/gpt-4o',
    ]);
  });

  it('ignores empty/invalid ids', () => {
    const { chat, embedding } = classifyOpenAIModels([
      '',
      undefined as unknown as string,
      'gpt-4o',
    ]);
    expect(chat.map((m) => m.key)).toEqual(['gpt-4o']);
    expect(embedding).toEqual([]);
  });
});
