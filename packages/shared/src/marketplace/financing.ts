export interface LoanTerms {
  principalCents: number;
  downPaymentCents: number;
  interestRateBps: number;
  termMonths: number;
  monthlyPaymentCents: number;
  totalInterestCents: number;
  totalPaidCents: number;
}

export interface FinancingOptions {
  cash: { totalCents: number };
  loans: LoanTerms[];
}

interface OptionTemplate {
  downPaymentBps: number; // 2000 = 20%
  termMonths: number;
  interestRateBps: number;
}

const TIER_LOW: OptionTemplate[] = [
  { downPaymentBps: 2000, termMonths: 60, interestRateBps: 750 },
  { downPaymentBps: 3000, termMonths: 36, interestRateBps: 650 },
];

const TIER_MID: OptionTemplate[] = [
  { downPaymentBps: 2000, termMonths: 84, interestRateBps: 700 },
  { downPaymentBps: 3000, termMonths: 60, interestRateBps: 650 },
  { downPaymentBps: 4000, termMonths: 48, interestRateBps: 600 },
];

const TIER_HIGH: OptionTemplate[] = [
  { downPaymentBps: 3000, termMonths: 120, interestRateBps: 700 },
  { downPaymentBps: 4000, termMonths: 84, interestRateBps: 650 },
  { downPaymentBps: 5000, termMonths: 60, interestRateBps: 600 },
];

const TIER_LOW_MAX = 25_000_000; // $250K in cents
const TIER_MID_MAX = 150_000_000; // $1.5M in cents

function tierFor(askingPriceCents: number): OptionTemplate[] {
  if (askingPriceCents < TIER_LOW_MAX) return TIER_LOW;
  if (askingPriceCents < TIER_MID_MAX) return TIER_MID;
  return TIER_HIGH;
}

function amortizedMonthly(
  principalCents: number,
  rateBps: number,
  termMonths: number,
): number {
  if (principalCents <= 0 || termMonths <= 0) return 0;
  const monthlyRate = rateBps / 10_000 / 12;
  if (monthlyRate === 0) return Math.ceil(principalCents / termMonths / 100) * 100;
  const factor = Math.pow(1 + monthlyRate, termMonths);
  const payment = (principalCents * (monthlyRate * factor)) / (factor - 1);
  // Round up to nearest whole dollar (100 cents).
  return Math.ceil(payment / 100) * 100;
}

function buildLoan(
  askingPriceCents: number,
  template: OptionTemplate,
): LoanTerms {
  const downPaymentCents = Math.round(
    (askingPriceCents * template.downPaymentBps) / 10_000,
  );
  const principalCents = askingPriceCents - downPaymentCents;
  const monthlyPaymentCents = amortizedMonthly(
    principalCents,
    template.interestRateBps,
    template.termMonths,
  );
  const totalPaidCents = monthlyPaymentCents * template.termMonths;
  const totalInterestCents = Math.max(0, totalPaidCents - principalCents);
  return {
    principalCents,
    downPaymentCents,
    interestRateBps: template.interestRateBps,
    termMonths: template.termMonths,
    monthlyPaymentCents,
    totalInterestCents,
    totalPaidCents,
  };
}

export function calculateFinancingOptions(
  askingPriceCents: number,
): FinancingOptions {
  const tier = tierFor(askingPriceCents);
  return {
    cash: { totalCents: askingPriceCents },
    loans: tier.map((t) => buildLoan(askingPriceCents, t)),
  };
}
