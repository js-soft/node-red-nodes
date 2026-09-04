<script>
  import { Button, Collapsible, EditableList, Input, Row, TypedInput } from 'svelte-integration-red/components'
  import ParameterListEditor from './ParameterListEditor.svelte';
  import { createParameters, createParameter, getTypedInputType, getAllowedTypes, getMultipleSchemesType, getArrayElementSchema } from '../utils/htmlFunctions'
  import { tick } from 'svelte'

  export let node, parameter, paramMetaData, operation, schema, additionalEachTypes, activatable, externalEditorMode

  // also in ParameterInput
  const editActiveParamFilter = (index) => {
    const value = (parameter.value[index]?.activeFilter) ? parameter.value[index].activeFilter :  '{\n\treturn true\n}'
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
            parameter.value[index].activeFilter = ''
          } else {
            parameter.value[index].activeFilter = content
            delete monaco.languages.typescript.javascriptDefaults._extraLibs.openapi_red
          }
        }, 500)
      }
    })
  }

  const addNewArrayElement = () => {
    const defaultType = arrayTypes[0]?.value || arrayTypes[0]
    const type = (defaultType?.startsWith('editor')) ? defaultType : 'msg'
    const nextIndex = parameter.value.length
    const arraySchema = getArrayElementSchema({ type }, paramMetaData, true)    
    const newValue = createParameter(nextIndex.toString(), { type }, {
      paramMetaData: arraySchema,
      requiredByParent: true,
      msgPathString: parameter.msgPathString,
      newArrayValue: true,
      externalEditorMode
    })
    parameter.value.push(newValue)
    parameter.value = parameter.value
  }

  const walkThroughParameters = (param, callback) => {
    // param itself
    callback(param)
    // if param owns additional parameters
    Object.values(param.parameters).forEach(p => callback(p))
    // children parameters    
    if ((param.type === 'each' || param.type === 'array') && Array.isArray(param.value)) {
      param.value.forEach(childParam => walkThroughParameters(childParam, callback))
    }
  }

  const createAdditionalEachTypes = async (init = false) => {
    // blur event has no value -> use oldAsValue to check
    rebuild = true // using node = node or parameter = parameter didn't help
    if (!init && oldAsValue !== parameter.as) {
      const oldAsType = '_each_' + oldAsValue
      const newAsType = '_each_' + parameter.as
      additionalEachTypes = additionalEachTypes.filter(t => t !== oldAsValue)
      oldAsValue = parameter.as
      // update all sub parameters if they use the old "as" value
      await walkThroughParameters(parameter, (p) => {
        if (p.type === oldAsType) {
          p.type = newAsType
        }
      })
    }
    if (parameter.as && !additionalEachTypes.includes(parameter.as)) {
      additionalEachTypes.push(parameter.as)
      additionalEachTypes = additionalEachTypes.sort()
    }
    await createArrayTypes()
    await repairValue(parameter.type)
    await tick()
    rebuild = false
  }

  const createArrayTypes = () => {
    // additionalEachTypes = additionalEachTypes || parameter.type === 'each'
    if (arrayMultiSchemesType) {
      const editorTypes = []
      const nonEditorTypes = []
      const arraySchemes = paramMetaData.items?.[arrayMultiSchemesType] || paramMetaData.schema?.items?.[arrayMultiSchemesType] || []
      if (paramMetaData[arrayMultiSchemesType]?.find(schema => schema?.items)) {
        arraySchemes.push(paramMetaData[arrayMultiSchemesType]?.find(schema => schema?.items).items)
      }
      arraySchemes.forEach((schema, index) => {
        const type = getTypedInputType(schema)
        if (type.startsWith('editor')) {
          // split editor value from rest
          const types = getAllowedTypes(schema, parameter.name + '_' + index, additionalEachTypes)
          editorTypes.push(types.shift())
          nonEditorTypes.push(...types)
        } else {
          nonEditorTypes.push(...getAllowedTypes(paramMetaData, parameter.name, additionalEachTypes))
        }
      })
      arrayTypes = [...editorTypes, ...new Set(nonEditorTypes)]
    } else {
      arrayTypes = getAllowedTypes(schema.items || paramMetaData.items || {}, parameter.name, additionalEachTypes)
    }
  }

  const createTypedInputClazz = (childParameter) => {
    let clazz = ''
    if (childParameter.type === 'msg' || childParameter.type === 'flow' || childParameter.type === 'global') clazz += 'externalValue'
    if (parameter.type === 'each' && childParameter?.type?.startsWith('editor')) clazz += ' eachEditor'

    if (childParameter.mark.type) clazz += ' mark markType'
    if (childParameter.mark.value) clazz += ' mark markValue'
    return clazz
  }

  const createIterateClazz = () => {
    let clazz = 'indentedEachAsInput'
    if (parameter.mark.iterate) clazz += ' mark markIterate'
    return clazz
  }

  const createAsClazz = () => {
    let clazz = 'indentedEachAsInput'
    if (parameter.mark.as) clazz += ' mark markAs'
    return clazz
  }

  const createArrayClazz = () => {
    let clazz = 'arrayList'
    if (parameter.type === 'each') clazz += ' each'
    if (arrayError && nestedParam.activatable) clazz += ' arrayError'
    return clazz
  }

  // similar to parameterInput
  const handleTypeSelection = async (e, index) => {
    rebuild = true
    const type = e.detail.type
    if (typeof index !== 'undefined') {
      parameter.value[index].value = e.detail.value
      parameter.value[index].type = type
    }
    // repair array
    await repairValue(type)
    // handleTypeSelection mainly function from parameterRow
    if (type.startsWith('editor')) {
      const multiSchemeType = parameter.value[index]?.selectedSchema?.type || getMultipleSchemesType(paramMetaData) 
      // clear value from (main) parameter when switching to editor (parsing will be difficult to impossible, and user should see that those two are different...)
      if (multiSchemeType) {
        if (!parameter.value[index].selectedSchema) {
          parameter.value[index].selectedSchema = { type: multiSchemeType }
        }
        parameter.value[index].selectedSchema.name = type.substring(7)

        await createParameters(node, operation, externalEditorMode)
      }
      // must update parameter manually, as this parameter will not be updated while node.parameters[xxx] already exists.
      parameter = await createParameter(parameter.name, parameter, {
        paramMetaData,
        requiredByParent: parameter.required,
        msgPathString: parameter.msgPathString.slice(0, (parameter.name.length + 1) * -1),
        externalEditorMode
      })
    } else if (type === 'msg' && parameter.value === '') {
      parameter.value = parameter.msgPathString
    }
    if (type.startsWith('editor') || type === 'each' || type === 'array') {
      parameter.collapsed = false
    }
    await tick()
    rebuild = false
  }

  const repairValue = (type) => {
    const rebuildArray = (!Array.isArray(parameter.value) || !parameter.value.length || parameter.value.find(v => !v?.type) !== undefined)
    if ((type === 'each' || type === 'array' || typeof index !== 'undefined') && rebuildArray) {
      parameter.value = []
      parameter.eachType ||= 'msg' // add eachType if not existing
    }
    if (!parameter.value.length) {
      addNewArrayElement()
    }
  }

  const createButtonClazz = (param) => {
    let clazz = 'activeFilter'
    if (param.activeFilter) clazz +=  ' isActive'
    if (Object.keys(param.parameters || {}).length) clazz += ' intendedYieldFilter'
    if (param.mark.activeFilter) clazz += ' mark markFilter'
    return clazz
  }

  const arrayMultiSchemesType = getMultipleSchemesType(paramMetaData, true)
  let arrayTypes = []
  let arrayError = false
  let rebuild = false
  let oldAsValue = parameter.as
  let iterateClazz = createIterateClazz()
  let asClazz = createAsClazz()

  additionalEachTypes = structuredClone(additionalEachTypes)
  // creates array and additional each typedInput types
  createAdditionalEachTypes(true)

  $: if (parameter.as !== oldAsValue) {
    createAdditionalEachTypes()
  }

  $: if (parameter.type === 'array' && parameter.value) {
    const minValueOk = (!paramMetaData.minItems || parameter.value.length >= paramMetaData.minItems)
    const maxValueOk = (!paramMetaData.maxItems || parameter.value.length < paramMetaData.maxItems)
    const uniqueOk = (!paramMetaData.uniqueItems || new Set(parameter.value).size === parameter.value.length)
    arrayError = !(minValueOk && maxValueOk && uniqueOk)
  } else {
    arrayError = false
  }

  $: {
    if (!node.searching) {
      iterateClazz = createIterateClazz()
      asClazz = createAsClazz()
    }
  }

  $:isActive = activatable && parameter.isActive
</script>

<style>
  :global(#sir-Collapsible-openApi-ParameterEditor .sir-Collapsible.arrayParameterCollapsible > .sir-Collapsible-content.sir-Collapsible-indented) {
    padding-left: 20px;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .yield label) {
    min-width: 241px;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .sir-Row.indentedEachAsInput label) {
    min-width: 269px;
  }
  /* within a typed input we still need full width */
  :global(#sir-Collapsible-openApi-ParameterEditor .sir-Row.indentedEachAsInput .sir-TypedInput input) {
    width: 100%;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .sir-Row.indentedEachAsInput :is(.sir-TypedInput, input)) {
    width: calc(100% - 250px)
  }
  /* hide additional values from "old" array if each was selected */
  :global(#sir-Collapsible-openApi-ParameterEditor .arrayList) {
    margin-left: 270px;
  }
  /* change type "each" css to avoid changing logic to array */
  :global(#sir-Collapsible-openApi-ParameterEditor .arrayList.each) {
    margin-left: 42px;
    flex-direction: row;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .arrayList.each > .sir-ComponentHeader) {
    width: 200px;
  }
  /* set collapsible into line of array type selection */
  :global(#sir-Collapsible-openApi-ParameterEditor .arrayParameterCollapsible > .sir-ComponentHeader) {
    margin-top: -46px;
    height: 34px;
    margin-bottom: 6px !important;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .arrayParameterCollapsible > .sir-ComponentHeader > .sir-ComponentHeader-content) {
    padding-left: 40px;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .intendedYieldFilter.activeFilter) {
    margin-left: 20px;
    z-index: 99;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .eachEditor) {
    margin-left: 226px;
  }
  /* error */
  :global(#sir-Collapsible-openApi-ParameterEditor .arrayError .red-ui-editableList-container) {
    border-color: var(--red-ui-border-color-error);
  }
  /* each yield label */
  :global(#sir-Collapsible-openApi-ParameterEditor .arrayParameterCollapsible > .sir-ComponentHeader label) {
    margin-left: 0px;
  }
</style>

<!-- TODO check if each and array can be combined somehow (another component or bind on "editableList" => simple div with slot or list) -->
{#if parameter.type === 'each'}
  <TypedInput label="Iterate" id={parameter.msgPathString + '_iterate'} bind:type={parameter.eachType} bind:value={parameter.each} types={["msg", "flow", "global", "json"]} maximize={false} clazz={iterateClazz} disabled={!isActive}/>
  <Input label="As" id={parameter.msgPathString + '_as'} bind:value={parameter.as} on:blur={() => createAdditionalEachTypes()} maximize={false} clazz={asClazz} disabled={!isActive}/>
  {#if !rebuild && parameter.value?.[0]?.type}
    <Row clazz="eachYield">
      <Button small inline icon="filter" clazz={createButtonClazz(parameter.value[0])} disabled={!isActive} id={parameter.msgPathString + '["0"]_activeFilter'} 
        tooltip={'return a boolean value.\n\nUse msg, the current "each "as" name" or value for the current value.\n\n' + parameter.value[0].activeFilter || '{ return true '} 
        on:click={() => editActiveParamFilter(0)}
      />  
      <TypedInput inline label={parameter.value[0].type.startsWith('editor') && Object.keys(getArrayElementSchema(parameter.value[0], paramMetaData)?.properties || {})?.length ? false : "Yield"} 
        id={parameter.msgPathString + '["0"]'} placeholder={'The whole entry value.'}
        type={parameter.value[0].type} value={parameter.value[0].value} types={arrayTypes} disabled={!isActive} clazz={createTypedInputClazz(parameter.value[0], true) + ' yield'} 
        on:blur={(e) => handleTypeSelection(e, 0)}
      />
    </Row>   
    <!-- each editor (collapsible) or input field -->
    {#if parameter.value[0].type.startsWith('editor') && Object.keys(getArrayElementSchema(parameter.value[0], paramMetaData)?.properties || {})?.length}
      <Collapsible id={parameter.msgPathString} label="Yield" clazz="arrayParameterCollapsible">
        <ParameterListEditor bind:node bind:parameter={parameter.value[0]} paramMetaData={getArrayElementSchema(parameter.value[0], paramMetaData)} {operation} inArrayValue {additionalEachTypes} activatable={isActive}/>
      </Collapsible>
    {:else}
      <ParameterListEditor bind:node bind:parameter={parameter.value[0]} paramMetaData={getArrayElementSchema(parameter.value[0], paramMetaData)} {operation} inArrayValue {additionalEachTypes} activatable={isActive}/>
    {/if}
  {/if}
{:else if parameter.type ==='array'}
  <EditableList sortable removable addButton minHeight="0px" maxHeight=900 clazz={createArrayClazz(parameter.type)} disabled={!isActive}
    bind:elements={parameter.value} let:element={el} let:index
    on:add={addNewArrayElement}
  >
    {#if !rebuild}
      <Row style="margin-bottom: 6px;">
        <Button small inline icon="filter" clazz={createButtonClazz(parameter.value[index])} id={parameter.msgPathString + '["' + index + '"]_activeFilter"'} disabled={!isActive}
          tooltip={'return a boolean value.\n\nUse msg, the current "each "as" name" or value for the current value.\n\n' + parameter.value[index].activeFilter || '{ return true '} 
          on:click={() => editActiveParamFilter(index)}
        />
        <TypedInput inline type={el.type} value={el.value} types={arrayTypes} id={parameter.msgPathString + '["' + index + '"]'} clazz={createTypedInputClazz(el, true)} disabled={!isActive} 
          on:blur={(e) => handleTypeSelection(e, index)}
        />
      </Row>
      {#if Object.keys(getArrayElementSchema(parameter.value[index], paramMetaData) || {})?.length}
        <Collapsible clazz="arrayParameterCollapsible">
          <ParameterListEditor bind:node bind:parameter={parameter.value[index]} paramMetaData={getArrayElementSchema(parameter.value[index], paramMetaData)} {operation} inArrayValue {additionalEachTypes} activatable={isActive}/>
        </Collapsible>
      {/if}
    {/if}
  </EditableList>
{/if}