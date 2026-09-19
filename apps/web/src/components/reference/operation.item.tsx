import { Fragment, type ReactNode } from 'react';
import { Accordion, Badge, Code, Group, Stack, Table, Text, Title, Tooltip } from '@mantine/core';

import type { Body, Operation } from './openapi.view';
import { Prose, SchemaView, TypeLabel } from './schema.view';

/** A method's colour. Reading only is calm, writing is the primary, removing is a warning. */
const METHOD_COLOR: Record<string, string> = { GET: 'blue', POST: 'rhapsode', PUT: 'rhapsode', PATCH: 'rhapsode', DELETE: 'red' };

export function MethodBadge({ method }: { method: string }) {
    return (
        <Badge variant="light" color={METHOD_COLOR[method] ?? 'gray'} w={64} radius="sm" ff="monospace" style={{ flexShrink: 0 }}>
            {method}
        </Badge>
    );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <Stack gap={6}>
            <Title order={4} size="h6" tt="uppercase" c="dimmed">
                {title}
            </Title>
            {children}
        </Stack>
    );
}

/** A request body in full, since it is what a caller writes. */
function RequestBodies({ bodies }: { bodies: Body[] }) {
    return (
        <Stack gap="sm">
            {bodies.map(body => (
                <Stack key={body.contentType} gap={4}>
                    <Text size="xs" ff="monospace" c="dimmed">
                        {body.contentType}
                    </Text>
                    <SchemaView schema={body.schema} />
                </Stack>
            ))}
        </Stack>
    );
}

/**
 * A response body by name, one line per media type. Drawn in full, the error envelope would repeat
 * under every refusal of every route and bury the answer a caller came for. The name links to it.
 */
function ResponseBodies({ bodies }: { bodies: Body[] }) {
    return (
        <Stack gap={2} pl="md">
            {bodies.map(body => (
                <Group key={body.contentType} gap="xs" wrap="nowrap">
                    <Text size="xs" ff="monospace" c="dimmed">
                        {body.contentType}
                    </Text>
                    <TypeLabel schema={body.schema} />
                </Group>
            ))}
        </Stack>
    );
}

/** One route: what it takes and every answer it declares, refusals included. */
export function OperationItem({ operation }: { operation: Operation }) {
    const [summary = '', ...rest] = (operation.description ?? '').split('\n');
    return (
        <Accordion.Item value={operation.key}>
            <Accordion.Control>
                <Group gap="sm" wrap="nowrap">
                    <MethodBadge method={operation.method} />
                    <Text component="code" size="sm" ff="monospace" style={{ overflowWrap: 'anywhere', minWidth: 0 }}>
                        {/* A break opportunity after each slash, so a long path wraps between segments on a phone. */}
                        {operation.path.split('/').map((segment, index) => (
                            <Fragment key={index}>
                                {index > 0 ? (
                                    <>
                                        /<wbr />
                                    </>
                                ) : undefined}
                                {segment}
                            </Fragment>
                        ))}
                    </Text>
                    {operation.management ? (
                        <Tooltip label="Answers loopback callers, or a bearer token when one is configured. protocol.md § 10." withArrow>
                            <Badge variant="outline" color="gray" size="sm" style={{ flexShrink: 0 }}>
                                Management
                            </Badge>
                        </Tooltip>
                    ) : undefined}
                    <Text size="sm" c="dimmed" truncate visibleFrom="sm">
                        {summary.replaceAll('`', '')}
                    </Text>
                </Group>
            </Accordion.Control>
            <Accordion.Panel>
                <Stack gap="md">
                    {/* The summary line is already on the control; only a longer description says more. */}
                    {rest.length > 0 ? <Prose text={operation.description} /> : undefined}
                    {operation.parameters.length > 0 ? (
                        <Section title="Parameters">
                            <Table fz="sm" verticalSpacing={6}>
                                <Table.Tbody>
                                    {operation.parameters.map(parameter => (
                                        <Table.Tr key={`${parameter.in}:${parameter.name}`}>
                                            <Table.Td w="22%">
                                                <Code>{parameter.name}</Code>
                                            </Table.Td>
                                            <Table.Td w="28%">
                                                <TypeLabel schema={parameter.schema} />
                                            </Table.Td>
                                            <Table.Td>
                                                <Text size="sm" c="dimmed">
                                                    in {parameter.in}
                                                    {parameter.required ? ', required' : ''}
                                                </Text>
                                            </Table.Td>
                                        </Table.Tr>
                                    ))}
                                </Table.Tbody>
                            </Table>
                        </Section>
                    ) : undefined}
                    {operation.request.length > 0 ? (
                        <Section title="Request body">
                            <RequestBodies bodies={operation.request} />
                        </Section>
                    ) : undefined}
                    <Section title="Responses">
                        <Stack gap="sm">
                            {operation.responses.map(response => (
                                <Stack key={response.status} gap={4}>
                                    <Group gap="xs">
                                        <Code fw={600}>{response.status}</Code>
                                        <Text size="sm" c="dimmed">
                                            {response.description}
                                        </Text>
                                    </Group>
                                    {response.bodies.length > 0 ? <ResponseBodies bodies={response.bodies} /> : undefined}
                                </Stack>
                            ))}
                        </Stack>
                    </Section>
                </Stack>
            </Accordion.Panel>
        </Accordion.Item>
    );
}
