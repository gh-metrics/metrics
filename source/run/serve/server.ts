//Imports
import { server as schema, webrequest } from "@engine/config.ts"
import { process } from "@engine/process.ts"
import { type is, parse } from "@engine/utils/validation.ts"
import { read } from "@engine/utils/deno/io.ts"
import { KV, listen } from "@engine/utils/deno/server.ts"
import { env } from "@engine/utils/deno/env.ts"
import { Internal } from "@engine/components/internal.ts"
import * as YAML from "@std/yaml"
import { parseHandle } from "@engine/utils/github.ts"
import { decodeBase64 } from "@std/encoding"
import { serveDir, serveFile } from "@std/http/file-server"
import { fromFileUrl } from "@std/path"
import { STATUS_CODE } from "@std/http"
import { metadata } from "@engine/metadata.ts"
import { deepMerge } from "@std/collections"
import { getCookies, setCookie } from "@std/http/cookie"
import { Secret } from "@engine/utils/secret.ts"
import { Requests } from "@engine/components/requests.ts"
import { App } from "@octokit/app"
import { client } from "@run/serve/imports.ts"
import { Browser } from "@engine/utils/browser.ts"
try {
  await import("@run/serve/imported.ts")
} catch { /* Ignore */ }

/** Server */
export class Server extends Internal {
  /** Import meta */
  static readonly meta = import.meta

  /** Context */
  declare protected readonly context: is.infer<typeof schema>

  /** Constructor */
  constructor(context = {} as Record<PropertyKey, unknown>) {
    super(parse(schema, context, { sync: true }))
    if (!this.context.config.presets.default.plugins.token.read()) {
      this.context.config.presets.default.plugins.token = new Secret("NO_TOKEN")
    }
    if (this.context.github_app) {
      this.log.info(`loaded github app: ${this.context.github_app.id}`)
      this.#app = new App({
        appId: this.context.github_app.id,
        privateKey: read(this.context.github_app.private_key_path, { sync: true }),
        oauth: {
          clientId: this.context.github_app.client_id,
          clientSecret: this.context.github_app.client_secret.read(),
        },
      })
    }
    this.#kv = new KV()
    Deno.addSignalListener("SIGINT", async () => {
      this.log.info("received SIGINT, closing server")
      await Browser.shared?.close()
      Deno.exit(0)
    })
  }

  /** KV */
  readonly #kv

  /** GitHub app */
  readonly #app = null as App | null

  /** Routes */
  protected readonly routes = {
    index: /^\/(?:index\.html)?$/,
    favicon: /^\/favicon\.(?:ico|png)$/,
    metrics: /^\/(?<handle>[-\w]+(?:\/[-\w]+)?)(?:\.(?<ext>svg|png|jpg|jpeg|webp|json|html|txt|text|yml|yaml|pdf))?$/,
    control: /^\/metrics\/(?<action>\w+)$/,
    login: /^\/login(?<action>\/(?:authorize|review|revoke)?)?$/,
    me: /^\/me$/,
    ratelimit: /^\/ratelimit$/,
  }

  /** Start server */
  start() {
    this.log.info(`listening on ${this.context.hostname}:${this.context.port}`)
    return listen({ hostname: this.context.hostname, port: this.context.port }, (request, connection) => this.handle(request, connection as { remoteAddr: { hostname: string } }))
  }

  /** Metadata */
  #metadata = null as unknown

  /** Request handler */
  protected async handle(request: Request, { remoteAddr: { hostname: from } } = { remoteAddr: { hostname: "unknown" } }) {
    const url = new URL(request.url)
    const cookies = getCookies(request.headers)
    const { metrics_session: session = null } = cookies
    const log = this.log.with({ from, ...(session ? { session } : null) })
    log.io(`${request.method} ${url.pathname}`)
    const pending = new Map<string, Promise<Response>>()
    await this.#kv.ready
    routing: switch (request.method) {
      case "GET": {
        switch (true) {
          // Serve index
          case this.routes.index.test(url.pathname): {
            return serveFile(request, fromFileUrl(new URL("static/index.html", import.meta.url)))
          }
          // Serve favicon
          case this.routes.favicon.test(url.pathname): {
            return serveFile(request, fromFileUrl(new URL("static/favicon.png", import.meta.url)))
          }
          // Rebundle app in development mode
          case (url.pathname === "/static/app.js") && (!env.deployment): {
            return new Response(await client(), { status: STATUS_CODE.OK, headers: { "content-type": "application/javascript" } })
          }
          // Serve static files
          case url.pathname.startsWith("/static/"): {
            return serveDir(request, { fsRoot: fromFileUrl(new URL("static", import.meta.url)), urlRoot: "static", quiet: true })
          }
          // Metadata
          case url.pathname === "/metadata": {
            if (!this.#metadata) {
              this.#metadata = await metadata()
            }
            return new Response(JSON.stringify(this.#metadata), { status: STATUS_CODE.OK, headers: { "content-type": "application/json" } })
          }
          // User profile
          case this.routes.me.test(url.pathname): {
            if (!this.context.github_app) {
              return new Response(JSON.stringify(null), { status: STATUS_CODE.OK, headers: { "content-type": "application/json" } })
            }
            if ((!session) || !(await this.#kv.has(`sessions.${session}`))) {
              return new Response(JSON.stringify({ login: null }), { status: STATUS_CODE.OK, headers: { "content-type": "application/json" } })
            }
            const { login, avatar } = await this.#kv.get<user>(`sessions.${session}`)
            return new Response(JSON.stringify({ login, avatar }), { status: STATUS_CODE.OK, headers: { "content-type": "application/json" } })
          }
          // OAuth login
          case this.routes.login.test(url.pathname): {
            if (!this.context.github_app) {
              return Response.redirect(url.origin, STATUS_CODE.Found)
            }
            const app = this.context.github_app
            const { action = "/" } = url.pathname.match(this.routes.login)?.groups ?? {}
            switch (action) {
              // Start OAuth process
              case "":
              case "/": {
                if (session && (await this.#kv.has(`sessions.${session}`))) {
                  return Response.redirect(url.origin, STATUS_CODE.Found)
                }
                return Response.redirect(this.#app!.oauth.getWebFlowAuthorizationUrl({ allowSignup: false }).url, STATUS_CODE.Found)
              }
              // OAuth authorization process
              case "/authorize": {
                if (session && (await this.#kv.has(`sessions.${session}`))) {
                  return Response.redirect(url.origin, STATUS_CODE.Found)
                }
                try {
                  const state = url.searchParams.get("state")
                  const code = url.searchParams.get("code")
                  const { authentication: { token, expiresAt: expiration } } = await this.#app!.oauth.createToken(
                    // @ts-expect-error: upstream types are incorrect
                    { state, code },
                  )
                  const ttl = new Date(expiration!).getTime() - Date.now()
                  const { data: { user: userData } } = await this.#app!.oauth.checkToken({ token })
                  const { login, avatar_url: avatar } = userData ?? {}

                  if (await this.#kv.has(`sessions.login.${login}`)) {
                    log.trace(`oauth process: user ${login} was already authenticated`)
                    return Response.redirect(url.origin, STATUS_CODE.Found)
                  }
                  const user = { login, avatar, token, session: crypto.randomUUID() }
                  await this.#kv.set(`sessions.${user.session}`, user, { ttl })
                  await this.#kv.set(`sessions.login.${user.login}`, true, { ttl })
                  log.message(`oauth process: user ${login} authenticated`)
                  const headers = new Headers({ Location: url.origin })
                  setCookie(headers, {
                    name: "metrics_session",
                    value: user.session,
                    path: "/",
                    sameSite: "None",
                    httpOnly: true,
                    secure: true,
                    expires: new Date(Date.now() + 1000 * Number(expiration!)),
                  })
                  return new Response(null, { status: STATUS_CODE.SeeOther, headers })
                } catch (error) {
                  log.warn(error)
                  return new Response("Bad request: Authorization process failed", { status: STATUS_CODE.BadRequest })
                }
              }
              // OAuth token revocation
              case "/revoke": {
                if (!session || !(await this.#kv.has(`sessions.${session}`))) {
                  return Response.redirect(url.origin, STATUS_CODE.Found)
                }
                try {
                  const { login, token } = await this.#kv.get<user>(`sessions.${session}`)
                  await this.#app!.oauth.deleteToken({ token })
                  await this.#kv.delete(`sessions.${session}`)
                  await this.#kv.delete(`sessions.login.${login}`)
                  log.trace(`oauth process: user ${login} revoked their token`)
                  return Response.redirect(url.origin, STATUS_CODE.Found)
                } catch (error) {
                  log.warn(error)
                  return new Response("Bad request: Revocation process failed", { status: STATUS_CODE.BadRequest })
                }
              }
              // OAuth permissions review
              case "/review": {
                return Response.redirect(`https://github.com/settings/connections/applications/${app.client_id}`, STATUS_CODE.Found)
              }
            }
            break routing
          }
          // Ratelimit
          case this.routes.ratelimit.test(url.pathname): {
            const context = { login: null as string | null, ...this.context.config.presets.default.plugins }
            if (session && (await this.#kv.has(`sessions.${session}`))) {
              const { login, token } = await this.#kv.get<user>(`sessions.${session}`)
              context.token = new Secret(token)
              context.login = login
            }
            const requests = new Requests(this.meta, context)
            const ratelimit = { core: 0, graphql: 0, search: 0, error: null }
            try {
              Object.assign(ratelimit, await requests.ratelimit())
            } catch (error) {
              ratelimit.error = error.status ?? STATUS_CODE.InternalServerError
            }
            return new Response(JSON.stringify({ login: context.login, ...ratelimit }), { status: STATUS_CODE.OK, headers: { "content-type": "application/json" } })
          }
          // Serve renders
          case this.routes.metrics.test(url.pathname): {
            const { handle, ext = "svg" } = url.pathname.match(this.routes.metrics)?.groups ?? {}
            const entity = handle.includes("/") ? "repository" : "user"
            const _log = log
            let user = null as user | null
            try {
              parseHandle(handle, { entity })
            } catch {
              return new Response(`Bad request: invalid handle "${handle}"`, { status: STATUS_CODE.BadRequest })
            }
            if (!handle) {
              return new Response("Not found", { status: STATUS_CODE.NotFound })
            }
            {
              const log = _log.with({ handle })
              log.trace(url.href)
              // Honor single request at a time
              const requested = url.href.replace(url.origin, "")
              if (pending.has(requested)) {
                log.trace("existing request pending, waiting for completion")
                return pending.get(requested)!
              }
              const { promise, resolve } = Promise.withResolvers<Response>()
              pending.set(requested, promise)
              log.trace("processing request")
              try {
                // Parse inputs (lax-YAML)
                let context = {} as unknown as is.infer<typeof webrequest>
                try {
                  const inputs = {} as Record<PropertyKey, unknown>
                  for (const [key, _value] of url.searchParams) {
                    const value = _value.replaceAll(/([:,])([\w\[\{])/g, "$1 $2")
                    if (_value !== value) {
                      log.trace(`${_value} → ${value}`)
                    }
                    inputs[key] = YAML.parse(value)
                  }
                  context = inputs as unknown as typeof context
                  log.trace("parsed raw request")
                  log.trace(context)
                } catch (error) {
                  log.warn(error)
                  return resolve(new Response(`Bad request: ${error}`, { status: STATUS_CODE.BadRequest }))!
                }

                // Filter features and apply server configuration
                try {
                  const { plugins } = await parse(webrequest.pick({ plugins: true }), context)
                  context.plugins = plugins.concat([{ processors: [{ id: "render.content", args: { format: { jpg: "jpeg", txt: "text", yml: "yaml" }[ext] ?? ext } }] }])
                  context = await parse(webrequest, context)
                  log.trace("parsed request")
                  log.trace(context)
                  //TODO(#1576)
                } catch (error) {
                  log.warn(error)
                  return resolve(new Response(`Bad request: ${error}`, { status: STATUS_CODE.BadRequest }))!
                }

                // Load user session if available
                if (session && (await this.#kv.has(`sessions.${session}`))) {
                  user = await this.#kv.get<user>(`sessions.${session}`)
                  log.debug(`logged as: ${user.login}`)
                }

                // Honor server limits
                if (this.context.limit) {
                  const section = user ? "users" : "guests"
                  // Users limits
                  if (typeof this.context.limit[section]?.max === "number") {
                    //TODO(#1542)
                    if (0 > this.context.limit[section]?.max!) {
                      return new Response("Service unavailable: server capacity is full", { status: STATUS_CODE.ServiceUnavailable })
                    }
                  }

                  // Requests limit
                  if (this.context.limit[section]?.requests) {
                    if ((context.mock) && (this.context.limit[section]?.requests?.ignore_mocked)) {
                      log.trace("requests ratelimit: bypassed as request is mocked")
                    } else {
                      const { limit, duration } = this.context.limit[section]?.requests!
                      const { current = 0, reset = Date.now() + 1000 * duration, init = false } =
                        await this.#kv.get<{ current: number; reset: number; init?: boolean }>(`requests.ratelimit.${user}`) ?? { init: true }
                      log.trace(`requests ratelimit: ${current + 1} / ${limit} until ${new Date(reset).toISOString()}`)
                      if (current + 1 > limit) {
                        log.trace(`requests ratelimit: preventing further requests for "${from}" until ${new Date(reset).toISOString()}`)
                        return new Response(`Too Many Requests: Rate limit exceeded (wait ~${Math.ceil(Math.max((reset - Date.now()) / 1000, 1))}s)`, { status: STATUS_CODE.TooManyRequests })
                      }
                      if (init) {
                        await this.#kv.set(`requests.ratelimit.${from}`, { current: current + 1, reset }, { ttl: 1000 * duration })
                      } else {
                        await this.#kv.set(`requests.ratelimit.${from}`, { current: current + 1, reset })
                      }
                    }
                  }
                }

                // Apply server configuration
                try {
                  const extras = {} as Record<PropertyKey, unknown>
                  if (user?.token) {
                    extras.token = new Secret(user.token)
                    log.debug(`using token from user: ${user.login}`)
                  }
                  context = deepMerge(
                    context,
                    deepMerge(this.context.config, {
                      presets: Object.fromEntries(
                        Object.entries(this.context.config.presets).map(([preset, { plugins }]) => [preset, { plugins: { ...plugins, ...extras, handle, entity, mock: context.mock } }]),
                      ),
                    }),
                  )
                  log.trace("applied server configuration")
                  log.trace(context)
                } catch (error) {
                  log.warn(error)
                  // Do not print error to users to avoid data leaks
                  return resolve(
                    new Response(
                      "Internal Server Error: Failed to apply server configuration",
                      { status: STATUS_CODE.InternalServerError },
                    ),
                  )!
                }

                // Process request
                try {
                  const { content = "", mime = "image/svg+xml", base64 = false } = (await process(context)) ?? {}
                  const body = base64 ? decodeBase64(content) : content
                  const headers = new Headers({ "cache-control": typeof this.context.cache === "number" ? `max-age=${this.context.cache}` : "no-store" })
                  if (!body) {
                    return resolve(
                      new Response(null, { status: STATUS_CODE.NoContent, headers }),
                    )!
                  }
                  headers.set("content-type", mime)
                  return resolve(new Response(body, { status: STATUS_CODE.OK, headers }))!
                } catch (error) {
                  log.warn(error)
                  // Do not print error to users to avoid data leaks
                  return resolve(
                    new Response("Internal Server Error: Failed to process metrics", { status: STATUS_CODE.InternalServerError }),
                  )!
                }
              } finally {
                log.trace("cleaning request")
                pending.delete(handle)
                log.trace("sending response")
                // deno-lint-ignore no-unsafe-finally
                return promise
              }
            }
          }
        }
        break
      }
      case "POST": {
        // Control API
        switch (true) {
          case this.routes.control.test(url.pathname): {
            const authorization = request.headers.get("authorization")
            if (!authorization) {
              return new Response("Unauthorized", { status: STATUS_CODE.Unauthorized })
            }
            const token = authorization.replace(/^Bearer\s+/, "")
            const { action } = url.pathname.match(this.routes.control)?.groups ?? {}
            switch (action) {
              // Stop instance
              case "stop": {
                if (!this.context.control?.[token]?.[action]) {
                  return new Response("Forbidden", { status: STATUS_CODE.Forbidden })
                }
                this.log.info("received stop request, server will shutdown in a few seconds")
                setTimeout(() => Deno.exit(0), 5000)
                return new Response("Accepted", { status: STATUS_CODE.Accepted })
              }
            }
          }
        }
        break
      }
      default:
        return new Response(`Method Not Allowed: ${request.method}`, { status: STATUS_CODE.MethodNotAllowed })
    }
    return new Response("Not found", { status: STATUS_CODE.NotFound })
  }
}

/** User */
type user = { login: string; avatar: string; token: string; session: string }
