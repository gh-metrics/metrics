/**Mocked data */
export default function({faker, query, login = faker.internet.userName()}) {
  console.debug("metrics/compute/mocks > mocking graphql api result > base/user")
  return ({
    user: {
      databaseId: faker.number.int(10000000),
      name: faker.person.fullName(),
      login,
      createdAt: `${faker.date.past({years: 10})}`,
      avatarUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mOcOnfpfwAGfgLYttYINwAAAABJRU5ErkJggg==",
      websiteUrl: faker.internet.url(),
      twitterUsername: login,
    },
  })
}
