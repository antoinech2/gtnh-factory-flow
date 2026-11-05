import { beforeEach, describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";
import { euHandleId } from "@/lib/power/eu";
import { buildPowerRecipe } from "@/lib/power/power-recipe";
import { useFactoryStore } from "./factory-store";

/**
 * Wiring a power network (docs/power-networks.md): a machine's EU input has no recipe slot, but a wire of its own
 * tier's EU lands on it, from an EU drawer or straight from a generator; EU of another tier never does.
 */
const turbine = buildPowerRecipe("gas-turbine", { tier: "LV", fuel: "Benzene" }, "turbine")!;

function plan(pressTier: string): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "p",
    name: "p",
    planMode: true,
    solveMode: true,
    recipes: [
      turbine,
      {
        id: "press",
        name: "press",
        machineType: "Mock Machine",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 30,
        inputs: [{ kind: "item", id: "ore", amount: 1, displayName: "ore" }],
        outputs: [{ kind: "item", id: "plate", amount: 1, displayName: "plate" }],
      },
    ],
    nodes: [
      { id: "gen", recipeId: "turbine", machineCount: 1, parallel: 1, overclockTier: "LV", enabled: true, position: { x: 0, y: 0 } },
      { id: "press", recipeId: "press", machineCount: 1, parallel: 1, overclockTier: pressTier, enabled: true, position: { x: 400, y: 0 } },
    ],
    storages: [{ id: "grid", kind: "power", resourceId: "eu:lv", displayName: "LV EU", position: { x: 200, y: 0 } }],
    edges: [],
    fuelProfiles: [],
  } as FactoryProject;
}

const LV_EU = {
  kind: "power" as const,
  id: "eu:lv",
  sourceHandle: euHandleId("output", "LV"),
  targetHandle: euHandleId("input", "LV"),
};

describe("power network wiring", () => {
  beforeEach(() => useFactoryStore.getState().setProject(plan("LV")));

  it("wires an LV EU drawer into an LV machine's EU input", () => {
    useFactoryStore.getState().connectNodes("grid", "press", LV_EU);
    expect(useFactoryStore.getState().project.edges).toEqual([
      expect.objectContaining({ source: "grid", target: "press", resourceKind: "power", resourceId: "eu:lv" }),
    ]);
  });

  it("wires an LV generator straight into an LV machine", () => {
    useFactoryStore.getState().connectNodes("gen", "press", LV_EU);
    expect(useFactoryStore.getState().project.edges).toEqual([
      expect.objectContaining({ source: "gen", target: "press", resourceId: "eu:lv" }),
    ]);
  });

  it("refuses LV EU into a machine running at MV", () => {
    useFactoryStore.getState().setProject(plan("MV"));
    useFactoryStore.getState().connectNodes("grid", "press", LV_EU);
    useFactoryStore.getState().connectNodes("gen", "press", LV_EU);
    expect(useFactoryStore.getState().project.edges).toEqual([]);
  });
});
