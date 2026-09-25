import { ImageValidationError } from '@autocontent/shared';
import type { Api } from 'grammy';
import type { ChatNotifier, TelegramFileFetcher } from './ports.js';

const DOWNLOAD_TIMEOUT_MS = 20_000;

export function createNotifier(api: Api): ChatNotifier {
  return {
    async sendHtml(chatId, html) {
      await api.sendMessage(chatId, html, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    },
    async sendText(chatId, text) {
      await api.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } });
    },
  };
}

export function createFileFetcher(api: Api, token: string): TelegramFileFetcher {
  return {
    async download(fileId, maxBytes) {
      const file = await api.getFile(fileId);
      if (file.file_size !== undefined && file.file_size > maxBytes) {
        throw new ImageValidationError('too_large', `Telegram reports ${file.file_size} bytes`);
      }
      if (!file.file_path) throw new Error('Telegram returned no file_path');

      const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!res.ok || !res.body) throw new Error(`File download failed with HTTP ${res.status}`);

      // Stream with a hard cap so a lying file_size can't exhaust memory.
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of res.body) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          throw new ImageValidationError('too_large', `Download exceeded ${maxBytes} bytes`);
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, total);
    },
  };
}
