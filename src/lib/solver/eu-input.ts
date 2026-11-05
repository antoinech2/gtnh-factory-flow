import { applyRecipeInputOverrides } from "@/lib/model/recipe-input-overrides";
import {
  applyMachineHandlerToRecipe,
  getSelectedMachineHandler,
  isSteamMachineHandler,
} from "@/lib/model/recipe-rules";
import { getVoltageTierMaxEuT } from "@/lib/model/tiers";
import type { FactoryNode, FactoryProject, Recipe, ThroughputResult } from "@/lib/model/types";
import { euHandleId, euResource, euTierOf, type VoltageTier } from "@/lib/power/eu";
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
 * The most amps a power network's takers pull at once: what its cable must carry. A singleblock refills its buffer at
 * up to floor(2 x EU/t / V) + 1 A (GTNH wiki, Electricity), a multiblock 2 A per energy hatch or its multi-amp
 * hatch's rating, a transformer its input side's amps; each times its whole machines (a part machine is one more to
 * build). The network's average is its EU/t over V; this is what bursts reach.
 */
export function networkPeakAmps(
  project: FactoryProject,
  result: ThroughputResult | undefined,
  storageId: string,
  tier: VoltageTier,
): number {
  const voltage = getVoltageTierMaxEuT(tier);
  let amps = 0;
  for (const edge of project.edges) {
    if (edge.source !== storageId || edge.resourceKind !== "power") continue;
    const node = project.nodes.find((entry) => entry.id === edge.target);
    const recipe = node ? project.recipes.find((entry) => entry.id === node.recipeId) : undefined;
    if (!node || !recipe) continue;
    const solved = result?.nodes[node.id]?.theoreticalMachinesRequired ?? node.machineCount;
    const machines = Math.ceil(Math.max(0, solved) - 1e-9);
    // A transformer's EU in is a recipe slot: one block takes its input side's amps.
    const slot = recipe.inputs.find((input) => input.kind === "power" && input.id === edge.resourceId);
    if (slot) {
      amps += machines * (slot.amount / 20 / voltage);
      continue;
    }
    if (!getNodeEuInput(recipe, node)) continue;
    const report = getNodePowerReport(applyRecipeInputOverrides(recipe, node), node);
    const perMachine = report.isMultiblock
      ? Math.max(2 * report.hatches, report.amps)
      : Math.floor((2 * report.drawEuT) / voltage) + 1;
    amps += machines * Math.max(1, node.parallel) * perMachine;
  }
  return amps;
}

/**
 * The cards among `nodeIds` an EU drawer can supply in one go ("Wire selected machines"): machines that draw EU of
 * the drawer's tier and have no EU wire yet (one network a machine). Board order kept.
 */
export function networkCandidates(project: FactoryProject, storageId: string, nodeIds: readonly string[]): string[] {
  const storage = project.storages?.find((entry) => entry.id === storageId);
  const tier = storage?.kind === "power" ? euTierOf(storage.resourceId) : undefined;
  if (!tier) return [];
  const wanted = new Set(nodeIds);
  return project.nodes
    .filter((node) => {
      if (!wanted.has(node.id)) return false;
      const recipe = project.recipes.find((entry) => entry.id === node.recipeId);
      const eu = recipe ? getNodeEuInput(recipe, node) : undefined;
      return (
        eu?.tier === tier &&
        !project.edges.some((edge) => edge.target === node.id && edge.resourceKind === "power")
      );
    })
    .map((node) => node.id);
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
