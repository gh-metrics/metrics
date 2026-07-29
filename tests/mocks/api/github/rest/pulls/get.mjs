/**Mocked data */
export default async function({faker}, target, that, [{owner, repo, pull_number}]) {
  console.debug("metrics/compute/mocks > mocking rest api result > rest.pulls.get")
  return ({
    status: 200,
    url: `https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}`,
    headers: {
      server: "GitHub.com",
      status: "200 OK",
      "x-oauth-scopes": "repo",
    },
    data: {
      id: faker.number.int(100000),
      number: pull_number,
      title: faker.lorem.sentence(),
      body: faker.lorem.paragraph(),
      user: {
        login: faker.internet.userName(),
      },
      state: "open",
      merged: faker.datatype.boolean(),
      additions: faker.number.int(1000),
      deletions: faker.number.int(1000),
      changed_files: faker.number.int(10),
    },
  })
}
