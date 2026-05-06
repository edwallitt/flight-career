import { getAtlasData } from "../../services/atlas.js";
import { publicProcedure, router } from "../trpc.js";

export const atlasRouter = router({
  getData: publicProcedure.query(() => getAtlasData()),
});
