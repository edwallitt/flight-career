export interface MonthlyOwnershipCost {
  hangarageCents: number;
  insuranceCents: number;
  totalCents: number;
}

export function calculateMonthlyOwnership(aircraftType: {
  hangarageMonthlyCents: number;
  insuranceMonthlyCents: number;
}): MonthlyOwnershipCost {
  return {
    hangarageCents: aircraftType.hangarageMonthlyCents,
    insuranceCents: aircraftType.insuranceMonthlyCents,
    totalCents:
      aircraftType.hangarageMonthlyCents + aircraftType.insuranceMonthlyCents,
  };
}
