import { Schema } from "effect";

export type Json = Schema.MutableJson;
export type RecordJson = Schema.MutableJsonObject;

export const JsonSchema: Schema.Codec<Json, Json> = Schema.suspend(() =>
  Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.String,
    Schema.mutable(Schema.Array(JsonSchema)),
    Schema.Record(Schema.String, JsonSchema),
  ]),
);
export const JsonRecordSchema = Schema.Record(Schema.String, JsonSchema);
