// Ethiopian (Ge'ez) calendar: 12 months of 30 days + Pagume (5 days, 6 in leap year).
export type EthDate = { year: number; month: number; day: number };

export const ETH_MONTHS_EN = ["Meskerem","Tikimt","Hidar","Tahsas","Tir","Yekatit","Megabit","Miazia","Genbot","Sene","Hamle","Nehase","Pagume"];
export const ETH_MONTHS_AM = ["መስከረም","ጥቅምት","ኅዳር","ታኅሣሥ","ጥር","የካቲት","መጋቢት","ሚያዝያ","ግንቦት","ሰኔ","ሐምሌ","ነሐሴ","ጳጉሜን"];

const EPOCH = 1723856;

function gregorianToJdn(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

function jdnToGregorian(jdn: number): { year: number; month: number; day: number } {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return { day: e - Math.floor((153 * m + 2) / 5) + 1, month: m + 3 - 12 * Math.floor(m / 10), year: 100 * b + d - 4800 + Math.floor(m / 10) };
}

export function ethiopianToGregorian({ year, month, day }: EthDate) {
  const jdn = EPOCH + 365 + 365 * (year - 1) + Math.floor(year / 4) + 30 * month + day - 31;
  return jdnToGregorian(jdn);
}

export function gregorianToEthiopian(y: number, m: number, d: number): EthDate {
  const jdn = gregorianToJdn(y, m, d);
  const r = (jdn - EPOCH) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  return {
    year: 4 * Math.floor((jdn - EPOCH) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460),
    month: Math.floor(n / 30) + 1,
    day: (n % 30) + 1,
  };
}

export function formatEthiopian(d: EthDate, lang: "en" | "am" = "en"): string {
  const names = lang === "am" ? ETH_MONTHS_AM : ETH_MONTHS_EN;
  return `${names[d.month - 1]} ${d.day}, ${d.year}`;
}
