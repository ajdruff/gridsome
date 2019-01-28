const { pick, omit, reduce } = require('lodash')
const { pageInfoType, sortOrderType } = require('../types')

const {
  GraphQLInt,
  GraphQLList,
  GraphQLString,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLInputObjectType
} = require('../../graphql')

const {
  createFilterTypes,
  GraphQLInputFilterObjectType,
  GraphQLInputFilterReferenceType
} = require('../createFilterTypes')

module.exports = ({ nodeType, fields }) => {
  const edgeType = new GraphQLObjectType({
    name: `${nodeType.name}Edge`,
    fields: () => ({
      node: { type: nodeType },
      next: { type: nodeType },
      previous: { type: nodeType }
    })
  })

  const connectionType = new GraphQLObjectType({
    name: `${nodeType.name}Connection`,
    fields: () => ({
      totalCount: { type: GraphQLInt },
      pageInfo: { type: new GraphQLNonNull(pageInfoType) },
      edges: { type: new GraphQLList(edgeType) }
    })
  })

  const args = {
    sortBy: { type: GraphQLString, defaultValue: 'date' },
    order: { type: sortOrderType, defaultValue: 'DESC' },
    perPage: { type: GraphQLInt, defaultValue: 25 },
    skip: { type: GraphQLInt, defaultValue: 0 },
    page: { type: GraphQLInt, defaultValue: 1 },

    // TODO: remove before 1.0
    regex: { type: GraphQLString, deprecationReason: 'Use filter argument instead.' }
  }

  args.filter = {
    description: `Filter for ${nodeType.name} nodes.`,
    type: new GraphQLInputObjectType({
      name: `${nodeType.name}Filters`,
      fields: createFilterTypes({
        ...fields,
        id: '',
        title: '',
        slug: '',
        path: '',
        content: '',
        excerpt: '',
        date: '2019-01-03'
      }, nodeType.name)
    })
  }

  return {
    type: connectionType,
    description: `Connection to all ${nodeType.name} nodes`,
    args,
    async resolve (_, input, { store }, info) {
      const { sortBy, order, skip, regex, filter } = input
      let { perPage, page } = input

      page = Math.max(page, 1) // ensure page higher than 0
      perPage = Math.max(perPage, 1) // ensure page higher than 1

      const { collection } = store.getContentType(nodeType.name)
      const query = {}

      if (regex) {
        // TODO: remove before 1.0
        query.path = { $regex: new RegExp(regex) }
      }

      if (filter) {
        const internals = ['id', 'title', 'date', 'slug', 'path', 'content', 'excerpt']
        Object.assign(query, toFilterArgs(omit(filter, internals), args.filter, 'fields'))
        Object.assign(query, toFilterArgs(pick(filter, internals), args.filter))
      }

      const results = collection
        .chain()
        .find(query)
        .simplesort(sortBy, order === 'DESC')
        .offset(((page - 1) * perPage) + skip)
        .limit(perPage)

      const nodes = results.data()
      const totalNodes = collection.find({}).length

      // total items in result
      const totalCount = Math.max(totalNodes - skip, 0)

      // page info
      const currentPage = page
      const totalPages = Math.max(Math.ceil(totalCount / perPage), 1)
      const isLast = page >= totalPages
      const isFirst = page <= 1

      return {
        totalCount,
        edges: nodes.map((node, index) => ({
          node,
          next: nodes[index + 1],
          previous: nodes[index - 1]
        })),
        pageInfo: {
          currentPage,
          totalPages,
          isFirst,
          isLast
        }
      }
    }
  }
}

function toFilterArgs (input, filters, current = '') {
  const fields = filters.type.getFields()
  const result = {}

  for (const key in input) {
    const newKey = current ? `${current}.${key}` : key
    const value = input[key]

    if (value === undefined) continue

    if (fields[key].type instanceof GraphQLInputFilterObjectType) {
      result[newKey] = convertFilterValues(value)
    } else if (fields[key].type instanceof GraphQLInputFilterReferenceType) {
      result[`${newKey}.id`] = convertFilterValues(value)
    } else {
      Object.assign(result, toFilterArgs(value, fields[key], newKey))
    }
  }

  return result
}

function convertFilterValues (value) {
  return reduce(value, (acc, value, key) => {
    const filterKey = `$${key}`

    if (key === 'regex') acc[filterKey] = new RegExp(value)
    else acc[filterKey] = value

    return acc
  }, {})
}
