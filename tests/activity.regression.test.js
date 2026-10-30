//Run the actual ESM source in isolated Node processes, like the existing suite.
const {spawnSync} = require("child_process")
const path = require("path")

function sourceTest(name, scenario) {
  test(name, () => {
    const result = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      `
      import assert from "node:assert/strict"
      import activity from "./source/plugins/activity/index.mjs"
      import {requestWithBackoff} from "./source/plugins/activity/request.mjs"
      const event = (id, extra = {}) => ({
        type: "PushEvent", actor: {login: "tester"}, repo: {name: "tester/project"},
        created_at: new Date(Date.now() - id * 1000).toISOString(), public: true,
        payload: {size: 1, ref: "refs/heads/main", before: "before", head: String(id)}, ...extra,
      })
      function fixture(events, options = {}) {
        const calls = {pages: [], comparisons: [], pulls: [], active: 0, maximum: 0}
        const inputs = {limit: 5, load: 300, days: 14, filter: ["all"], visibility: "all", timestamps: true, skipped: [], ignored: [], ...options}
        const list = async args => {
          calls.pages.push(args)
          return {data: events.slice((args.page - 1) * 100, args.page * 100)}
        }
        const rest = {
          activity: {listEventsForAuthenticatedUser: list, listRepoEvents: list},
          repos: {compareCommitsWithBasehead: async args => {
            calls.comparisons.push(args)
            calls.maximum = Math.max(calls.maximum, ++calls.active)
            await new Promise(resolve => setImmediate(resolve))
            calls.active--
            const id = args.basehead.split("...")[1]
            return {data: {commits: [{sha: "abcdefg" + id, author: null, commit: {message: "message " + id, author: {email: "writer@example.test"}}}]}}
          }},
          pulls: {get: async args => {
            calls.pulls.push(args)
            return {data: {user: {login: "writer"}, title: "PR", body: "body", additions: 1, deletions: 0, changed_files: 1, merged: false}}
          }},
        }
        const context = {
          login: "tester", account: "user", q: {activity: true}, rest,
          data: {shared: {"repositories.skipped": [], "users.ignored": []}, user: {repositories: {nodes: [{name: "project", owner: {login: "tester"}}]}}},
          imports: {
            metadata: {plugins: {activity: {enabled: () => true, inputs: () => ({...inputs, skipped: [...inputs.skipped], ignored: [...inputs.ignored]})}}},
            filters: {repo: (value, skipped) => !skipped.includes(value), text: (value, ignored) => !ignored.includes(value)},
            markdown: async value => value,
            format: {error: error => error},
          },
        }
        return {context, calls, rest}
      }
      const rateError = (status, headers = {}, message = "Secondary rate limit exceeded") => Object.assign(new Error(message), {status, response: {headers, data: {message}}})
      const fakeWaits = () => {
        const waits = []
        globalThis.setTimeout = (resolve, milliseconds) => { waits.push(milliseconds); resolve() }
        return waits
      }
      await (${scenario.toString()})()
    `,
    ], {cwd: path.join(__dirname, ".."), encoding: "utf8", timeout: 10000})
    if (result.status !== 0)
      throw new Error(`${result.error || ""}\n${result.stdout}\n${result.stderr}`)
  })
}

sourceTest("300 available events need only five serialized comparisons and one page", async () => {
  const {context, calls} = fixture(Array.from({length: 300}, (_, index) => event(index)))
  const result = await activity(context)
  assert.equal(calls.pages.length, 1)
  assert.equal(calls.comparisons.length, 5)
  assert.equal(calls.maximum, 1)
  assert.equal(result.timestamps, true)
  assert.deepEqual(result.events.map(item => item.commits[0].message), ["message 0", "message 1", "message 2", "message 3", "message 4"])
  assert.equal(result.events[0].commits[0].sha, "abcdefg")
  assert.equal(result.events[0].branch, "main")
})

sourceTest("filtered and null-result events do not starve the display limit", async () => {
  const events = [
    event(0, {type: "WatchEvent", payload: {action: "stopped"}}),
    event(1, {actor: {login: "other"}}),
    event(2, {type: "UnknownEvent"}),
    event(3, {repo: {name: "tester/skipped"}}),
    event(4, {public: false}),
    event(5, {created_at: "2000-01-01T00:00:00Z"}),
    event(6, {type: "MemberEvent", payload: {action: "added", member: {login: "ignored"}}}),
    event(7, {payload: {commits: [{sha: "ignored", commit: {message: "ignored", author: {email: "bot@example.test"}}, author: null}]}}),
    ...Array.from({length: 10}, (_, index) => event(8 + index)),
  ]
  const {context, calls} = fixture(events, {visibility: "public", skipped: ["tester/skipped"], ignored: ["ignored", "bot@example.test"]})
  const result = await activity(context)
  assert.equal(result.events.length, 5)
  assert.equal(calls.comparisons.length, 5)
  assert.deepEqual(result.events.map(item => item.commits[0].message), ["message 8", "message 9", "message 10", "message 11", "message 12"])
})

sourceTest("REST commit data has nested messages and emails even with null outer authors", async () => {
  const {context, rest} = fixture([event(0)], {ignored: ["bot@example.test"]})
  rest.repos.compareCommitsWithBasehead = async () => ({
    data: {
      commits: [
        {sha: "11111111", author: null, commit: {message: "first", author: {email: "writer@example.test"}}},
        {sha: "22222222", author: {login: "bot"}, commit: {message: "ignored", author: {email: "bot@example.test"}}},
        {sha: "33333333", author: null, commit: {message: "latest", author: null}},
      ],
    },
  })
  const result = await activity(context)
  assert.deepEqual(result.events[0].commits, [{sha: "3333333", message: "latest"}, {sha: "1111111", message: "first"}])
})

sourceTest("legacy event commits avoid comparisons and merge summaries retain only newest merge", async () => {
  const {context, calls} = fixture([event(0, {
    payload: {
      ref: "refs/heads/main",
      size: 2,
      commits: [
        {sha: "11111111", message: "first", author: {email: "writer@example.test"}},
        {sha: "22222222", message: "Merge branch feature", author: null},
      ],
    },
  })])
  const result = await activity(context)
  assert.equal(calls.comparisons.length, 0)
  assert.deepEqual(result.events[0].commits, [{sha: "2222222", message: "Merge branch feature"}])
})

sourceTest("repository pagination advances beyond filtered events and stops when enough survive", async () => {
  const events = [...Array.from({length: 100}, (_, id) => event(id, {type: "WatchEvent", payload: {action: "stopped"}})), ...Array.from({length: 100}, (_, id) => event(100 + id))]
  const {context, calls} = fixture(events)
  context.q.repo = "tester/project"
  const result = await activity(context)
  assert.equal(result.events.length, 5)
  assert.deepEqual(calls.pages, [{owner: "tester", repo: "project", per_page: 100, page: 1}, {owner: "tester", repo: "project", per_page: 100, page: 2}])
  assert.equal(calls.comparisons.length, 5)
})

sourceTest("configured event-load cap and event-type filter are respected", async () => {
  const events = Array.from({length: 300}, (_, id) => event(id, {type: "WatchEvent", payload: {action: id < 149 ? "stopped" : "started"}}))
  const {context, calls} = fixture(events, {load: 150, filter: ["star"]})
  const result = await activity(context)
  assert.equal(result.events.length, 1)
  assert.equal(calls.pages.length, 2)
  assert.equal(calls.comparisons.length, 0)
})

sourceTest("initial page failures surface instead of silently returning success", async () => {
  const {context, rest} = fixture([])
  const denied = rateError(403, {}, "Resource not accessible by integration")
  rest.activity.listEventsForAuthenticatedUser = async () => {
    throw denied
  }
  await assert.rejects(activity(context), error => error === denied)
})

sourceTest("later-page failure preserves already collected valid events", async () => {
  const {context, rest} = fixture(Array.from({length: 100}, (_, id) => event(id, {type: "WatchEvent", payload: {action: id === 0 ? "started" : "stopped"}})))
  const original = rest.activity.listEventsForAuthenticatedUser
  rest.activity.listEventsForAuthenticatedUser = args => {
    if (args.page > 1)
      throw rateError(404, {}, "Not found")
    return original(args)
  }
  const result = await activity(context)
  assert.equal(result.events.length, 1)
  assert.equal(result.events[0].type, "star")
})

sourceTest("Retry-After is honored before retrying a successful request", async () => {
  const waits = fakeWaits()
  let calls = 0
  const value = await requestWithBackoff(async () => {
    if (++calls === 1)
      throw rateError(403, {"retry-after": "1.25"})
    return "ok"
  })
  assert.equal(value, "ok")
  assert.deepEqual(waits, [1250])
  assert.equal(calls, 2)
})

sourceTest("429 retries are bounded even with a zero Retry-After", async () => {
  const waits = fakeWaits()
  let calls = 0
  const error = rateError(429, {"retry-after": "0"})
  await assert.rejects(
    requestWithBackoff(async () => {
      calls++
      throw error
    }),
    caught => caught === error,
  )
  assert.equal(calls, 3)
  assert.deepEqual(waits, [0, 0])
})

sourceTest("secondary limits without headers back off at least a minute within a total budget", async () => {
  const waits = fakeWaits()
  let calls = 0
  const error = rateError(403)
  await assert.rejects(
    requestWithBackoff(async () => {
      calls++
      throw error
    }),
    caught => caught === error,
  )
  assert.equal(calls, 2)
  assert.deepEqual(waits, [60000])
})

sourceTest("permission failures and server delays beyond the budget are not retried", async () => {
  const waits = fakeWaits()
  for (const error of [rateError(403, {}, "Resource not accessible by integration"), rateError(429, {"retry-after": "121"})]) {
    let calls = 0
    await assert.rejects(
      requestWithBackoff(async () => {
        calls++
        throw error
      }),
      caught => caught === error,
    )
    assert.equal(calls, 1)
  }
  assert.deepEqual(waits, [])
})

sourceTest("HTTP-date Retry-After and primary reset headers cannot cause premature retries", async () => {
  const waits = fakeWaits()
  const now = Date.parse("2026-10-30T00:00:00Z")
  Date.now = () => now
  let calls = 0
  await requestWithBackoff(async () => {
    if (++calls === 1)
      throw rateError(403, {"retry-after": new Date(now + 2000).toUTCString(), "x-ratelimit-remaining": "0", "x-ratelimit-reset": String((now + 5000) / 1000)})
    return "ok"
  })
  assert.deepEqual(waits, [5000])
})

sourceTest("rate-limited comparisons retry in place without reordering or fetching extra events", async () => {
  const waits = fakeWaits()
  const {context, rest, calls} = fixture([event(0), event(1)], {limit: 2})
  const original = rest.repos.compareCommitsWithBasehead
  let attempts = 0
  rest.repos.compareCommitsWithBasehead = args => {
    if (++attempts === 1)
      throw rateError(403, {"retry-after": "1"})
    return original(args)
  }
  const result = await activity(context)
  assert.equal(attempts, 3)
  assert.equal(calls.pages.length, 1)
  assert.deepEqual(waits, [1000])
  assert.deepEqual(result.events.map(item => item.commits[0].message), ["message 0", "message 1"])
})

sourceTest("ignored PR authors after enrichment do not consume the limit", async () => {
  const events = Array.from({length: 10}, (_, id) => event(id, {type: "PullRequestEvent", payload: {action: "opened", pull_request: {number: id}}}))
  const {context, rest, calls} = fixture(events, {limit: 2, ignored: ["ignored"]})
  const original = rest.pulls.get
  rest.pulls.get = async args => {
    const result = await original(args)
    if (args.pull_number === 0)
      result.data.user.login = "ignored"
    return result
  }
  const result = await activity(context)
  assert.deepEqual(result.events.map(item => item.number), [1, 2])
  assert.equal(calls.pulls.length, 3)
})

sourceTest("organization events retain other actors and disabled plugins make no requests", async () => {
  const {context, calls} = fixture([event(0, {actor: {login: "member"}})])
  context.account = "organization"
  const result = await activity(context)
  assert.equal(result.events[0].actor, "member")
  context.q.activity = false
  assert.equal(await activity(context), null)
  assert.equal(calls.pages.length, 1)
})

sourceTest("pushes without payload size use the full comparison total rather than the returned subset", async () => {
  const pushed = event(0)
  delete pushed.payload.size
  const {context, rest} = fixture([pushed])
  rest.repos.compareCommitsWithBasehead = async () => ({
    data: {
      total_commits: 300,
      commits: [
        {sha: "11111111", author: null, commit: {message: "latest", author: {email: "writer@example.test"}}},
      ],
    },
  })
  const result = await activity(context)
  assert.equal(result.events[0].size, 300)
  assert.equal(result.events[0].commits.length, 1)
})

sourceTest("missing or invalid comparison totals fall back to commit count before filtering or merge trimming", async () => {
  for (const total_commits of [undefined, null, -1, 1.5, Infinity, NaN, "3"]) {
    const pushed = event(0)
    delete pushed.payload.size
    const {context, rest} = fixture([pushed], {ignored: ["bot@example.test"]})
    rest.repos.compareCommitsWithBasehead = async () => ({
      data: {
        total_commits,
        commits: [
          {sha: "11111111", author: null, commit: {message: "first", author: {email: "writer@example.test"}}},
          {sha: "22222222", author: null, commit: {message: "ignored", author: {email: "bot@example.test"}}},
          {sha: "33333333", author: null, commit: {message: "Merge branch feature", author: {email: "writer@example.test"}}},
        ],
      },
    })
    const result = await activity(context)
    assert.equal(result.events[0].size, 3)
    assert.equal(result.events[0].commits.length, 1)
  }
})

sourceTest("valid legacy sizes including zero are retained and missing embedded sizes fall back without comparisons", async () => {
  for (const size of [0, 7, undefined, null, -1, 1.5, Infinity, NaN]) {
    const pushed = event(0, {
      payload: {
        size,
        ref: "refs/heads/main",
        commits: [
          {sha: "11111111", message: "first", author: null},
          {sha: "22222222", message: "second", author: null},
        ],
      },
    })
    const {context, calls} = fixture([pushed])
    const result = await activity(context)
    assert.equal(result.events[0].size, Number.isSafeInteger(size) && size >= 0 ? size : 2)
    assert.equal(calls.comparisons.length, 0)
  }
  const {context, rest} = fixture([event(0)])
  const original = rest.repos.compareCommitsWithBasehead
  rest.repos.compareCommitsWithBasehead = async args => {
    const response = await original(args)
    response.data.total_commits = 300
    return response
  }
  assert.equal((await activity(context)).events[0].size, 1)
})
