export const URL_PATTERN = /https?:\/\/[^\s"')<>\]]+/gi;
export const stripTrailingPunctuation = (url: string) => url.replace(/[!),.:;?\]]+$/, '');
export function findFirstUrl(text: string | null | undefined): string | null {
  const match = text?.match(URL_PATTERN);
  return match ? stripTrailingPunctuation(match[0]) : null;
}
