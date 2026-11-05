import { applyRecipeInputOverrides } from "@/lib/model/recipe-input-overrides";
import {
  applyMachineHandlerToRecipe,
  getSelectedMachineHandler,
  isSteamMachineHandler,
} from "@/lib/model/recipe-rules";
import type { FactoryNode, Recipe } from "@/lib/model/types";
import { euHandleId, euResource, type VoltageTier } from "@/lib/power/eu";
import { getOverclockedRecipeStats } from "./overclock";
import { getNodePowerReport, hasPowerReport } from "./power-report";

/** The EU input row of a machine that draws power: what a power network wires into (docs/power-networks.md). */
export interface NodeEuInput {
  /** The voltage the machine runs at: its own tier, or its energy hatches' on a multiblock. */
  tier: VoltageTier;
  /** EU one craft takes, before parallels (the solver's per-craft unit): overclocked EU/t x overclocked ticks. */
  euPerCraft: number;
  resource: ReturnType<typeof euResource>;
  /** The row's handle on section 0 (`input:power:eu%3Amv`). */
  handleId: string;
}

/**
 * A machine's EU input, or undefined for a card that draws no EU: generators, steam machines, crops, bees and
 * zero-EU recipes. The row is derived, never stored, and follows the card's tier: a new tier is a new resource, so
 * its wire comes off as when a slot's resource changes. The draw is the card's own power math (`getNodePowerReport`,
 * `getOverclockedRecipeStats`), the same the nameplate loop bills.
 */
export function getNodeEuInput(recipe: Recipe, node: FactoryNode): NodeEuInput | undefined {
  if (recipe.power || isSteamMachineHandler(getSelectedMachineHandler(recipe, node))) return undefined;
  const nodeRecipe = applyRecipeInputOverrides(recipe, node);
  if (!hasPowerReport(nodeRecipe) || !(applyMachineHandlerToRecipe(nodeRecipe, node).eut > 0)) return undefined;
  const stats = getOverclockedRecipeStats(nodeRecipe, node);
  const euPerCraft = Math.abs(stats.eut) * stats.durationTicks;
  if (!(euPerCraft > 0) || !Number.isFinite(euPerCraft)) return undefined;
  const { tier } = getNodePowerReport(nodeRecipe, node);
  return { tier, euPerCraft, resource: euResource(tier), handleId: euHandleId("input", tier) };
}
