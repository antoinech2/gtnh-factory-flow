/**
 * Every placeable power source, grouped for the picker. Source ids are
 * stored in plans (Recipe.power.sourceId); never rename a shipped id.
 */
import { engineSources } from "./sources/engines";
import { endgameSources } from "./sources/endgame";
import { passiveSources, reactorSources } from "./sources/reactors";
import { railcraftOtherSources } from "./sources/railcraft";
import { singleblockSources } from "./sources/singleblocks";
import { sofcSources } from "./sources/sofc";
import { steamMakerSources } from "./sources/steam-makers";
import { withDynamos } from "./dynamos";
import { transformerSources } from "./sources/transformer";
import { turbineSources } from "./sources/turbines";
import type { PowerGroupId, PowerSourceDefinition } from "./types";

export const POWER_GROUPS: Array<{ id: PowerGroupId; name: string; blurb: string }> = [
  // The planning cards: the custom rate card, the fluid tank and the crop farm are special models
  // (src/lib/model), listed by the picker itself; the Railcraft Water Tank is a source.
  { id: "other", name: "Other", blurb: "Planning cards, transformers, and water from the sky." },
  { id: "burners", name: "Generators", blurb: "Singleblocks: one amp of their tier from fuel." },
  { id: "engines", name: "Engines", blurb: "The big fuel burners: engines and fuel cells." },
  { id: "steam", name: "Boilers and exchangers", blurb: "Everything that makes steam." },
  { id: "turbines", name: "Turbines", blurb: "Steam, gas and plasma through a rotor." },
  { id: "reactors", name: "Reactors", blurb: "Nuclear heat, pebbles and salts." },
  { id: "passive", name: "Solar", blurb: "Power from the sky." },
  { id: "endgame", name: "Endgame", blurb: "Naquadah, fusion, antimatter." },
];

// Multiblock generators get dynamo settings (dynamos.ts): the voltage their EU leaves at.
export const POWER_SOURCES: PowerSourceDefinition[] = [
  ...singleblockSources,
  ...engineSources,
  ...sofcSources,
  ...steamMakerSources,
  ...turbineSources,
  ...reactorSources,
  ...passiveSources,
  ...endgameSources,
  ...railcraftOtherSources,
  ...transformerSources,
].map(withDynamos);

const byId = new Map(POWER_SOURCES.map((source) => [source.id, source]));

export function getPowerSource(sourceId: string): PowerSourceDefinition | undefined {
  return byId.get(sourceId);
}
