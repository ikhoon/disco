// Tell TypeScript about Bun's `with { type: 'text' }` imports for the shell
// completion scripts that the `completions` command embeds. Runtime resolution
// is handled by Bun's loader; we just need the types. The zsh script is named
// `_disco` (no extension — a zsh compdef requirement), so it needs a
// path-suffix wildcard rather than an extension wildcard.
declare module "*/_disco" {
  const content: string;
  export default content;
}

declare module "*.bash" {
  const content: string;
  export default content;
}
