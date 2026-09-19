import type { OpenApiDocument } from '@maroonedsoftware/rhapsode-sdk';

/**
 * The part of an OpenAPI schema object this page draws. The contract declares only the top of the
 * document (§ 9), so the rest is read defensively: a field this does not know is ignored, never a
 * failure, which is the rule § 9 sets for every client.
 */
export interface Schema {
    $ref?: string;
    type?: string | string[];
    format?: string;
    description?: string;
    enum?: unknown[];
    properties?: Record<string, Schema>;
    required?: string[];
    items?: Schema;
    additionalProperties?: Schema | boolean;
    allOf?: Schema[];
    oneOf?: Schema[];
    anyOf?: Schema[];
}

export interface Parameter {
    name: string;
    in: string;
    required: boolean;
    description?: string;
    schema?: Schema;
}

export interface Body {
    contentType: string;
    schema?: Schema;
}

export interface Response {
    status: string;
    description?: string;
    bodies: Body[];
}

export interface Operation {
    /** `GET /engines`, which is unique in a document and readable in a URL fragment. */
    key: string;
    method: string;
    path: string;
    operationId?: string;
    description?: string;
    parameters: Parameter[];
    request: Body[];
    responses: Response[];
    /**
     * Answers loopback callers, or a bearer token when one is configured, and nobody else. Read from
     * the document rather than known per route: § 6 reserves `forbidden`, 403, for "a management
     * route called from somewhere it does not answer", so declaring a 403 is what makes one.
     */
    management: boolean;
}

export interface OperationGroup {
    /** The first path segment, `/engines`. Generic on purpose: a new route files itself. */
    name: string;
    operations: Operation[];
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

const SCHEMA_REF = '#/components/schemas/';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The model a `$ref` names, or undefined for a reference this page cannot follow. */
export function refName(ref: string | undefined): string | undefined {
    return ref?.startsWith(SCHEMA_REF) ? ref.slice(SCHEMA_REF.length) : undefined;
}

function bodies(content: unknown): Body[] {
    if (!isObject(content)) return [];
    return Object.entries(content).map(([contentType, media]) => ({
        contentType,
        schema: isObject(media) && isObject(media.schema) ? (media.schema as Schema) : undefined,
    }));
}

function parameters(value: unknown): Parameter[] {
    if (!Array.isArray(value)) return [];
    return value.filter(isObject).map(parameter => ({
        name: String(parameter.name),
        in: String(parameter.in),
        required: parameter.required === true,
        description: typeof parameter.description === 'string' ? parameter.description : undefined,
        schema: isObject(parameter.schema) ? (parameter.schema as Schema) : undefined,
    }));
}

/** Every operation in the document, grouped by the first segment of its path, in document order. */
export function operationGroups(document: OpenApiDocument): OperationGroup[] {
    const groups = new Map<string, Operation[]>();
    for (const [path, item] of Object.entries(document.paths)) {
        if (!isObject(item)) continue;
        const shared = parameters(item.parameters);
        for (const method of METHODS) {
            const operation = item[method];
            if (!isObject(operation)) continue;
            const responses = isObject(operation.responses)
                ? Object.entries(operation.responses).map(([status, response]) => ({
                      status,
                      description: isObject(response) && typeof response.description === 'string' ? response.description : undefined,
                      bodies: isObject(response) ? bodies(response.content) : [],
                  }))
                : [];
            const name = `/${path.split('/')[1] ?? ''}`;
            const group = groups.get(name) ?? [];
            group.push({
                key: `${method.toUpperCase()} ${path}`,
                method: method.toUpperCase(),
                path,
                operationId: typeof operation.operationId === 'string' ? operation.operationId : undefined,
                description: typeof operation.description === 'string' ? operation.description : undefined,
                parameters: [...shared, ...parameters(operation.parameters)],
                request: isObject(operation.requestBody) ? bodies(operation.requestBody.content) : [],
                responses,
                management: responses.some(response => response.status === '403'),
            });
            groups.set(name, group);
        }
    }
    return [...groups].map(([name, operations]) => ({ name, operations }));
}

/** Every model the document declares, by name, in declaration order. */
export function models(document: OpenApiDocument): [string, Schema][] {
    const schemas: unknown = document.components?.schemas;
    if (!isObject(schemas)) return [];
    return Object.entries(schemas).flatMap(([name, schema]): [string, Schema][] => (isObject(schema) ? [[name, schema as Schema]] : []));
}

export interface Property {
    name: string;
    schema: Schema;
    required: boolean;
}

/**
 * The properties of an object schema, with every `allOf` member merged in: `EngineSpeakRequest` is
 * `SpeakRequest` and an `engine`, and a reader wants the one list a request actually takes.
 */
export function properties(schema: Schema, schemas: Record<string, Schema>, seen: Set<string> = new Set()): Property[] {
    const name = refName(schema.$ref);
    if (name !== undefined) {
        const target = schemas[name];
        if (target === undefined || seen.has(name)) return [];
        return properties(target, schemas, new Set(seen).add(name));
    }
    const own = Object.entries(schema.properties ?? {}).map(([key, value]) => ({
        name: key,
        schema: value,
        required: schema.required?.includes(key) ?? false,
    }));
    return [...(schema.allOf ?? []).flatMap(member => properties(member, schemas, seen)), ...own];
}
