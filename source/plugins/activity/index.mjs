//Imports
import { requestWithBackoff } from "./request.mjs"

//Setup
export default async function({login, data, rest, q, account, imports}, {enabled = false, markdown = "inline", extras = false} = {}) {
  //Plugin execution
  try {
    //Check if plugin is enabled and requirements are met
    if ((!q.activity) || (!imports.metadata.plugins.activity.enabled(enabled, {extras})))
      return null

    //Context
    let context = {mode: "user"}
    if (q.repo) {
      console.debug(`metrics/compute/${login}/plugins > activity > switched to repository mode`)
      const {owner, repo} = data.user.repositories.nodes.map(({name: repo, owner: {login: owner}}) => ({repo, owner})).shift()
      context = {...context, mode: "repository", owner, repo}
    }

    //Load inputs
    let {limit, load, days, filter, visibility, timestamps, skipped, ignored} = imports.metadata.plugins.activity.inputs({data, q, account})
    if (!days)
      days = Infinity
    skipped.push(...data.shared["repositories.skipped"])
    ignored.push(...data.shared["users.ignored"])
    const pages = Math.ceil(load / 100)
    const codelines = 2

    const payloadTypesToCustomTypes = {
      CommitCommentEvent: "comment",
      CreateEvent: "ref/create",
      DeleteEvent: "ref/delete",
      ForkEvent: "fork",
      GollumEvent: "wiki",
      IssueCommentEvent: "comment",
      IssuesEvent: "issue",
      MemberEvent: "member",
      PublicEvent: "public",
      PullRequestEvent: "pr",
      PullRequestReviewEvent: "review",
      PullRequestReviewCommentEvent: "comment",
      PushEvent: "push",
      ReleaseEvent: "release",
      WatchEvent: "star",
    }

    //Enrich one event at a time, preserving the API's newest-first order.
    const enrich = async ({type, payload, actor: {login: actor}, repo: {name: repo}, created_at}) => {
      const timestamp = new Date(created_at)
      if (!imports.filters.repo(repo, skipped))
        return null

      //Get custom type from the previously declared mapping, so that it acts as a single source of truth
      const customType = payloadTypesToCustomTypes[type]
      if (!customType)
        throw new Error(`Missing event mapping for type: ${type}`)

      switch (type) {
        //Commented on a commit
        case "CommitCommentEvent": {
          if (!["created"].includes(payload.action))
            return null
          const {comment: {user: {login: user}, commit_id: sha, body: content}} = payload
          if (!imports.filters.text(user, ignored))
            return null
          return {type: customType, on: "commit", actor, timestamp, repo, content: await imports.markdown(content, {mode: markdown, codelines}), user, mobile: null, number: sha.substring(0, 7), title: ""}
        }
        //Created a git branch or tag
        case "CreateEvent": {
          const {ref: name, ref_type: type} = payload
          return {type: customType, actor, timestamp, repo, ref: {name, type}}
        }
        //Deleted a git branch or tag
        case "DeleteEvent": {
          const {ref: name, ref_type: type} = payload
          return {type: customType, actor, timestamp, repo, ref: {name, type}}
        }
        //Forked repository
        case "ForkEvent": {
          const {forkee: {full_name: forked}} = payload
          return {type: customType, actor, timestamp, repo, forked}
        }
        //Wiki changes
        case "GollumEvent": {
          const {pages} = payload
          return {type: customType, actor, timestamp, repo, pages: pages.map(({title}) => title)}
        }
        //Commented on an issue
        case "IssueCommentEvent": {
          if (!["created"].includes(payload.action))
            return null
          const {issue: {user: {login: user}, title, number}, comment: {body: content, performed_via_github_app: mobile}} = payload
          if (!imports.filters.text(user, ignored))
            return null
          return {type: customType, on: "issue", actor, timestamp, repo, content: await imports.markdown(content, {mode: markdown, codelines}), user, mobile, number, title}
        }
        //Issue event
        case "IssuesEvent": {
          if (!["opened", "closed", "reopened"].includes(payload.action))
            return null
          const {action, issue: {user: {login: user}, title, number, body: content}} = payload
          if (!imports.filters.text(user, ignored))
            return null
          return {type: customType, actor, timestamp, repo, action, user, number, title, content: await imports.markdown(content, {mode: markdown, codelines})}
        }
        //Activity from repository collaborators
        case "MemberEvent": {
          if (!["added"].includes(payload.action))
            return null
          const {member: {login: user}} = payload
          if (!imports.filters.text(user, ignored))
            return null
          return {type: customType, actor, timestamp, repo, user}
        }
        //Made repository public
        case "PublicEvent": {
          return {type: customType, actor, timestamp, repo}
        }
        //Pull requests events
        case "PullRequestEvent": {
          if (!["opened", "closed"].includes(payload.action))
            return null
          const {action, pull_request: {number}} = payload
          const [owner, repoName] = repo.split("/")
          const {data: {user: {login: user}, title, body: content, additions: added, deletions: deleted, changed_files: changed, merged}} = await requestWithBackoff(() => rest.pulls.get({owner, repo: repoName, pull_number: number}))
          if (!imports.filters.text(user, ignored))
            return null
          return {type: customType, actor, timestamp, repo, action: (action === "closed") && (merged) ? "merged" : action, user, title, number, content: await imports.markdown(content, {mode: markdown, codelines}), lines: {added, deleted}, files: {changed}}
        }
        //Reviewed a pull request
        case "PullRequestReviewEvent": {
          const {review: {state: review}, pull_request: {number}} = payload
          const [owner, repoName] = repo.split("/")
          const {data: {user: {login: user}, title}} = await requestWithBackoff(() => rest.pulls.get({owner, repo: repoName, pull_number: number}))
          if (!imports.filters.text(user, ignored))
            return null
          return {type: customType, actor, timestamp, repo, review, user, number, title}
        }
        //Commented on a pull request
        case "PullRequestReviewCommentEvent": {
          if (!["created"].includes(payload.action))
            return null
          const {pull_request: {number}, comment: {body: content, performed_via_github_app: mobile}} = payload
          const [owner, repoName] = repo.split("/")
          const {data: {user: {login: user}, title}} = await requestWithBackoff(() => rest.pulls.get({owner, repo: repoName, pull_number: number}))
          if (!imports.filters.text(user, ignored))
            return null
          return {type: customType, on: "pr", actor, timestamp, repo, content: await imports.markdown(content, {mode: markdown, codelines}), user, mobile, number, title}
        }
        //Pushed commits
        case "PushEvent": {
          let {size, ref, head, before} = payload
          const [owner, repoName] = repo.split("/")

          //Older event payloads include commits; current GitHub events require a
          //comparison. REST comparison authors/messages live inside `commit`.
          const comparison = payload.commits == null ? (await requestWithBackoff(() => rest.repos.compareCommitsWithBasehead({owner, repo: repoName, basehead: `${before}...${head}`}))).data : null
          let commits = payload.commits ?? comparison.commits
          //Current PushEvents may omit size. Count the push before author filters
          //and merge-summary trimming, preferring the full comparison total.
          if (!Number.isSafeInteger(size) || (size < 0))
            size = Number.isSafeInteger(comparison?.total_commits) && (comparison.total_commits >= 0) ? comparison.total_commits : commits.length
          commits = commits
            .map(({sha, message, author, commit}) => ({sha, message: commit?.message ?? message ?? "", email: commit?.author?.email ?? author?.email ?? ""}))
            .filter(({email}) => imports.filters.text(email, ignored))
          if (!commits.length)
            return null
          if (commits.slice(-1).pop()?.message.startsWith("Merge branch "))
            commits = commits.slice(-1)
          return {type: customType, actor, timestamp, repo, size, branch: ref.match(/refs.heads.(?<branch>.*)/)?.groups?.branch ?? null, commits: commits.reverse().map(({sha, message}) => ({sha: sha.substring(0, 7), message}))}
        }
        //Released
        case "ReleaseEvent": {
          if (!["published"].includes(payload.action))
            return null
          const {action, release: {name, tag_name, prerelease, draft, body: content}} = payload
          return {type: customType, actor, timestamp, repo, action, name: name || tag_name, prerelease, draft, content: await imports.markdown(content, {mode: markdown, codelines})}
        }
        //Starred a repository
        case "WatchEvent": {
          if (!["started"].includes(payload.action))
            return null
          const {action} = payload
          return {type: customType, actor, timestamp, repo, action}
        }
        //Unknown event
        default: {
          return null
        }
      }
    }

    //Only request/enrich enough events to fill the display. Null results (for
    //example ignored authors or unsupported actions) do not consume the limit.
    const activity = []
    let loaded = 0
    console.debug(`metrics/compute/${login}/plugins > activity > querying api`)
    for (let page = 1; (page <= pages) && (activity.length < limit); page++) {
      let events
      try {
        console.debug(`metrics/compute/${login}/plugins > activity > loading page ${page}/${pages}`)
        const response = await requestWithBackoff(() =>
          context.mode === "repository"
            ? rest.activity.listRepoEvents({owner: context.owner, repo: context.repo, per_page: 100, page})
            : rest.activity.listEventsForAuthenticatedUser({username: login, per_page: 100, page})
        )
        events = response.data.slice(0, load - loaded)
      }
      catch (error) {
        if (!activity.length)
          throw error
        console.warn(`metrics/compute/${login}/plugins > activity > unable to load more events (${error.status ?? "unknown status"})`)
        break
      }
      loaded += events.length
      for (const event of events) {
        if ((account !== "organization") && (event.actor?.login?.toLocaleLowerCase() !== login.toLocaleLowerCase()))
          continue
        if (Number.isFinite(days) && !(new Date(event.created_at) > new Date(Date.now() - days * 24 * 60 * 60 * 1000)))
          continue
        if ((visibility === "public") && !event.public)
          continue
        const customType = payloadTypesToCustomTypes[event.type]
        if (!customType || (!filter.includes("all") && !filter.includes(customType)))
          continue
        const result = await enrich(event)
        if (result)
          activity.push(result)
        if (activity.length >= limit)
          break
      }
      if ((events.length < 100) || (loaded >= load))
        break
    }
    console.debug(`metrics/compute/${login}/plugins > activity > ${loaded} events loaded`)

    //Results
    return {timestamps, events: activity}
  }
  //Handle errors
  catch (error) {
    throw imports.format.error(error)
  }
}
