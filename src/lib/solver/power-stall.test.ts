import { describe, expect, it } from "vitest";
import type { Recipe } from "@/lib/model/types";
import { describePowerStall, getNodePowerReport, powerStallWord } from "./power-report";

/** A 480 EU/t HV recipe on a multiblock (the table marks the LCR one), as an EBF's HV recipes are. */
const recipe = {
  id: "lcr-hv",
  name: "LCR test",
  machineType: "Large Chemical Reactor",
  minimumTier: "HV",
  durationTicks: 400,
  eut: 480,
  inputs: [],
  outputs: [],
} as unknown as Recipe;

const hatches = (tier: "LV" | "MV" | "HV", amps: number) =>
  getNodePowerReport(recipe, { overclockTier: tier, hatchVoltageTier: tier, hatchAmps: amps, powerInputMode: "amps" });

describe("a multiblock's power stall", () => {
  it("runs an HV recipe on two MV hatches: 4A at 128 V carries 480 EU/t", () => {
    expect(hatches("MV", 4).state).toBe("ok");
  });

  it("asks for amps, not a tier, on one MV hatch", () => {
    const report = hatches("MV", 1);
    expect(report.state).toBe("under-powered");
    expect(powerStallWord(report)).toBe("LOW!");
    expect(describePowerStall(report)).toContain("Add amperage or raise the tier.");
  });

  it("names the lowest hatch tier that runs it when the hatches are too low", () => {
    const report = hatches("LV", 16);
    expect(report.state).toBe("over-tier");
    expect(powerStallWord(report)).toBe("TIER!");
    expect(describePowerStall(report)).toBe("Won't run at LV: this recipe needs at least MV hatches, with enough amps.");
  });
});
