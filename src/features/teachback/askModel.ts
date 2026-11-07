import { AiUnavailableError, chatJSON, type ChatJsonOptions } from "@/features/ai";

/**
 * chatJSON, with one more try if it fails. We saw the model return an empty reply
 * now and then, and a second try works. Without this, one empty reply would throw
 * away a grade the learner already earned.
 */
export async function askModel<T>(options: ChatJsonOptions<T>): Promise<T> {
  try {
    return await chatJSON(options);
  } catch (error) {
    if (!(error instanceof AiUnavailableError)) throw error;
    return chatJSON(options);
  }
}
