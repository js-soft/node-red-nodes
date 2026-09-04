<script>
  import { Button, Callout, Collapsible, Row, Select } from 'svelte-integration-red/components'
  import { clearError, setError } from '../utils/htmlFunctions'
  import specStore from '../utils/specStore.js'
  import operationStore from '../utils/operationStore'

  export let node, operation

  const initContentType = (type) => {
    if (!contentTypes[type].length) {
      node[type + 'ContentType'] = ''
    } else if (!contentTypes[type].includes(node[type + 'ContentType'])) {
      // set default application/json, if available, else first match...
      node[type + 'ContentType'] = contentTypes[type].includes('application/json') ? 'application/json' : contentTypes[type][0]
    }
  }

  const getApiTooltip = () => {
    const tagDescription = $specStore[node.configUrlNode]?.tags?.find(tag => tag.name === node.apiTag)?.description || ''
    // const pathDescription = 
    apiTooltip = RED.utils.sanitize(tagDescription)
  }

  // parameter value cannot be an object (HTML select)
  const handleSelectOperation = async (newOperationId) => {
    if (!newOperationId) {
      // deselected operation
      operation = {}
      clearError(node, 'getOperationData')
      operationTooltip = ''
      contentTypes.request = []
      contentTypes.response = []
      return
    }
    node.operationData = $operationStore[node.apiTag]?.find(operation => (operation.id === newOperationId)) || {}
    // the object parent of the operation is called "Paths" in openAPI (paths[method] => operation)
    let paths = $specStore[node.configUrlNode]?.paths?.[node.operationData.path] || {}
    if (!paths?.['x-openApi-red-resolved'] && node.operationData.path) {
      // try to resolve it
      await specStore.resolvePath(node.configUrlNode, node.operationData.path)
      paths = $specStore[node.configUrlNode]?.paths?.[node.operationData.path] || {}
      // updated nodes fixes 
      // version > 2.0.0 method was optional, if no operationId
      if (!node.operationData.method) {
        const methods = Object.keys(paths)
        node.operationData.method = methods.find(method => paths[method]?.operationId === node.operationData.id)
      }
      // import old nodes after update
      if (!node.apiTag && node.operationData.path && node.operationData.method) {
        node.apiTag = paths[node.operationData.method]?.tags?.[0] || '' // do not set to default if not found
      }
    }

    operation = paths[node.operationData?.method]
    if (!operation) {
      operation = {}
      setError(node, 'Error getting operationData for "' +  node.operationData.id + '".', 'getOperationData')
    } else {
      clearError(node, 'getOperationData')
      // if path has a general description add it to the selected operation
      const pathDescription = $specStore[node.configUrlNode].paths?.[node.operationData.path]?.description 
        ? $specStore[node.configUrlNode].paths?.[node.operationData.path]?.description + '\n\n'
        : ''
      operationTooltip = RED.utils.sanitize(pathDescription + (operation.description || operation.summary || ''))
  
      // set valid content Types if operation is set
      // needed input since an update from swagger.js
      contentTypes.request = ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data'] // some default types as fallback
      if (Object.keys(operation.requestBody?.content || {}).length) {
        contentTypes.request = Object.keys(operation.requestBody.content)
      } else if (operation.consumes) { // swagger style
        contentTypes.request = operation.consumes
      }
      initContentType('request')

      let responseContentTypes = []
      // responses exists in swagger and openApi but in swagger the response data type is stated in "produces"
      if (operation?.produces) {
        responseContentTypes = operation.produces // swagger style
      }
      if (operation?.responses) {
        Object.values(operation.responses).forEach(response => {
          if (response?.content) {
            Object.keys(response.content)?.forEach(cT => responseContentTypes.push(cT))
          }
        })
      }
      // distinct array
      contentTypes.response = Array.from(new Set(responseContentTypes))
      initContentType('response')
    }
  }

  const contentTypes = {
    request: [],
    response: []
  }
  let collapsed = node.apiTag && node.operationData.id
  let apiTooltip = ''
  let operationTooltip = ''
  let apis = []
  let operations = []

  getApiTooltip()
  if (node.operationData.id) {
    // init operation
    handleSelectOperation(node.operationData.id)
  }
  

  $: if (!node.apiTag || !node.operationData?.id) {
    contentTypes.request = []
    contentTypes.response = []
    node.operationData.id = ''
    operation = {}
    collapsed = false
  }
  
  $: {
    apis = Object.keys($operationStore || {})
    operations = $operationStore[node.apiTag] || []
  }
</script>

<style>
  :global(#sir-Collapsible-openapi-red_request-settings label.sir-Label) {
    min-width: 180px;
    max-width: 180px;
  }
  :global(#sir-Collapsible-openapi-red_request-settings select) {
    max-width: calc(100% - 187px); /* label width + 7px margin */
  }
</style>

<Collapsible label="Request settings" id="openapi-red_request-settings" icon="level-up" bind:collapsed border maximizeLabel={false}>
  <span slot="header" class:overviewTextHeader={collapsed} class:header={!collapsed}>
    {#if collapsed}
      Api: {node.apiTag || "No api selected"} | Operation: {node.operationData?.title || node.operationData?.id || "No operation selected"}
    {:else if (operationTooltip || apiTooltip)}
      <Button inline  small label={node.showCalloutBox ? "hide description" : "show description"} icon={node.showCalloutBox ? "eye-slash" : "eye"}  on:click={() => node.showCalloutBox = !node.showCalloutBox}/>
    {/if}
  </span>
  <Select bind:node prop="apiTag" error={!node.apiTag} 
    on:change={() => {
      node.operationData = {}
      getApiTooltip()
    }}
    tooltip={node.showCalloutBox ? '' : apiTooltip}
  >
    <option value="">Please select the api.</option>
    { #each apis as api (api)}
      <option value={api} selected={node.apiTag === api}>{api}</option>
    {/each}
  </Select>
  <Callout type="info" bind:show={node.showCalloutBox}>
    {@html apiTooltip}
  </Callout>

  <Row>
    <Select inline label="Operation" icon="wrench" error={!node.operationData.id} value={node.operationData.id} tooltip={node.showCalloutBox ? '' : operationTooltip} 
      on:change={(e) => handleSelectOperation(e.detail.value)}
    >
      <option value="">Please select an operation.</option>
      {#each operations as operation (operation)}
        <!-- a path can have multiple operations, but also additional data like description or parameter for all operations /paths/myPath/{myParamteter} -->
        {#if operation?.id}
          <option selected={node.operationData.id === operation.id} value={operation.id}>{operation.title || operation.id}</option>
        {/if}
      {/each}
    </Select>
  </Row>
  <Callout type="info" bind:show={node.showCalloutBox}>
    {@html operationTooltip}
  </Callout>
  {#if contentTypes.request.length}
    <Select bind:node prop="requestContentType">
      {#each contentTypes.request as reqCT}
        <option value={reqCT} selected={node.requestContentType === reqCT}>{reqCT}</option>
      {/each}
    </Select>
  {/if}
  {#if contentTypes.response.length}
    <Select bind:node prop="responseContentType">
      {#each contentTypes.response as resCT}
        <option value={resCT} selected={node.responseContentType === resCT}>{resCT}</option>
      {/each}
    </Select>
  {/if}
</Collapsible>
