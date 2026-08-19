/**
 *  require-pnpm-publish.mjs
 *
 *  Fails a publish that is being driven by npm instead of pnpm.
 *
 *  Every publishable package here keeps its workspace manifest pointing at TypeScript — that is
 *  what lets the monorepo import a sibling with no build step — and relies on `publishConfig` to
 *  swap `main`, `types` and `exports` over to `dist` for the tarball. **That swap is a pnpm
 *  feature.** npm honours only a handful of publishConfig keys (registry, tag, access) and
 *  ignores the rest, so `npm publish` uploads a package whose entry point is `./src/index.ts`.
 *  npm also leaves `workspace:^` ranges verbatim, which no consumer can install.
 *
 *  Both were verified by packing the same package twice:
 *
 *      npm pack  → main: ./src/index.ts   deps: "@archiyou/meshup": "workspace:^"
 *      pnpm pack → main: ./dist/index.js  deps: "@archiyou/meshup": "^0.3.0"
 *
 *  A published version cannot be replaced, only deprecated, so this is worth a hard stop rather
 *  than a note in a README.
 */

const ua = process.env.npm_config_user_agent ?? '';

if (!ua.startsWith('pnpm/'))
{
    const runner = ua.split('/')[0] || 'an unknown package manager';
    console.error(`
  ✖ Publish this package with pnpm, not ${runner}.

      pnpm publish            # from the package directory
      pnpm -r publish         # or every changed package in the workspace

  Why: the manifest deliberately points at TypeScript for the workspace, and only pnpm applies
  the publishConfig swap that repoints it at dist/ — and only pnpm replaces "workspace:^" with a
  real version. Published through npm, this package's entry point would be a .ts file and its
  dependencies uninstallable.
`);
    process.exit(1);
}
