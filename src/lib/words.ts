/** An amount in santim written out in English, as printed on receipts and bills: "Two hundred thirty thousand birr and fifty santim only". */
const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", " thousand", " million", " billion"];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} hundred`); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : "")); }
  else if (n > 0) parts.push(ONES[n]!);
  return parts.join(" ");
}

export function numberInWords(n: number): string {
  if (n === 0) return "zero";
  const groups: string[] = [];
  for (let i = 0; n > 0 && i < SCALES.length; i++, n = Math.floor(n / 1000)) { const g = n % 1000; if (g) groups.unshift(below1000(g) + SCALES[i]); }
  return groups.join(" ");
}

export function etbInWords(santim: number): string {
  const abs = Math.abs(Math.round(santim));
  const birr = Math.floor(abs / 100), cents = abs % 100;
  const text = `${numberInWords(birr)} birr${cents ? ` and ${numberInWords(cents)} santim` : ""} only`;
  return (santim < 0 ? "minus " : "") + text.charAt(0).toUpperCase() + text.slice(1);
}
