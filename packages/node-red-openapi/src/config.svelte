<script context='module'>
  // let NR get access to the specStore (e.g. auto reload)
  import specStore from './utils/specStore'
  window.openApiRed = {
    specStore
  }

  RED.nodes.registerType('openApi-red-url', {
		category: 'config',
    defaults: {
      name:       { value: '', label: 'Name' },
      url:        { value: '', label: 'Source', required: true }, // TODO: rename to source
      urlType:    { value: 'str' },
      server:     { value: '', label: 'Server' },
      serverType: { value: 'custom' },
      devMode:    { value: false, label: 'Development Mode' },
      headers:    { value: [], label: 'Custom Header' },
      timestamp:  { value: ''}, // allows saving if spec was reloaded (and no changes -> SIR Input on:close would not be triggered)
      useAuthCertificate:    { value: false, label: 'Use Certificate Auth' },
      authCertificate:    { value: '', label: 'Certificate path' },
      authCertificateKey:    { value: '', label: 'Key path' },
      logo:       { value: '', label: 'Logo' },
      _version:   { value: '' }
    },
    label: function() {
        if (this.name) return this.name
        return this.url || this.id
    },
		oneditprepare: function () {
			render(this)
		},
		oneditsave: function () {
      update(this)
      // Sync logo to all dependent nodes and update their canvas representation
      RED.nodes.eachNode(node => {
        if (node.type === 'openApi-red' && node.configUrlNode === this.id) {
          node.nodeLogo = this.logo || ''
          node.dirty = true
        }
      })
      
      // Force a full canvas redraw
      RED.view.redraw(true)
		},
		oneditcancel: function () {
			revert(this)
		},
    oneditdelete: function () {
      fetch('openapi-red/deleteOpenApiSpec/' + this.id)
    },
    onadd: function () { 
      addCurrentNodeVersion(this) 
    }
	})

  
</script>

<script>
  export let node
  import { Button, Callout, Input, Popup, Row, TypedInput } from 'svelte-integration-red/components'
  import { tick } from 'svelte'
  import CustomHeader from './components/CustomHeader.svelte';
  
  
  const createServerTypes = () => {
    serverTypes = [
      { 
        value: 'server',
        options: [...new Set(($specStore[node.id].servers || []).map(s =>  s.url))]
      },
      { value: 'custom' },
      'msg', 'flow', 'global'
    ]
  }

  const getApiSpec = ((init = false, reload = false) => {
    reload = reload || (oldUrl !== node.url) // reload if source changed or forced by button
    if ((init || reload) && node.url) {
      oldUrl = node.url
      checkingUrl = true
      specificationExists = false
      errorText = ''
      // set undeployed changes
      const options = {
        url: node.url,
        urlType: node.urlType,
        devMode: node.devMode,
        server: node.server || '',
        serverType: node.serverType || 'custom'
      }
      specStore.loadOpenApiSpec(node.id, reload, options).then(() => {
        checkingUrl = false
        specificationExists = !!$specStore[node.id]
        createServerTypes()
        if (!node.server && $specStore[node.id]?.servers?.length) {
          node.serverType = 'server'
          node.server = $specStore[node.id]?.servers[0]?.url || ''
        }
        node.timestamp = Date.now()
      }).catch(e => {
        checkingUrl = false
        errorText = RED.utils.renderMarkdown(`Error: Check console for detailed information. \n\n${e.message || e.text || JSON.stringify(e)}`)
      })
    }
  })

  const handleDeleteFile = async () => {
    const filename = node.url
    showDeletePopup = false
    const res = await fetch('openapi-red/deleteFile?name=' +  filename)
    if (res.ok) {
      RED.notify('File deleted', { type: 'info', timeout: 10000 })
      // refresh local file list
      getLocalFiles()
    }
  }

  const uploadApiFile = () => {
    const filename =  newFile?.[0]?.name || ''
    if (!filename) {
      return
    }
    if (filename.endsWith('.json') || filename.endsWith('.yaml') || filename.endsWith('.yml')) {
      newFile[0].text().then(fileValue => {
        const body = JSON.stringify({
          name: newFile[0].name,
          value: fileValue
        })
        fetch('openapi-red/uploadFile', {
          method: "POST",
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body
        })
        .then(res => {
          if (res.ok) {
            RED.notify('File uploaded. -> Will now load specification.', { type: 'info', timeout: 10000 })
            getApiSpec(false, true)
            getLocalFiles().then(() => {
              node.url = filename
              node.urlType = 'Files'
              newFile = ''
            })
          } else {
            if (res.status === 413) {
              console.log('[openAPI-red-config] Error file size too large. Either upload file directly into the [node-red directory]/openApi or set a higher apiMaxLength limit in the settings.js')
            } else {
              console.log('[openAPI-red-config] Error uploading file.', e)
            }
            RED.notify('Error uploading file. Check console.', { type: 'error', timeout: 20000 })
            newFile = ''
          }
        })
      })
    } else {
      RED.notify('Not a valid JSON or YAML file.', { type: 'error', timeout: 10000 })
    }
  }

  const getLocalFiles = async () => {
    const res = await fetch('openapi-red/getFiles')
    if (res.ok) {
      const files = await res.json()
      if (files.length) {
        sourceTypes = ['str', 'env', { value: 'Files', options: files }]
      } else {
        sourceTypes = ['str', 'env']
      }
    }
  }

  const urlTooltip = `Loading the OpenAPI specification from the entered source on leaving the field.
  If not starting with "http" or "ws" it searches for a local file. 
  Starting with "\\~/" it searches within the Node-RED directory. Uploads will be made into the "openApi" folder ("\\~/openApi/myFile.json").
  
  Attention: Local yaml files will create a parsed json file. This file will only be updated on pressing reloading.
  `

  let checkingUrl = false
  let oldUrl = node.url
  let specificationExists = !!$specStore[node.id]
  let errorText = ''
  let serverTypes = []
  let newFile = ''
  let sourceTypes
  let showDeletePopup

  // load filelist
  getLocalFiles()

  // if specification is not in the store yet
  if (!specificationExists) {
    getApiSpec(true)
  } else {
    createServerTypes()
  }

  const saveCustomServer = async () => {
    await tick()
    if (node.url && node.serverType === 'custom') {
      fetch('openapi-red/setServer/' + node.id + '?serverUrl=' + node.server + '?serverType=' + node.serverType)
    }
  }
</script>

<style>
  :global(#openApi-red-url-svelte-container .sir-Label) {
    min-width: 170px;
  }
  :global(#sir-TypedInput-label-url-Label) { /* SVG Icon in Row fix */
    margin-left: -7px;
    margin-right: 13px;
  }
  :global(#openApi-red-url-svelte-container .noMarginBottom) {
    margin-bottom: 0px;
  }
</style>

<Input bind:node prop="name" icon="tag" />

{#if newFile}
  <Callout type="info"> <i class="fa fa-spinner fa-pulse" style="margin-right: 6px;"></i>Uploading file... </Callout>
{:else}
  <Row>
    {#if sourceTypes}
      <TypedInput bind:node prop="url", typeProp="urlType" icon="file-in.svg" inline tooltip={urlTooltip} types={sourceTypes} disabled={checkingUrl} 
        on:blur={() => getApiSpec(false)} 
        on:change={() => {
          if (node.urlType === 'Files') {
            getApiSpec(false)
          }
        }}
      />
      <Button inline style="margin-right: 0px;" icon={checkingUrl ? "refresh fa-spin" : "refresh"} on:click={() => getApiSpec(false, true)} tooltip="Reload specification" disabled={checkingUrl}/>
    {:else}
      <Callout type="info" small> <i class="fa fa-spinner fa-pulse" style="margin-right: 6px;"></i>Loading files... </Callout>
    {/if}
  </Row>

  {#if oldUrl !== node.url} 
    <Callout type="info" small> New specification will be loaded on leaving input field. </Callout>
  {:else if node.url && specificationExists}
    <Callout type="info" small> OpenAPI specification loaded. </Callout>
  {:else if node.url && checkingUrl}
    <Callout type="info" small> <i class="fa fa-spinner fa-pulse" style="margin-right: 6px;"></i>Loading specification... </Callout>
  {:else if node.url && !specificationExists}
    <Callout type="error"> {@html errorText} </Callout>
  {/if}

  <Row style="justify-content: space-between;">
    <Button indented icon="file-o" label="Add a new file" clazz="noMarginBottom" on:click={() => document.getElementById('openapi_uploadApiFile').click()} disabled={checkingUrl}/>
    <Button inline icon="trash" tooltip="Delete file" on:click={() => showDeletePopup = true} disabled={checkingUrl || (node.urlType === 'str' && (!node.url || node.url.startsWith('http')))}/>
  </Row>

  {#if $specStore[node.id]?.servers}
    <TypedInput bind:node prop="server" icon="server" typeProp="serverType" types={serverTypes} placeholder={$specStore[node.id]?.openApiRed?.defaultServer || ''} 
      error={(node.urlType === 'Files' && !(node.server?.startsWith('http') || node.server?.startsWith('ws')))} disabled={checkingUrl}
      tooltip={$specStore[node.id]?.servers?.find(server => server.url === node.server)?.description || "Select the server from your server list in the specification or use a custom one."} 
      on:change={saveCustomServer}  
    />
  {:else}
    <!-- openAPI v2 (swagger) -->
    <Input bind:node prop="server" icon="server" placeholder={$specStore[node.id]?.openApiRed?.defaultServer || ''} disabled={checkingUrl}
      tooltip="Reroute to another server which is not defined in your specification" 
      on:blur={saveCustomServer} 
    />
  {/if}
  <Input bind:node prop="devMode" icon="bug" type="checkbox" labelBeforeCheckbox={true} tooltip="Accept self signed or expired certificates, which will be rejected otherwise."/>
  <!-- Agent auth  -->
  <Input bind:node prop="useAuthCertificate" icon="certificate" type="checkbox" labelBeforeCheckbox={true} tooltip="Use Certificate Authorization in HTTPS Agent"/>
  {#if node.useAuthCertificate}
    <Input bind:node prop="authCertificate" icon="file-o" placeholder={'./myCertificate.cert'} disabled={checkingUrl} tooltip="Path to certificate file" />
    <Input bind:node prop="authCertificateKey" icon="file-o" placeholder={'./myCertificate.key'} disabled={checkingUrl} tooltip="Path to key file"/>
  {/if}

  <Input bind:node prop="logo" icon="image" placeholder="e.g. jsFrog.svg" tooltip="Logo for openapi-red nodes. Supported: image URLs (https://), Font Awesome classes (e.g. 'fa-globe'), or Node-RED built-in icons (e.g. 'white-globe.png')" />

  <CustomHeader bind:node />
{/if}

<Popup id={"deleteSpecFile"} modal fixed bind:showPopup={showDeletePopup} keyboard={{escape: () => showDeletePopup = false}}>
  <h2>Confirm deleting File</h2>
  Are you sure you want to delete "{node.url}"?
  <svelte:fragment slot="buttons">
    <Button inline label="Cancel" on:click={() => showDeletePopup = false} />
    <Button inline label={"Delete"} primary on:click={handleDeleteFile} />
  </svelte:fragment>
</Popup>

<input type="file" id="openapi_uploadApiFile" name="filename" accept=".json,.yaml,.yml" style="width: 0px; visibility:hidden;" bind:files={newFile} on:change={uploadApiFile}>