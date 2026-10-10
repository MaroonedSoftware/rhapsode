/**
 * A key an adapter chose, written as words: `cfgWeight` reads "CFG weight", `top_p` "Top P". Dials
 * and deliveries are named by each engine's adapter and the capability document carries no label
 * for them (§ 4), so this is the whole of the page's say in how they read; nothing here knows any
 * engine.
 *
 * A part of three letters or fewer with no vowel is taken for an initialism, which is what `cfg` is.
 */
export function keyWords(key: string): string {
    const parts = key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[\s_-]+/)
        .filter(part => part.length > 0)
        .map(part => (part.length <= 3 && !/[aeiouy]/i.test(part) ? part.toUpperCase() : part.toLowerCase()));
    if (parts.length === 0) return key;
    const [first, ...rest] = parts;
    return [first!.charAt(0).toUpperCase() + first!.slice(1), ...rest].join(' ');
}
