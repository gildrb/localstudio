import { Schema } from "effect";

export type Json = null | boolean | number | string | Json[] | RecordJson;
export type RecordJson = { [key: string]: Json };

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
