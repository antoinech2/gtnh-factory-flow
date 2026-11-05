import { describe, expect, it } from "vitest";
import { getVoltageTierMaxEuT, getVoltageTierWithinEuT } from "@/lib/model/tiers";
import { buildPowerRecipe } from "./power-recipe";
import { getPowerSource } from "./registry";

/** Dynamo hatches on multiblock generators (dynamos.ts): the voltage their EU leaves at, and the explosion rule. */
const lge = (settings?: Record<string, string>) => buildPowerRecipe("large-gas-turbine", settings, "lge")!;
const euOf = (recipe: ReturnType<typeof lge>) => recipe.outputs.find((slot) => slot.kind === "power")!;

describe("dynamos", () => {
  it("are offered on multiblock generators only", () => {
    expect(getPowerSource("large-gas-turbine")!.settings.some((s) => s.id === "dynamoTier")).toBe(true);
    // Singleblocks, transformers and boilers have their own voltage, or none.
    for (const id of ["gas-turbine", "transformer", "solar-panel", "rtg", "large-steel-boiler"]) {
      expect(getPowerSource(id)!.settings.some((s) => s.id === "dynamoTier")).toBe(false);
    }
  });

  it("on Auto put the EU out at the highest voltage inside the EU/t, with the amps it needs", () => {
    const recipe = lge();
    const euPerTick = recipe.power!.euPerTick;
    const tier = getVoltageTierWithinEuT(euPerTick);
    expect(euOf(recipe).id).toBe(`eu:${tier.toLowerCase()}`);
    const amps = Math.ceil(euPerTick / getVoltageTierMaxEuT(tier) - 1e-9);
    expect(recipe.power!.stats).toContainEqual({ label: "Dynamos", value: `${amps} A ${tier}` });
    expect(recipe.power!.warnings?.join(" ") ?? "").not.toMatch(/explodes/);
  });

  it("on a picked tier put the EU out at that voltage, which picks the network it wires to", () => {
    expect(euOf(lge({ dynamoTier: "LV" })).id).toBe("eu:lv");
    expect(lge({ dynamoTier: "LV" }).power!.tier).toBe("LV");
  });

  it("say the machine explodes when the dynamos carry less than it makes, and never cap its EU", () => {
    const free = lge();
    const euPerTick = free.power!.euPerTick;
    const overloaded = lge({ dynamoTier: "LV", dynamoAmps: "1" });
    expect(overloaded.power!.warnings?.join(" ")).toMatch(/explodes/);
    expect(euOf(overloaded).amount).toBeCloseTo(euPerTick * 20, 9);
    // Enough amps: no warning.
    const enough = String(Math.ceil(euPerTick / 32));
    expect(lge({ dynamoTier: "LV", dynamoAmps: enough }).power!.warnings?.join(" ") ?? "").not.toMatch(/explodes/);
  });
});
