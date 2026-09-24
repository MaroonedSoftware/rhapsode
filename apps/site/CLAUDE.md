# The website

`apps/site` is the public site at `https://maroonedsoftware.github.io/rhapsode/`: a Docusaurus build
whose front page is a React page (`src/pages/index.tsx`) and whose docs live under `/docs`. It is not
part of the server. Nothing here ships in the image and nothing in the core reads it. Its approach is
deadair's `apps/site`, so somebody who knows one knows the other; its content and its look are its own.

`pnpm --filter @rhapsode/site start` serves it on :8082; `build` writes `dist/`. It has no `dev`
script on purpose, so `pnpm dev` does not start a docs server beside the core and the page.

Every paragraph below is a failure that happened, here or in deadair, and each looks harmless to
undo.

**Every dependency is a devDependency.** The image's build stage installs every workspace member and
then deploys the server with production dependencies only, so anything under `dependencies` here
would be one more thing to reason about with nothing to use it. `.dockerignore` keeps everything but
`package.json` out of the build context for the same reason: editing a page does not invalidate the
source layer and rebuild the core. The manifest stays because the frozen lockfile names the site as a
workspace member.

**No `"type": "module"`.** Docusaurus generates `.docusaurus/*.js` modules that call
`require.resolveWeak`, which the bundler only translates when it parses those files as CommonJS. Mark
the package as ESM and the build fails at static generation with `require.resolveWeak is not a
function`. The ESLint config is `.mjs` for this reason.

**The `browserslist` block is load-bearing.** `future.v4` puts Infima and the theme in CSS cascade
layers. With no `browserslist`, `postcss-preset-env` polyfills the layers into `:not(#\#)` specificity
hacks, and those outrank every override in `src/css/custom.css`: the site comes out in Infima's
default blue. The block is the one Docusaurus's own template ships.

**The colours are the page's, copied.** `src/css/custom.css` restates `apps/web/src/theme.ts`'s
`rhapsode` tuple as Infima's primary scale and `apps/web/src/tokens.css`'s surfaces, in both schemes,
because the page publishes them through Mantine and this site does not load it. If either moves, move
these with it. Links in the dark scheme use index 3 rather than the dark primary shade, which is
4.3:1 on the dark background. The favicon comes from `apps/web/public` through `staticDirectories`,
so the mark has one drawing.

**The Docusaurus-only advisories are overridden in `pnpm-workspace.yaml`,** with the reasons beside
them. They are the dev server and the bundler, never the image.

**Most pages are copied in, never edited here.** `scripts/docs.sync.mjs` copies `docs/operating.md`,
`docs/protocol.md`, `CONTRIBUTING.md` and the README of every package under `python/` into `docs/`
on every `start` and `build`. The copies are gitignored; edit the source files. The repository's own
rule that `docs/protocol.md` outranks the code holds for its copy too: the site shows the spec, it
does not restate it. A link in a source is written for the repository, so the script rewrites it:
to the copied page when it names a file the script copies (relatively, or by its GitHub URL, which is
how the engine READMEs cite the protocol so the link works off GitHub), and to the file on GitHub
otherwise. A new source is four edits: the list in the script, `sidebars.ts`, `.gitignore`, and the
`inputs` of `@rhapsode/site#build` in `turbo.json`, since turbo does not otherwise know the site reads
outside its package. A new engine's README is caught by the `python/*/README.md` glob there, but not
by the other three.

**There is one sidebar per audience, listed by hand.** `sidebars.ts` holds `run` (operators) and
`build` (engine and client authors), and the navbar has one item per sidebar. Renaming a page fails
the build instead of quietly moving it; a new page has no sidebar until it is added to the list.
