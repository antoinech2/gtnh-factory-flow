import { afterEach, describe, expect, it } from "vitest";
import type { FactoryEdge, FactoryNode, FactoryStorage } from "@/lib/model/types";
import { buildPowerRecipe } from "@/lib/power/power-recipe";
import { euHandleId } from "@/lib/power/eu";
import { getSolveCore, setSolveCore } from "./plan/adapter/engine";
import { drawer, node, project, recipe, wire } from "./plan/adapter/test-kit";
import type { SolveInput } from "./plan/types";
import { calculateThroughput } from "./throughput";

/**
 * Power networks (docs/power-networks.md): an EU drawer of one tier, fed by generators and drawn from by machines,
 * solved as an ordinary buffer. The LV gas turbine makes 32 EU/t (640 EU/s); the press draws 30 EU/t for 20 ticks,
 * 600 EU a craft, one craft a second per machine. Four plates a second want 4 presses, 2400 EU/s, 3.75 turbines.
 */
const turbine = buildPowerRecipe("gas-turbine", { tier: "LV", fuel: "Benzene" }, "turbine")!;
const press = recipe("press", [["ore", 1]], [["plate", 1]]);
const benzene = turbine.inputs[0]!;

const euWire = (id: string, source: string, target: string): FactoryEdge => ({
  id,
  source,
  target,
  sourceHandle: euHandleId("output", "LV"),
  targetHandle: euHandleId("input", "LV"),
  resourceKind: "power",
  resourceId: "eu:lv",
});

function networkPlan(options: { wired: boolean; turbine?: Partial<FactoryNode> }) {
  return project({
    recipes: [turbine, press],
    nodes: [node("gen", "turbine", options.turbine), node("press", "press")],
    storages: [
      { ...drawer("fuel", benzene.id), kind: "fluid" } as FactoryStorage,
      drawer("ore-in", "ore"),
      drawer("plates", "plate", { targetPerSecond: 4, targetMode: "at-least" }),
      { id: "grid", kind: "power", resourceId: "eu:lv", displayName: "LV EU", position: { x: 0, y: 0 } },
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
      euWire("w-gen", "gen", "grid"),
      ...(options.wired ? [euWire("w-press", "grid", "press")] : []),
    ],
  });
}

/** Solves with the real core and keeps the input it was given. */
function solve(p: ReturnType<typeof networkPlan>) {
  const core = getSolveCore();
  let input!: SolveInput;
  setSolveCore((given) => {
    input = given;
    return core(given);
  });
  const result = calculateThroughput(p, { generatedAt: "t" });
  return { input, result };
}

afterEach(() => setSolveCore(undefined));

describe("power networks", () => {
  it("sends a machine's EU to the solve only when a network is wired to it, after the recipe's rows", () => {
    const pressOf = (input: SolveInput) => input.machines.find((machine) => machine.id === "press")!;
    const unwired = pressOf(solve(networkPlan({ wired: false })).input);
    const wired = pressOf(solve(networkPlan({ wired: true })).input);
    // Unwired: the recipe's own row alone, as before power networks.
    expect(unwired.inputs).toHaveLength(1);
    // Wired: the same row at the same index, then the EU it takes a craft.
    expect(wired.inputs).toHaveLength(2);
    expect(wired.inputs[0]).toEqual(unwired.inputs[0]);
    expect(wired.inputs[1]!.amount).toBeCloseTo(600, 9);
  });

  it("sizes the generators to what the network's machines draw", () => {
    const { result } = solve(networkPlan({ wired: true }));
    expect(result.nodes.press?.theoreticalMachinesRequired).toBeCloseTo(4, 9);
    expect(result.nodes.gen?.theoreticalMachinesRequired).toBeCloseTo(3.75, 9);
    expect(result.edges["w-gen"]?.transferredPerSecond).toBeCloseTo(2400, 6);
    expect(result.edges["w-press"]?.transferredPerSecond).toBeCloseTo(2400, 6);
    // The network never brings EU in from outside the plan.
    expect(result.plan?.forced).toEqual([]);
  });

  it("an Up to generator count holds the machines back, as a short grid does in the game", () => {
    const { result } = solve(networkPlan({ wired: true, turbine: { solvePin: 2 } }));
    // Two turbines, 1280 EU/s: 2.13 presses' worth.
    expect(result.nodes.press?.theoreticalMachinesRequired).toBeCloseTo(1280 / 600, 9);
    expect(result.plan?.forced).toEqual([]);
    expect(result.plan?.upTo?.gen).toMatchObject({ reason: "BOTTLENECK", wants: 3.75 });
    expect(result.plan?.shortfalls?.[0]).toMatchObject({ drawerId: "plates", limitingCards: ["gen"] });
  });

  it("a transformer joins an HV network to an MV one and is sized like a machine", () => {
    // HV turbine -> HV drawer -> HV-to-MV transformer -> MV drawer -> 4 MV presses at 100 EU/t (8000 EU/s).
    const hvTurbine = buildPowerRecipe("gas-turbine", { tier: "HV", fuel: "Benzene" }, "hv-turbine")!;
    const step = buildPowerRecipe("transformer", { tier: "HV", mode: "down", type: "normal" }, "step")!;
    const mvPress = { ...recipe("mv-press", [["ore", 1]], [["plate", 1]]), eut: 100, minimumTier: "MV" };
    const eu = (id: string, source: string, target: string, tier: "HV" | "MV"): FactoryEdge => ({
      id,
      source,
      target,
      sourceHandle: euHandleId("output", tier),
      targetHandle: euHandleId("input", tier),
      resourceKind: "power",
      resourceId: `eu:${tier.toLowerCase()}`,
    });
    const p = project({
      recipes: [hvTurbine, step, mvPress],
      nodes: [node("gen", "hv-turbine"), node("step", "step"), node("press", "mv-press", { overclockTier: "MV" })],
      storages: [
        { ...drawer("fuel", benzene.id), kind: "fluid" } as FactoryStorage,
        drawer("ore-in", "ore"),
        drawer("plates", "plate", { targetPerSecond: 4, targetMode: "at-least" }),
        { id: "hv", kind: "power", resourceId: "eu:hv", displayName: "HV EU", position: { x: 0, y: 0 } },
        { id: "mv", kind: "power", resourceId: "eu:mv", displayName: "MV EU", position: { x: 0, y: 0 } },
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
        eu("w-gen", "gen", "hv", "HV"),
        eu("w-hv", "hv", "step", "HV"),
        eu("w-step", "step", "mv", "MV"),
        eu("w-mv", "mv", "press", "MV"),
      ],
    });
    const { result } = solve(p);
    const mvNeeded = 4 * 100 * 20;
    // One block moves 512 EU/t of HV; each 128 EU MV packet costs 130.
    const perBlock = 512 * 20 * (128 / 130);
    expect(result.nodes.press?.theoreticalMachinesRequired).toBeCloseTo(4, 9);
    expect(result.nodes.step?.theoreticalMachinesRequired).toBeCloseTo(mvNeeded / perBlock, 9);
    expect(result.edges["w-mv"]?.transferredPerSecond).toBeCloseTo(mvNeeded, 6);
    expect(result.edges["w-hv"]?.transferredPerSecond).toBeCloseTo((mvNeeded * 130) / 128, 6);
    const hvPerTurbine = hvTurbine.outputs.find((slot) => slot.kind === "power")!.amount;
    expect(result.nodes.gen?.theoreticalMachinesRequired).toBeCloseTo((mvNeeded * 130) / 128 / hvPerTurbine, 9);
    expect(result.plan?.forced).toEqual([]);
  });

  it("an Exactly generator count too small shows the EU the network lacks as a Forced in row", () => {
    // The solver's doctrine for any resource under a fixed count; the board has to read it as a shortage.
    const { result } = solve(networkPlan({ wired: true, turbine: { solvePin: 2, solvePinExact: true } }));
    expect(result.nodes.press?.theoreticalMachinesRequired).toBeCloseTo(4, 9);
    expect(result.plan?.forced).toEqual([
      expect.objectContaining({ nodeId: "press", side: "in", resourceKey: "power:eu:lv", perSecond: expect.closeTo(1120, 6) }),
    ]);
  });
});
