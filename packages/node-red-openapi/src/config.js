const util = require('util')
const Swagger = require('swagger-client')
const path = require('path')
const fs = require('fs')

// to allow using self signed certificates, add env var to tinypool
// https://nodejs.org/api/cli.html#cli_node_extra_ca_certs_file
const parentEnv = {}
if (process.env.NODE_EXTRA_CA_CERTS) {
  parentEnv.NODE_EXTRA_CA_CERTS = process.env.NODE_EXTRA_CA_CERTS
}
// using tinypool as loading extrem huge files can lead to timeout errors on fetching other files
let Tinypool
import('tinypool').then((tp) => {
  Tinypool = tp.Tinypool
})

module.exports = function (RED) {
  const openApiSpecifications = new Map()
  // syncronous evaluateNodeProperty is depreceated with Node-RED 3.1
  // https://github.com/flowforge/flowforge-nr-dashboard/issues/99
  const evalNodeProp = util.promisify(RED.util.evaluateNodeProperty)

  // change server url directly in specification which will be given to swagger.js as POJO
  const setServerUrl = (specification, serverUrl, serverType) => {
    serverUrl = serverUrl || specification.openApiRed.defaultServer
    if (specification.swagger?.startsWith('2')) {
      // swagger specification has only scheme, host, basePath
      if (serverUrl !== specification.openApiRed.defaultServer) {
        try {
          const url = new URL(serverUrl)
          specification.scheme = url.protocol
          specification.host = url.hostname
          if (url.port) {
            specification.host += ':' + url.port
          }
          specification.basePath = url.pathname
        } catch (e) {
          RED.notify('[openAPI-red] Invalid server url set.', { timeout: 30000 })
          console.error(e)
          specification.scheme = ''
          specification.host = ''
          specification.basePath = ''
        }
      }
    } else {
      // if openAPI 3 -> dynamic servers
      // no servers object or custom server url missing -> add it
      if (!specification.servers) {
        specification.servers = []
      }
      // remove custom server
      specification.servers = specification.servers.filter(server => !server.openApiRed)
      const server = {
        url: serverUrl,
        openApiRed: true
      }
      // add default server if no server exists or add custom server
      if (!specification.servers.length || serverType === 'custom') {
        specification.servers.push(server)
      }
    }
  }

  const loadOpenApiSpec = async (options) => {
    const { id, apiSource, sourceType, serverUrl, serverType, devMode, reload } = options
    try {
      let source
      if (sourceType === 'Files') {
        source = path.resolve(getOpenApiFolder(), apiSource)
      } else {
        source = (await evalNodeProp(apiSource, sourceType, this, null)).trim()
        if (source.startsWith('file://')) {
          source = source.substring(7)
        }
      }
      // handle urls by swagger-js to handle json and yaml files correctly (else yaml must be converted by us)
      const specLoaderThread = new Tinypool({
        filename: new URL('src/utils/loadOpenApiSpecWorker.mjs', 'file://' + __dirname).href,
        runtime: 'child_process',
        env: parentEnv,
        minThreads: 1,
        maxThreads: 1
      })
      const spec = await specLoaderThread.run({ source, devMode, userDir: RED.settings.userDir, reload })
      await specLoaderThread.destroy()

      // only do a sub resolve (on nothing) to get the a first response (valid file and normalize first lvl
      // -> deeply nested oneOf/allOf/anyOf -> items -> $refs may not even normalized on a normal run, therefor there is a check integrated, to get the $ref value)
      const client = await Swagger.resolveSubtree(spec, [''], { returnEntireTree: true })
      if (client.errors?.length) {
        // log openApi json/yaml file errors
        client.errors.forEach(e => console.error(e))
      }
      if (!client.spec.paths) {
        throw new Error('[openAPI-red-config] Valid specification was found under (' + source + '), but has no paths.')
      }
      let sourceServer = (source.startsWith('http') || source.startsWith('ws')) ? source : ''
      // remove file from URL
      if (sourceServer.endsWith('.json') || sourceServer.endsWith('.yaml')) {
        sourceServer = sourceServer.split('/')
        sourceServer.pop()
        sourceServer = sourceServer.join('/')
      }

      // helper object for small changes like server url
      client.spec.openApiRed = {}
      // openApi 2 (swagger) definition
      if (client.spec.swagger?.startsWith('2')) {
        // get server url if set in specification
        if (client.spec.schemes && client.spec.host && client.spec.basePath) {
          // prefer https (can be overwritten in the node)
          const scheme = client.spec.schemes.includes('https') ? 'https://' : client.spec.schemes[0]
          sourceServer = scheme + client.spec.host + client.spec.basePath
          client.spec.openApiRed.orgUrl = {
            schemes: [...client.spec.schemes],
            host: client.spec.host,
            basePath: client.spec.basePath
          }
        }
      } else {
        if (!client.spec.servers) {
          client.spec.servers = []
        }

        if (!sourceServer) {
          sourceServer = client.spec.servers[0]?.url || ''
        } else {
          // relative urls -> absolute urls
          const urlObj = new URL(sourceServer)
          client.spec.servers = client.spec.servers.map(server => {
            if (server.url.startsWith('/')) {
              server.url = urlObj.origin + server.url // "https://petstore3.swagger.io" + "/api/v3"
            }
            return server
          })
        }
      }
      // save "default" server
      if (sourceServer) {
        client.spec.openApiRed.defaultServer = sourceServer
      }
      // overwrite server
      setServerUrl(client.spec, serverUrl, serverType)

      openApiSpecifications.set(id, client.spec)
      RED.log.info('[openAPI-red-config] Successfully loaded specification for node "' + id + '".')

      return client.spec
    } catch (e) {
      RED.log.error('[openAPI-red] Error getting specification for node "' + id + '".')
      // console.error(e)
      openApiSpecifications.delete(id)
      throw e
    }
  }

  const getProjectFolder = () => {
    const userDir = RED.settings.userDir // Node-Red path without project
    const projects = RED.settings.get('projects')
    return projects?.activeProject ? path.resolve(userDir, 'projects', projects.activeProject) : path.resolve(userDir)
  }

  const getOpenApiFolder = () => {
    return path.join(getProjectFolder(), 'openApi')
  }

  function urlConfig (config) {
    RED.nodes.createNode(this, config)
    if (!config.url) {
      console.warn('[openAPI-red-config] No url set!')
      return
    }

    this.url = config.url
    this.urlType = config.urlType
    this.server = config.server
    this.serverType = config.serverType
    this.devMode = config.devMode
    this.openApiSpecification = () => openApiSpecifications.get(this.id)
    this.loadOpenApiSpec = loadOpenApiSpec // load spec if incoming message in openApi-red.js has no spec yet
    this.headers = config.headers
    this.useAuthCertificate = config.useAuthCertificate
    if (config.useAuthCertificate) {
      try {
        const projectFolder = getProjectFolder()
        if (config.authCertificate.startsWith('..') || config.authCertificateKey.startsWith('..')) {
          throw new Error('[openAPI-red] Path to auth files must be within project folder.')
        }
        this.authCertificate = fs.readFileSync(path.join(projectFolder, config.authCertificate), 'utf-8')
        this.authCertificateKey = fs.readFileSync(path.join(projectFolder, config.authCertificateKey), 'utf-8')
        const caFile = path.join(projectFolder, config.authCertificate.substring(0, config.authCertificate.lastIndexOf('.')) + '.ca')
        if (fs.existsSync(caFile)) {
          this.authCaFile = fs.readFileSync(caFile, 'utf-8')
        }
      } catch (e) {
        RED.log.error('[openAPI-red] Error reading certificate files for node "' + this.id + '".')
        RED.log.error(e)
      }
    }

    loadOpenApiSpec({
      id: this.id,
      apiSource: config.url,
      sourceType: config.urlType,
      serverUrl: config.server,
      serverType: config.serverType,
      devMode: this.devMode
    }).catch(e => {
      console.log(e)
    })
  }

  RED.httpAdmin.get('/openapi-red/getOpenApiSpec/:id', async (request, response) => {
    const id = request.params.id
    const { source, sourceType, serverUrl, serverType, devMode, reload } = request.query
    if (!reload && openApiSpecifications.get(id)) {
      response.send(openApiSpecifications.get(id))
    } else {
      try {
        await loadOpenApiSpec({ id, apiSource: source, sourceType, serverUrl, serverType, devMode, reload })
        if (openApiSpecifications.get(id)?.info?.title) {
          response.send(openApiSpecifications.get(id))
        } else {
          throw new Error('[openAPI-red-config] Error in your openApi specification.\n\n' + openApiSpecifications.get(id)?.toString())
        }
      } catch (e) {
        response.status(e.status || 500)
        response.send(e.response?.statusText || e.message || e.response || 'Please check the console.')
      }
    }
  })

  RED.httpAdmin.get('/openapi-red/resolvePath/:id', async (request, response) => {
    const id = request.params.id
    try {
      // Hint: There was a "bug", which leads to do not resolve everything in huge files at a specific point. = In further pathes is everything ok, the later ones did not resolve, even if called directly.
      // The TRAVERSE_LIMIT was set higher which fixed the problem. https://github.com/swagger-api/swagger-js/issues/3385
      const resolved = await Swagger.resolveSubtree(openApiSpecifications.get(id), ['paths', request.query.path])
      // save into cache
      response.send(resolved)
    } catch (e) {
      response.status(e.status || 500)
      response.send(e.response?.statusText || e.message || e.response || 'Please check the console.')
    }
  })

  RED.httpAdmin.get('/openapi-red/deleteOpenApiSpec/:id', (request, response) => {
    // delete from Map
    openApiSpecifications.delete(request.params.id)
    response.sendStatus(200)
  })

  RED.httpAdmin.get('/openapi-red/setServer/:id', (request, response) => {
    setServerUrl(openApiSpecifications.get(request.params.id), request.query.serverUrl, request.query.serverType || 'custom')
    response.sendStatus(200)
  })

  RED.httpAdmin.get('/openapi-red/getFiles', (_request, response) => {
    const openApiFolder = getOpenApiFolder()
    if (!fs.existsSync(openApiFolder)) {
      fs.mkdirSync(openApiFolder, { recursive: true })
    }
    const files = []
    fs.readdirSync(openApiFolder).forEach(file => {
      if (file.endsWith('.json')) {
        // only show parsed yaml files if there is no yaml file anymore
        if ((!file.endsWith('.yaml.json') && !file.endsWith('.yml.json')) && !fs.existsSync(file.substring(0, file.length - 5))) {
          files.push(file)
        }
      } else if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        files.push(file)
      }
    })
    response.send(files)
  })

  RED.httpAdmin.post('/openapi-red/uploadFile', (request, response) => {
    const openApiFolder = getOpenApiFolder()
    const filePath = path.join(openApiFolder, request.body.name)
    fs.writeFileSync(filePath, request.body.value, 'utf-8')
    response.sendStatus(200)
  })

  RED.httpAdmin.get('/openapi-red/deleteFile', (request, response) => {
    const openApiFolder = getOpenApiFolder()
    const filePath = path.join(openApiFolder, request.query.name)
    fs.rmSync(filePath)
    if (fs.existsSync(filePath + '.json')) {
      fs.rmSync(filePath + '.json')
    }
    response.sendStatus(200)
  })

  RED.nodes.registerType('openApi-red-url', urlConfig)
}
