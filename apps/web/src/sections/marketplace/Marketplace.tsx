import { useMemo, useState } from "react";
import { trpc } from "../../trpc.js";
import { MarketDrawer } from "./MarketDrawer.js";
import { MarketFilters } from "./MarketFilters.js";
import { MarketTable } from "./MarketTable.js";
import { PurchaseModal } from "./PurchaseModal.js";
import type {
  ClassFilter,
  Listing,
  MaxPriceFilter,
  SortKey,
} from "./types.js";

const SORT_TO_API: Record<
  SortKey,
  "distance_asc" | "price_asc" | "price_desc" | "hours_asc"
> = {
  distance: "distance_asc",
  price_asc: "price_asc",
  price_desc: "price_desc",
  hours: "hours_asc",
};

export function Marketplace() {
  const [classFilter, setClassFilter] = useState<ClassFilter>("any");
  const [maxPrice, setMaxPrice] = useState<MaxPriceFilter>("any");
  const [sortKey, setSortKey] = useState<SortKey>("distance");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [purchasingId, setPurchasingId] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const listingsQuery = trpc.marketplace.listings.useQuery(
    {
      filterByClass:
        classFilter === "any"
          ? undefined
          : ([classFilter] as ("SEP" | "MEP" | "SET" | "JET")[]),
      maxPriceCents: maxPrice === "any" ? undefined : maxPrice,
      sortBy: SORT_TO_API[sortKey],
    },
    { refetchInterval: 30_000 },
  );

  const refresh = trpc.marketplace.refreshNow.useMutation({
    onSuccess: () => {
      utils.marketplace.listings.invalidate();
      utils.marketplace.listingById.invalidate();
    },
  });

  const allListings: Listing[] = listingsQuery.data?.listings ?? [];
  const drawerOpen = selectedId != null;

  // The server already filters/sorts. We just expose a total / filtered count
  // to the filter strip; here, "total" is the server-filtered set, which is
  // what users care about for "showing X of Y".
  const totalCount = allListings.length;
  const filteredCount = useMemo(() => allListings.length, [allListings]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex items-end justify-between border-b border-ink-600 bg-ink-850 px-6 pt-5 pb-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-callsign text-amber-glow">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.6)]" />
            Console · MKT
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-text-high">
            Aircraft Marketplace
          </h1>
          <p className="text-tiny text-muted">
            Used aircraft for sale across North America. Listings refresh
            every few minutes.
          </p>
        </div>
      </div>

      <MarketFilters
        classFilter={classFilter}
        setClassFilter={setClassFilter}
        maxPrice={maxPrice}
        setMaxPrice={setMaxPrice}
        sortKey={sortKey}
        setSortKey={setSortKey}
        totalCount={totalCount}
        filteredCount={filteredCount}
        onRefresh={() => refresh.mutate()}
        isRefreshing={refresh.isPending}
      />

      <div
        className="relative flex min-h-0 flex-1 transition-[padding] duration-200"
        style={{ paddingRight: drawerOpen ? 440 : 0 }}
      >
        <MarketTable
          listings={allListings}
          selectedId={selectedId}
          onSelect={(l) =>
            setSelectedId((prev) => (prev === l.id ? null : l.id))
          }
          isLoading={listingsQuery.isPending}
        />

        <MarketDrawer
          listingId={selectedId}
          onClose={() => setSelectedId(null)}
          onPurchase={(id) => setPurchasingId(id)}
        />
      </div>

      {purchasingId != null && (
        <PurchaseModal
          listingId={purchasingId}
          onClose={() => {
            setPurchasingId(null);
            setSelectedId(null);
          }}
        />
      )}
    </div>
  );
}
