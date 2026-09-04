<script>
  import { EditableList, Input, Row, Tooltip, TypedInput } from 'svelte-integration-red/components'

  export let node

  const addKey = () => {
    node.headers.push({
      key: '',
      valueType: 'str',
      value: ''
    })
    node.headers = node.headers
  }

  const getTooltip = (index) => {
    const headerElement = node.headers[index]
    if (headerElement.keyType === 'str' && authSchemes.includes(headerElement.key) && (headerElement.valueType === 'str' || headerElement.valueType === 'jsonata')) {
      headerElement.warning = true
    } else {
      delete headerElement.warning
    }
    node.headers[index] = node.headers[index] 
  }

  const authSchemes = ['Basic', 'Bearer', 'Digest', 'HOBA', 'Mutual', 'Negotiate', 'VAPID', 'SCRAM', 'AWS4-HMAC-SHA256']
  const types = ['msg', 'flow', 'global', 'str', 'jsonata', 'env']
  const tooltipOptions = {
    icon: 'warning'
  }
  const tooltipWarning = 'Warning: The key seems to be an authentification.\nAvoid using a value with the type "string" or "jsonata" as the value will be saved in the flow.json.'
</script>

<style>
  .header {
    display: inline-flex;
    width: 100%;
  }
  .headerLeft {
    margin-left: 20px;
    width: 100%
  }
  .headerRight {
    width: 100%
  }
</style>

<EditableList label="Custom Header" icon="file" bind:elements={node.headers} let:element={el} let:index maxHeight=650 minHeight=400 sortable removable addButton="Add header key" on:add={addKey}>
  <span slot="tableHeader" class="header">
    <div class="headerLeft">Key</div>
    <div class="headerRight">Value</div>
  </span>
   <Row>
    <Input inline bind:value={node.headers[index].key} error={!node.headers[index].key}
      on:change={() => getTooltip(index)}
      on:blur={() => node.headers[index].key = node.headers[index].key.trim()}
    />
    {#if authSchemes.includes(el.key) && (el.valueType === 'str' || el.valueType === 'jsonata')}
      <!-- Warn if Authentification will be saved in flow.json -->
      <Tooltip tooltip={tooltipWarning} {tooltipOptions} />
    {/if}
    <TypedInput inline bind:type={node.headers[index].valueType} bind:value={node.headers[index].value} {types} />
   </Row>
</EditableList>