<script>
  import { Button, Row, TypedInput, Tooltip } from "svelte-integration-red/components"
  import { createParameters, createParameter, getAllowedTypes, getMultiSelectionSelectedSchema, getTypedInputType, getMultipleSchemesType } from '../utils/htmlFunctions'

  export let node, collapsible, parameter, paramMetaData, operation, schema, nestedParam, description, additionalEachTypes = [], activatable = true, externalEditorMode

  const toggleCollapsed = () => parameter.collapsed = !parameter.collapsed

  // also in ArrayTypedInput
  const editActiveParamFilter = (event) => {
    const position = event.target
    const value = (parameter?.activeFilter) ? parameter.activeFilter :  '{\n\treturn true\n}'
    monaco.languages.typescript.javascriptDefaults.addExtraLib('const ' + ['value', ...additionalEachTypes.join(', ')], 'openapi_red')
    RED.editor.editJavaScript({
      value: value,
      title: 'Javascript Editor',
      width: 'Infinity',
      mode: 'ace/mode/nrjavascript',
      complete: (content) => {
        // Save the content (after UI exists again, tick is too short)
        setTimeout(() => {
          // check if anything was set
          if (content && content.trim() === '{\n\treturn true\n}') {
            parameter.activeFilter = ''
          } else {
            parameter.activeFilter = content
            delete monaco.languages.typescript.javascriptDefaults._extraLibs.openapi_red
          }
          position.scrollIntoView({ block: 'start' })
        }, 500)
      }
    })
  }

  const handleTypeSelection = (e, index) => {
    let isArray = false
    const type = e.detail.type
    
    if ((type === 'each' || type === 'array' || typeof index !== 'undefined')) {
      const rebuildArray = (!Array.isArray(parameter.value) || parameter.value.find(v => !v?.type) !== undefined)
      if (rebuildArray) {
        parameter.value = []
      }
      parameter.eachType ||= 'msg' // add eachType if not existing
    }
    if (typeof index !== 'undefined') {
      isArray = true
      parameter.value[index].value = e.detail.value
      parameter.value[index].type = type
    }
    // handleTypeSelection mainly function from parameterRow
    if (type.startsWith('editor')) {
      const multiSchemeType = getMultipleSchemesType(paramMetaData, isArray)
      // clear value from (main) parameter when switching to editor (parsing will be difficult to impossible, and user should see that those two are different...)
      if (multiSchemeType) {
        if (isArray) {
          parameter.value[index].selectedSchema.name = type.substring(7)
        } else {
          parameter.selectedSchema.name = type.substring(7)
          schema = getMultiSelectionSelectedSchema(parameter, paramMetaData)
        }
        createParameters(node, operation, externalEditorMode)
        // must update parameter manually, as this parameter will not be updated while node.parameters[xxx] already is.
        parameter = createParameter(parameter.name, parameter, {
          paramMetaData,
          requiredByParent: parameter.required,
          msgPathString: parameter.msgPathString.slice(0, (parameter.name.length + 1) * -1 ),
          externalEditorMode: externalEditorMode
        })
      }
    } else if (type === 'msg' && parameter.value === '') {
      parameter.value = parameter.msgPathString
    }
    // type changed and is collapsible => open editor
    parameter.collapsed = false
  }

  const createTypedInputClazz = () => {
    typedInputClazz = ''
    if (parameter.type === 'msg' || parameter.type === 'flow' || parameter.type === 'global') typedInputClazz += 'externalValue'
    if (parameter.mark?.type) typedInputClazz += ' mark markType'
    if (parameter.mark?.value) typedInputClazz += ' mark markValue'
  }

  const createFilterClazz = () => {
    filterClazz = 'activeFilter'
    if (!parameter.mark) {
    }
    if (parameter.activeFilter) filterClazz += ' isActive'
    if (parameter.mark?.activeFilter) filterClazz += ' mark markFilter'
  }

  const setAllowedValue = () => {
    // default string (all values except...)
    if (typeof parameter.value === 'string' && parameter.value.startsWith('payload')) {
      parameter.type = 'msg'
    // ...an Array allowed by the editor
    } else {
      parameter.type = parameterTypes[0]?.value || parameterTypes[0]
      if (parameter.type === 'array' && !Array.isArray(parameter.value)) {
        parameter.value = []
      } else {
        parameter.value = ''
      }
    }
  }

  const multiSchemesType = getMultipleSchemesType(paramMetaData)
  const defaultTypedInputType = getTypedInputType(paramMetaData)
  const labelId = parameter.name + '_' + parameter.type + '_' + Date.now()
  const required = parameter.required
  let placeholder = paramMetaData.default || schema.default || ''
  let filterClazz = ''
  let typedInputClazz = ''
  let parameterTypes = []

  // init clazzes
  createFilterClazz()
  createTypedInputClazz()

  if (typeof placeholder === 'object') {
    try {
      placeholder = JSON.stringify(placeholder)
    } catch (e) {
      placeholder = 'Invalid Json placeholder / default value'
    }
  }

  if (defaultTypedInputType === 'array') {
    if (paramMetaData.minItems) description += '\n\n⚠️ Minimum items: ' + paramMetaData.minItems
    if (paramMetaData.maxItems) description += '\n\n⚠️ Maximum items: ' + paramMetaData.maxItems
    if (paramMetaData.uniqueItems) description += '\n\n⚠️ Items must be unique!'
  }

  if (multiSchemesType) {
    const editorTypes = []
    const nonEditorTypes = []
    const multiSchemesList = paramMetaData.schema?.[multiSchemesType] || paramMetaData[multiSchemesType]
    
    multiSchemesList.forEach((schema, index) => {
      const type = getTypedInputType(schema)
      if (type.startsWith('editor')) {
        // split editor value from rest
        const types = getAllowedTypes(schema, parameter.name + '_' + index, additionalEachTypes)
        editorTypes.push(types.shift())
        nonEditorTypes.push(...types)
      } else {
        nonEditorTypes.push(...getAllowedTypes(schema, null, additionalEachTypes))
      }
    })
    parameterTypes = [...editorTypes, ...new Set(nonEditorTypes)]
  } else {
    parameterTypes = getAllowedTypes(paramMetaData, parameter.name, additionalEachTypes) 
  }
  
  if (!parameterTypes.find(type => (type?.value || type) === parameter.type)) {
  // parameter was identified as an editor object, but 
    // -> a) didn't had any further data collected in ParameterEditor.svelte --> this happens on creating parameter at the first time
    // -> b) if an editor was selected and api/operation was changed, this editor may not be available anymore -> select the first existing
    if (parameter.type.startsWith('editor')) {
      const firstEditorType = parameterTypes.find(type => type?.value?.startsWith('editor'))
      if (firstEditorType) {
        parameter.type = firstEditorType.value
        parameter.selectedSchema =  {
          name: firstEditorType.value.substring(7),
          type: multiSchemesType
        }
      } else {
        setAllowedValue()
      }
    } else {
      // parameter type has changed (other api operation or it was changed in the spec) and couldn't be found -> select first allowed
      setAllowedValue()
    }
  }

  $: {
    if (!node.searching) {
      createFilterClazz()
      createTypedInputClazz()
    }
  }
</script>

<style>
  .pointer {
    cursor: pointer;
  }
  .maximize {
    width: 100%
  }
  /* set min width for font-awesome icons */
  :global(#sir-Collapsible-openApi-ParameterEditor .parameterRow .sir-Row label i) {
    min-width: 27px;
  }
  /* align parameters to top and use margin to lower the label */
  :global(#sir-Collapsible-openApi-ParameterEditor .parameterInput) {
    align-items: flex-start;
  }
  /* the real label */
  .parameterLabelOuter {
    display: inline-flex;
    align-items: center;
    min-height: 34px;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .param-label) {
    min-width: 200px;
    width: 200px;
    overflow-wrap: break-word;
    padding-left: 28px;
  }
  .param-label.required {
    font-weight: bold;
  }
  .param-label.required.warning {
    color: var(--red-ui-text-color-warning);
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .sir-Input-container .checkbox) {
      display: inline-flex;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .sir-Input-container .checkbox input) {
    margin-top: 0px;
  }
  /* typedInput label marker if value is from extern */
  :global(.sir-TypedInput-container.externalValue:focus-within button.sir-TypedInput-options-button .sir-TypedInput-ui-type-label) {
    color: var(--red-ui-border-color-warning);
  }
  /* filter button style */
  :global(#sir-Collapsible-openApi-ParameterEditor .activeFilter.isActive button) {
    background: var(--red-ui-list-item-background-selected);
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .activeFilter.isActive i) {
    color: var(--red-ui-primary-text-color)
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .activeFilter i) {
    color: var(--red-ui-workspace-button-color-disabled);
  }
  :global(#sir-Collapsible-openApi-ParameterEditor :is(.sir-TypedInput-container.markValue input, .param-label.markName, .sir-TypedInput-container.markType .sir-TypedInput-optionsText, .sir-TypedInput-container.markIterate input, .markAs input, .markFilter button i)) {
    font-weight: bold;
    color: var(--red-ui-view-lasso-stroke);
  }
</style>

<Row id={parameter.msgPathString} maximize clazz={"parameterInput" + (collapsible ? "": " notCollapsible")}>
  <!-- empty label to show icon -->
  <div class="parameterLabelOuter">
    <Button small inline icon="filter" id={parameter.msgPathString + "_activeFilter"} clazz={filterClazz} tooltip={'return a boolean value.\n\nUse msg, the current "each "as" name" or value for the current value.\n\n' + parameter.activeFilter || '{ return true '} disabled={!activatable || parameter.required} on:click={editActiveParamFilter} />
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div id={labelId} class="param-label" 
        class:mark={parameter.mark?.name} class:markName={parameter.mark?.name} class:required class:pointer={collapsible} class:warning={required && !parameter.isActive}
        on:click={toggleCollapsed} on:keydown={toggleCollapsed}
      >
      {nestedParam.name||parameter.name}{required ? '*' : ''}
      {#if !node.showCalloutBox && description} 
        <Tooltip id={labelId} tooltip={node.showCalloutBox ? "" : description} tooltipOptions={{ direction: "bottom", icon:"info-circle pointer" }} />
      {/if}
    </div>
  </div>
  <div class:arrayInput={parameter.type === 'array'} class="maximize">
    <TypedInput id={parameter.msgPathString} inline={parameter.type !== 'each'} types={parameterTypes} bind:type={parameter.type} bind:value={parameter.value} {placeholder} 
      autocompleteList={operation.autocompleteList} autoCompleteMsgDefault={!operation.autocompleteList}
      clazz={typedInputClazz}
      disabled={!activatable || !parameter.isActive || nestedParam.activatable === false || (parameter.type === 'select' && (paramMetaData.enum || paramMetaData.items?.enum || schema?.enum)?.length === 1)}
      error={required && (parameter.type !== 'array' && !parameter.type.startsWith('editor')) && parameter.value === ''}
      on:change={handleTypeSelection}
      on:editor-closed={(e) => setTimeout(() => document.getElementById("sir-TypedInput-" + e.detail.id)?.scrollIntoView({ block: 'start', behavior: 'smooth'}), 500)}
    />
  </div>
</Row>	