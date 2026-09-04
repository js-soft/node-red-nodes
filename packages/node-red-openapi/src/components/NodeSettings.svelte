<!-- global RED -->
<script>
  import { Button, Callout, Collapsible, Input, Select, TypedInput } from 'svelte-integration-red/components'
  import { clearError } from '../utils/htmlFunctions.js'
  import specStore from '../utils/specStore.js'
  import operationStore from '../utils/operationStore'

  export let node
  export let collapsed
 
  const handleChangedUrlNode = async () => {
    const configNode = RED.nodes.node(node.configUrlNode)
    // save options as they may get deleted while reloading spec
    let apiTag = node.apiTag
    let operationData = node.operationData
    node.currentUrl = '' // show loading on UI
    await clearError(node, 'url')
    try {
      // ensure UI is visible again before loadOpenApiSpec else it can lead to an error (try to init input fields)
      let counter = 0
      const waitForEditor = setInterval(() => {
        if (document.getElementById('openApi-red-svelte-container')) {
          // next editor has been opened
          clearInterval(waitForEditor)
          specStore.loadOpenApiSpec(node.configUrlNode).then(async () => {
            await createApiList()
            node.apiTag = apiTag
            node.operationData = operationData
            node.currentUrl = configNode?.url || ''
            node.recreateRequestSettings = true // requestSetting reactive function
          })
        } else if (counter > 50) {
          clearInterval(waitForEditor)
          console.log('[openAPI-red] Could\'nt find openApi editor DOM.')
        }
        counter++
      }, 100)
    } catch (e) {
      console.log('[openAPI-red] Error loading specification', e)
      setError(RED.utils.renderMarkdown(`Check console for detailed information. \n\n${e.message || e.text || JSON.stringify(e)}`), 'url')
    }

  }
  
  const createApiList = () => {
    $operationStore = {}
    if (node.configUrlNode === '_ADD_') {
      return
    }
    // This will iterate through the paths (/pet || /pet/getPetById,...)
    Object.keys($specStore[node.configUrlNode]?.paths || {}).forEach(path => {
      // a path can already have a description or parameters which will be valid for all methods /paths/myPath/{myParameter})
      // This will iterate through the html methods and show the operation (get, put, post,...)
      // Official: For each path, you define operations (HTTP methods) that can be used to access that path
      Object.keys($specStore[node.configUrlNode].paths[path]).forEach(operationMethod => {
        //  operation.tags.forEach
        const operation = $specStore[node.configUrlNode].paths[path][operationMethod]
        const isOperation = operation && typeof operation === 'object' && !Array.isArray(operation)
          if (isOperation) {
          // real operation id or fallback method and path (get/pet/getPetById,...)
          const operationId = operation.operationId || operationMethod + path
          const hasOperationId = !!operation.operationId

          
          // default if no array tag exists
          const tags = operation.tags?.length ? operation.tags : ['default']
          tags.forEach(tag => {
            if (!$operationStore[tag]) {
              $operationStore[tag] = []
            }
            $operationStore[tag].push({
              id: operationId,
              title: operation["x-operationIdLabel"], // openApi-red specific title as operationId must be unique and only snake_case
              hasOperationId,
              path,
              method: operationMethod
            })
          })
        }
      })
    })
    $operationStore = $operationStore // refresh UI
    if (!$specStore[node.configUrlNode].servers || $specStore[node.configUrlNode].servers.length <= 1) node.server = ''

    // operationData.method and path was optional in version <2.0.0 (only if no operation id exists). Now it helps finding the operationData within the original specification sheet.
    // this can't be made via update.js as the specStore is not known when updating nodes.
    let operationFound = false
    if (node.operationData.id && node.apiTag && (!node.operationData.method || !node.operationData.path)) {
      Object.keys($specStore[node.configUrlNode].paths).forEach(path => {
        const methods = $specStore[node.configUrlNode].paths[path]
        const method = Object.keys(methods).find(method => (methods[method].operationId === node.operationData.id) || (methods[method].__originalOperationId === node.operationData.id))
        if (method) {
            node.operationData.id = methods[method].operationId
            node.operationData.method = method
            node.operationData.path = path
            operationFound = true
        }
      })
    } else {
      operationFound = true
    }
    // clear operationData if no longer existing
    if (!operationFound) {
      node.apiTag = ''
      node.operationData = {}
    }
    // create main description + ext. description note
    if ($specStore[node.configUrlNode].info) {
      const createSubDescription = (obj) => {
        if (Array.isArray(obj)) {
          return JSON.stringify(obj)
        } else if (typeof obj === 'object') {
          let result = ''
          Object.keys(obj).forEach(key => {
            if (typeof obj[key] === 'object') {
              // TODO: recursive call and creating, but propably will never be neccessary....
              result += `\n\n- ${key}: ${JSON.stringify(obj[key])}\n\n`
            } else {
              result += `\n\n- ${key}: ${obj[key]}\n\n`
            }
          })
          return result
        }
      }
      const infoKeys = Object.keys($specStore[node.configUrlNode].info || {})
      if (infoKeys.length) {
        sourceTooltip += '# Info'
        infoKeys.forEach(infoKey => {
          // JSON.stringify on normal text destroys markup ("\n" won't be recognized anymore)
          const text = (typeof $specStore[node.configUrlNode].info[infoKey] === 'object') ? createSubDescription($specStore[node.configUrlNode].info[infoKey]) : $specStore[node.configUrlNode].info[infoKey]
          sourceTooltip += `\n\n## ${infoKey}\n\n${text}`
        })
      }
      const extDocKeys = Object.keys($specStore[node.configUrlNode].externalDocs || {})
      if (extDocKeys.length) {
        sourceTooltip += '\n\n---\n\n# External Documentation'
        extDocKeys.forEach(extKey => {
          sourceTooltip += `\n\n## ${extKey}\n\n${$specStore[node.configUrlNode].externalDocs[extKey]}`
        })
      }
    }
    sourceTooltip = sourceTooltip.trim()
  }

  const outputStyleTooltip = `
- Each Response: Create one output for each defined response.
If no successful response is defined, one output for all successful responses will be created.

- Compact: 
Create one output for each response type group (1xx, 2xx, 3xx, 4xx, 5xx) if at least one response code for a group is defined.

- Classic: Create one output for all responses.
Can have a separate output for unsuccessful responses, if set by error handling.`
  const outputHandlingTooltip = `
Select between two options:
- Create one output for all undefined responses. 
- Throw an exception which can be catched by a 'catch' node.

If at least one successful response code (2xx) exists, not defined successful responses will be handled as the option selected.`

  const errorHandlingTooltip = `
Select between three options: 
- Default: Send the error to the first (and only) output and let the flow handle it.
- Other output: Send all errors to a a new output.
- Throw expection: Throws the error so a catch node can handle it.
`

  const outputStyleOptions = [{ value: 'each response', label: 'One output for each defined response'}, { value: 'compact', label: 'One output for each existing response state group' }, { value: 'classic', label: 'Classic mode'}]
  const classicErrorHandlingOptions = ['default', 'other output', 'throw exception']
  const defaultErrorHandlingOptions = [{ label: 'separate output', value: 'other output'}, { label: 'throw exception', value: 'throw exception' }]

  let sourceTooltip = ''
  let init = true
  node.showCalloutBox = false

  // create list after spec store is ready
  $: if ($specStore[node.configUrlNode] && init) {
    init = false
    createApiList()
  }
</script>

<style>
  :global(#sir-Collapsible-openapi-red_node-settings label.sir-Label) {
    min-width: 180px;
    max-width: 180px;
  }
</style>

<Collapsible id="openapi-red_node-settings" label="Node settings" icon="file-text-o" bind:collapsed border maximizeLabel={false}>
  <span slot="header" class:overviewTextHeader={collapsed} class:header={!collapsed}>
    {#if collapsed}
      Api source: {node.currentUrl}
    {:else}
      <Button inline small id="nodeSettingsDescriptionButton" icon={node.showCalloutBox ? "eye-slash" : "eye"} label={node.showCalloutBox ? "hide description" : "show description"} tooltip="Shows all descriptions direct, instead of a tooltip." on:click={() => node.showCalloutBox = !node.showCalloutBox}/>
    {/if}
  </span>
  <Input bind:node prop="name"/>
  <!-- svelte-ignore missing-declaration -->
  <Input label="Source" icon="globe" bind:node prop="configUrlNode" type="config" tooltip={node.showCalloutBox ? '' : RED.utils.sanitize(sourceTooltip)}
    on:change={handleChangedUrlNode} 
    on:close={handleChangedUrlNode} 
  />
  <TypedInput bind:node prop="target" typeProp="targetType" types={['msg', 'flow', 'global']} />
  <!-- svelte-ignore missing-declaration -->
  <Callout type="info" bind:show={node.showCalloutBox}>
    {@html RED.utils.renderMarkdown(RED.utils.sanitize(sourceTooltip))}
  </Callout>

  <Select bind:node prop="outputStyle" tooltip={node.showCalloutBox ? '' : outputStyleTooltip}>
    {#each outputStyleOptions as outputStyle}
      <option value={outputStyle.value} selected={node.outputStyle === outputStyle.value}>{outputStyle.label}</option>
    {/each}
  </Select>
  <!-- svelte-ignore missing-declaration -->
  <Callout type="info" bind:show={node.showCalloutBox}>
    {@html RED.utils.renderMarkdown(RED.utils.sanitize(outputStyleTooltip))}
  </Callout>
  {#if node.outputStyle === 'classic'}
    <Select bind:node prop="errorHandling" icon={["circle", "bug fa-inverse"]} tooltip={node.showCalloutBox ? '' : errorHandlingTooltip }>
        {#each classicErrorHandlingOptions as errorHandling}
          <option value={errorHandling} selected={node.errorHandling === errorHandling}>{errorHandling}</option>
        {/each}
    </Select>
    <!-- svelte-ignore missing-declaration -->
    <Callout type="info" bind:show={node.showCalloutBox}>
      {@html RED.utils.renderMarkdown(RED.utils.sanitize(errorHandlingTooltip))}
    </Callout>
  {:else if node.outputStyle === 'each response' || node.outputStyle === 'compact'}
    <Select bind:node label='Undefined response handling' prop="errorHandling" tooltip={node.showCalloutBox ? '' : outputHandlingTooltip}>
      {#each defaultErrorHandlingOptions as errorHandling}
        <option value={errorHandling.value} selected={node.errorHandling === errorHandling}>{errorHandling.label}</option>
      {/each}
    </Select>
    <!-- svelte-ignore missing-declaration -->
    <Callout type="info" bind:show={node.showCalloutBox}>
      {@html RED.utils.renderMarkdown(RED.utils.sanitize(outputHandlingTooltip))}
    </Callout>
  {/if}
</Collapsible>
