/**
 * How many SMS segments a message uses, which is what operators bill by. Plain Latin text (GSM alphabet) fits 160
 * characters in one segment (153 each when it spans several). Anything else, such as Amharic, is sent as UCS-2 and
 * fits only 70 (67 each when it spans several), so the same sentence in Amharic can cost two or three times as much.
 */
const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€"; // each of these takes two characters

export function smsSegments(text: string): { segments: number; unicode: boolean; length: number } {
  const chars = [...text];
  const unicode = chars.some((c) => !GSM.includes(c) && !GSM_EXTENDED.includes(c));
  const length = unicode ? chars.length : chars.reduce((n, c) => n + (GSM_EXTENDED.includes(c) ? 2 : 1), 0);
  const single = unicode ? 70 : 160, multi = unicode ? 67 : 153;
  return { segments: length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / multi), unicode, length };
}
