import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import { themes as prismThemes } from 'prism-react-renderer';

const repository = 'https://github.com/MaroonedSoftware/rhapsode';

/**
 * Where "Edit this page" goes.
 *
 * The API reference is regenerated from the contracts by `pnpm codegen`, so an edit made to one of
 * its pages is lost on the next run. Those pages link to the contract their area comes from instead:
 * `api-reference/public/…` and `api-reference/models/public/…` both come from
 * `contracts/rhapsode.public.ck`, and the `rhapsode` models from `rhapsode.types.ck`.
 * `api-reference/index.md` is the one page there the generator writes once and leaves alone, so it
 * edits in place like any other. A page copied in by `scripts/docs.sync.mjs` sets `custom_edit_url`
 * to its source, which wins over this.
 */
function editUrl({ docPath }: { docPath: string }): string {
    const [section, ...rest] = docPath.split('/');
    if (section === 'api-reference' && rest.length > 1) {
        const area = rest[0] === 'models' ? rest[1] : rest[0];
        const file = area === 'rhapsode' ? 'types' : area;
        return `${repository}/blob/main/contracts/rhapsode.${file}.ck`;
    }
    return `${repository}/blob/main/apps/site/docs/${docPath}`;
}

const config: Config = {
    title: 'rhapsode',
    tagline: 'A multi-engine speech server: one contract, many TTS models.',
    favicon: 'favicon.svg',

    // The repository's Pages address. A custom domain is a Pages setting plus these two lines.
    url: 'https://maroonedsoftware.github.io',
    baseUrl: '/rhapsode/',
    // GitHub Pages serves `quick-start.html` at `/docs/quick-start` without a redirect, and a
    // trailing slash would give every page two addresses.
    trailingSlash: false,

    future: { v4: true },

    onBrokenLinks: 'throw',
    markdown: {
        // `.md` is CommonMark and `.mdx` is MDX. The pages copied in from the rest of the repository
        // are plain Markdown written for GitHub, and parsing them as MDX would reject any `<` or `{`
        // in prose that GitHub renders happily.
        format: 'detect',
        hooks: { onBrokenMarkdownLinks: 'throw' },
    },

    // The favicon lives with the page and is served from there rather than copied, so the mark has
    // one drawing. Everything in `apps/web/public` is therefore on the site too. `static` holds
    // `openapi.yaml`, which `scripts/docs.sync.mjs` copies from `docs/`.
    staticDirectories: ['static', '../web/public'],

    clientModules: ['./src/fonts.ts'],

    presets: [
        [
            'classic',
            {
                docs: {
                    editUrl,
                    sidebarPath: './sidebars.ts',
                },
                blog: false,
                theme: { customCss: './src/css/custom.css' },
            } satisfies Preset.Options,
        ],
    ],

    themeConfig: {
        // The page follows the operating system, and so does this.
        colorMode: { defaultMode: 'light', respectPrefersColorScheme: true },
        navbar: {
            title: 'rhapsode',
            logo: { alt: '', src: 'favicon.svg' },
            items: [
                { type: 'docSidebar', sidebarId: 'run', label: 'Run it', position: 'left' },
                { type: 'docSidebar', sidebarId: 'build', label: 'Build on it', position: 'left' },
                { type: 'docSidebar', sidebarId: 'api', label: 'API', position: 'left' },
                { href: repository, label: 'GitHub', position: 'right' },
            ],
        },
        footer: {
            links: [
                {
                    title: 'Run it',
                    items: [
                        { label: 'Quick start', to: '/docs/quick-start' },
                        { label: 'Running one', to: '/docs/operating' },
                        { label: 'Engines', to: '/docs/engines' },
                        { label: 'OpenAI clients', to: '/docs/openai' },
                        { label: 'Help', to: '/docs/help' },
                    ],
                },
                {
                    title: 'Build on it',
                    items: [
                        { label: 'Adding an engine', to: '/docs/develop' },
                        { label: 'The protocol', to: '/docs/protocol' },
                        { label: 'API reference', to: '/docs/api-reference' },
                        { label: 'The worker SDK', to: '/docs/develop/worker-sdk' },
                        { label: 'Conformance', to: '/docs/develop/conformance' },
                        { label: 'Contributing', to: '/docs/develop/contributing' },
                    ],
                },
                {
                    title: 'Project',
                    items: [
                        { label: 'Source', href: repository },
                        { label: 'Issues', href: `${repository}/issues` },
                        { label: 'Changelog', href: `${repository}/blob/main/CHANGELOG.md` },
                        { label: 'Security', href: `${repository}/blob/main/SECURITY.md` },
                        { label: 'Code of conduct', href: `${repository}/blob/main/CODE_OF_CONDUCT.md` },
                    ],
                },
            ],
            copyright: 'rhapsode is MIT licensed. Each engine carries its own licence, for its code and for its weights.',
        },
        prism: {
            theme: prismThemes.github,
            darkTheme: prismThemes.oneDark,
            additionalLanguages: ['bash', 'json', 'python'],
        },
    } satisfies Preset.ThemeConfig,
};

export default config;
