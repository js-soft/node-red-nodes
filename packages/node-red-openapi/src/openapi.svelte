<script context='module'>
  RED.events.on('registry:module-updated', function(updatedModule) {
    if (updatedModule.module === 'openApi-red' && updatedModule.version === '2.0.0') {
      RED.nodes.eachNode(node => {
        if (node.type === 'openApi-red') {
          RED.editor.validateNode(node)
          RED.view.redraw()
        }
      })
      
      let updateNotification = RED.notify('Important notice: Updated openapi-red to version 2.0.0.<br\><br\>If an node error occurs at your openAPI nodes on the workspace, deploy the update changes and reload the workspace, as this is usually a timing problem with the new config node.<br\>The nodes should work now as intended, <b>it is still highly recommended to check each node before using it.</b>', 
        { type: 'info', 
          fixed: true, 
          buttons: [{
            text: "Understood",
            class:"primary",
            click: function() { updateNotification.close() }
        }]
      })
    }
  })

  RED.nodes.registerType('openApi-red', {
    category: 'network',
    color: '#D8BFD8',
    defaults: {
      name: 			    { value: '', label: 'Name', placeholder: 'openApi-red', icon: 'tag' },
      configUrlNode:  { value: '', type: 'openApi-red-url', required: true },
      nodeLogo:       { value: '' },
      apiTag:         { value: '', label: 'API tag', required: true, icon: 'tag' },
      keepAuth:       { value: false, label: 'Keep authentification', icon: 'lock' },
      operationData:  { value: {} , validate: function (v) { return v.id !== '' }},
      target:         { value: 'payload', label: 'Target', icon: 'bullseye' },
      targetType:     { value: 'msg' },
      outputStyle:    { value: 'each response', label: 'Node output style', icon: 'mail-forward' },
      errorHandling:  { value: 'throw exception', label: 'Error handling', icon: 'code-fork fa-rotate-90' },
      internalErrors: { value: {}, validate: function (v) { return !Object.values(v).find(error => error) }},
      parameters:     { value: {},  label: 'Parameters', validate: function(parameters) {
        if (!parameters || !Array.isArray(parameters) || parameters.length === 0 ) {
          return true
        } else {
          // if a required parameter has no value -> return false
          return !parameters.find(p => p.required && p.value === '')
        }
      }},
      requestContentType: { value: '',  label: 'Request Content Type', icon: 'file-in.svg' },
      responseContentType: { value: '',  label: 'Response Content Type', icon: 'file-out.svg' },
      outputs: {value: 1 },
      responseOutputLabels: { value: [{ 'code': 'default', 'text': 'default'}] },
      responseAsPayload: { value: false, label: 'Legacy mode', icon: 'file-code-o' },
      debugMode: { value: false, label: 'Debug mode', icon: 'bug'},
      headers: { value: [],  label: 'Custom Header' },
      _version: { value: '' }
    },
    inputs:1,
    outputs:1,
    outputLabels: function(index) {
      let label = this.responseOutputLabels[index]
      if (Number(label.code)) {
        return label.code + ': ' + label.text
      }
      return label.text
    },
    icon: function() {
      // Use icon from this node if set, otherwise fall back to default
      if (this.nodeLogo) {
        // Support Font Awesome icons, built-in icons, or embedded SVG data
        return this.nodeLogo
      }
      return 'white-globe.png'
    },
    label: function() {
      return this.name || this.operationData?.title || this.operationData?.id || 'openAPI client'
    },
    oneditprepare: function() {
      render(this, { minWidth: '600px' } )
    },
    oneditsave: function() {
      // Copy color and logo from config node to this node
      const clone = this.__clone
      const configNode = RED.nodes.node(this.configUrlNode)
      if (configNode) {
        this.nodeLogo = configNode.logo || ''
      }
         
      const cleanupParameter = (param) => {
        if (!param.required) {
          delete param.required
        } else {
          param.isActive = true // this should already be the case if required, but better safe than sorry
        }
        if (!param.isActive) delete param.isActive
        if (param.collapsed) delete param.collapsed
        if (!param.required && !param.isActive) {
          // inactiv -> remove unneccessary data
          // check if parameter has (active) sub parameter
          if (param.value === param.msgPathString) {
            delete param.value
            if (param.type === 'msg') delete param.type
          }
        }

        if (param.type?.startsWith('editor')) {
          // value is useless for editor mode
          delete param.value
        } else {
          // parameters object is only useful for editor mode
          delete param.parameters
        }

        if (param.type === 'each' && param.value.length) {
          // each mode only needs first value, if it was an array before with multiple values, we delete the rest
          param.value = [param.value[0]]
          param.value.forEach(childParam => cleanupParameter(childParam))
        } else if (param.type === 'array') {
          param.value.forEach(childParam => cleanupParameter(childParam))
        }

        // definitiv garbage
        delete param.msgPathString
        delete param.mark
        delete param.parent
        const subParams = Object.keys(param.parameters || {})
        subParams.forEach(subParam => cleanupParameter(param.parameters[subParam]))
      }
      Object.keys(clone.parameters || {}).forEach(parameter => cleanupParameter(clone.parameters[parameter]))


      // set outputs
      const createOutputs = () => {
        const responses = clone.specStore[clone.configUrlNode]?.paths?.[clone.operationData.path]?.[clone.operationData.method]?.responses
        clone.outputs = 0
        clone.responseOutputLabels = []
        const succesfulResponse = { code: 'successful', text: 'all successful responses (2xx)' }
        const allResponse = { code: 'all', text: 'all responses' }

        if (clone.outputStyle === 'classic') {
          clone.outputs++
          if (clone.errorHandling === 'default') {
            clone.responseOutputLabels.push(succesfulResponse)
          } else {
            clone.responseOutputLabels.push(allResponse)
          }
        } else {
          let hasSuccessfulOutput = false
          const responseCodes = Object.keys(responses || {})

          if (clone.outputStyle === 'each response') {
            responseCodes.sort().forEach(responseCode => {
              clone.outputs++
              clone.responseOutputLabels.push({ code: responseCode, text: responses[responseCode].description })
              if (responseCode >= 200 && responseCode <= 299) {
                hasSuccessfulOutput = true
              }
            })
          } else if (clone.outputStyle === 'compact') {
            const outputs = new Set()
            Object.keys(responses || {}).forEach(responseCode => outputs.add(responseCode.toString().substring(0, 1) + 'xx'))
            hasSuccessfulOutput = outputs.has('2xx')
            clone.responseOutputLabels = [...outputs].map(code => {
              clone.outputs++
              return { code, text: 'Handles all response codes with the schema "' + code + '".' }
            })
          }

          // if no successful response is defined, create an all successful response output as first output
          if (!hasSuccessfulOutput) {
            clone.outputs++
            clone.responseOutputLabels.unshift(succesfulResponse)
          }
          // if no responses are defined, send all responses to one output, check if error handling has other output
          if (!clone.outputs) {
            clone.outputs++
            const label = clone.errorHandling === 'default' ? 'all' : 'successful'
            if (label === 'all') {
              clone.responseOutputLabels = [allResponse]
            } else if (label === 'successful') {
              clone.responseOutputLabels = [succesfulResponse]
            }
          }
        }
        if (clone.errorHandling === 'other output') {
          clone.outputs++
          clone.responseOutputLabels.push({ code: 'undefinedResponses', text: 'all undefined responses' })
        }
      }
      createOutputs()


      update(this)
      RED.view.redraw(true)
    },
    oneditcancel: function() {
      revert(this)
    },
    onadd: function () { 
      addCurrentNodeVersion(this) 
    }
  })
</script>
 
<script>
  export let node
  import { Callout, Input, TabbedPane, TabContent } from 'svelte-integration-red/components'
  import NodeSettings from './components/NodeSettings.svelte'
  import CustomHeader from './components/CustomHeader.svelte'
  import RequestSettings from './components/RequestSettings.svelte'
  import ParameterEditor from './components/ParameterEditor.svelte'
  import specStore from './utils/specStore'
  import operationStore from './utils/operationStore.js'
  import { clearError, setError } from './utils/htmlFunctions'

  // temp variables
  node.currentUrl = RED.nodes.node(node.configUrlNode)?.url || ''
  node.searching = false
  node.specStore = $specStore

  const nodeSettingsCollapsed = !!node.configUrlNode
  let operation = {}
  // if only one setting exists -> set this config node automatically
  if (!node.configUrlNode) {
    let configNodes = []

    RED.nodes.eachConfig(cN => {
      if (cN.type === 'openApi-red-url') {
        configNodes.push(cN)
      }
    })
    if (configNodes.length === 1) {
      node.configUrlNode = configNodes[0].id
      node.currentUrl = configNodes[0].url
    }
  }

  $operationStore = {}
  clearError(node)

  // load specification into the store if not existing 
  if (node.configUrlNode && !$specStore[node.configUrlNode]) {
    specStore.loadOpenApiSpec(node.configUrlNode).catch(e => {
      setError(node, RED.utils.renderMarkdown(`Check console for detailed information. \n\n${e.message || e.text || JSON.stringify(e)}`), 'url')
      node.internalErrors = node.internalErrors // update UI
    })
  }

  let tabs = { "general": "General", "advanced": "Advanced" }

  $: if ($specStore[node.configUrlNode]) {
    clearError(node, 'url')
  }
</script>
 
<style>
 :global(#sir-Collapsible-openApi-ParameterEditor :is(.required, .required label)) {
    font-weight: bold !important;
	}
  :global(#sir-Collapsible-openApi-ParameterEditor .sir-Row label) {
    min-width: 182px;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .sir-Row label i) {
    min-width: 14px;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .overviewTextHeader) {
    text-overflow: ellipsis;
    overflow: hidden;
    text-wrap: nowrap;
    color: var(--red-ui-secondary-text-color);
  }
</style>

{#if node.internalErrors.text}
  <Callout type="error">
    <span slot="header">Error</span>
    {@html node.internalErrors.text}
  </Callout>
{/if}
<TabbedPane bind:tabs>
  <TabContent tab="general">
    <NodeSettings bind:node collapsed={nodeSettingsCollapsed}/>
    {#if node.configUrlNode && node.configUrlNode !== '_ADD_' && (!node.currentUrl || !$specStore[node.configUrlNode])}
      <div style="font-size: larger;">
        Loading... <i class="fa fa-spinner fa-pulse" style="margin-left: 6px;"></i>
      </div>
    {:else if $specStore[node.configUrlNode] && node.currentUrl}
      <RequestSettings bind:node bind:operation />
      <ParameterEditor bind:node {operation} />
    {/if}
  </TabContent>
  <TabContent tab="advanced">
    <Input bind:node prop="keepAuth" labelBeforeCheckbox={true} tooltip={`⚠️ Use with caution as it will reveal sensible data to the flow!\n\nmsg.openApiToken and msg.headers will not be deleted and can be seen by other nodes in the flow.`}/>
    <Input bind:node prop="debugMode" labelBeforeCheckbox={true} tooltip={`⚠️ Use with caution as this may reveal sensible data to the flow!\n\n Put the whole sending data into msg.openApiDebugData and the debug console.`}/>
    <Input bind:node prop="responseAsPayload" labelBeforeCheckbox={true} tooltip="Legacy mode: Put the whole response into the payload instead of only response.obj."/>

    <CustomHeader bind:node />
  </TabContent>
</TabbedPane>