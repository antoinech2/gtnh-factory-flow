import { describe, expect, it } from "vitest";
import type { FactoryEdge, FactoryNode, FactoryProject, FactoryStorage } from "@/lib/model/types";
import { PROJECT_SCHEMA_VERSION } from "@/lib/model/types";
import { normalizeLoadedProject } from "@/lib/model/project-normalize";
import { buildPowerRecipe } from "./power-recipe";
import { retierUntieredEu } from "./eu-wires";

function generator(id: string, tier: string): { node: FactoryNode; recipe: NonNullable<ReturnType<typeof buildPowerRecipe>> } {
  const recipe = buildPowerRecipe("gas-turbine", { tier, fuel: "Benzene" }, `recipe-${id}`)!;
  return {
    recipe,
    node: {
      id,
      recipeId: recipe.id,
      machineCount: 1,
      parallel: 1,
      overclockTier: "LV",
      enabled: true,
      position: { x: 0, y: 0 },
      machineConfigTiers: { tier, fuel: "Benzene" },
    } as FactoryNode,
  };
}

const drawer = (id: string, extra?: Partial<FactoryStorage>): FactoryStorage => ({
  id,
  kind: "power",
  resourceId: "eu",
  displayName: "EU",
  position: { x: 0, y: 0 },
  ...extra,
});

/** A wire as an older build stored it: untiered EU, untiered handles. */
const oldWire = (id: string, source: string, target: string): FactoryEdge => ({
  id,
  source,
  target,
  sourceHandle: "output:power:eu",
  targetHandle: "input:power:eu",
  resourceKind: "power",
  resourceId: "eu",
});

function project(parts: Array<ReturnType<typeof generator>>, storages: FactoryStorage[], edges: FactoryEdge[]): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "p",
    name: "p",
    recipes: parts.map((part) => part.recipe),
    nodes: parts.map((part) => part.node),
    storages,
    edges,
    fuelProfiles: [],
  } as FactoryProject;
}

describe("retierUntieredEu", () => {
  it("gives a generator's old EU wire and its drawer the generator's tier", () => {
    const out = retierUntieredEu(
      project([generator("g", "MV")], [drawer("bank", { targetPerSecond: 100 })], [oldWire("w", "g", "bank")]),
    );
    expect(out.edges[0]).toMatchObject({
      resourceId: "eu:mv",
      sourceHandle: "output:power:eu%3Amv",
      target: "bank",
      targetHandle: "input:power:eu%3Amv",
    });
    expect(out.storages).toEqual([
      expect.objectContaining({ id: "bank", resourceId: "eu:mv", displayName: "MV EU", targetPerSecond: 100 }),
    ]);
  });

  it("splits a drawer fed by two tiers into one drawer per tier", () => {
    const out = retierUntieredEu(
      project(
        [generator("lv", "LV"), generator("hv", "HV")],
        [drawer("bank", { targetPerSecond: 100 })],
        [oldWire("a", "hv", "bank"), oldWire("b", "lv", "bank")],
      ),
    );
    // The lowest tier keeps the drawer and its rate; the other gets a copy with no rate.
    expect(out.storages).toEqual([
      expect.objectContaining({ id: "bank", resourceId: "eu:lv", targetPerSecond: 100 }),
      expect.objectContaining({ id: "bank:hv", resourceId: "eu:hv", targetPerSecond: undefined }),
    ]);
    expect(out.edges.find((edge) => edge.id === "a")).toMatchObject({ target: "bank:hv", resourceId: "eu:hv" });
    expect(out.edges.find((edge) => edge.id === "b")).toMatchObject({ target: "bank", resourceId: "eu:lv" });
  });

  it("leaves a plan with no untiered EU wire as it is", () => {
    const plan = project([generator("g", "MV")], [drawer("idle")], []);
    expect(retierUntieredEu(plan)).toBe(plan);
  });

  it("runs in the load funnel, after the generators are rebuilt", () => {
    const part = generator("g", "HV");
    // A stored generator recipe still says untiered EU: the funnel rebuilds it first.
    const stale = {
      ...part.recipe,
      outputs: part.recipe.outputs.map((slot) => (slot.kind === "power" ? { ...slot, id: "eu" } : slot)),
    };
    const loaded = normalizeLoadedProject(
      project([{ ...part, recipe: stale }], [drawer("bank")], [oldWire("w", "g", "bank")]),
    );
    expect(loaded.edges.find((edge) => edge.id === "w")).toMatchObject({ resourceId: "eu:hv", target: "bank" });
    expect(loaded.storages?.find((storage) => storage.id === "bank")?.resourceId).toBe("eu:hv");
  });
});
