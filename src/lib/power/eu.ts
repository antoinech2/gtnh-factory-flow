import { GT_VOLTAGE_TIERS } from "@/lib/model/tiers";
import type { MachineTier } from "@/lib/model/types";

export type VoltageTier = Exclude<MachineTier, "DEMO">;

/**
 * EU is one resource per voltage tier (`power:eu:lv`, `power:eu:mv`, ...): a power network is an EU drawer of one
 * tier (docs/power-networks.md). Ids compare strictly, so a generator or machine of one tier never wires to a network
 * of another; only a transformer joins two tiers.
 */
const EU_PREFIX = "eu:";

/** The id of a tier's EU: `eu:lv`, `eu:luv`. Lowercased tier names stay distinct (LuV is "luv"). */
export function euResourceId(tier: VoltageTier): string {
  return `${EU_PREFIX}${tier.toLowerCase()}`;
}

/** The tier an EU id names; undefined for the untiered `eu` of older plans and for anything else. */
export function euTierOf(resourceId: string): VoltageTier | undefined {
  if (!resourceId.startsWith(EU_PREFIX)) return undefined;
  const name = resourceId.slice(EU_PREFIX.length);
  return GT_VOLTAGE_TIERS.find((entry) => entry.tier.toLowerCase() === name)?.tier;
}

/**
 * GT's output loss (BaseMetaTileEntity): every EU-producing block, generators and transformers alike, draws
 * 2^max(0, tier - 1) EU more than each packet of its output tier carries (ULV and LV: 1, MV: 2, HV: 4).
 */
export function euPacketLoss(tier: VoltageTier): number {
  const index = GT_VOLTAGE_TIERS.findIndex((entry) => entry.tier === tier);
  return 2 ** Math.max(0, index - 1);
}

/** A port's or drawer's handle for a tier's EU (`input:power:eu%3Alv`), as the board names every handle. */
export function euHandleId(side: "input" | "output", tier: VoltageTier): string {
  return `${side}:power:${encodeURIComponent(euResourceId(tier))}`;
}

/** A tier's EU as a resource: wires, ports and drawers carry it like any resource, in EU per second. */
export function euResource(tier: VoltageTier) {
  return {
    kind: "power" as const,
    id: euResourceId(tier),
    displayName: `${tier} EU`,
    // The power amber of the POWER button, as the untiered EU wore it.
    dominantColor: "#fbbf24",
  };
}
