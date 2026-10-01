<script>
  import ParameterRow from "./ParameterRow.svelte"
  import { clearError, setError } from '../utils/htmlFunctions'

  export let node, operation, parameters, schema, paramMetaData, additionalEachTypes, firstLevel, externalEditorMode, activatable

  // returns schema or parameter meta
  const getParameterData = (parameterId) => {
    clearError(node, 'getParameterData')
    const paramOrSchemaData = (parameterId === 'requestBody') 
      ? operation.requestBody?.content?.[node.requestContentType]?.schema // has parameter data in schema
      : operation.parameters.find(param => (param.name + ' ' + param.in) === parameterId) // other parameters can have an schema object
    if (paramOrSchemaData) {
      return paramOrSchemaData
    } else {
      setError(node, 'Error finding schema for parameter ' + parameterId + '.', 'getParameterData')
    }
  }

  let parameterList = []
  let properties = {}

  if (firstLevel) {
    activatable = true
    parameterList = Object.keys(node.parameters || {})
  } else {
    properties = paramMetaData.properties || schema.properties || paramMetaData.items?.properties || {}
  }
</script>

<!-- To avoid confusion keep parameters (first level (type and "in")) and properties (object parameter or property) separated -->
{#each parameterList as parameterId (parameterId)}
  <ParameterRow bind:node {operation} bind:parameter={node.parameters[parameterId]} paramMetaData={getParameterData(parameterId)} firstLevel {externalEditorMode} {activatable} additionalEachTypes={[]}/>
{/each}

{#each Object.keys(properties) as propName (propName)}
  <ParameterRow bind:node {operation} bind:parameter={parameters[propName]} paramMetaData={properties[propName]} {activatable} {externalEditorMode}
    nestedParam={{ name: propName, activatable }} {additionalEachTypes}
  />
{/each}