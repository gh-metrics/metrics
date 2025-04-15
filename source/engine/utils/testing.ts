/// <reference lib="deno.unstable" />
// Imports
import { is, parse } from "@engine/utils/validation.ts"
import { Logger } from "@engine/utils/log.ts"
import * as dir from "@engine/paths.ts"
import { toFileUrl } from "@std/path"
import { bgBrightBlack, bgYellow, black, brightCyan, cyan } from "@std/fmt/colors"
import chai from "chai"
import chaiSubset from "chai-subset"
import chaiAsPromised from "chai-as-promised"

/** Logger */
export const log = new Logger(import.meta)

/** Mock utility (first argument is the expected input, and second a mock function called with parsed input that return mocked output) */
export function mock<T extends is.ZodRawShape>(input: T, data: (vars: is.infer<is.ZodObject<T>>) => unknown) {
  return function (vars: Record<PropertyKey, unknown>) {
    return data(parse(is.object(input), vars, { sync: true }))
  }
}

/** Test namer */
export function t(meta: { url: string } | string, test: string | null) {
  let [icon, mod] = (typeof meta === "string") ? meta.split(" ") : ["", meta.url.replace(toFileUrl(dir.source).href, "").replace(/_test\.ts$/, "").replace(/^\//, "")]
  switch (true) {
    case mod.startsWith("engine/utils"):
      icon = "🔧"
      break
    case mod.startsWith("engine/"):
      icon = "⚙️"
      break
  }
  const f = (text: string) => text.replace(/`([\s\S]+?)`/g, (_, text) => cyan(text)).replace(/\*([\s\S]+?)\*/g, (_, text) => brightCyan(text))
  return `${bgBrightBlack(`${icon.trim()} ${mod.padEnd(38)}`)} ${test !== null ? f(test) : bgYellow(black(" NO TESTS FOUND ! "))}`
}

/** Chai assertions */
chai.config.truncateThreshold = 0
chai.config.showDiff = true
export const { expect } = chai.use(chaiSubset).use(chaiAsPromised)

/** Testing type */
// deno-lint-ignore no-explicit-any
export type test = any

// Exports
export { MetricsError, throws } from "@engine/utils/errors.ts"
export { is, MetricsValidationError } from "@engine/utils/validation.ts"
export { STATUS_CODE, type StatusCode } from "@std/http/status"
export { faker } from "@faker-js/faker"
export { dir }
