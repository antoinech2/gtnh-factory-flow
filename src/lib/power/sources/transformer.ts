/**
 * GregTech transformers (wiki, Electricity: "Transformers", "Power Transformer and Hi-Amp Transformer"): the only
 * bridge between two power networks of different voltages (docs/power-networks.md). One block moves, every tick, the
 * high side's voltage times its amps: Normal 1 A high to 4 A low, Hi-Amp 4 A to 16 A, Power 16 A to 64 A. A soft mallet
 * turns it from step-down to step-up. Its output pays GT's output loss like every EU-producing block: each packet of
 * the output tier draws 2^max(0, tier - 1) EU more than it carries.
 */
import { GT_VOLTAGE_TIERS } from "@/lib/model/tiers";
import { euPacketLoss, type VoltageTier } from "../eu";
import type { PowerModel, PowerSourceDefinition } from "../types";
import { formatAmount, percent, stat } from "./helpers";

const TYPES = [
  { key: "normal", label: "Transformer (1 A to 4 A)", highAmps: 1 },
  { key: "hi-amp", label: "Hi-Amp (4 A to 16 A)", highAmps: 4 },
  { key: "power", label: "Power (16 A to 64 A)", highAmps: 16 },
] as const;

/** Every tier with one below it: the transformer is named by its high side. */
const HIGH_TIERS = GT_VOLTAGE_TIERS.slice(1).map((entry, index) => ({
  high: entry.tier,
  low: GT_VOLTAGE_TIERS[index]!.tier,
  voltage: entry.maxEuT,
  lowVoltage: GT_VOLTAGE_TIERS[index]!.maxEuT,
}));

export const transformer: PowerSourceDefinition = {
  id: "transformer",
  name: "Transformer",
  group: "other",
  unlock: "LV",
  blurb: "Joins two power networks one voltage apart.",
  settings: [
    {
      type: "select",
      id: "tier",
      label: "Voltages",
      options: HIGH_TIERS.map(({ high, low }) => ({ key: high, label: `${high} and ${low}` })),
      defaultKey: "MV",
    },
    {
      type: "select",
      id: "mode",
      label: "Mode",
      options: [
        { key: "down", label: "Step down" },
        { key: "up", label: "Step up" },
      ],
      defaultKey: "down",
    },
    {
      type: "select",
      id: "type",
      label: "Type",
      options: TYPES.map(({ key, label }) => ({ key, label })),
      defaultKey: "normal",
    },
  ],
  compute(read): PowerModel {
    const tiers = HIGH_TIERS.find((entry) => entry.high === read.select("tier")) ?? HIGH_TIERS[1]!;
    const type = TYPES.find((entry) => entry.key === read.select("type")) ?? TYPES[0];
    const down = read.select("mode") !== "up";
    // What one block moves a tick: the high side's voltage at its amps (the low side's at four times as many).
    const moved = tiers.voltage * type.highAmps;
    const inTier: VoltageTier = down ? tiers.high : tiers.low;
    const outTier: VoltageTier = down ? tiers.low : tiers.high;
    const outVoltage = down ? tiers.lowVoltage : tiers.voltage;
    const loss = euPacketLoss(outTier);
    const out = (moved * outVoltage) / (outVoltage + loss);
    const highAmps = `${type.highAmps} A ${tiers.high}`;
    const lowAmps = `${type.highAmps * 4} A ${tiers.low}`;
    return {
      // Net: it makes no power of its own, it loses some. The machine list counts the loss as its draw.
      euPerTick: out - moved,
      euInput: { tier: inTier, perTick: moved },
      euOutput: { tier: outTier, perTick: out },
      inputs: [],
      outputs: [],
      stats: [
        stat("Takes", down ? highAmps : lowAmps),
        stat("Gives", down ? lowAmps : highAmps),
        stat("EU/t moved", formatAmount(moved)),
        stat("Loss", percent(1 - out / moved)),
      ],
    };
  },
};

/** The Active Transformer's loss on everything through it (wiki, Active Transformer). */
const ACTIVE_LOSS = 0.00004;

/**
 * The Active Transformer (ZPM multiblock, wiki: Active Transformer): any voltage to any other, whatever the amps, at
 * 0.004% loss. What one carries is what its energy hatches take: their amps at the input voltage.
 */
export const activeTransformer: PowerSourceDefinition = {
  id: "active-transformer",
  name: "Active Transformer",
  group: "other",
  unlock: "ZPM",
  blurb: "Joins two power networks of any voltages.",
  settings: [
    {
      type: "select",
      id: "from",
      label: "From",
      options: GT_VOLTAGE_TIERS.map(({ tier }) => ({ key: tier, label: tier })),
      defaultKey: "LuV",
    },
    {
      type: "select",
      id: "to",
      label: "To",
      options: GT_VOLTAGE_TIERS.map(({ tier }) => ({ key: tier, label: tier })),
      defaultKey: "IV",
    },
    {
      type: "number",
      id: "amps",
      label: "Energy hatch amps",
      min: 1,
      max: 16_777_216,
      step: 1,
      defaultValue: 2,
      unit: "A at its input voltage",
    },
  ],
  compute(read): PowerModel {
    const tierOf = (key: string): VoltageTier =>
      GT_VOLTAGE_TIERS.find((entry) => entry.tier === key)?.tier ?? "IV";
    const from = tierOf(read.select("from"));
    const to = tierOf(read.select("to"));
    const amps = read.number("amps");
    const moved = (GT_VOLTAGE_TIERS.find((entry) => entry.tier === from)?.maxEuT ?? 0) * amps;
    const out = moved * (1 - ACTIVE_LOSS);
    return {
      euPerTick: out - moved,
      euInput: { tier: from, perTick: moved },
      euOutput: { tier: to, perTick: out },
      inputs: [],
      outputs: [],
      stats: [
        stat("Takes", `${formatAmount(amps)} A ${from}`),
        stat("Gives", `${formatAmount(out)} EU/t ${to}`),
        stat("Loss", percent(ACTIVE_LOSS)),
      ],
    };
  },
};

export const transformerSources: PowerSourceDefinition[] = [transformer, activeTransformer];
