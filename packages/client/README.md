# Vera TypeScript client

`@vera/client` uses the OpenAPI document as the source of truth for its HTTP
operations, request and response types, and runtime response validation. It
also retains a thin compatibility facade for the existing Vera SDK experience.

- `src/generated` is an ignored build artifact produced from
  `apps/api/openapi/vera.openapi.json`. Do not edit or commit it.
- The package root exports every generated operation, model, and Zod schema.
  `createVeraGeneratedClient` creates an isolated generated Axios client for
  direct use. New endpoints therefore do not require handwritten client code.
- `src/client.ts`, `src/domains`, and `src/http` preserve existing convenience
  method names, Vera error normalization, cancellation, and polling. Every
  ordinary JSON method delegates to a generated operation, whose generated Zod
  schema validates the response.
- `src/compatibility/validation.ts` preserves the previously exported
  `assert*` and `is*` helpers as thin wrappers over those generated schemas; it
  does not define another copy of an API resource contract.
- Handwritten HTTP remains only where it adds protocol behavior the generated
  layer does not yet model: binary uploads, audio transcription, resumable
  server-sent events, and attachment preview URL construction.
- `src/sdk-types.ts` contains only aliases derived from generated models and
  SDK-only types such as polling options and stream events. There are no
  handwritten copies of API resource or request/response contracts.

Generate the low-level client from the repository root:

```sh
npm run client:generate
```

Package installation generates the client automatically. The root
`npm run check` generates it once before compiling or testing any consumer
workspace. Build, test, and typecheck do not regenerate independently, so they
can run concurrently without deleting files another process is importing.
After changing the OpenAPI artifact, run `npm run client:generate` explicitly
before invoking an individual workspace command.

Generated internal imports deliberately use `.ts` specifiers so Metro can load
the package's React Native/browser source export. TypeScript rewrites those
specifiers to `.js` in compiled output for Node. Keep both paths working and run
the all-platform production build after changing generator or export settings.

The generator and Axios versions are pinned so a dependency update cannot
silently change the SDK. Update them deliberately, regenerate, and inspect the
result locally before merging the dependency change. The generation lifecycle
also converts closed generated Zod objects to strict objects, matching the
OpenAPI contract's `additionalProperties: false` behavior.
