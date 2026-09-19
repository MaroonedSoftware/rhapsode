import { createContext, Fragment, useContext, type ReactNode } from 'react';
import { Anchor, Badge, Code, Table, Text } from '@mantine/core';

import { properties, refName, type Schema } from './openapi.view';

/** What a schema needs from the page around it: the models to resolve against, and a way to open one. */
export interface ModelLinks {
    schemas: Record<string, Schema>;
    show: (name: string) => void;
}

export const ModelLinksContext = createContext<ModelLinks>({ schemas: {}, show: () => {} });

/** The id a model's section carries, so a link and the section cannot drift apart. */
export const modelAnchor = (name: string) => `model-${name}`;

/**
 * A description as the contract wrote it: backticks are code, and a line break is where the comment
 * wrapped rather than a paragraph, so lines are joined.
 */
export function Prose({ text, size = 'sm' }: { text: string | undefined; size?: 'xs' | 'sm' }) {
    if (text === undefined || text.trim() === '') return undefined;
    const parts = text.replace(/\s*\n\s*/g, ' ').split('`');
    return (
        <Text size={size} c="dimmed" maw={760}>
            {parts.map((part, index) => (index % 2 === 1 ? <Code key={index}>{part}</Code> : <Fragment key={index}>{part}</Fragment>))}
        </Text>
    );
}

function ModelLink({ name }: { name: string }) {
    const { show } = useContext(ModelLinksContext);
    return (
        <Anchor
            href={`#${modelAnchor(name)}`}
            ff="monospace"
            size="sm"
            onClick={event => {
                event.preventDefault();
                show(name);
            }}
        >
            {name}
        </Anchor>
    );
}

/** One schema as a type a person reads: `string`, `array of Voice`, `map of string to Dial`. */
export function TypeLabel({ schema }: { schema: Schema | undefined }): ReactNode {
    if (schema === undefined)
        return (
            <Text span size="sm" ff="monospace">
                any
            </Text>
        );
    const name = refName(schema.$ref);
    if (name !== undefined) return <ModelLink name={name} />;

    const members = schema.allOf ?? schema.oneOf ?? schema.anyOf;
    if (members !== undefined) {
        const joiner = schema.allOf ? ' and ' : ' or ';
        return (
            <>
                {members.map((member, index) => (
                    <Fragment key={index}>
                        {index > 0 ? joiner : undefined}
                        <TypeLabel schema={member} />
                    </Fragment>
                ))}
            </>
        );
    }
    if (schema.enum !== undefined) {
        return (
            <Text span size="sm">
                one of{' '}
                {schema.enum.map((value, index) => (
                    <Fragment key={index}>
                        {index > 0 ? ', ' : undefined}
                        <Code>{String(value)}</Code>
                    </Fragment>
                ))}
            </Text>
        );
    }
    if (schema.items !== undefined) {
        return (
            <Text span size="sm">
                array of <TypeLabel schema={schema.items} />
            </Text>
        );
    }
    if (typeof schema.additionalProperties === 'object') {
        return (
            <Text span size="sm">
                map of string to <TypeLabel schema={schema.additionalProperties} />
            </Text>
        );
    }
    const type = Array.isArray(schema.type) ? schema.type.join(' | ') : (schema.type ?? 'any');
    return (
        <Text span size="sm" ff="monospace">
            {schema.format === 'binary' ? 'binary' : type}
        </Text>
    );
}

/** A schema's properties as a table, or its type alone when it has none. */
export function SchemaView({ schema }: { schema: Schema | undefined }) {
    const { schemas } = useContext(ModelLinksContext);
    const rows = schema === undefined ? [] : properties(schema, schemas);
    if (rows.length === 0) return <TypeLabel schema={schema} />;
    return (
        <Table.ScrollContainer minWidth={520}>
            <Table verticalSpacing={6} fz="sm">
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th w="22%">Field</Table.Th>
                        <Table.Th w="28%">Type</Table.Th>
                        <Table.Th>Notes</Table.Th>
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {rows.map(row => (
                        <Table.Tr key={row.name}>
                            <Table.Td>
                                <Code>{row.name}</Code>
                                {row.required ? undefined : (
                                    <Badge ml={6} size="xs" variant="light" color="gray">
                                        optional
                                    </Badge>
                                )}
                            </Table.Td>
                            <Table.Td>
                                <TypeLabel schema={row.schema} />
                            </Table.Td>
                            <Table.Td>
                                <Prose text={row.schema.description} />
                            </Table.Td>
                        </Table.Tr>
                    ))}
                </Table.Tbody>
            </Table>
        </Table.ScrollContainer>
    );
}
