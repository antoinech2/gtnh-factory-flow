import { describe, expect, it } from "vitest";
import type { FactoryEdge, FactoryStorage } from "@/lib/model/types";
import { buildPowerRecipe } from "@/lib/power/power-recipe";
import { euHandleId } from "@/lib/power/eu";
import { drawer, node, project, recipe, wire } from "@/lib/solver/plan/adapter/test-kit";
import { calculateThroughput } from "@/lib/solver/throughput";
import { buildRailModel } from "./rail-model";

/**
 * The overview's power networks (docs/power-networks.md): one line per EU drawer with a wire, and what machines draw
 * on no network. An LV gas turbine feeds 4 LV presses at 30 EU/t each (120 EU/t).
 */
const turbine = buildPowerRecipe("gas-turbine", { tier: "LV", fuel: "Benzene" }, "turbine")!;
const press = recipe("press", [["ore", 1]], [["plate", 1]]);
const benzene = turbine.inputs[0]!;
const eu = (id: string, source: string, target: string): FactoryEdge => ({
  id,
  source,
  target,
  sourceHandle: euHandleId("output", "LV"),
  targetHandle: euHandleId("input", "LV"),
  resourceKind: "power",
  resourceId: "eu:lv",
});

function plan(options: { grid: boolean; wired: boolean }) {
  return project({
    recipes: [turbine, press],
    nodes: [node("gen", "turbine"), node("press", "press")],
    storages: [
      { ...drawer("fuel", benzene.id), kind: "fluid" } as FactoryStorage,
      drawer("ore-in", "ore"),
      drawer("plates", "plate", { targetPerSecond: 4, targetMode: "at-least" }),
      ...(options.grid
        ? [{ id: "grid", kind: "power", resourceId: "eu:lv", displayName: "Main LV", position: { x: 0, y: 0 } } as FactoryStorage]
        : []),
    ],
    edges: [
      {
        id: "w-fuel",
        source: "fuel",
        target: "gen",
        targetHandle: `input:fluid:${encodeURIComponent(benzene.id)}`,
        resourceKind: "fluid",
        resourceId: benzene.id,
      },
      wire("w-ore", "ore-in", "press", "ore", {}, { fromDrawer: true }),
      wire("w-plate", "press", "plates", "plate", {}, { toDrawer: true }),
      ...(options.grid ? [eu("w-gen", "gen", "grid")] : []),
      ...(options.grid && options.wired ? [eu("w-press", "grid", "press")] : []),
    ],
  });
}

const networksOf = (p: ReturnType<typeof plan>) => buildRailModel(p, calculateThroughput(p, { generatedAt: "t" })).networks;

describe("the overview's power networks", () => {
  it("lists a network with what it makes, what it gives and the amps its cable must carry", () => {
    const [network, ...rest] = networksOf(plan({ grid: true, wired: true }));
    expect(rest).toEqual([]);
    expect(network).toMatchObject({ storageId: "grid", tier: "LV", label: "Main LV" });
    expect(network!.made).toBeCloseTo(120, 6);
    expect(network!.used).toBeCloseTo(120, 6);
    // Each LV press refills at up to floor(2 x 30 / 32) + 1 = 2 A: 8 A for four, against 3.75 A on average.
    expect(network!.peakAmps).toBe(8);
  });

  it("adds the draw of machines on no network", () => {
    const networks = networksOf(plan({ grid: true, wired: false }));
    expect(networks.map((n) => n.label)).toEqual(["Main LV", "No network"]);
    expect(networks[1]!.used).toBeCloseTo(120, 6);
    expect(networks[1]!.storageId).toBeUndefined();
  });

  it("lists nothing for a plan with no power network", () => {
    expect(networksOf(plan({ grid: false, wired: false }))).toEqual([]);
  });
});
