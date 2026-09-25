/**
 * Narrow ports between the job pipeline and Telegram, so the worker can be
 * tested without network access. grammy.ts holds the real adapters.
 */
export interface ChatNotifier {
  sendHtml(chatId: number, html: string): Promise<void>;
  sendText(chatId: number, text: string): Promise<void>;
}

export interface TelegramFileFetcher {
  /** Download a Telegram file, refusing anything larger than maxBytes. */
  download(fileId: string, maxBytes: number): Promise<Uint8Array>;
}
