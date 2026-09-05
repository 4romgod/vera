# Vera OpenAPI contract

`vera.openapi.json` is the generated, checked-in description of Vera's complete
HTTP API. The Fastify route definitions and their Zod-derived request and
response schemas remain authoritative; do not edit the JSON artifact directly.

Generate the artifact from the repository root:

```sh
npm run openapi:generate
```

Check that it is current and structurally valid:

```sh
npm run openapi:check
```

The contract lives beside `apps/api` because it is an output of the running
server's exact route graph. Generated TypeScript transport code will live in
`packages/client`, where the existing `@vera/client` package can preserve its
runtime validation, error normalization, polling, upload, and streaming SDK
behavior over the generated operations.

Generate that Axios-backed TypeScript client after updating this artifact:

```sh
npm run client:generate
```
