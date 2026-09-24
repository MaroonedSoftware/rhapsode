import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Accordion, Badge, Button, Code, Stack, TextInput, Title } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';

import { BASE_URL } from '../../api/client';
import { useReference } from '../../api/reference.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { models, operationGroups, type Operation } from './openapi.view';
import { OperationItem } from './operation.item';
import { modelAnchor, ModelLinksContext, Prose, SchemaView } from './schema.view';

function scrollToModel(name: string) {
    // Optional call: jsdom has no scrollIntoView.
    window.document.getElementById(modelAnchor(name))?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}

const matches = (operation: Operation, needle: string) =>
    needle === '' || `${operation.key} ${operation.operationId ?? ''} ${operation.description ?? ''}`.toLowerCase().includes(needle);

/**
 * Every route this server answers, drawn from the document it serves at `GET /openapi.json` rather
 * than a copy of its own (§ 13), so the page describes the core it is talking to and nothing else.
 */
export function ReferencePage() {
    const reference = useReference();
    const [filter, setFilter] = useState('');
    const [openModels, setOpenModels] = useState<string[]>([]);
    // A model asked for before its section was open: scrolled to once the render that opens it lands.
    const pendingScroll = useRef<string>(undefined);

    const document = reference.data;
    const groups = useMemo(() => (document ? operationGroups(document) : []), [document]);
    const declared = useMemo(() => (document ? models(document) : []), [document]);
    const schemas = useMemo(() => Object.fromEntries(declared), [declared]);

    const show = useCallback(
        (name: string) => {
            if (openModels.includes(name)) return scrollToModel(name);
            pendingScroll.current = name;
            setOpenModels([...openModels, name]);
        },
        [openModels],
    );
    const links = useMemo(() => ({ schemas, show }), [schemas, show]);

    useEffect(() => {
        if (pendingScroll.current === undefined) return;
        scrollToModel(pendingScroll.current);
        pendingScroll.current = undefined;
    }, [openModels]);

    const needle = filter.trim().toLowerCase();
    const shown = groups
        .map(group => ({ ...group, operations: group.operations.filter(operation => matches(operation, needle)) }))
        .filter(group => group.operations.length > 0);

    return (
        <Stack gap="lg">
            <PageHeader
                title="API"
                description="Every route this server answers, read from the description it serves to any client. Nothing here is written by hand, so it cannot describe some other version."
                actions={
                    <>
                        {document ? (
                            <Badge variant="light" color="gray" size="lg" className="rh-num">
                                {document.info.version}
                            </Badge>
                        ) : undefined}
                        <Button component="a" href={`${BASE_URL}/openapi.json`} target="_blank" rel="noreferrer" variant="default" size="compact-md">
                            openapi.json
                        </Button>
                    </>
                }
            />
            {reference.isPending ? (
                <PageSkeleton variant="table" />
            ) : reference.isError ? (
                <ErrorAlert title="The API description did not load" error={reference.error} fallback="The rhapsode server did not answer." />
            ) : (
                <ModelLinksContext.Provider value={links}>
                    <TextInput
                        aria-label="Filter routes"
                        placeholder="Filter routes"
                        leftSection={<IconSearch size={16} />}
                        value={filter}
                        onChange={event => setFilter(event.currentTarget.value)}
                        maw={360}
                    />
                    {shown.length === 0 ? (
                        <EmptyState title="No routes match">
                            Nothing in the path, the SDK name or the description contains <Code>{filter.trim()}</Code>.
                        </EmptyState>
                    ) : (
                        shown.map(group => (
                            <Stack key={group.name} gap="xs">
                                <Title order={2} size="h4" ff="monospace">
                                    {group.name}
                                </Title>
                                <Accordion multiple variant="separated" radius="md" chevronPosition="left">
                                    {group.operations.map(operation => (
                                        <OperationItem key={operation.key} operation={operation} />
                                    ))}
                                </Accordion>
                            </Stack>
                        ))
                    )}
                    <Stack gap="xs">
                        <Title order={2} size="h4">
                            Models
                        </Title>
                        <Accordion multiple value={openModels} onChange={setOpenModels} variant="separated" radius="md" chevronPosition="left">
                            {declared.map(([name, schema]) => (
                                <Accordion.Item key={name} value={name} id={modelAnchor(name)} style={{ scrollMarginTop: 72 }}>
                                    <Accordion.Control>
                                        <Code fz="sm" bg="transparent">
                                            {name}
                                        </Code>
                                    </Accordion.Control>
                                    <Accordion.Panel>
                                        <Stack gap="sm">
                                            <Prose text={schema.description} />
                                            <SchemaView schema={schema} />
                                        </Stack>
                                    </Accordion.Panel>
                                </Accordion.Item>
                            ))}
                        </Accordion>
                    </Stack>
                </ModelLinksContext.Provider>
            )}
        </Stack>
    );
}
