// Imports
import { expandGlob } from "@std/fs"
import { fromFileUrl, relative } from "@std/path"
import { read, write } from "@engine/utils/deno/io.ts"
import { dirname } from "@std/path"
import { Logger } from "@engine/utils/log.ts"
import { bundle } from "@deno/emit"
import * as JSONC from "@std/jsonc/parse"

if (import.meta.main) {
  const log = new Logger(import.meta)

  // Register dynamic imports
  const base = dirname(fromFileUrl(import.meta.url))
  const imports = []
  for (const glob of ["source/{plugins,processors}/**/mod.ts", "source/{plugins,processors}/**/tests/*.ts"]) {
    for await (const { path } of expandGlob(glob)) {
      const mod = relative(base, path)
      imports.push(mod)
      log.trace(`found: ${mod}`)
    }
  }
  await write(
    "source/run/serve/imported.ts",
    [
      "/*",
      " * Statically analyzable dynamic imports for deno deploy",
      " * Auto-generated, do not edit manually",
      " */",
      imports.map((imported) => `(async () => await import("${imported.replaceAll("\\", "/")}"))`).sort().join(";\n"),
    ].join("\n"),
  )
  log.success("generated: source/run/serve/imported.ts")

  // Create client
  await write("source/run/serve/static/app.js", await client())
  log.success("generated: source/run/serve/static/app.js")
}

/** Bundle client */
export async function client() {
  const { imports } = JSONC.parse(await read("deno.jsonc")) as { imports: Record<PropertyKey, string> }
  const result = await bundle(new URL("./client.ts", import.meta.url), { type: "module", importMap: { imports } })
  const { code } = result
  return code
}
