<script>
  /**
   * ParameterListEditor allows to handle complex values on the UI.
   * It prepares the structure to handle it within a new parameterList.
   * For objects it also provides helper buttons to create a required / all properties json and shows the object structure (Old UI mode)
  */
  import { Row, Button, Callout } from "svelte-integration-red/components"
  import ParameterList from "./ParameterList.svelte"
  import { getMultipleSchemesType } from '../utils/htmlFunctions'

  export let node, parameter, paramMetaData, schema, operation, multiSchemesType, inArrayValue = false, additionalEachTypes=[], activatable, externalEditorMode

  const getProperties = () => {
    properties = paramMetaData.properties || schema.properties || paramMetaData.items?.properties || {}
    propKeys = Object.keys(properties)
  }

  const setJsonKeys = (option) => {
    const requiredParameters = []
    const notRequiredParameters = []
    const exists = []
    let fieldValue = parameter.value
    try {
      fieldValue = JSON.parse(fieldValue)
    } catch {
      fieldValue = {}
    }

    propKeys.forEach(prop => {
      if (fieldValue[prop]) {
        const value = fieldValue[prop]
        // chk if value is empty array or object -> would return "" otherwise
        if (typeof value === 'object') {
          if (Array.isArray(value) && value.length === 0) exists.push(`"${prop}": []`)
          else if (Object.keys(value).length === 0) exists.push(`"${prop}": {}`)
          else exists.push(`"${prop}": "${value}"`)
        } else {
          exists.push(`"${prop}": "${value}"`)
        }
      } else {
        const isRequired = requiredList.find(reqParam => reqParam === prop)
        if (isRequired) {
          requiredParameters.push(`"${prop}": "${properties[prop].type} - required"`)
        } else {
          notRequiredParameters.push(`"${prop}": "${properties[prop].type}"`)
        }
      }
    })

    let result = requiredParameters.concat(exists)
    if (option === 'default') result = result.concat(notRequiredParameters)
    result = '{ ' + result.join(', ') + ' }'
    if (!inArrayValue && (paramMetaData.type === 'array' || schema?.type === 'array')) {
      result = '[' + result + ']'
    }
    // change parameter
    parameter.isActive = true
    if (parameter.type !== 'jsonata') {
      parameter.type = 'json'
    }
    parameter.value = result
  }

  let properties = {}
  let propKeys = []
  let hideJsonKeys = true
  schema ||= paramMetaData.schema || {}
  multiSchemesType ||= (getMultipleSchemesType(paramMetaData, inArrayValue))
  additionalEachTypes = structuredClone(additionalEachTypes)
  getProperties()
  const requiredList = Array.isArray(schema.required) ? schema.required : []
  // (old JSON) UI-Editor can currently only handle one multi scheme type and does not combine schemes. (oneOf > anyOf > allOf)
  const multiSchemesWarning = multiSchemesType === 'anyOf' || multiSchemesType === 'allOf'
  // on change of meta data get new props
  $: getProperties(paramMetaData, schema)

  $: if (inArrayValue) {
    parameter.isActive = activatable
  }
</script>

<style>
  .jsonObjectKeyList {
    margin-bottom: 0px;
  }
  .jsonKeys {
    display: none;
  }
</style>

{#if parameter.type.startsWith("editor") && parameter.parameters}
  {#if multiSchemesWarning}
    <Callout type="warning">
      This complex schema (anyOf or allOf) may not be complete, as it can include other schemes.
    </Callout>
  {/if}
  <ParameterList bind:node bind:parameters={parameter.parameters} {operation} {paramMetaData} {schema} {externalEditorMode} activatable={parameter.isActive && activatable} {additionalEachTypes} />
{:else if propKeys.length}
  <!-- old UI  -->
  <Row>
    <Button inline small icon={hideJsonKeys ? "eye" : "eye-slash"} label={hideJsonKeys ? "Show keys" : "Hide keys"} on:click={() => (hideJsonKeys = !hideJsonKeys)} />
    <Button inline small icon="edit" label="Set default" on:click={() => setJsonKeys("default")}/>
    <Button inline small icon="edit" label="Set required" on:click={() => setJsonKeys("required")}/>
  </Row>
  <div class:jsonKeys={hideJsonKeys}>
    {#if propKeys.length}
      {#each propKeys as propKey (propKey)}
        <ul>
          <li>
            <div class:required={requiredList.find((reqParam) => reqParam === propKey)}>
              {propKey}: {properties[propKey].type}
            </div>
            {#if properties[propKey].example}
              <div>Example: {properties[propKey].example}</div>
            {/if}
            {#if properties[propKey].type === "object"}
              {"{"}
              <ul>
                {#each Object.entries(properties[propKey]?.properties || {}) as [pKey, p] (pKey)}
                  <p class="jsonObjectKeyList">{pKey}: {p.type}</p>
                {/each}
              </ul>
              {"}"}
            {:else if properties[propKey].type === "array" && properties[propKey]?.items?.type}
              <div>
                <div>Containing: {properties[propKey].items.type}</div>
                {#if properties[propKey].items.type === "object" && properties[propKey]?.items?.properties}
                  {"{"}
                  <ul>
                    {#each Object.entries(properties[propKey].items.properties) as [pKey, p] (pKey)}
                      <p class="jsonObjectKeyList">{pKey}: {p.type}</p>
                    {/each}
                  </ul>
                  {"}"}
                {/if}
              </div>
            {/if}
          </li>
        </ul>
      {/each}
    {:else}
      No properties defined.
    {/if}
  </div>
{/if}