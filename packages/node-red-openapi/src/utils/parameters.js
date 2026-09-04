const util = require('util')

let RED
let evalNodeProp
// avoid adding RED it to all functions
const setRED = (_RED) => {
  RED = _RED
  // syncronous evaluateNodeProperty is depreceated with Node-RED 3.1
  // https://github.com/flowforge/flowforge-nr-dashboard/issues/99
  evalNodeProp = util.promisify(RED.util.evaluateNodeProperty)
}

// openApi-red >= v.2.0.0 uses parameter object instead of array
// external editor could also use parameters with array (which is openAPI default)
const restructureParamFromArray = (parameters) => {
  console.warn('[openAPI-red] Warning: Depreceated parameter format. Please use an object instead of an array.')
  const newParameterObject = {}
  parameters.forEach(parameter => {
    newParameterObject[parameter.name] = parameter
  })
  return newParameterObject
}

const evaluateNodeProp = async (value, type, node, msg, context) => {
  try {
    // using try/catch to return a more user friendly error
    let result
    if (type.startsWith('_each_')) {
      const source = context[type.substring(6)]
      if (value.startsWith('.')) {
        value = value.substring(1)
      }
      // get nested value from object or array
      result = value.split(/[\.\[\]\'\"]/).filter(p => p).reduce((o, p) => o ? o[p] : undefined, source) // eslint-disable-line
    } else {
      result = await evalNodeProp(value, type, node, msg)
    }
    return result
  } catch (e) {
    console.error(e)
    throw new Error(`[openAPI-red] Could not evaluate value "${value}" from type "${type}".`)
  }
}

// context will be recreated for each main parameter
const createSpecialValue = async (param, alreadyNested = false, context = {}, msg, node) => {
  let value
  context.value = null // next value
  // check only if parameter is active or required for now, the filter check must be done individually (e.g. parameter is required, but the yield for an array/each shall be filtered)
  if (checkParameterIsActive(param)) {
    if (param.type.startsWith('editor')) {
      // check if the whole editor should be added
      if (await checkParamActiveFilter(msg, param, context)) {
        value = alreadyNested ? {} : { [param.name]: {} }
        for await (const subParam of Object.values(param.parameters || {})) {
          context.value = await createSpecialValue(subParam, true, context, msg, node)
          if (await checkParamActiveFilter(msg, subParam, context)) {
            // await checkIsParameterActive(subParam, eachIndex)
            if (alreadyNested) {
              value[subParam.name] = context.value
            } else {
              value[param.name][subParam.name] = context.value
            }
          }
        }
      }
    } else if (param.type === 'array') {
      value = []
      for await (const arrayParam of param.value) {
        if (await checkParamActiveFilter(msg, arrayParam, context, true)) {
          const evaluatedValue = await createSpecialValue(arrayParam, true, context, msg, node)
          value.push(evaluatedValue)
        }
      }
    } else if (param.type === 'select') {
      try {
        context.value = JSON.parse(param.value)
      } catch (e) {
        // undefined (if somebody really want to make that selectable....) or other error, send at least the string value
        context.value = param.value
      }
      if (await checkParamActiveFilter(msg, param, context)) {
        value = context.value
      }
    } else if (param.type === 'each') {
      // check if each  is active
      if (await checkParamActiveFilter(msg, param, context)) {
        const eachValues = await evaluateNodeProp(param.each, param.eachType, node, msg, context)
        value = []
        if (!Array.isArray(eachValues)) {
          throw new Error('[openAPI-red] Parameter "' + param.name + '" is from type "each", but it\'s value is not an array.')
        }
        const parameterDefinition = param.value[0]
        for (let index = 0; index < eachValues.length; index++) {
          // each values must be checked individually (yield)
          context[param.as] = eachValues[index]
          if (await checkParamActiveFilter(msg, parameterDefinition, context, true)) {
            const evaluatedValue = await createSpecialValue(parameterDefinition, true, context, msg, node)
            value.push(evaluatedValue)
          }
        }
        // all children of each have been evaluated -> remove context[param.as] to hide it from later context accesses
        delete context[param.as]
      }
    } else {
      context.value = await evaluateNodeProp(param.value, param.type, node, msg, context)
      if (await checkParamActiveFilter(msg, param, context)) {
        value = context.value
      }
    }
  }
  return value
}

const checkParameterIsActive = (param) => param.isActive || param.required || false

const checkParamActiveFilter = async (msg, param, context = {}, inArray = false) => {
  // if required parameter is iterated, each "yield" must be checked
  if (param.required && !inArray) {
    return true
  }
  let isActive = param.isActive
  if (isActive && param.activeFilter) {
    const filterFunction =  new Function('msg', '{' + Object.keys(context).join (',') + '}', param.activeFilter) // eslint-disable-line
    isActive = filterFunction(msg, context)
  }
  return isActive
}

const createParameters = async (rawParameters, msg, node) => {
  const parameters = {}
  try {
    if (Array.isArray(rawParameters)) {
      rawParameters = restructureParamFromArray(rawParameters)
    }
    const parameterKeys = Object.keys(rawParameters)
    // forEach cannot be async...
    for await (const pKey of parameterKeys) {
      const parameter = rawParameters[pKey]
      // check first lvl parameters (requestBody, query parameter,...)
      if (checkParameterIsActive(parameter)) {
        let parameterValue
        const context = {}
        if (parameter.type.startsWith('editor')) {
          // recursive build of object -> e.g. returns { body: { id: 123 } }
          // but it must be set to parameters.body (below) -> only the value of the object is needed
          // (no need to put value into context)
          parameterValue = await createSpecialValue(parameter, false, context, msg, node)
          parameterValue = parameterValue[parameter.name] // remove first object level ({Request body: {} })
        } else if (parameter.type === 'array') {
          if (!Array.isArray(parameter.value)) {
            throw new Error('[openAPI-red] Parameter "' + parameter.name + '" is from type array, but it\'s value not.')
          }
          if (await checkParamActiveFilter(msg, parameter, context)) {
            parameterValue = await createSpecialValue(parameter, false, context, msg, node)
          }
        } else if (parameter.type === 'each') {
          if (await checkParamActiveFilter(msg, parameter, context)) {
            parameterValue = await createSpecialValue(parameter, false, context, msg, node)
          }
        } else {
          context.value = await evaluateNodeProp(parameter.value, parameter.type, node, msg, node)
          if (await checkParamActiveFilter(msg, parameter, context)) {
            parameterValue = context.value
          }
        }
        // query input can't be object, swagger.js should handle this but does not (https://github.com/swagger-api/swagger-js/blob/master/docs/usage/http-client.md#query-support)
        // arrays still work and will be set to "...tag=val1&tag=val2"
        if (typeof parameterValue === 'object' && !Array.isArray(parameterValue) && parameter.in === 'query') {
          parameterValue = JSON.stringify(parameterValue)
        }
        parameters[parameter.name] = parameterValue
      }
    }
    return parameters
  } catch (e) {
    console.error('[openAPI-red] Error creating parameters')
    throw e
  }
}

module.exports = {
  setRED,
  restructureParamFromArray,
  createParameters,
  evaluateNodeProp
}
