import { useCatalog } from '../../api/catalog.queries';

/**
 * An engine's name as its catalog entry writes it ("Chatterbox"), for the places that are handed
 * only its id: a job, a resident model, a keep-alive setting. The id is the answer until the catalog
 * has loaded, and for an engine configured by hand that the catalog does not list.
 */
export function useEngineName(): (id: string) => string {
    const catalog = useCatalog();
    return id => catalog.data?.find(entry => entry.id === id)?.displayName ?? id;
}
