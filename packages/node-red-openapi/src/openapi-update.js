/* global RED */
const addLegacyProperties = () => {
  const legacyProps = []
  legacyProps.push('api') // renamend to apiTag
  legacyProps.push('operation') // put into operationData
  legacyProps.push('openApiUrl') // using only config node now
  return legacyProps
}

// version === node version
const clientUpdate = (version, node) => {
  if (typeof node.requestContentType === 'undefined') node.requestContentType = node.contentType
  if (typeof node.responseContentType === 'undefined') node.responseContentType = ''
  if (typeof node.alternServer === 'undefined') node.alternServer = false
  if (typeof node.keepAuth === 'undefined') node.keepAuth = false
  if (typeof node.internalErrors === 'undefined') node.internalErrors = {}

  // adding new version bug (missing addCurrentNodeVersion)
  if (Array.isArray(node.headers)) {
    node.version = '2.1.2'
    version.aggregated = version.parse('2.1.2').aggregated
  }

  // lower than 2.0.0
  if (version.aggregated < version.parse('2.0.0').aggregated) {
    if (!node.configUrlNode) {
      const configType = 'openApi-red-url'
      // search for existing config node
      RED.nodes.eachConfig(cN => {
        if (cN.type === configType && cN.url === node.openApiUrl) {
          node.configUrlNode = cN.id
        }
      })
      // create new configNode
      if (!node.configUrlNode && node.openApiUrl) {
        const _def = RED.nodes.getType(configType)
        const newConfig = RED.nodes.add({
          id: RED.nodes.id('_ADD_'),
          _def,
          type: configType,
          z: '',
          users: [],
          _: _def._,
          name: node.openApiUrl,
          url: node.openApiUrl,
          server: '',
          serverType: 'custom',
          urlType: 'str',
          _version: '2.0.0'
        })
        node.configUrlNode = newConfig.id
      }
    }

    node.apiTag = node.api

    node.operationData = {
      id: node.operation || node.operationId || node.operationData.method + node.operationData.path,
      hasOperationId: !node.operationData.withoutOriginalOpId,
      path: node.operationData.path,
      method: node.operationData.method
    }

    node.responseAsPayload = true
    node.outputStyle = 'classic'
    if (node.errorHandling === 'Standard') {
      node.errorHandling = 'default'
    }

    // recreate parameters from array to objects and remove unneccessary old values
    if (Array.isArray(node.parameters)) {
      const newParameterObject = {}
      node.parameters.forEach(parameter => {
        // unique name is param.name + param.in (query, header,...)
        // former "Request body " will be renamend in requestBody for cleaner code and less error potential (space after "body") in ParameterEditor.svelte
        let uniqueName = (parameter.name + ' ' + parameter.in).trim()
        if (uniqueName === 'Request body') {
          uniqueName = 'requestBody'
        }
        newParameterObject[uniqueName] = {
          isActive: parameter.isActive,
          in: parameter.in,
          name: parameter.name,
          required: parameter.required,
          type: parameter.type,
          value: parameter.value
        }
      })
      node.parameters = newParameterObject
    }
  }

  if (version.aggregated < version.parse('2.1.0').aggregated) {
    node.headers = []
  }

  if (version.aggregated < version.parse('2.7.0').aggregated) {
    node.target = 'payload'
    node.targetType = 'msg'
  }
  return node
}

module.exports = {
  clientUpdate,
  addLegacyProperties
}
