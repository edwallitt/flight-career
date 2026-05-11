import { z } from "zod";
import { setMsfsEnabled } from "../../services/settings.js";
import { simBridge } from "../../services/simBridge.js";
import { publicProcedure, router } from "../trpc.js";

export const simBridgeRouter = router({
  status: publicProcedure.query(() => simBridge.getStatus()),

  currentState: publicProcedure.query(() => simBridge.getCurrentState()),

  testConnection: publicProcedure.mutation(() => {
    simBridge.forceReconnect();
    return { ok: true as const };
  }),

  toggleEnabled: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ input }) => {
      setMsfsEnabled(input.enabled);
      simBridge.applyEnabledChange(input.enabled);
      return { ok: true as const, enabled: input.enabled };
    }),
});
