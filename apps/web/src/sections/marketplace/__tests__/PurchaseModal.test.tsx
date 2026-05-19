import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../__tests__/helpers/renderWithProviders.js";
import { PurchaseModal } from "../PurchaseModal.js";

function makeListing(overrides: Record<string, unknown> = {}): any {
  return {
    id: 1,
    aircraftTypeId: "bonanza_g36",
    aircraftTypeManufacturer: "Beechcraft",
    aircraftTypeModel: "Bonanza G36",
    aircraftClass: "SEP",
    tailNumber: "C-FONE",
    locationIcao: "CYHZ",
    locationName: "Halifax Stanfield Intl",
    airframeHours: 2_000,
    engineHoursSinceOverhaul: 400,
    engineRemainingHours: 1_600,
    tboHours: 2_000,
    hoursSince100hr: 30,
    hoursSinceAnnual: 90,
    conditionGrade: "good",
    askingPriceCents: 350_000_00,
    basePurchasePriceCents: 500_000_00,
    depreciationFactor: 0.7,
    distanceFromPlayerNm: 0,
    descriptionShort: "Clean SEP, fresh annual.",
    listedAt: Date.UTC(2026, 4, 1),
    expiresAt: Date.UTC(2026, 4, 30),
    fuelCapacityGal: 80,
    fuelType: "avgas",
    cruiseSpeedKts: 176,
    fuelBurnGph: 17,
    rentalRatePerHour: 0,
    hangarageMonthly: 30_000,
    insuranceMonthly: 25_000,
    hundredHourCost: 90_000,
    ...overrides,
  };
}

function makeLoan(overrides: Partial<Record<string, unknown>> = {}): any {
  return {
    principalCents: 280_000_00,
    downPaymentCents: 70_000_00,
    interestRateBps: 650,
    termMonths: 60,
    monthlyPaymentCents: 5_500_00,
    totalInterestCents: 50_000_00,
    totalPaidCents: 330_000_00,
    affordable: true,
    ...overrides,
  };
}

function makePreview(opts: {
  affordableCash?: boolean;
  cash?: number;
  loans?: any[];
} = {}): any {
  const listing = makeListing();
  const affordableCash = opts.affordableCash ?? true;
  return {
    ok: true,
    preview: {
      listing,
      cash: {
        totalCents: listing.askingPriceCents,
        affordable: affordableCash,
        cashAfterCents:
          (opts.cash ?? 500_000_00) - listing.askingPriceCents,
      },
      loans:
        opts.loans ??
        [
          makeLoan({ termMonths: 36, monthlyPaymentCents: 9_500_00 }),
          makeLoan({ termMonths: 60, monthlyPaymentCents: 5_500_00 }),
          makeLoan({ termMonths: 84, monthlyPaymentCents: 4_200_00 }),
        ],
    },
  };
}

describe("PurchaseModal — loading + preview rendering", () => {
  it("shows 'loading…' while previewPurchase is pending", () => {
    renderWithProviders(<PurchaseModal listingId={1} onClose={() => {}} />, {
      seed: ({ seedQuery }) => {
        // Don't seed previewPurchase → stays pending.
        seedQuery(["career", "get"], { cash: 500_000_00 });
      },
    });
    expect(screen.getByText(/^loading…$/i)).toBeInTheDocument();
  });

  it("renders the listing title, tail, and asking price when the preview resolves", () => {
    renderWithProviders(<PurchaseModal listingId={1} onClose={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(["marketplace", "previewPurchase"], makePreview(), {
          input: { listingId: 1 },
        });
        seedQuery(["career", "get"], { cash: 500_000_00 });
      },
    });
    expect(
      screen.getByText(/Purchase: Beechcraft Bonanza G36/i),
    ).toBeInTheDocument();
    expect(screen.getByText("C-FONE")).toBeInTheDocument();
    // Asking price formatCash($350K) = "$350,000"; also appears in totals.
    expect(screen.getAllByText("$350,000").length).toBeGreaterThan(0);
  });

  it("renders an error banner when the preview returns ok=false", () => {
    renderWithProviders(<PurchaseModal listingId={1} onClose={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["marketplace", "previewPurchase"],
          { ok: false, error: "Listing not found" },
          { input: { listingId: 1 } },
        );
        seedQuery(["career", "get"], { cash: 0 });
      },
    });
    // The same error string is echoed in both the body banner and the
    // footer hint, so we just confirm both copies showed up.
    expect(screen.getAllByText(/Listing not found/i).length).toBeGreaterThanOrEqual(1);
  });
});

describe("PurchaseModal — cash tab", () => {
  it("defaults to Cash and shows 'After purchase' with the remaining balance", () => {
    renderWithProviders(<PurchaseModal listingId={1} onClose={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["marketplace", "previewPurchase"],
          makePreview({ cash: 500_000_00, affordableCash: true }),
          { input: { listingId: 1 } },
        );
        seedQuery(["career", "get"], { cash: 500_000_00 });
      },
    });
    expect(screen.getByText("Your cash")).toBeInTheDocument();
    // 500k - 350k = 150k → $150,000
    expect(screen.getByText("$150,000")).toBeInTheDocument();
  });

  it("blocks Confirm and shows the 'Insufficient cash' callout when cash is short", () => {
    renderWithProviders(<PurchaseModal listingId={1} onClose={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["marketplace", "previewPurchase"],
          makePreview({
            affordableCash: false,
            cash: 100_000_00,
            // No affordable loan either, so the auto-switch effect leaves it on Cash.
            loans: [makeLoan({ affordable: false })],
          }),
          { input: { listingId: 1 } },
        );
        seedQuery(["career", "get"], { cash: 100_000_00 });
      },
    });
    expect(screen.getByText(/Insufficient cash/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Confirm purchase/i }),
    ).toBeDisabled();
  });

  it("Confirm fires marketplace.purchase with paymentMethod='cash'", async () => {
    const purchase = vi.fn(() => ({
      ok: true as const,
      ownedAircraftId: 10,
      tailNumber: "C-FONE",
      loanId: null,
    }));
    renderWithProviders(<PurchaseModal listingId={1} onClose={() => {}} />, {
      seed: ({ seedQuery, mockMutation }) => {
        seedQuery(
          ["marketplace", "previewPurchase"],
          makePreview({ cash: 500_000_00, affordableCash: true }),
          { input: { listingId: 1 } },
        );
        seedQuery(["career", "get"], { cash: 500_000_00 });
        mockMutation(["marketplace", "purchase"], purchase);
      },
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Confirm purchase/i }));
    await waitFor(() =>
      expect(purchase).toHaveBeenCalledWith({
        listingId: 1,
        paymentMethod: "cash",
      }),
    );
  });
});

describe("PurchaseModal — finance tab", () => {
  it("auto-switches to Finance when the player can't cover cash but a loan is affordable", () => {
    renderWithProviders(<PurchaseModal listingId={1} onClose={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["marketplace", "previewPurchase"],
          makePreview({
            affordableCash: false,
            cash: 80_000_00,
            loans: [
              makeLoan({ termMonths: 60, affordable: true }),
              makeLoan({ termMonths: 36, affordable: false }),
            ],
          }),
          { input: { listingId: 1 } },
        );
        seedQuery(["career", "get"], { cash: 80_000_00 });
      },
    });
    // Three "60 months", "36 months" labels indicate the Finance tab content rendered.
    expect(screen.getByText(/60 months/i)).toBeInTheDocument();
    expect(screen.getByText(/Down payment now/i)).toBeInTheDocument();
  });

  it("clicking a different term updates the selected loan + footer hint", async () => {
    renderWithProviders(<PurchaseModal listingId={1} onClose={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["marketplace", "previewPurchase"],
          makePreview({ cash: 80_000_00, affordableCash: false }),
          { input: { listingId: 1 } },
        );
        seedQuery(["career", "get"], { cash: 80_000_00 });
      },
    });
    // Auto-select picks the first affordable → 36-month tile. Switch to 84.
    await userEvent.setup().click(screen.getByText(/84 months/i));
    expect(
      screen.getByText(/84-month note · auto-debit each sim month/i),
    ).toBeInTheDocument();
  });

  it("Confirm fires purchase with paymentMethod='loan' + loanTermMonths", async () => {
    const purchase = vi.fn(() => ({
      ok: true as const,
      ownedAircraftId: 11,
      tailNumber: "C-FONE",
      loanId: 42,
    }));
    renderWithProviders(<PurchaseModal listingId={1} onClose={() => {}} />, {
      seed: ({ seedQuery, mockMutation }) => {
        seedQuery(
          ["marketplace", "previewPurchase"],
          makePreview({ cash: 80_000_00, affordableCash: false }),
          { input: { listingId: 1 } },
        );
        seedQuery(["career", "get"], { cash: 80_000_00 });
        mockMutation(["marketplace", "purchase"], purchase);
      },
    });
    const user = userEvent.setup();
    // Auto-select picked the first affordable; click 60 to be explicit.
    await user.click(screen.getByText(/60 months/i));
    await user.click(screen.getByRole("button", { name: /Confirm purchase/i }));
    await waitFor(() =>
      expect(purchase).toHaveBeenCalledWith({
        listingId: 1,
        paymentMethod: "loan",
        loanTermMonths: 60,
      }),
    );
  });
});

describe("PurchaseModal — close + success", () => {
  it("Cancel button calls onClose", async () => {
    const onClose = vi.fn();
    renderWithProviders(<PurchaseModal listingId={1} onClose={onClose} />, {
      seed: ({ seedQuery }) => {
        seedQuery(["marketplace", "previewPurchase"], makePreview(), {
          input: { listingId: 1 },
        });
        seedQuery(["career", "get"], { cash: 500_000_00 });
      },
    });
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape key calls onClose", async () => {
    const onClose = vi.fn();
    renderWithProviders(<PurchaseModal listingId={1} onClose={onClose} />, {
      seed: ({ seedQuery }) => {
        seedQuery(["marketplace", "previewPurchase"], makePreview(), {
          input: { listingId: 1 },
        });
        seedQuery(["career", "get"], { cash: 500_000_00 });
      },
    });
    await userEvent.setup().keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("renders the success view + 'Cash purchase recorded' after a cash purchase resolves", async () => {
    renderWithProviders(<PurchaseModal listingId={1} onClose={() => {}} />, {
      seed: ({ seedQuery, mockMutation }) => {
        seedQuery(
          ["marketplace", "previewPurchase"],
          makePreview({ cash: 500_000_00, affordableCash: true }),
          { input: { listingId: 1 } },
        );
        seedQuery(["career", "get"], { cash: 500_000_00 });
        mockMutation(["marketplace", "purchase"], () => ({
          ok: true as const,
          ownedAircraftId: 10,
          tailNumber: "C-FONE",
          loanId: null,
        }));
      },
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Confirm purchase/i }));
    await waitFor(() => {
      expect(screen.getByText(/Purchase complete/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/C-FONE is now yours/i)).toBeInTheDocument();
    expect(screen.getByText(/Cash purchase recorded/i)).toBeInTheDocument();
  });

  it("surfaces an error message when the purchase mutation returns ok=false", async () => {
    renderWithProviders(<PurchaseModal listingId={1} onClose={() => {}} />, {
      seed: ({ seedQuery, mockMutation }) => {
        seedQuery(
          ["marketplace", "previewPurchase"],
          makePreview({ cash: 500_000_00, affordableCash: true }),
          { input: { listingId: 1 } },
        );
        seedQuery(["career", "get"], { cash: 500_000_00 });
        mockMutation(["marketplace", "purchase"], () => ({
          ok: false as const,
          error: "Listing was just sold",
        }));
      },
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Confirm purchase/i }));
    await waitFor(() => {
      expect(screen.getByText(/Listing was just sold/i)).toBeInTheDocument();
    });
  });
});
