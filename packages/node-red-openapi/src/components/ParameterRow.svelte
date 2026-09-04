<script>
  import { Callout, Collapsible, Input, Row } from 'svelte-integration-red/components'
  import ParameterListEditor from './ParameterListEditor.svelte'
  import SingleParameterInput from './SingleParameterInput.svelte'
  import ListParameterInput from './ListParameterInput.svelte'
  import { getMultiSelectionSelectedSchema, getMultipleSchemesType } from '../utils/htmlFunctions'
  
  // referencing to an unknown/no longer available schema or other errors in the spec can lead to trying create an parameter which does not exist and would crash the node
  export let node, operation, parameter = { type: 'unknown', value: '' }, paramMetaData = {}, nestedParam = {}, firstLevel = false, additionalEachTypes = [], activatable, externalEditorMode

  const getParameterRowClazz = () => {
    let clazz = 'parameterRow'
    if (parameter.type === 'array' || parameter.type === 'each') {
      clazz += ' arrayParameterParent'
    }
    return clazz
  }

  // getIcon gets the icon that represents the data type from the parameter, not the selection
  const getIcon = () => {
    let defaultType = schema?.type || paramMetaData.type
    // mixed types allowed -> use first one
    if (defaultType?.oneOf) {
      defaultType = defaultType.oneOf[0]
    }
    // allowed data types 
    // https://swagger.io/docs/specification/data-models/data-types/
    switch (defaultType) {
      case 'number':
      case 'integer':
        return 'red/images/typedInput/09.svg'
      case 'boolean':
        return 'red/images/typedInput/bool.svg'
      case 'object':
        return 'red/images/typedInput/json.svg'
      case 'array':
        return 'list-ol'
      default:
        return 'red/images/typedInput/az.svg'
    }
  }

  const handleCheckboxClick = () => {
    setTimeout(() => {
      if (parameter.isActive && (['array', 'each'].includes(parameter.type) || parameter.type.startsWith('editor:'))) {
        parameter.collapsed = false
      } else if (!parameter.isActive) {
        parameter.collapsed = true
      }
      parameter = parameter
    }, 50)
  }
  
  const multiSchemesType = getMultipleSchemesType(paramMetaData)
  let schema = (multiSchemesType ? getMultiSelectionSelectedSchema(parameter, paramMetaData) : paramMetaData.schema) || {}
  const icon = getIcon()
 
  let description = paramMetaData.description || paramMetaData.summary || ''
  if (paramMetaData.deprecated) {
    description = '### *WARNING: DEPRECEATED*\n\n' + description
  }
  if (paramMetaData.default) {
    description += '\n\n### Default value:\n\n' + paramMetaData.default
  }
  if (paramMetaData.example) {
    description += '\n\n### Example:\n\n```\n' + JSON.stringify(paramMetaData.example, null, 2)
  }
  if (paramMetaData.examples) {
    description += '\n\n### Example:\n\n```\n' + JSON.stringify(paramMetaData.examples, null, 2) // for reasons closing '`' will show the backtick...
  }

  if (firstLevel) {
    if (parameter.type.startsWith('editor')) {
      parameter.collapsed = false
    }
  }
</script>

<style>
  :global(#sir-Collapsible-openApi-ParameterEditor .parameterRow) {
    overflow: visible;
  }
  /* collapsible sub row */
  :global(#sir-Collapsible-openApi-ParameterEditor .parameterRow .parameterRow.sir-Collapsible > .sir-ComponentHeader) {
    margin-left: -15px;
    width: calc(100% + 15px);
  }
  /* if a collapsible row and not collapsible rows are at the same level */
  :global(#sir-Collapsible-openApi-ParameterEditor .parameters:has( > .sir-Collapsible) > .parameterRow:not(.sir-Collapsible)) {
    padding-left: 15px;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .parameterRow .sir-ComponentHeader) {
    margin-right: 0px !important;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .parameterRow > .sir-Collapsible-content) {
    margin-top: 12px;
  }
  .maximize {
    width: 100%
  }
  :global(#sir-Collapsible-openApi-ParameterEditor :is(.parameterRowObject, .parameterRow)) {
    display: inline-flex;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .onlyCheckbox) {
    min-width: 17px;
    width: 17px;
    margin-right: 3px;
  }
  /* push the label (icon only) of the checkbox to the right side of the filter button */
  :global(#sir-Collapsible-openApi-ParameterEditor .onlyCheckbox label) {
    pointer-events: none;
    padding-left: 28px;
  }
</style>

{#if parameter && parameter.type && parameter.type !== 'unknown'}
  <!-- show parameter? -->
  {#if !node.showOnlyActiveParams || (parameter.required || parameter.isActive)} <!-- activatable would show everything e.g. request body is parent and required-->
    {#if Object.keys(paramMetaData.properties || schema.properties || {}).length || parameter.type === 'array' || parameter.type === 'each'}
      <!-- JSON object (Editor UI) -->
      <Collapsible id={parameter.msgPathString} clazz={getParameterRowClazz()} bind:collapsed={parameter.collapsed} openOnlyOnIcon>
        <span slot="header" class="parameterRowObject maximize">
          <!-- Need pseudo label for icon -->
          <Input inline type="checkbox" label=" " bind:value={parameter.isActive} disabled={!activatable || (parameter.required && !externalEditorMode) || nestedParam.activatable === false} {icon} clazz={'onlyCheckbox' + (parameter.required ? ' required' : '')}
            on:click={handleCheckboxClick}
          />
          <SingleParameterInput bind:node collapsible bind:parameter bind:nestedParam bind:schema {additionalEachTypes} {paramMetaData} {operation} {description} {multiSchemesType} {activatable} {externalEditorMode} />
          {#if node.showCalloutBox && description}
            <!-- svelte-ignore missing-declaration -->
            <Callout type="info" small>{@html RED.utils.renderMarkdown(description)}</Callout>
          {/if}
        </span>
        {#if parameter.type === 'array' || parameter.type === 'each'}
          <ListParameterInput bind:node bind:parameter {schema} {additionalEachTypes} {paramMetaData} {operation} {activatable} {externalEditorMode} />
        {:else}
          <!-- is object / editor -->
          <ParameterListEditor bind:node bind:parameter {schema} {additionalEachTypes} {paramMetaData} {operation} {multiSchemesType} {activatable} {externalEditorMode} />
        {/if}      
      </Collapsible>
    {:else}
      <Row clazz="parameterRow" maximize>
        <!-- Need pseudo label for icon -->
        <Input inline type="checkbox" label=" " bind:value={parameter.isActive} disabled={!activatable || (parameter.required && !externalEditorMode) || nestedParam.activatable === false} {icon} clazz={'onlyCheckbox' + (parameter.required ? ' required' : '')}
          on:click={handleCheckboxClick}
        />
        <SingleParameterInput bind:node bind:parameter bind:nestedParam bind:schema {additionalEachTypes} {paramMetaData} {operation} {description} {multiSchemesType} {activatable} {externalEditorMode} />
      </Row>
      {#if node.showCalloutBox && description}
        <!-- svelte-ignore missing-declaration -->
        <Callout type="info" small>{@html RED.utils.renderMarkdown(description)}</Callout>
      {/if}
      <ParameterListEditor bind:node bind:parameter {schema} {additionalEachTypes} {paramMetaData} {operation} {multiSchemesType} {externalEditorMode} />
    {/if}
  {/if}
{:else}
  <Callout type="error" small>Unknown parameter{#if parameter?.name}: {parameter.name}{/if}</Callout>
{/if}