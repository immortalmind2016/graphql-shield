import {
  IMiddleware,
  IMiddlewareFunction,
  IMiddlewareGeneratorConstructor,
} from 'graphql-middleware'
import { GraphQLSchema, GraphQLObjectType, isObjectType } from 'graphql'
import { IRules, IOptions, ShieldRule, IRuleFieldMap } from './types'
import { isRuleFunction, isRuleFieldMap, isRule, isLogicRule } from './utils'
import { CustomError } from './customError'
import { allow, deny } from './constructors'

/**
 *
 * @param options
 *
 * Generates a middleware function from a given rule and
 * initializes the cache object in context.
 *
 */
function generateFieldMiddlewareFromRule(
  rule: ShieldRule,
  options: IOptions,
): IMiddlewareFunction {
  async function middleware(resolve, parent, args, ctx, info) {
    // Cache
    if (!ctx) {
      ctx = {}
    }

    if (!ctx._shield) {
      ctx._shield = {}
    }

    if (!ctx._shield.cache) {
      ctx._shield.cache = {}
    }

    // Execution
    try {
      const res = await rule.resolve(parent, args, ctx, info)

      if (res instanceof CustomError) {
        return res
      } else if (res) {
        return resolve(parent, args, ctx, info)
      } else {
        return options.fallback
      }
    } catch (err) {
      if (options.debug) {
        throw err
      } else if (options.allowExternalErrors) {
        return err
      } else {
        return options.fallback
      }
    }
  }

  if (isRule(rule) && rule.extractFragment()) {
    return {
      fragment: rule.extractFragment(),
      resolve: middleware,
    }
  } else if (isLogicRule(rule)) {
    return {
      fragments: rule.extractFragments(),
      resolve: middleware,
    }
  } else {
    return middleware
  }
}

/**
 *
 * @param type
 * @param rules
 * @param options
 *
 * Generates middleware from rule for a particlar type.
 *
 */
function applyRuleToType(
  type: GraphQLObjectType,
  rules: ShieldRule | IRuleFieldMap,
  options: IOptions,
): IMiddleware {
  if (isRuleFunction(rules)) {
    const fieldMap = type.getFields()

    const middleware = Object.keys(fieldMap).reduce((middleware, field) => {
      return {
        ...middleware,
        [field]: generateFieldMiddlewareFromRule(rules, options),
      }
    }, {})

    return middleware
  } else if (isRuleFieldMap(rules)) {
    const fieldMap = type.getFields()

    const middleware = Object.keys(fieldMap).reduce((middleware, field) => {
      if (rules[field]) {
        return {
          ...middleware,
          [field]: generateFieldMiddlewareFromRule(rules[field], options),
        }
      } else {
        return {
          ...middleware,
          [field]: generateFieldMiddlewareFromRule(
            options.whitelist ? deny : allow,
            options,
          ),
        }
      }
    }, {})

    return middleware
  } else {
    const fieldMap = type.getFields()

    const middleware = Object.keys(fieldMap).reduce((middleware, field) => {
      return {
        ...middleware,
        [field]: generateFieldMiddlewareFromRule(
          options.whitelist ? deny : allow,
          options,
        ),
      }
    }, {})

    return middleware
  }
}

/**
 *
 * @param schema
 * @param rule
 * @param options
 *
 * Applies the same rule over entire schema.
 *
 */
function applyRuleToSchema(
  schema: GraphQLSchema,
  rule: ShieldRule,
  options,
): IMiddleware {
  const typeMap = schema.getTypeMap()

  const middleware = Object.keys(typeMap).reduce((middleware, typeName) => {
    const type = typeMap[typeName]

    if (isObjectType(type)) {
      return {
        ...middleware,
        [typeName]: applyRuleToType(type, rule, options),
      }
    } else {
      return middleware
    }
  }, {})

  return middleware
}

/**
 *
 * @param rules
 * @param wrapper
 *
 * Converts rule tree to middleware.
 *
 */
function generateMiddlewareFromSchemaAndRuleTree(
  schema: GraphQLSchema,
  rules: IRules,
  options: IOptions,
): IMiddleware {
  if (isRuleFunction(rules)) {
    return applyRuleToSchema(schema, rules, options)
  } else {
    const typeMap = schema.getTypeMap()

    const middleware = Object.keys(typeMap)
      .filter(type => isObjectType(typeMap[type]))
      .reduce(
        (middleware, type) => ({
          ...middleware,
          [type]: applyRuleToType(
            typeMap[type] as GraphQLObjectType,
            rules[type],
            options,
          ),
        }),
        {},
      )

    return middleware
  }
}

/**
 *
 * @param ruleTree
 * @param options
 *
 * Generates middleware from given rules.
 *
 */
export function generateMiddlewareGeneratorFromRuleTree<
  TSource = any,
  TContext = any,
  TArgs = any
>(
  ruleTree: IRules,
  options: IOptions,
): IMiddlewareGeneratorConstructor<TSource, TContext, TArgs> {
  const generator = (schema: GraphQLSchema) => {
    const middleware = generateMiddlewareFromSchemaAndRuleTree(
      schema,
      ruleTree,
      options,
    )

    return middleware
  }

  return generator
}
