/* global RED */
import { writable } from 'svelte/store'

function createSpecStore () {
  const { subscribe, set, update } = writable({})

  return {
    subscribe,
    set,
    loadOpenApiSpec: async (configNodeId, reload = false, options = {}) => {
      // since openApi-red 2.0, only loading spec but not resolving it (reduce loading time, especially for big files)
      // reloading specifications only via config node (or if not existing in store)
      if (configNodeId === '_ADD_') {
        // nothing to do here
        return
      }
      try {
        const getSpecUrl = 'openapi-red/getOpenApiSpec/' + configNodeId
        // Warning: configNode may have undeployed changes or does not exist yet -> then use options object
        const configNode = RED.nodes.node(configNodeId) || {}
        if (!options.url && !configNode.url) {
          return
        }
        let params = `?source=${options.url || configNode.url}&sourceType=${options.urlType || configNode.urlType}&serverUrl=${options.server || configNode.server || ''}&serverType=${options.serverType || configNode.serverType || ''}`
        if (options.devMode || configNode.devMode) {
          params += '&devMode=true'
        }
        if (reload) {
          params += '&reload=true'
        }
        const fetchedUrl = await fetch(getSpecUrl + params)
        if (fetchedUrl.ok) {
          const specification = await fetchedUrl.json()
          update((store) => {
            // only save to store if paths exists (else it could be "valid" but has no operations, which makes it useless)
            if (specification?.paths) {
              store[configNodeId] = specification
            } else {
              console.log('[openAPI-red-config] Error: Valid specification found (' + fetchedUrl + '), but it has no operations.')
              delete store[configNodeId]
            }
            return store
          })
        } else {
          const errorResponse = await fetchedUrl.text()
          throw errorResponse
        }
      } catch (e) {
        // if fetch failed or response is not a valid json
        update((store) => {
          delete store[configNodeId]
          return store
        })
        console.log('[openAPI-red-config] Error getting openApi specification', e)
        throw e
      }
      return 'ok'
    },
    resolvePath: async (configNodeId, path) => {
      // since openApi-red 2.0 resolve only needed operations
      try {
        const getSpecUrl = 'openapi-red/resolvePath/' + configNodeId + '?path=' + path
        const fetchedUrl = await fetch(getSpecUrl)
        if (fetchedUrl.ok) {
          const { spec: operations } = await fetchedUrl.json()

          await update((store) => {
            const resolveSchema = (schema) => {
              if (!schema.$ref) {
                return schema // nothing to do
              }
              const refArray = schema.$ref.split('/')
              refArray.shift() // remove '#'
              let result = store[configNodeId]
              for (let index = 0; index < refArray.length; index++) {
                result = result?.[refArray[index]]
              }
              if (result) {
                result.$$ref = schema.$ref // success
                return result
              } else {
                console.error('[openApi-red] Error resolving reference: "' + schema.$ref + '".')
                return schema.$ref // could not be resolved
              }
            }

            // walk through parameters, properties or schema
            const walkParamPropSchema = (element) => {
              if (element.$ref) {
                element = resolveSchema(element)
              }
              if (element.schema) {
                element.schema = walkParamPropSchema(element.schema)
              }
              const multiSchemes = ['oneOf', 'anyOf', 'allOf']
              multiSchemes.forEach(ms => {
                if (element[ms]) {
                  element[ms] = element[ms].map(schema => walkParamPropSchema(schema))
                }
              })

              if (element.properties) {
                Object.keys(element.properties).forEach(propName => {
                  element.properties[propName] = walkParamPropSchema(element.properties[propName])
                })
              }

              if (element.items) {
                element.items = walkParamPropSchema(element.items)
              }
              return element
            }
            // set resolve marker to path operations
            if (operations) {
              // check if everything is really resolved (very nested schemas may not be resolved by swaggerClient, for whatever reasons...)
              // very nested elements, especially in oneOf, etc. may not be resolved by swaggerClient?
              // check request Body
              Object.keys(operations).forEach(method => {
                const operation = operations[method]
                ;(operation.parameters || []).forEach(parameter => {
                  parameter = walkParamPropSchema(parameter)
                })

                Object.keys(operation.requestBody?.content || {}).forEach(requestBodyMediaType => {
                  operation.requestBody.content[requestBodyMediaType] = walkParamPropSchema(operation.requestBody.content[requestBodyMediaType])
                })
              })

              operations['x-openApi-red-resolved'] = true
              // Object.keys(operations).forEach(o => { operations[o]['x-openApi-red-resolved'] = true })
              store[configNodeId].paths[path] = operations
            }
            return store
          })
        } else {
          const errorResponse = await fetchedUrl.text()
          throw errorResponse
        }
      } catch (e) {
        // if fetch failed or response is not a valid json
        update((store) => {
          delete store[configNodeId]
          return store
        })
        console.log('[openAPI-red-config] Error getting openApi specification', e)
        throw e
      }
      return 'ok'
    }
  }
}

// export const count = createSpecStore();
export default createSpecStore()
