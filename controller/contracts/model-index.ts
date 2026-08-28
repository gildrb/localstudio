import { Schema } from "effect";
import compactSource from "./model-index.json";

export const ModelIndexVariantSchema = Schema.Struct({
  format: Schema.Literals(["bf16", "fp8", "nvfp4", "q4"]),
  repo: Schema.String,
  official: Schema.Boolean,
  source: Schema.optional(Schema.String),
  allow_patterns: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  size_gb: Schema.NullOr(Schema.Number),
  caveat: Schema.NullOr(Schema.String),
});

export const ModelIndexModelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: Schema.NullOr(Schema.Literals(["fast", "smart"])),
  description: Schema.String,
  params: Schema.String,
  architecture: Schema.optional(Schema.NullOr(Schema.String)),
  total_params_b: Schema.optional(Schema.NullOr(Schema.Number)),
  intelligence_index: Schema.optional(Schema.NullOr(Schema.Number)),
  agentic_index: Schema.optional(Schema.NullOr(Schema.Number)),
  active_params_b: Schema.NullOr(Schema.Number),
  context_tokens: Schema.Number,
  license: Schema.String,
  multimodal: Schema.Boolean,
  notes: Schema.Array(Schema.String),
  variants: Schema.Array(ModelIndexVariantSchema),
});

export const ModelIndexTierSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  blurb: Schema.String,
  models: Schema.Array(ModelIndexModelSchema),
});

/**
 * A launchable registry entry: a model the operator authored (or that was
 * migrated from the old SQLite recipes table), carrying its full serve
 * configuration. `serve` is the recipe body minus id/name — it is validated by
 * the recipe serializer on read, not here, so the recipe shape stays declared
 * exactly once (in contracts/recipes.ts).
 */
export const ModelIndexEntrySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  serve: Schema.Record(Schema.String, Schema.Unknown),
});

export const ModelIndexSchema = Schema.Struct({
  version: Schema.Number,
  updated: Schema.String,
  intelligence_source: Schema.optional(Schema.String),
  tiers: Schema.Array(ModelIndexTierSchema),
  /** Launchable entries. The catalog tiers describe what exists; entries
   *  describe what this controller can actually serve. */
  entries: Schema.optional(Schema.Array(ModelIndexEntrySchema)),
  /** Set once when the old SQLite recipes table was imported. */
  migrated_from_sqlite: Schema.optional(Schema.String),
});

export type ModelIndexResponse = Schema.Schema.Type<typeof ModelIndexSchema>;

const NullableNumber = Schema.NullOr(Schema.Number);
/** Ordered variant row: format, repo, official, source, patterns, size, caveat. */
const CompactVariantSchema = Schema.Tuple([
  Schema.Literals(["bf16", "fp8", "nvfp4", "q4"]),
  Schema.String,
  Schema.Boolean,
  Schema.NullOr(Schema.String),
  Schema.NullOr(Schema.mutable(Schema.Array(Schema.String))),
  NullableNumber,
  Schema.NullOr(Schema.String),
]);
/** Ordered catalog row. Its fields remain separate from launchable entries. */
const CompactModelSchema = Schema.Tuple([
  Schema.String,
  Schema.String,
  Schema.NullOr(Schema.Literals(["fast", "smart"])),
  Schema.String,
  Schema.String,
  Schema.NullOr(Schema.String),
  NullableNumber,
  NullableNumber,
  Schema.Number,
  Schema.String,
  Schema.Boolean,
  Schema.Array(Schema.String),
  NullableNumber,
  NullableNumber,
  Schema.Array(CompactVariantSchema),
]);
/** Ordered tier row: id, label, blurb, models. */
const CompactTierSchema = Schema.Tuple([
  Schema.String,
  Schema.String,
  Schema.String,
  Schema.Array(CompactModelSchema),
]);
const CompactIndexSchema = Schema.Struct({
  v: Schema.Number,
  u: Schema.String,
  s: Schema.optional(Schema.String),
  t: Schema.Array(CompactTierSchema),
});

const compact = Schema.decodeUnknownSync(CompactIndexSchema)(compactSource);
export const bundledModelIndexSource: ModelIndexResponse = Schema.decodeUnknownSync(
  ModelIndexSchema,
)({
  version: compact.v,
  updated: compact.u,
  intelligence_source: compact.s,
  tiers: compact.t.map((tier) => ({
    id: tier[0],
    label: tier[1],
    blurb: tier[2],
    models: tier[3].map((model) => ({
      id: model[0],
      name: model[1],
      role: model[2],
      description: model[3],
      params: model[4],
      architecture: model[5],
      total_params_b: model[6],
      active_params_b: model[7],
      context_tokens: model[8],
      license: model[9],
      multimodal: model[10],
      notes: model[11],
      intelligence_index: model[12],
      agentic_index: model[13],
      variants: model[14].map((variant) => ({
        format: variant[0],
        repo: variant[1],
        official: variant[2],
        source: variant[3] ?? undefined,
        allow_patterns: variant[4] ?? undefined,
        size_gb: variant[5],
        caveat: variant[6],
      })),
    })),
  })),
});
export type ModelIndexEntry = Schema.Schema.Type<typeof ModelIndexEntrySchema>;
