import { createTheme, type CSSVariablesResolver, type MantineColorsTuple } from '@mantine/core';

/**
 * The whole palette and every component default, in one place.
 *
 * `rhapsode` is the brand colour, an ink indigo. The page is Mantine and nothing else: no
 * CSS-in-JS, no utility framework. A convention for a component belongs in `components` below
 * rather than in a wrapper, so every use of it gets it. The same rules as signet's console.
 */
const rhapsode: MantineColorsTuple = ['#f0efff', '#dedcfa', '#bab6ef', '#938de5', '#736bdc', '#5f55d7', '#5449d6', '#443bbe', '#3b34ab', '#2f2c98'];

const SANS = "'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export const theme = createTheme({
    primaryColor: 'rhapsode',
    primaryShade: { light: 7, dark: 4 },
    colors: { rhapsode },
    fontFamily: SANS,
    fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    headings: { fontFamily: SANS, fontWeight: '650' },
    defaultRadius: 'md',
    cursorType: 'pointer',
    spacing: { xxxs: '2px', xxs: '4px' },
    components: {
        Card: { defaultProps: { withBorder: true, radius: 'md', padding: 'lg' } },
        Button: { defaultProps: { radius: 'md' } },
        Modal: { defaultProps: { radius: 'md' } },
    },
});

/** Points the surfaces at the `--rh-*` tokens in `tokens.css`, so light and dark are one decision there. */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
    variables: {},
    light: { '--mantine-color-body': 'var(--rh-bg)' },
    dark: { '--mantine-color-body': 'var(--rh-bg)' },
});
