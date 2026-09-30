<script>
  import { Button, Callout, Collapsible, Input, Row, Popover} from 'svelte-integration-red/components'
  import { createParameters } from '../utils/htmlFunctions'
  import { onMount, tick } from 'svelte'  
  import ParameterList from './ParameterList.svelte'

  export let node, operation, isCollapsible=true, externalEditorMode=false

  const prepareParameters = async () => {
    ready = false
    await tick()
    // check if operation was successfully initiated
    if (Object.keys(operation).length) {
      await createParameters(node, operation, externalEditorMode)
      parameterKeys = Object.keys(node.parameters || {})
      await tick()
      ready = true
    }
  }

  const searchInParameter = (parameter, parent) => {
    if (parent) {
      parameter.parent = parent
    }
    // order determinates what will be shown first
    parameter.mark = { activeFilter: false, name: false, type: false, value: false }
    const isArrayParameter = parameter.type === 'each' || parameter.type === 'array'
    const isEditorParameter = parameter.type.startsWith('editor:')
    // check this parameter
    if (searchValue) {
      if (!isArrayParameter && !isEditorParameter) {
        // array value will be shown directly at their children and editor has no value
        parameter.mark.value = parameter.value.toLowerCase().includes(searchValue)
      }
      parameter.mark.name = typeof parameter.name === 'string' ? parameter.name.toLowerCase().includes(searchValue) : false // parameters in arrays do not have a name but a number to identify them (optional chaining not working due to toLowerCase())
      parameter.mark.type = parameter.type.toLowerCase().includes(searchValue)
      parameter.mark.activeFilter = parameter.activeFilter.toLowerCase().includes(searchValue)
      if (parameter.type === 'each') {
        parameter.mark.iterate = parameter.each.toLowerCase().includes(searchValue)
        parameter.mark.as = parameter.as.toLowerCase().includes(searchValue)
      }
    }


    const showOrder = (parameter.type === 'array') ? ['activeFilter', 'type', 'name', 'value'] : Object.keys(parameter.mark)
    showOrder.forEach(markedPos => {
      // if something was found, push to result
      if (parameter.mark[markedPos]) {
        currentSearchResults.push({ parameter, parent, marked: markedPos })
      }
    })
    // check editor parameters
    if (isEditorParameter) {
      const childParameters = Object.values(parameter.parameters || {})
      childParameters.forEach(childParameter => searchInParameter(childParameter, parameter))
    }
    // check array children
    if (isArrayParameter) {
      parameter.value.forEach(child => searchInParameter(child, parameter))
    } 
  }

  const handleSearch = (e) => {
    node.searching = true
    clearTimeout(searchTimeout)
    searchTimeout= setTimeout(() => {
      currentSearchIndex = -1
      currentSearchResults = []
      searchValue = e.detail.value.toLowerCase().trim()
      const parameters = Object.values(node.parameters || {})
      for (let index = 0; index < parameters.length; index++) {
        searchInParameter(parameters[index])
      }
      node.searching = false
      setTimeout(() => currentSearchResults = currentSearchResults, 50) // update UI external editor
    }, 1000)
  }

  const showParameters = (param) => {
    param.collapsed = false
    let pp = param.parent
    while (pp) {
      pp.collapsed = false
      pp = pp.parent
    }
    // refresh UI
    node.parameters = node.parameters
  }

  const showSearchResult = async () => {
    const index = currentSearchIndex
    if (currentHighlightedElement) {
      currentHighlightedElement?.classList?.remove('highlightSearchResult')
    }
    const currentSearchResult = currentSearchResults[index]
    const id = currentSearchResult.parameter.type === 'each' ? 'sir-Collapsible-' + currentSearchResult.parameter.msgPathString : currentSearchResult.parameter.msgPathString
    // just check if element can be found -> else uncollapse parent elements
    let domElement = document.getElementById(id)
    if (!domElement) {
      await showParameters(currentSearchResult.parameter)
    }
    await tick()
    let counter = 0
    clearInterval(highlightInterval)
    highlightInterval = setInterval(() => {
      counter++
      // get the position which should really be marked
      switch (currentSearchResult.marked) {
        case 'name':
          domElement = document.getElementById(id)?.querySelector('.param-label')
          break
        case 'type':
          domElement = document.getElementById('sir-TypedInput-container-' + id)
          break
        case 'value':
          domElement = document.getElementById('sir-TypedInput-container-' + id)
          break
        case 'activeFilter':
          domElement = document.getElementById('sir-Button-container-' + id + '_activeFilter')
          break
        case 'iterate':
        domElement = document.getElementById('sir-TypedInput-' + currentSearchResult.parameter.msgPathString + '_iterate')
          break
        case 'as':
          domElement = document.getElementById('sir-Input-container-' + currentSearchResult.parameter.msgPathString + '_as')
          break
      }
      if (domElement) {
        clearInterval(highlightInterval)
        currentHighlightedElement = domElement
        domElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
        domElement.classList.add('highlightSearchResult')
        setTimeout(() => domElement.classList.remove('highlightSearchResult'), 2000)
      } else if (counter > 5000) {
        clearInterval(highlightInterval)
        console.log('[openAPI-red] Couldn\'t find DOM element with id :"' + id + '".') 
      }
    }, 50)

  }
  const showNextSearchResult = () => {
    currentSearchIndex++
    if (currentSearchIndex > currentSearchResults.length - 1) {
      currentSearchIndex = 0
    }
    showSearchResult()
  }
  const showPrevSearchResult = () => {
    currentSearchIndex--
    if (currentSearchIndex < 0) {
      currentSearchIndex = currentSearchResults.length - 1
    }
    showSearchResult()
  }

  // set all parameters to active / deactive is a editor mode option only and usually only for the first level parameters useful
  const setAllParametersTo = () => {
    Object.keys(node.parameters).forEach(paramKey => {
      node.parameters[paramKey].isActive = allParametersChecked
    })
    allParametersInputIndeterminate = false
  }

  let parameterKeys = []
  let ready = false
  let searchValue = '' 
  let searchTimeout
  let currentSearchIndex = 0
  let currentSearchResults = []
  let currentHighlightedElement
  let highlightInterval
  let allParametersChecked = false
  let allParametersInputIndeterminate = false


  
  node.showOnlyActiveParams = false // temp value

  onMount(() => {
    if (externalEditorMode) {
      allParametersChecked = Object.values(node.parameters).every(param => param.isActive)
    }
  })

  $: if (operation) {
    parameterKeys = []
    prepareParameters()
  }

  $: if (externalEditorMode && !allParametersChecked && !allParametersInputIndeterminate) {
    const params = Object.values(node.parameters)
    allParametersInputIndeterminate = params.find(param => param.isActive) && params.find(param => !param.isActive)
    if (allParametersInputIndeterminate) {
      document.getElementById('allParametersChecked').indeterminate = true
    }
  }
</script>

<style>
  :global(#sir-Collapsible-openApi-ParameterEditor) {
    margin-bottom: 0;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor *) {
    scroll-padding-top: 200px;
  }
  /* allow sticky header in container and hide overflow from other content */
  :global(#sir-Collapsible-openApi-ParameterEditor .red-ui-editableList-header) {
    margin-bottom: 12px;
    margin-left: -12px;
    position: sticky;
    z-index: 100;
    background: var(--red-ui-secondary-background);
    top: 33px;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .red-ui-editableList-header > div) {
    margin-top: 6px;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor #sir-Row-searchParameter) {
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--red-ui-secondary-background);
    margin-top: 6px;
    margin-bottom: 1px;
    padding-right: 6px;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor > .sir-Collapsible-content) {
    max-height: calc(100vh - 385px);
    /* overflow: auto; */
    padding: 0 0 12px 12px;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .sir-Collapsible .sir-Collapsible-content.sir-Collapsible-indented) {
    padding-left: 40px;
    margin-left: 0px;
  }
  /* subparams have a lower indention */
  :global(#sir-Collapsible-openApi-ParameterEditor .parameterRow .sir-Collapsible .sir-Collapsible-content.sir-Collapsible-indented) {
    padding-left: 20px;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .parametersDescriptionButton) { 
    margin-right: 0px !important; /* prevent jumping as last element */
  }
  .parameters {
    padding-right: 6px;
    overflow: auto;
  }

  .searching, .searchIndex {
    position: absolute;
    right: 75px;
    color: var(--red-ui-text-editor-color-disabled);
  }
  .searchIndex {
    width: 75px;
    text-align: right;
    top: 2px;
    font-size: 11px;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor :is(.highlightSearchResult > div, .markAs.highlightSearchResult input, .markName.highlightSearchResult)) {
    border: 2px dotted;
    animation: blink 0.75s linear infinite;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .markFilter.highlightSearchResult button) {
    border: 1px dashed;
    animation: blink 0.75s linear infinite;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor .markName.highlightSearchResult) {
    margin: 0 -2px;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor.notCollapsible > .sir-ComponentHeader i.fa-angle-right) {
    display: none;
  }
  :global(#sir-Collapsible-openApi-ParameterEditor.notCollapsible > .sir-ComponentHeader .sir-ComponentHeader-content) {
    padding-left: 0px;
  }
  :global(.notCollapsible #sir-Collapsible-openApi-ParameterEditor-Label) {
    cursor: default;
  }
  .red-ui-editableList-header {
    display: inline-flex;
    align-items: center;
  }
  .red-ui-editableList-header input {
    margin: -1px 0 0 8px
  }
  .parametersHeader_1 {
   width: 292px;
   padding-left: 12px;
  }
  .externalEditorHeader .parametersHeader_1 {
    width: 257px;
    padding-left: 6px;
  }

  @keyframes blink {
    from, to {    
      border-color: var(--red-ui-form-input-border-color);
    }    
    50% {    
      border-color: var(--red-ui-view-lasso-stroke);    
    }   
  }
</style>

{#if node.operationData?.id}
  {#if !ready}
    <div style="font-size: larger;">
      Loading... <i class="fa fa-spinner fa-pulse" style="margin-left: 6px;"></i>
    </div>
  {:else if parameterKeys.length > 0}
    <Collapsible id="openApi-ParameterEditor" label="Parameters" clazz={(!isCollapsible ? " notCollapsible" : "")} border openOnlyOnIcon={!isCollapsible} indented={isCollapsible}>
      <span slot="header" class="header" >
        <Popover inline small icon="gears" style="padding: 6px;">
          <Input bind:checked={node.showOnlyActiveParams} type="checkbox" label="Show only active parameters"/>
          <Button small clazz="parametersDescriptionButton" icon={node.showCalloutBox ? "eye-slash" : "eye"} label={node.showCalloutBox ? "hide description" : "show description"} 
            tooltip="Shows all descriptions direct, instead of a tooltip." on:click={() => node.showCalloutBox = !node.showCalloutBox}
          />
        </Popover>
      </span>
      <Row id="searchParameter">
        <Input type="search" id="searchParameterInput" inline on:change={handleSearch}/>
        {#if node.searching}
          <i class="fa fa-spinner fa-pulse searching"></i>
        {:else if searchValue}
          <div class="searchIndex">
            {#if currentSearchIndex >= 0}
              ({currentSearchIndex + 1} / {currentSearchResults.length})
            {:else}
              ({currentSearchResults.length})
            {/if}
          </div>
        {/if}
        <Button inline small icon="chevron-up" on:click={showPrevSearchResult} disabled={!currentSearchResults.length}/>
        <Button inline small icon="chevron-down" on:click={showNextSearchResult} disabled={!currentSearchResults.length}/>
      </Row>
      <!-- Simulate editableList header -->
      <div class="red-ui-editableList-header" class:externalEditorHeader={externalEditorMode}>
        {#if externalEditorMode}
          <input type="checkbox" id="allParametersChecked" bind:checked={allParametersChecked} on:change={setAllParametersTo} />
        {/if}
        <span class="parametersHeader_1">Name <b>(*=required)</b></span>
        <span>Value</span>
      </div>
      <div class="parameters">
        <ParameterList bind:node {operation} firstLevel={true} {externalEditorMode} activatable={true}/>
      </div>
    </Collapsible>
  {:else}
    <Callout type="info">
      No parameters found!
    </Callout>
  {/if}
{/if}
