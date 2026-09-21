import { z } from 'zod';

type _JsonValue = string | number | boolean | null | _JsonValue[] | { [key: string]: _JsonValue };
const _ZodJson: z.ZodType<_JsonValue> = z.lazy(() =>
    z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(_ZodJson), z.record(z.string(), _ZodJson)]),
);

/**
 * generated from [ApiInfo](../../../../contracts/rhapsode.public.ck#L63)
 */
export const ApiInfo = z.looseObject({
    title: z.string(),
    version: z.string().describe("The running core's package version. Not the contract."),
});
export type ApiInfo = z.infer<typeof ApiInfo>;

/**
 * This file, `rhapsode.types.ck` and `rhapsode.openai.ck` as OpenAPI 3.1. protocol.md § 9. Only the
 * top of the document is declared: the rest is OpenAPI's own shape, and a client that wants it typed
 * already has a library that types it.
 * generated from [OpenApiDocument](../../../../contracts/rhapsode.public.ck#L56)
 */
export const OpenApiDocument = z.looseObject({
    openapi: z.string(),
    info: ApiInfo,
    paths: z.record(z.string(), _ZodJson),
    components: z.record(z.string(), _ZodJson).optional(),
});
export type OpenApiDocument = z.infer<typeof OpenApiDocument>;
