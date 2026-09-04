const Swagger = require('swagger-client')

const { setRED, restructureParamFromArray, createParameters, evaluateNodeProp } = require('./utils/parameters')
let nodeFetch // lazy import below

module.exports = function (RED) {
  function openApiRed (config) {
    RED.nodes.createNode(this, config)
    const node = this

    // set RED in parameters.js
    setRED(RED)

    // return -1 if not found
    const findOutputNumber = (response) => {
      const responseCode = response.code || response.statusCode || response.status || ''
      let outputNumber
      if (config.outputStyle === 'compact') {
        outputNumber = config.responseOutputLabels.findIndex(label => label.code === (responseCode?.toString()?.substring(0, 1) + 'xx'))
      } else if (config.outputStyle === 'each response') {
        outputNumber = config.responseOutputLabels.findIndex(label => Number(label.code) === responseCode)
      }
      if (outputNumber === -1 && response.ok) {
        // check for unspecified successful output. this should always be index === 0
        // This is only available if no successful output was defined. Else it will go to undefined responses.
        outputNumber = config.responseOutputLabels.findIndex(label => label.code === 'successful' || label.code === 'all')
      }

      // still no defined output found, exist an undefined response output?
      if (outputNumber === -1 && config.errorHandling === 'other output') {
        outputNumber = config.responseOutputLabels.findIndex(label => label.code === 'undefinedResponses')
      }
      return outputNumber
    }

    const setMessage = async (msg, response) => {
      let result
      if (typeof response === 'string') {
        result = response
      } else if (config.responseAsPayload) {
        // legacy mode
        result = response
      } else {
        // More about the duplicates: https://github.com/swagger-api/swagger-js/blob/96d261987700297a472db5587c0a8c769095d73e/src/http/index.js#L115
        delete response.obj // Duplicate of response.body
        // If response is a file, convert blob as NR (or express) will remove it on sending
        if (response?.data instanceof Blob) {
          result = Buffer.from(await response.data.arrayBuffer())
          const contentDisposition = response?.headers?.['content-disposition'] || ''
          // check if filename is stated
          // do not split via ";" as this is a legit char for filenames ('"' is not valid for windows, but prob. ok for linux)
          let filenameStartIndex = contentDisposition.indexOf('filename="')
          if (filenameStartIndex > -1) {
            filenameStartIndex += 10 // + filename="
            const filename = contentDisposition.substring(filenameStartIndex)?.split('"')?.[0]
            if (filename) {
              msg.filename = filename
            }
          }
        } else {
          result = response.body
        }
      }

      const setResult = (object, path, value) => {
        const keys = path.split('.')
        keys.reduce((acc, key, index) => {
          if (index === keys.length - 1) {
            acc[key] = value
          } else {
            acc[key] = acc[key] || {}
          }
          return acc[key]
        }, object)
      }

      if (config.targetType === 'msg') {
        setResult(msg, config.target, result)
      } else if (config.targetType === 'flow') {
        setResult(node.context().flow, config.target, result)
      } else if (config.targetType === 'global') {
        setResult(node.context().global, config.target, result)
      } else {
        msg.payload = result // fallback
      }
      delete response.data // Duplicate of response.text
      msg.response = response
      delete msg.response.body
    }

    node.on('input', async function (msg, send, done) {
      const handleDebugMode = (request) => {
        // if we have the full request object from swagger-client
        msg.openApiDebugData = { ...(request || requestSettings), ...debugData }
        delete msg.openApiDebugData.requestInterceptor
        if (msg.openApiDebugData.operationId) {
          delete msg.openApiDebugData.pathName
          delete msg.openApiDebugData.method
        }
        node.warn(msg.openApiDebugData)
      }
      const sendError = async (e, requestSettings) => {
        node.status({ fill: 'red', shape: 'dot', text: 'Error code: ' + (e.code || e.statusCode || e.status || 'Unknown code') })
        const errorMsg = `${e.status || e.response?.body?.code || ''} ${e.message} ${e.response?.body?.message ? '- ' + e.response.body.message : ''}`.trim()
        // set all available error data in a new object as NR flow will loose everything but the message (=== e.toString())
        if (e.response) {
          await setMessage(msg, e.response)
        } else {
          const errorObj = {
            message: errorMsg,
            status: e.status || e.response?.body?.code,
            stack: e.stack
          }
          // e.cause (rethrown Error Object (usually from swagger-js)) can have additional useful information.
          if (e.cause) {
            errorObj.cause = JSON.parse(JSON.stringify(e.cause))
          }
          await setMessage(msg, { body: errorObj })
        }

        if (config.debugMode && requestSettings) {
          handleDebugMode()
        }

        if (config.outputStyle === 'classic') {
          if (config.errorHandling === 'other output') {
            send([null, msg])
            done()
          } else if (config.errorHandling === 'throw exception') {
            done(e)
          } else {
            send(msg)
            done()
          }
        } else if (config.outputStyle === 'each response' || config.outputStyle === 'compact') {
          // check for an existing response output (includes check for error handling "other output")
          const outputNumber = findOutputNumber(e)
          if (outputNumber > -1) {
            const msgArray = Array(outputNumber).fill(null)
            msgArray.push(msg)
            send(msgArray)
            done()
          } else {
            // if no output found, throw expection
            done(e)
          }
        }
      }

      const configNode = RED.nodes.getNode(config.configUrlNode) || {}
      let parameters
      let debugData = {}
      // let eachValues = {}
      // eslint-disable-next-line
      let requestBody = undefined

      send = send || function () { node.send.apply(node, arguments) }

      if (msg.openApi?.parameters) {
        parameters = msg.openApi.parameters
        if (Array.isArray(parameters)) {
          parameters = restructureParamFromArray(parameters)
        }
      } else {
        try {
          parameters = await createParameters(config.parameters || {}, msg, node)
          if (parameters['Request body']) {
            requestBody = parameters['Request body']
            delete parameters['Request body']
            delete parameters.requestBody
          }
        } catch (e) {
          sendError(e)
        }
      }

      // fallback if no content type can be found
      let requestContentType = 'application/json'
      if (config.requestContentType) requestContentType = config.requestContentType
      const opData = config.operationData
      // try to get it if source was unavailable on startup (e.g. NodeRed creates specification or server/shuttle was not ready yet)
      let spec
      try {
        spec = configNode?.openApiSpecification() || null
        if (!spec) {
          await configNode.loadOpenApiSpec({
            id: configNode.id,
            apiSource: configNode.url,
            sourceType: configNode.urlType,
            serverUrl: configNode.server,
            serverType: configNode.serverType,
            devMode: configNode.devMode
          })
          spec = configNode.openApiSpecification()
        }

        // upgrade to v.2 needs operation method (node was not opened yet after upgrade)
        if (!opData.method && opData.hasOperationId && opData.id) {
          opData.method = Object.keys(spec.paths[opData.path] || {}).find(method => spec.paths[opData.path][method]?.operationId === opData.id)
        }
        // resolve if neccessary (this is neccessary once, if the node editor was not opened)
        if (!spec.paths[opData.path][opData.method]['x-openApi-red-resolved']) {
          await Swagger.resolveSubtree(spec, ['paths', opData.path, opData.method])
          spec.paths[opData.path][opData.method]['x-openApi-red-resolved'] = true
        }
      } catch (e) {
        // ignore error -> do not let NR crash
        console.warn(e)
      }
      if (!spec) {
        sendError(new Error('No openApi specification found. Please check the config node.'))
        return
      }

      const requestSettings = {
        // preferred use is operationId. If not available use pathname + method
        // Warning: every operation gets a (dummy) ID via resolve swagger, check for hasOperationId
        operationId: opData.hasOperationId ? opData.id : undefined,
        pathName: opData.hasOperationId ? undefined : opData.path,
        method: opData.hasOperationId ? undefined : opData.method,
        parameters,
        requestBody,
        requestContentType,
        requestInterceptor: async (req) => {
          // add headers from config node / node / msg
          req.headers = req.headers || {}
          if (configNode.headers?.length) {
            for (let index = 0; index < configNode.headers.length; index++) {
              req.headers[configNode.headers[index].key] = await evaluateNodeProp(configNode.headers[index].value, configNode.headers[index].valueType, this, msg)
            }
          }
          if (config.headers?.length) {
            for (let index = 0; index < config.headers.length; index++) {
              req.headers[config.headers[index].key] = await evaluateNodeProp(config.headers[index].value, config.headers[index].valueType, this, msg)
            }
          }
          if (msg.headers) {
            req.headers = Object.assign(req.headers, msg.headers)
          }
          // depreceated: remove in next major version
          if (msg.openApiToken) {
            req.headers.Authorization = 'Bearer ' + msg.openApiToken
            this.warn('msg.openApiToken is depreceated. Please use msg.headers')
          }
          // remove keys with empty value
          Object.keys(req.headers).forEach(key => {
            if (!req.headers[key]) {
              delete req.headers[key]
            }
          })

          if (config.debugMode) {
            debugData = req
          }
          if (!config.keepAuth) {
            delete msg.openApiToken
            delete msg.headers
          }

          return req
        }
      }
      if (config.responseContentType) {
        requestSettings.responseContentType = config.responseContentType
      }

      if (spec.swagger?.startsWith('2')) {
        if (configNode.server) {
          requestSettings.contextUrl = configNode.server // that does not change the port in url -> must also be changed in request interceptor
        }
      } else {
        // will only work with openApi v3
        // important: the custom server must be set into the specs, else it will be ignored
        if (['msg', 'flow', 'global'].includes(configNode.serverType)) {
          requestSettings.server = await evaluateNodeProp(configNode.server, configNode.serverType, this, msg)
          if (!spec.servers.find(server => server.url === requestSettings.server)) {
            spec.servers.push({ url: requestSettings.server })
          }
        } else {
          requestSettings.server = configNode.server || spec.openApiRed?.defaultServer // this option is already set into the specs
        }
      }

      const agentOptions = {}
      // if cert-auth is set, it will be used
      if (configNode.useAuthCertificate && configNode.authCertificate && configNode.authCertificateKey) {
        agentOptions.cert = configNode.authCertificate
        agentOptions.key = configNode.authCertificateKey
      }
      // if ca is set, it will be used
      if (configNode.authCaFile) {
        // process.env.NODE_EXTRA_CA_CERTS ?
        agentOptions.ca = configNode.authCaFile
      }
      // localhost can accept self signed signatures
      if (requestSettings.server?.startsWith('https://localhost:') || requestSettings.server?.startsWith('https://localhost/') || configNode.devMode) {
        agentOptions.rejectUnauthorized = false
      }

      // if agentOptions is not empty, create a custom agent
      if (Object.keys(agentOptions).length > 0) {
        if (!nodeFetch) nodeFetch = (await import('node-fetch')).default
        const agent = require('https').Agent(agentOptions)
        requestSettings.userFetch = (url, options) => {
          options.agent = agent
          return nodeFetch(url, options)
        }
      }

      node.status({ fill: 'yellow', shape: 'dot', text: 'Retrieving...' })
      try {
        const response = await Swagger.execute({ spec, ...requestSettings })
        node.status({})
        if (config.debugMode) {
          handleDebugMode()
        }
        await setMessage(msg, response)
        if (config.outputStyle === 'classic') {
          send(msg)
          done()
        } else {
          const outputNumber = findOutputNumber(response)
          if (outputNumber > -1) {
            const msgArray = Array(outputNumber).fill(null)
            msgArray.push(msg)
            send(msgArray)
          } else {
            // No output found -> throw exception
            sendError(response, requestSettings)
          }
        }
      } catch (e) {
        // invalid input or server returns error
        sendError(e, requestSettings)
      }
    })
  }
  RED.nodes.registerType('openApi-red', openApiRed)
}
