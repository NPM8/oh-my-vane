import { Model, ModelList } from '../../types';

// An OpenAI-compatible `/models` endpoint (OpenAI, OpenRouter, etc.) returns
// every model the key can reach — including embeddings and non-chat models
// (audio/image/moderation). Split a flat list of model ids into chat vs
// embedding, dropping ids that are clearly not chat-completion models.

const EMBEDDING_RE = /embedding/i;

// Substrings that mark a model as NOT a chat-completion model.
const NON_CHAT_RE =
  /(whisper|tts|dall-?e|moderation|audio|transcrib|image|realtime|davinci-002|babbage-002|text-davinci|text-curie|text-babbage|text-ada)/i;

export const classifyOpenAIModels = (ids: string[]): ModelList => {
  const chat: Model[] = [];
  const embedding: Model[] = [];

  for (const id of ids) {
    if (!id || typeof id !== 'string') continue;
    if (EMBEDDING_RE.test(id)) {
      embedding.push({ key: id, name: id });
    } else if (!NON_CHAT_RE.test(id)) {
      chat.push({ key: id, name: id });
    }
  }

  const byKey = (a: Model, b: Model) => a.key.localeCompare(b.key);
  return { chat: chat.sort(byKey), embedding: embedding.sort(byKey) };
};
