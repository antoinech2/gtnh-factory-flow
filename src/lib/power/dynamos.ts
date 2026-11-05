/**
 * Dynamo hatches on the multiblock generators: the voltage their EU leaves at, so the power network they wire to
 * (docs/power-networks.md), and how many amps they carry. GT5U `MTEMultiBlockBase.addEnergyOutputMultipleDynamos`
 * (tag 5.09.54.20): a multiblock making more EU/t than its dynamos' voltage x amps explodes; nothing is capped or lost.
 * So the card says so, and the rate stays what the machine makes.
 */
import { GT_VOLTAGE_TIERS, getVoltageTierMaxEuT, getVoltageTierWithinEuT } from "@/lib/model/tiers";
import { buildPowerSettingsReader, type PowerModel, type PowerSourceDefinition } from "./types";
import { formatAmount, stat } from "./sources/helpers";
import type { VoltageTier } from "./eu";

const AUTO = "auto";

/** Whether a source is a multiblock generator that has no voltage of its own: EU out, no tier, no EU in. */
function needsDynamos(source: PowerSourceDefinition): boolean {
  const model = source.compute(buildPowerSettingsReader(source, undefined));
  return model.euPerTick > 0 && !model.outputTier && !model.euInput && !model.euOutput;
}

/** The source with its dynamo settings, or the source itself when it is not a multiblock generator. */
export function withDynamos(source: PowerSourceDefinition): PowerSourceDefinition {
  if (!needsDynamos(source)) return source;
  return {
    ...source,
    settings: [
      ...source.settings,
      {
        type: "select",
        id: "dynamoTier",
        label: "Dynamo",
        options: [
          { key: AUTO, label: "Auto (fits its EU/t)" },
          ...GT_VOLTAGE_TIERS.map(({ tier }) => ({ key: tier, label: tier })),
        ],
        defaultKey: AUTO,
      },
      {
        type: "number",
        id: "dynamoAmps",
        label: "Dynamo amps",
        min: 0,
        max: 16_777_216,
        step: 1,
        defaultValue: 0,
        unit: "A (0 = as many as it needs)",
      },
    ],
    compute(read): PowerModel {
      const model = source.compute(read);
      if (!(model.euPerTick > 0)) return model;
      const picked = read.select("dynamoTier");
      const tier: VoltageTier =
        picked === AUTO ? getVoltageTierWithinEuT(model.euPerTick) : (picked as VoltageTier);
      const voltage = getVoltageTierMaxEuT(tier);
      const needed = Math.ceil(model.euPerTick / voltage - 1e-9);
      const amps = read.number("dynamoAmps") > 0 ? read.number("dynamoAmps") : needed;
      const carried = amps * voltage;
      const overloaded = model.euPerTick > carried + 1e-9;
      return {
        ...model,
        outputTier: tier,
        stats: [...model.stats, stat("Dynamos", `${formatAmount(amps)} A ${tier}`)],
        warnings: overloaded
          ? [
              ...(model.warnings ?? []),
              `Its dynamos carry ${formatAmount(carried)} EU/t at ${tier}, less than the ${formatAmount(model.euPerTick)} EU/t it makes: in the game it explodes. Give it ${needed} A.`,
            ]
          : model.warnings,
      };
    },
  };
}
