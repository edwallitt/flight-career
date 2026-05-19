import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "@flightcareer/server/router";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { trpc } from "../../trpc.js";

/**
 * Test wrapper that mounts a component with the same provider tree as the
 * real app — `trpc.Provider` + `QueryClientProvider` + `MemoryRouter` —
 * with two test-only affordances:
 *
 * 1. **Pre-seed react-query cache** via `seedQuery(path, data)`. Queries
 *    whose key matches a seeded entry never fire over the wire.
 * 2. **Intercept mutations (and unseeded queries)** via `mockMutation` /
 *    `mockQuery`. The mock link short-circuits the HTTP transport and
 *    returns the handler's value (or throws to surface error states).
 *
 * If neither pre-seeding nor a mock handler covers a procedure that fires,
 * the link rejects with an explicit "no mock handler" error — surfaces in
 * tests as a failed query/mutation rather than a network hang.
 *
 * Usage:
 * ```ts
 * const toggle = vi.fn(({ enabled }) => ({ ok: true, enabled }));
 * renderWithProviders(<Settings />, {
 *   seed: ({ seedQuery, mockMutation }) => {
 *     seedQuery(["simBridge", "status"], { enabled: false, ... });
 *     mockMutation(["simBridge", "toggleEnabled"], toggle);
 *   },
 * });
 * await user.click(screen.getByRole("switch"));
 * await waitFor(() => expect(toggle).toHaveBeenCalledWith({ enabled: true }));
 * ```
 */

type Path = readonly string[];
type Handler = (input: unknown) => unknown | Promise<unknown>;

function pathKey(type: "query" | "mutation", path: Path): string {
  return `${type}:${path.join(".")}`;
}

function createMockLink(handlers: Map<string, Handler>): TRPCLink<AppRouter> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        const key = `${op.type}:${op.path}`;
        const handler = handlers.get(key);
        if (!handler) {
          observer.error(
            new TRPCClientError(
              `No mock handler registered for tRPC ${op.type} "${op.path}". ` +
                `Either pre-seed the cache (queries) or register a handler ` +
                `via mockMutation/mockQuery.`,
            ),
          );
          return;
        }
        Promise.resolve()
          .then(() => handler(op.input))
          .then((data) => {
            observer.next({ result: { data } });
            observer.complete();
          })
          .catch((err: unknown) => {
            observer.error(
              err instanceof TRPCClientError
                ? err
                : TRPCClientError.from(err as Error),
            );
          });
      });
}

export interface SeedHelpers {
  queryClient: QueryClient;
  /** Pre-fill the react-query cache for a procedure. The matching query never fires. */
  seedQuery: (
    path: Path,
    data: unknown,
    options?: { input?: unknown },
  ) => void;
  /**
   * Register a mutation handler. Receives the mutation input and returns the
   * server's reply. Wrap in `vi.fn` if you need call assertions:
   * `mockMutation(["jobs","accept"], vi.fn(...))`.
   */
  mockMutation: (path: Path, handler: Handler) => void;
  /**
   * Register a query handler. Use this only when seeding the cache won't work
   * — e.g. queries fired from a component-internal effect that depend on
   * other queries' data. Prefer `seedQuery` for the common case.
   */
  mockQuery: (path: Path, handler: Handler) => void;
}

export interface RenderOptions {
  route?: string;
  seed?: (helpers: SeedHelpers) => void;
}

export interface RenderWithProvidersResult extends RenderResult {
  queryClient: QueryClient;
}

export function renderWithProviders(
  ui: ReactElement,
  opts: RenderOptions = {},
): RenderWithProvidersResult {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const handlers = new Map<string, Handler>();

  const seedQuery: SeedHelpers["seedQuery"] = (path, data, options) => {
    const key: unknown[] = [path];
    if (options?.input !== undefined) {
      key.push({ input: options.input, type: "query" });
    } else {
      key.push({ type: "query" });
    }
    queryClient.setQueryData(key, data);
  };

  const mockMutation: SeedHelpers["mockMutation"] = (path, handler) => {
    handlers.set(pathKey("mutation", path), handler);
  };

  const mockQuery: SeedHelpers["mockQuery"] = (path, handler) => {
    handlers.set(pathKey("query", path), handler);
  };

  opts.seed?.({ queryClient, seedQuery, mockMutation, mockQuery });

  const trpcClient = trpc.createClient({ links: [createMockLink(handlers)] });

  const result = render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[opts.route ?? "/"]}>{ui}</MemoryRouter>
      </QueryClientProvider>
    </trpc.Provider>,
  );

  return Object.assign(result, { queryClient });
}

export { getQueryKey };
