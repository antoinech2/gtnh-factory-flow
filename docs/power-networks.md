# Power networks

Status: steps 1 to 3 built (tiered EU, EU input rows, the adapter), with wiring on the board and the overview.
Website only for now; the mod (GTNH Planner) does not read these plans yet (see "The mod").

Not built yet: transformers, dynamo settings, the drawer's tier colour and amps, "Connect selection", hiding EU
wires, EU rows on shared-machine sections, and dropping a machine's EU wire when its tier changes (until then the
wire stays drawn but the solve ignores it).

A power network is an EU drawer of one voltage tier. Generators of that tier feed it, machines of that tier draw from
it, and transformers join two tiers. A plan can hold any number of networks side by side, as it holds any number of
item drawers. Today every machine's power is a budget of its own card, generators bank EU into drawers that nothing
draws from, and the solver ignores EU (`MachineIn.energyPerTick` is read-out only).

## Game rules this follows

From the GTNH wiki (https://wiki.gtnewhorizons.com/wiki/Electricity), checked against GT5U `5.09.54.20` where noted.

- Tiers: ULV 8, LV 32, MV 128, HV 512, EV 2,048, IV 8,192, LuV 32,768, ZPM 131,072, UV 524,288, then x4 a tier up to
  MAX (`GT_VOLTAGE_TIERS` in `src/lib/model/tiers.ts`).
- A machine or energy hatch fed above its tier explodes. A cable carrying above its voltage burns. A recipe whose
  minimum voltage is above the supply does not start.
- A singleblock generator puts out 1 A of its tier. A multiblock puts out through its dynamo hatches (1, 4, 16, 64 A,
  and 256 A past UV). Every EU-producing block, transformers included, pays the output loss
  `2^max(0, tier - 1)` EU per amp (3% at LV, 1.5% at MV, halving each tier). Singleblock generators already price it
  (`packetLoss`, `src/lib/power/sources/singleblocks.ts`).
- Transformers: Normal 1 A high side to 4 A low side, Hi-Amp 4 A to 16 A, Power 16 A to 64 A. A soft mallet switches
  step-down and step-up. The Active Transformer (ZPM) joins any two tiers at 0.004% loss with no amp limit.

## The resource: EU per tier

- EU becomes one resource per tier: `power:eu:lv`, `power:eu:mv`, and so on. Port and wire matching compares ids
  strictly, so a generator or machine of one tier can never wire to a network of another, and the explosion case
  cannot be drawn. A transformer is the only bridge between two tiers, as a fluid tank card is between a cell and its
  fluid.
- Flows stay per second (EU/s), like every flow. Display converts to EU/t or amps (the power display dial).
- EU stays out of the resource books (`balances.ts` skips `kind === "power"`), whatever its tier.
- The id is written in one place today (`POWER_EU_RESOURCE`, `src/lib/power/power-recipe.ts`). Everything else tests
  the kind, so a tiered id touches little.

## Ports

- A generator's EU output takes the generator's tier: the singleblocks' Tier setting; for a multiblock, its new dynamo
  settings (tier, amps per hatch, hatch count). A multiblock whose EU/t exceeds what its dynamos carry says so on the
  card. What the game does with the excess (lost or capped) is read from the GT5U source before this is built.
- A machine that draws power gets an EU input row, derived and never stored (`input:power:eu:<tier>`). Its tier is the
  card's run voltage: the machine tier for a singleblock, the energy hatch tier for a multiblock (`getNodeRunTier`).
  Changing that tier changes the row's resource, so its wire comes off, as when a slot's resource changes.
- Amount per craft, before parallels: `energyPerTick * durationTicks / throughputFactor` EU. At full speed this is the
  card's draw in EU/s.
- A shared-machine card has one EU row per section (`r<n>:` prefix), because the solver's ports are per section.
- One wire per EU input row: a machine is on one network.
- Generator cards, custom rate cards, fluid tanks and every card with no draw get no EU input row.

## The network (an EU drawer)

- A `FactoryStorage` of kind `power` whose `resourceId` is `eu:<tier>`. No new schema field.
- Wired to generators only: a product drawer, as today. Wired to machines only: a source drawer (power from outside
  the plan). Wired to both: a buffer drawer (`docs/buffer-drawers.md`), which is the network proper.
- Look: the drawer and its wires wear the tier's colour (`GT_TIER_COLORS`, `src/components/flow/tier-colors.ts`) and
  the tier's name. The figure is what passes through in EU/t and in amps of the network's tier. A label names it
  ("Main MV").
- Optional amp limit (the cable): an At most rule on the network. The website gives a buffer no rule today, so this is
  a later step.

## In the solver

No solver change. The adapter (`src/lib/solver/plan/adapter/model.ts`) sends a wired EU row as an ordinary `PortIn`,
and the buffer drawer as an ordinary `BUFFER` drawer.

- An EU row with no wire is not sent. A plan with no network therefore builds the same `SolveInput` as today, and every
  golden and parity test stays as it is. Its draw stays what it is now: the card's own budget, outside the books.
- A network that makes less than its machines draw has a shortfall. The solver handles it as any buffer's: a Forced in
  row at a machine's EU port (the EU the network lacks), or an Up to card reading STARVED on its EU row.
- A network that makes more than its machines draw has a surplus at a generator's port. Unused EU dissipates in the
  game, so this row reads "Unused", never as a Forced out warning. The closed-plan rule already waives an unwired EU
  output.
- Proven (`src/lib/solver/power-network.test.ts`): an unpinned generator count rises to cover a network's machines,
  with nothing forced in. An Up to generator count holds the machines back (the generator reads BOTTLENECK, the
  product drawer falls short), as a short grid does in the game. An Exactly count too small forces the missing EU in
  at a machine's EU port, as the solver does for any resource under a fixed count: the board must show that row as
  EU the network lacks.
- Scale: EU ports can reach 1e8 EU a craft next to items at 0.03 a second. Dust is judged per network
  (`plan/validate.ts`); a fusion or reactor plan must still solve. If HiGHS struggles, count EU in kEU.

## Transformers

A special card that owns its recipe, like the fluid tank (`ownsItsRecipe`).

- Settings: high tier, type (Normal, Hi-Amp, Power), mode (step-down, step-up).
- Ports: EU of the high tier on one side, of the low tier on the other; which is the input follows the mode.
- One craft a second moves one block's capacity: the high tier's voltage times 1, 4 or 16 A, times 20, in EU/s. Out is
  in times (1 - output loss of the output tier). The solver sizes the count like any machine.
- Later: the Active Transformer as a fourth type (any two tiers, no amp limit, 0.004% loss).

## On the board

- "Connect selection to network": wires every selected card's EU row of the network's tier to it in one undo step.
- A display dial hides or dims EU wires (view only, never a re-solve). Many machines on one network otherwise draw many
  wires.
- The overview rail: a Power section with one line per network, grouped by tier (LV first), with made, used and spare
  in EU/t and amps; a line "Not on a network" for unwired EU rows; the plan total as today.
- Copy (player-facing, English, plain): "Not enough EU on Main MV: 1,200 EU/t short." "Unused: 300 EU/t."

## Old plans

- The load funnel (`project-normalize.ts`) gives each generator's EU output its tier (power recipes are resynthesized
  on load already, `resynthesizePowerRecipes`). An EU drawer wired to it takes the same tier.
- An old EU drawer fed by generators of several tiers splits into one drawer per tier, with a `planNotice`.
- No machine gains a wire on load: every old plan solves exactly as before.

## The mod

The mod reads and writes this plan JSON (`docs/cross-repo-features.md`). Until it learns tiered EU and transformer
cards, a plan with networks opened in the mod may lose its EU wires. Before shipping, read how the mod imports
`power-source` recipes and `power` drawers: if a tiered id breaks plans with no network, keep `power:eu` on generator
outputs that are not wired to a tiered drawer.

## Out of scope

Cable loss per block (the planner has no distances), battery buffers, the wireless EU network (UIV), amp peaks while
machine buffers fill, the global fuel estimate (`fuelEstimate`).

## Order of work

1. Tiered EU ids and the load migration.
2. EU input rows on cards.
3. The adapter, with the "no network, same input" test.
4. The network drawer: tier colour, EU/t and amps, Unused and shortfall read-outs.
5. The transformer card.
6. Dynamo settings on multiblock generators.
7. The overview rail's Power section.
8. Connect selection, hide EU wires.
9. Tests (solver case with two networks and a transformer, adapter, schema round trip), Playwright on the board,
   changelog.
