import OpenAI from 'openai';

const nvidia = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
  timeout: 60_000, // 60s per-request timeout
});

export const nvidiaClient = nvidia;

export type ChatCompletion = OpenAI.Chat.ChatCompletion;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 15_000; // 15 seconds between retries

/**
 * Determines if an error is retryable (timeout, rate limit, or server error).
 */
function isRetryableError(error: any): boolean {
  // OpenAI SDK wraps HTTP errors with a `status` property
  const status = error?.status || error?.statusCode || 0;
  // 429 = Rate Limit, 500 = Internal Server Error, 502/503/504 = Gateway/Timeout
  if ([429, 500, 502, 503, 504].includes(status)) return true;

  // Connection timeouts or aborted requests
  if (error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT' || error?.code === 'UND_ERR_CONNECT_TIMEOUT') return true;

  // OpenAI SDK throws APIConnectionError / APITimeoutError with recognizable names
  const errName: string = error?.constructor?.name || '';
  if (['APIConnectionError', 'APITimeoutError', 'ConnectionError'].includes(errName)) return true;

  // Fallback: check message for common keywords
  const msg: string = (error?.message || '').toLowerCase();
  if (msg.includes('timeout') || msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('econnreset')) return true;

  return false;
}

/**
 * Sleep helper — returns a Promise that resolves after `ms` milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * NVIDIA chat completion with automatic retry on timeout / rate-limit errors.
 * - Up to 3 retries after the initial attempt
 * - 15-second wait between retries
 * - Logs each retry attempt
 */
export async function nvidiaChatCompletion({
  model = 'openai/gpt-oss-120b',
  messages,
  temperature = 0.7,
  maxTokens = 2048,
  maxRetries = MAX_RETRIES,
  retryDelay = RETRY_DELAY_MS,
}: {
  model?: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
  retryDelay?: number;
}): Promise<ChatCompletion> {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await nvidia.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      });
    } catch (error: any) {
      lastError = error;

      // If this was the last allowed attempt, or the error is NOT retryable, throw immediately
      if (attempt === maxRetries || !isRetryableError(error)) {
        throw error;
      }

      console.warn(
        `[NVIDIA Retry] Attempt ${attempt + 1}/${maxRetries} failed ` +
        `(status: ${error?.status || 'N/A'}, message: ${error?.message || 'unknown'}). ` +
        `Retrying in ${retryDelay / 1000}s...`
      );

      await sleep(retryDelay);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}

/**
 * NVIDIA streaming chat completion with automatic retry on timeout / rate-limit errors.
 * - Up to 3 retries for the initial connection/stream creation
 * - 15-second wait between retries
 * - Once the stream is established, retry is NOT applicable (chunks flow)
 */
export async function* nvidiaChatStream({
  model = 'openai/gpt-oss-120b',
  messages,
  temperature = 0.7,
  maxTokens = 2048,
  maxRetries = MAX_RETRIES,
  retryDelay = RETRY_DELAY_MS,
}: {
  model?: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
  retryDelay?: number;
}): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk> {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const stream = await nvidia.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      });

      // Stream established — yield chunks
      for await (const chunk of stream) {
        yield chunk;
      }
      return; // Stream completed successfully
    } catch (error: any) {
      lastError = error;

      if (attempt === maxRetries || !isRetryableError(error)) {
        throw error;
      }

      console.warn(
        `[NVIDIA Stream Retry] Attempt ${attempt + 1}/${maxRetries} failed ` +
        `(status: ${error?.status || 'N/A'}, message: ${error?.message || 'unknown'}). ` +
        `Retrying in ${retryDelay / 1000}s...`
      );

      await sleep(retryDelay);
    }
  }

  throw lastError;
}

export default nvidiaClient;
