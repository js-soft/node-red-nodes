const setError = (node, text, source) => {
  console.log('[openAPI-red]', text)
  node.internalErrors.text = text
  node.internalErrors.source = source
}

const clearError = (node, source) => {
  if (!source || node.internalErrors.source === source) {
    node.internalErrors.text = ''
    node.internalErrors.source = ''
  }
}

const getArraySchemes = (paramMetaData, arrayMultiSchemesType) => {
  return paramMetaData.items?.[arrayMultiSchemesType] || paramMetaData.schema?.[arrayMultiSchemesType] || paramMetaData.items || paramMetaData.schema || paramMetaData || {}
}

const getArrayElementSchema = (value, paramMetaData, newElement = false) => {
  let arraySchema
  const arrayMultiSchemesType = value?.selectedSchema?.type || getMultipleSchemesType(paramMetaData, true)
  if (arrayMultiSchemesType) {
    const arraySchemes = getArraySchemes(paramMetaData, arrayMultiSchemesType)
    if (arraySchemes[arrayMultiSchemesType]) {
      arraySchema = arraySchemes[arrayMultiSchemesType].find(schema => schema?.items)?.items
    } else if (!newElement) {
      // try to find the selected schema or return a fallback
      arraySchema = Object.values(getArraySchemes(paramMetaData)).find(thisSchema => thisSchema?.$$ref?.endsWith('/' + value.selectedSchema?.name)) || arraySchemes?.[0]
    } else {
      // new element => use first found
      arraySchema = arraySchemes?.[0]
    }
  } else {
    arraySchema = getArraySchemes(paramMetaData)
  }
  return arraySchema || {}
}

const getMultipleSchemesType = (paramOrSchemaData, inArray) => {
  let schema
  if (inArray) {
    schema = paramOrSchemaData?.schema || paramOrSchemaData?.items?.schema || paramOrSchemaData?.items || paramOrSchemaData
  } else {
    schema = paramOrSchemaData?.schema || paramOrSchemaData
  }
  // only handling the first one found!
  if (schema?.oneOf?.length) {
    return 'oneOf'
  // anyOf shows only one scheme like oneOf, if user needs more than this scheme input
  // he must use a normal json editor
  } else if (schema?.anyOf?.length) {
    return 'anyOf'
  // handle allOf only if it has one entry (which is equal to oneOf)
  // else the schemes must be merged (like anyOf)
  } else if (schema?.allOf?.length === 1) {
    return 'allOf'
  }
}

const getMultiSelectionSelectedSchema = (parameter, paramMetaData) => {
  // is linked to a schema?
  if (!parameter.selectedSchema?.name) {
    return {}
  }
  // note: selecteable schema can also be a simple value or object parameter
  const multiSchemesList = paramMetaData.schema?.[parameter.selectedSchema?.type] || paramMetaData?.[parameter.selectedSchema?.type]
  const newSchema = multiSchemesList?.find(s => s?.$$ref?.endsWith('/' + parameter.selectedSchema?.name))
  if (newSchema) {
    return newSchema
  } else {
    console.warn('[openAPI-red] Warning: selected schema not found.')
    return {}
  }
}

const getTypedInputType = (paramMetaData = {}, getEnum = true) => {
  // swagger has schema nested, openApi has schema directly
  const multiSchemesType = (getMultipleSchemesType(paramMetaData))
  // TODO: check for other scheme types after found one? currently only allows one type, mixed can become very complex and there won't be propably a usecase.
  // paramMetaData[mulitSchemesType] is for 'select' arrays with schemes.
  const schema = paramMetaData.schema?.[multiSchemesType]?.[0] || paramMetaData[multiSchemesType]?.[0] || paramMetaData.schema
  let type = schema?.type || paramMetaData.type
  if (type?.oneOf) {
    type = type.oneOf[0]
  }
  const nullableBool = (type === 'boolean' && (schema?.nullable || paramMetaData.nullable))
  const hasEnum = (type !== 'boolean' && (paramMetaData.enum?.length || paramMetaData.items?.enum?.length || schema?.enum?.length))
  if (getEnum && (hasEnum || nullableBool)) {
    return 'select'
  }
  if (type === 'boolean') {
    return 'bool' // nullable bool -> select
  } else if (type === 'integer' || type === 'number') {
    return 'num'
  } else if (paramMetaData.name === 'Json Request Body' || paramMetaData.name === 'body' || type === 'body' || type === 'object') {
    // return "editor" will lead in parameter row to the check for multiple editors and the editor name and select the first one
    return (schema?.properties || paramMetaData.properties) ? 'editor' : 'json'
  } else if (type === 'array' && (schema?.items?.type || paramMetaData.items?.type || getMultipleSchemesType(paramMetaData.items || {}))) {
    // array should be defined what type is needed or can have nested multiple schemes inside
    return 'array'
  } else {
    return 'str'
  }
}

const getAllowedTypes = (metaOrSchema, paramName, additionalEachTypes) => {
  const type = getTypedInputType(metaOrSchema)
  const eachInputTypes = additionalEachTypes.map(asValue => { return { value: '_each_' + asValue, label: asValue } })
  let result = []
  switch (type) {
    case 'bool':
    case 'num':
    case 'json':
      result = [type, ...eachInputTypes, 'jsonata', 'msg', 'flow', 'global']
      break
    case 'editor': {
      // currently only handles the first type (oneOf, anyOf) found if multiple editors exists (while oneOf seems to be the most important)
      const reference = metaOrSchema?.$$ref || paramName || 'Unknown'
      const label = metaOrSchema?.['x-label']
        ? metaOrSchema?.['x-label']
        : reference.split('/').pop() + ' - Editor'
      const value = reference ? 'editor:' + reference.split('/').pop() : 'editor'
      result = [{ value, label, hasValue: false }, ...eachInputTypes, 'json', 'jsonata', 'msg', 'flow', 'global']
      break
    }
    case 'select': {
      // typedInput options must be string -> this means number/bool/null/etc. may loose their data type. (trying to JSON.stringify and JSON.parse it back)
      // if that fails the server must handle the wrong data type or the user has to enter the value directly or via msg.
      const defaultType = getTypedInputType(metaOrSchema, false)
      if (defaultType === 'bool') {
        // nullable bool
        result = [{ value: 'select', label: 'boolean or null', options: ['true', 'false', 'null'], icon: 'red/images/typedInput/bool.svg' }, ...eachInputTypes, 'jsonata', 'msg', 'flow', 'global']
      } else {
        const options = (metaOrSchema?.items?.enum || metaOrSchema?.schema?.enum || metaOrSchema?.enum || []).map(v => {
          const option = {}
          if (typeof v === 'undefined') {
            option.value = 'undefined'
          } else if (typeof v === 'string') {
            option.value = v // else value and label would be in quotes ("value" instead of value)
          } else {
            option.value = JSON.stringify(v)
          }
          option.label = option.label || option.value
          return option
        })
        result = [{ value: 'select', label: 'Select', options, icon: 'fa-list-ul' }, ...eachInputTypes, defaultType, 'json', 'jsonata', 'msg', 'flow', 'global']
      }
      break
    }
    case 'array':
      result = [{ value: 'each', label: 'Each', hasValue: false, icon: 'fa-tasks' }, { value: 'array', label: 'Array', hasValue: false, icon: 'fa-list-ol' }, ...eachInputTypes, 'json', 'msg', 'flow', 'global']
      break
    default:
      result = [...eachInputTypes, 'str', 'json', 'jsonata', 'msg', 'flow', 'global']
      break
  }
  return result.filter(type => type)
}

// if parameter has own parameters show them if parent type is editor and set default value to msg.payload[parentParam][param]
// can be parameter or subParameter
const createParameter = (name, oldParamValues = {}, options) => {
  const paramMetaData = options.paramMetaData || {}
  const requiredByParent = options.requiredByParent || false
  const newArrayValue = options.newArrayValue || false
  const externalEditorMode = options.externalEditorMode || false
  let msgPathString = options.msgPathString || 'payload'

  if (paramMetaData['x-pekfinger-msgPathString']) {
    // special case for external editors which should have a different msg path (e.g. simple schema values -> msg.payload instead of msg.payload[name])
    msgPathString = paramMetaData['x-pekfinger-msgPathString']
  } else if (!isNaN(name) || name.includes(' ') || name.includes('@')) {
    msgPathString += '["' + name + '"]'
  } else {
    msgPathString += '.' + name
  }
  // init type (old value) or (editor (obj) || msg)
  let type = oldParamValues.type
  const defaultType = getTypedInputType(paramMetaData)
  if (!type) {
    if (defaultType === 'editor') {
      type = defaultType // editor type will be changed later to editor:SchemaName
    } else {
      type = 'msg'
    }
  }

  let required = requiredByParent
  let schema = paramMetaData?.schema || paramMetaData || {}
  let selectedSchema
  const multiSchemesType = getMultipleSchemesType(paramMetaData, newArrayValue)
  if (multiSchemesType) {
    selectedSchema = oldParamValues.selectedSchema || {}
    const selectedType = selectedSchema.type || multiSchemesType
    let selectedSchemaIndex = schema[multiSchemesType]?.findIndex(s => s?.$$ref?.endsWith(selectedSchema.name))
    selectedSchemaIndex = selectedSchemaIndex >= 0 ? selectedSchemaIndex : 0 // undefined >= 0 => false
    // set schema to nested schema if existing
    schema = schema[selectedType]?.[selectedSchemaIndex] || {}
    selectedSchema.type = selectedType
    selectedSchema.name = schema.$$ref?.split('/')?.pop() || schema.title || ''
  }

  if (!required) {
    if (typeof schema.required === 'boolean') {
      required = schema.required
    } else if (typeof paramMetaData.required === 'boolean') {
      required = paramMetaData.required
    }
  }
  const result = {
    name,
    isActive: (required && !externalEditorMode) || (requiredByParent && !externalEditorMode) || !!oldParamValues.isActive, // required in schema is directly for this parameter
    activeFilter: oldParamValues.activeFilter || '',
    required,
    type,
    collapsed: (typeof oldParamValues.collapsed !== 'undefined') ? oldParamValues.collapsed : true,
    value: (typeof oldParamValues.value !== 'undefined') ? oldParamValues.value : msgPathString,
    parameters: {},
    mark: oldParamValues.mark || { name: false, type: false, value: false, activeFilter: false },
    parent: oldParamValues.parent,
    msgPathString
  }

  // additional special data
  if (selectedSchema) {
    result.selectedSchema = selectedSchema
  }
  if (paramMetaData.in) {
    result.in = paramMetaData.in
  }
  // each is a "single" array component for easier handling
  if (result.type === 'array' || result.type === 'each') {
    result.value = result.value.map((v, i) => {
      const arraySchema = getArrayElementSchema(v, paramMetaData)
      return createParameter(i, v, { paramMetaData: arraySchema, requiredByParent: true, msgPathString, externalEditorMode })
    })
  }
  if (result.type === 'each') {
    result.eachType = oldParamValues.eachType || 'msg'
    result.each = oldParamValues.each || ''
    result.as = oldParamValues.as || ''
  }
  // if parameter has properties...
  const nestedProperties = schema.properties || paramMetaData.properties || {}
  Object.keys(nestedProperties).forEach(nestedName => {
    const oldNestedParamVal = oldParamValues.parameters?.[nestedName]
    const nestedParamMetaData = nestedProperties[nestedName]
    const childParamsRequired = Array.isArray(schema?.required)
      ? schema.required
      : Array.isArray(paramMetaData.required)
        ? paramMetaData.required
        : []
    const reqByParent = childParamsRequired.includes(nestedName)
    result.parameters[nestedName] = createParameter(nestedName, oldNestedParamVal, {
      paramMetaData: nestedParamMetaData,
      requiredByParent: reqByParent,
      msgPathString,
      externalEditorMode
    })
  })

  return result
}

const orderRequired = (a, b) => {
  let comparison = 0
  if (b.required) {
    comparison = 1
  } else if (a.required) {
    comparison = -1
  }
  return comparison
}

const createParameters = (node, operation = {}, externalEditorMode = false) => {
  if (!Object.keys(operation).length) {
    // changed api, but triggered to early. if parameters have same name, we want to keep the value
    return
  }
  try {
    const oldParameters = { ...node.parameters }
    node.parameters = {}
    if (node.internalErrors.source === 'createParameters') {
      clearError(node)
    }
    // openApi 3 has the request body as an separate object instead of an "body" parameter, to avoid conflict,
    // there should be no requestBody additionally in parameters
    if (!operation.parameters?.requestBody && operation?.requestBody?.content) {
      const requestBodyData = operation.requestBody.content[node.requestContentType]
      if (requestBodyData) {
        node.parameters.requestBody = {
          name: 'Request body',
          required: !!operation.requestBody.required || false,
          isActive: (!!operation.requestBody.required && !externalEditorMode) || !!oldParameters.requestBody?.isActive,
          activeFilter: oldParameters.requestBody?.activeFilter || '',
          type: oldParameters.requestBody?.type || getTypedInputType(requestBodyData),
          parameters: {}, // using for UI editor
          mark: operation.requestBody.mark || { name: false, type: false, value: false, activeFilter: false },
          msgPathString: 'payload' // more correct would be payload.requestBody as another parameter could have the same name, but this is not practical.
        }
        // save description to requestBodyData (schema)
        requestBodyData.schema.description = requestBodyData.schema.description || operation.requestBody.description || ''
        // create subparameters. check by schema to remove legacy parameters
        let activeSchema = {}
        const isArray = requestBodyData.type === 'array'
        const multiSchemesType = getMultipleSchemesType(requestBodyData.schema, isArray)
        if (multiSchemesType) {
          const selectedSchema = oldParameters.requestBody?.selectedSchema || {}
          const subSchemas = isArray ? requestBodyData.schema.items : requestBodyData.schema
          // check if selected type exists, else fallback
          const selectedType = (selectedSchema.type && subSchemas[selectedSchema.type]) ? selectedSchema.type : multiSchemesType
          let selectedSchemaIndex
          selectedSchemaIndex = subSchemas[selectedType].findIndex(s => s?.$$ref?.endsWith(selectedSchema.name))
          selectedSchemaIndex = selectedSchemaIndex >= 0 ? selectedSchemaIndex : 0
          activeSchema = subSchemas[selectedType]?.[selectedSchemaIndex] || {}
          selectedSchema.name = subSchemas[selectedType][selectedSchemaIndex].$$ref.split('/').pop()
          selectedSchema.type = selectedType
          node.parameters.requestBody.selectedSchema = selectedSchema
        } else {
          activeSchema = requestBodyData.schema || {}
        }

        // value is for not using UI editor or not object values (incl. array)
        const hasOldValue = typeof oldParameters.requestBody?.value !== 'undefined'
        if (node.parameters.requestBody.type === 'json') {
          node.parameters.requestBody.value = hasOldValue ? oldParameters.requestBody.value : '{}'
        } else if (node.parameters.requestBody.type === 'array' || node.parameters.requestBody.type === 'each') {
          node.parameters.requestBody.value = Array.isArray(oldParameters.requestBody?.value) ? oldParameters.requestBody.value : []
          if (node.parameters.requestBody.type === 'array') {
            node.parameters.requestBody.value = node.parameters.requestBody.value.map((v, i) => {
              const arraySchema = getArrayElementSchema(v, activeSchema)
              return createParameter(i, v, {
                paramMetaData: arraySchema,
                requiredByParent: true,
                msgPathString: node.parameters.requestBody.msgPathString,
                externalEditorMode
              })
            })
          } else if (node.parameters.requestBody.type === 'each') {
            node.parameters.requestBody.eachType = oldParameters.requestBody.eachType || 'msg'
            node.parameters.requestBody.each = oldParameters.requestBody.each || ''
            node.parameters.requestBody.as = oldParameters.requestBody.as || ''
          }
        } else {
          node.parameters.requestBody.value = hasOldValue ? oldParameters.requestBody.value : ''
        }

        Object.keys(activeSchema.properties || {}).forEach(property => {
          const oldParameterValues = oldParameters.requestBody?.parameters?.[property]
          const paramMetaData = activeSchema.properties[property]
          const requiredByParent = activeSchema.required?.includes(property)
          node.parameters.requestBody.parameters[property] = createParameter(property, oldParameterValues, {
            paramMetaData,
            requiredByParent,
            msgPathString: 'payload',
            externalEditorMode
          })
        })
      }
    }
    // add default parameters
    const apiParameterSchemes = operation.parameters?.sort(orderRequired) || []
    apiParameterSchemes.forEach(parameterMetaData => {
      // Not good style, but a parameter with the same name can be in path, query, header or cookie
      // There was a ticket a long time ago...
      const paramKey = parameterMetaData.name + ' ' + parameterMetaData.in
      const oldParam = oldParameters[paramKey] || {}
      node.parameters[paramKey] = createParameter(parameterMetaData.name, oldParam, { paramMetaData: parameterMetaData, externalEditorMode })
    })
  } catch (e) {
    console.error(e)
    setError(node, 'Error creating parameters. Please check your openApi specification.', 'createParameters')
  }
}

module.exports = {
  clearError,
  getAllowedTypes,
  getTypedInputType,
  getMultipleSchemesType,
  getArraySchemes,
  getArrayElementSchema,
  getMultiSelectionSelectedSchema,
  createParameter,
  createParameters,
  setError
}
