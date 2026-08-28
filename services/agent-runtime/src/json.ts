import { Schema } from "effect";

export type Json = Schema.Json;
export type JsonObject = Schema.JsonObject;

export const JsonSchema: Schema.Codec<Json, Json> = Schema.suspend(() =>
  Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.String,
    Schema.Array(JsonSchema),
    Schema.Record(Schema.String, JsonSchema),
  ]),
);
