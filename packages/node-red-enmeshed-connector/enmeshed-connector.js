/**
 * enmeshed-connector — frosch-styled wrapper around openapi-red.
 *
 * Captures the openApiRed constructor by temporarily intercepting
 * RED.nodes.registerType during the second invocation of the factory,
 * then re-registers it under the 'enmeshed-connector' type name.
 */
module.exports = function (RED) {
  let openApiRedFactory
  try {
    openApiRedFactory = require('openapi-red/src/openapi')
  } catch (e) {
    RED.log.error('[enmeshed-connector] openapi-red is not installed.')
    return
  }

  let capturedConstructor = null
  let capturedOptions = undefined
  const originalRegisterType = RED.nodes.registerType.bind(RED.nodes)

  RED.nodes.registerType = function (type, constructor, options) {
    if (type === 'openApi-red') {
      capturedConstructor = constructor
      capturedOptions = options
      return
    }
    originalRegisterType(type, constructor, options)
  }

  openApiRedFactory(RED)
  RED.nodes.registerType = originalRegisterType

  if (!capturedConstructor) {
    RED.log.error('[enmeshed-connector] Could not capture openapi-red constructor.')
    return
  }

  RED.nodes.registerType('enmeshed-connector', capturedConstructor, capturedOptions)
}
