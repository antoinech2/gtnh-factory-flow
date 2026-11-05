import { GT_VOLTAGE_TIERS } from "@/lib/model/tiers";
import type { FactoryEdge, FactoryProject, FactoryStorage } from "@/lib/model/types";
import { euHandleId, euResource, euTierOf, type VoltageTier } from "./eu";

/** The untiered EU older plans wired: every generator's output and every EU drawer was `power:eu`. */
const UNTIERED_EU = "eu";

const tierOrder = (tier: VoltageTier) => GT_VOLTAGE_TIERS.findIndex((entry) => entry.tier === tier);

/**
 * Gives an older plan's EU wires the tier of the generator they leave: the wire, its handles and the EU drawer it
 * lands on. A drawer fed by generators of several tiers becomes one drawer per tier (the lowest keeps the original),
 * each fed by its own tier's wires: one drawer, one network, one voltage. Runs after `resynthesizePowerRecipes`, which
 * gives the generators their tiered outputs. A drawer with no generator wired to it keeps the untiered id.
 */
export function retierUntieredEu(project: FactoryProject): FactoryProject {
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
  const tierOfGenerator = new Map<string, VoltageTier>();
  for (const node of project.nodes) {
    const output = recipesById.get(node.recipeId)?.outputs.find((slot) => slot.kind === "power");
    const tier = output ? euTierOf(output.id) : undefined;
    if (tier) tierOfGenerator.set(node.id, tier);
  }
  const untiered = (edge: FactoryEdge) => edge.resourceKind === "power" && edge.resourceId === UNTIERED_EU;
  if (!project.edges.some((edge) => untiered(edge) && tierOfGenerator.has(edge.source))) {
    return project;
  }

  const storages = project.storages ?? [];
  const storagesById = new Map(storages.map((storage) => [storage.id, storage]));
  // The tiers wired into each untiered EU drawer, lowest first.
  const tiersOfDrawer = new Map<string, VoltageTier[]>();
  for (const edge of project.edges) {
    const tier = untiered(edge) ? tierOfGenerator.get(edge.source) : undefined;
    const drawer = storagesById.get(edge.target);
    if (!tier || drawer?.kind !== "power" || drawer.resourceId !== UNTIERED_EU) continue;
    const tiers = tiersOfDrawer.get(drawer.id) ?? [];
    if (!tiers.includes(tier)) tiers.push(tier);
    tiersOfDrawer.set(drawer.id, tiers);
  }

  // Each drawer's id per tier: the original for its lowest tier, a copy below it for each other.
  const drawerFor = new Map<string, string>();
  const copies: FactoryStorage[] = [];
  const retagged = storages.map((storage) => {
    const tiers = tiersOfDrawer.get(storage.id)?.sort((a, b) => tierOrder(a) - tierOrder(b));
    if (!tiers) return storage;
    tiers.forEach((tier, index) => {
      const id = index === 0 ? storage.id : `${storage.id}:${tier.toLowerCase()}`;
      drawerFor.set(`${storage.id}|${tier}`, id);
      if (index > 0) {
        copies.push({
          ...retag(storage, tier),
          id,
          targetPerSecond: undefined,
          targetMode: undefined,
          position: { x: storage.position.x, y: storage.position.y + 100 * index },
        });
      }
    });
    return retag(storage, tiers[0]!);
  });

  const edges = project.edges.map((edge) => {
    const tier = untiered(edge) ? tierOfGenerator.get(edge.source) : undefined;
    if (!tier) return edge;
    const drawer = drawerFor.get(`${edge.target}|${tier}`);
    return {
      ...edge,
      resourceId: euResource(tier).id,
      sourceHandle: euHandleId("output", tier),
      ...(drawer ? { target: drawer, targetHandle: euHandleId("input", tier) } : {}),
    };
  });

  return { ...project, edges, storages: [...retagged, ...copies] };
}

function retag(storage: FactoryStorage, tier: VoltageTier): FactoryStorage {
  const resource = euResource(tier);
  return { ...storage, resourceId: resource.id, displayName: resource.displayName };
}
