import { resolveCardTemplate, styleCardLine } from '../../../modules/game-servers/renderer.js';
import { CARD_PLACEHOLDERS } from '../../../modules/game-servers/card-profile.js';
import { cardPreviewScript } from './card-preview.js';

type MarkdownPreviewNode = {
  className: string;
  alt: string;
  src: string;
  textContent: string;
  classList: { toggle(name: string): void };
  append(...nodes: MarkdownPreviewNode[]): void;
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
  replaceWith(node: MarkdownPreviewNode): void;
};
type MarkdownPreviewDocument = {
  createElement(tag: string): MarkdownPreviewNode;
  createTextNode(text: string): MarkdownPreviewNode;
};

export const appendInlineMarkdown = (
  parent: MarkdownPreviewNode,
  content: string,
  doc: MarkdownPreviewDocument = (
    globalThis as typeof globalThis & { document: MarkdownPreviewDocument }
  ).document,
): void => {
  const pattern =
    /(\\[\\\x60*_{}\x5b\x5d()#+\-.!|><~])|(<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>)|(\x60[^\x60\n]+\x60|\|\|[^|\n]+?\|\||\*\*\*[^\n]+?\*\*\*|\*\*[^\n]+?\*\*|__[^\n]+?__|~~[^\n]+?~~|\*[^\n]+?\*)/g;
  let offset = 0;
  for (const match of content.matchAll(pattern)) {
    parent.append(doc.createTextNode(content.slice(offset, match.index)));
    if (match[1]) {
      parent.append(doc.createTextNode(match[1].slice(1)));
      offset = match.index + match[0].length;
      continue;
    }
    if (match[2]) {
      const emoji = match[2].match(/^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/);
      if (emoji) {
        const image = doc.createElement('img');
        image.className = 'preview-discord-emoji';
        image.alt = ':' + (emoji[2] ?? '') + ':';
        image.src =
          'https://cdn.discordapp.com/emojis/' +
          (emoji[3] ?? '') +
          (emoji[1] ? '.gif' : '.webp') +
          '?size=32&quality=lossless';
        image.addEventListener(
          'error',
          () => {
            image.replaceWith(doc.createTextNode(image.alt));
          },
          { once: true },
        );
        parent.append(image);
      }
      offset = match.index + match[0].length;
      continue;
    }
    const token = match[3] ?? '';
    const marker = token.startsWith('\x60')
      ? '\x60'
      : token.startsWith('||')
        ? '||'
        : token.startsWith('***')
          ? '***'
          : token.startsWith('**')
            ? '**'
            : token.startsWith('__')
              ? '__'
              : token.startsWith('~~')
                ? '~~'
                : '*';
    const element = doc.createElement(
      marker === '\x60'
        ? 'code'
        : marker === '||'
          ? 'span'
          : marker === '*'
            ? 'em'
            : marker === '__'
              ? 'u'
              : marker === '~~'
                ? 's'
                : 'strong',
    );
    if (marker === '||') {
      element.className = 'preview-spoiler';
      element.addEventListener('click', () => element.classList.toggle('is-revealed'));
    }
    const inner = token.slice(marker.length, -marker.length);
    if (marker === '\x60') element.textContent = inner;
    else if (marker === '***') {
      const italic = doc.createElement('em');
      appendInlineMarkdown(italic, inner, doc);
      element.append(italic);
    } else appendInlineMarkdown(element, inner, doc);
    parent.append(element);
    offset = match.index + token.length;
  }
  parent.append(doc.createTextNode(content.slice(offset)));
};

/** One set of authoritative element controls; selecting a row moves its controls into the panel. */
export const cardLineScript = String.raw`
const resolveLineTemplate = ${resolveCardTemplate.toString()};
const styleLineText = ${styleCardLine.toString()};
const placeholders = ${JSON.stringify(CARD_PLACEHOLDERS)};
const layoutEditors = document.getElementById('card-layout-editors');
const layoutProperties = document.getElementById('card-layout-properties-editor');
const propertiesTabs = Array.from(document.querySelectorAll('[data-properties-tab]'));
const layoutJson = document.getElementById('card-layout-json');
const buttonLibrary = document.querySelector('[data-button-library]');
const buttonLibraryPanel = document.getElementById('card-button-library-panel');
const buttonLibraryEmpty = document.querySelector('[data-button-library-empty]');
const buttonLibraryCount = document.getElementById('card-button-count');
const previewRoot = document.getElementById('card-template-preview');
const cardForm = layoutEditors?.closest('form');
const dirtyStatus = document.getElementById('card-config-dirty-status');
const appendInlineMarkdown = ${appendInlineMarkdown.toString()};
const formControl = (name) => cardForm?.querySelector('[name="' + name + '"]');
const inputValue = (name, fallback = '') => formControl(name)?.value ?? fallback;
const layoutNodes = () => Array.from(layoutEditors?.querySelectorAll('[data-layout-element]') ?? []);
const read = (node, field) => node._content.querySelector('[data-layout-field="' + field + '"]');
const showPropertiesPanel = (name, focus=false) => {
  propertiesTabs.forEach((tab)=>{const selected=tab.dataset.propertiesTab===name;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;});
  if(layoutProperties)layoutProperties.hidden=name!=='elements';
  if(buttonLibraryPanel)buttonLibraryPanel.hidden=name!=='buttons';
  if(focus)propertiesTabs.find((tab)=>tab.dataset.propertiesTab===name)?.focus();
};
propertiesTabs.forEach((tab)=>tab.addEventListener('keydown',(event)=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const index=propertiesTabs.indexOf(tab);const next=event.key==='Home'?0:event.key==='End'?propertiesTabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+propertiesTabs.length)%propertiesTabs.length;const target=propertiesTabs[next];showPropertiesPanel(target.dataset.propertiesTab,true);}));
const feedRows = (node) => Array.from(node._content.querySelectorAll('[data-feed-order-item]'));
const updateBlockRows = (node) => Array.from(node._content.querySelectorAll('[data-update-block]'));
let buttonDefinitions = [];
const renderButtonDefinition = (button) => {
  const row=document.createElement('fieldset');row.dataset.buttonDefinition=button.id;
  row.dataset.savedLabel=button.label??'';row.dataset.savedEmoji=button.emoji??'';
  row.dataset.initialDisplayLabel=(button.emoji?button.emoji+' ':'')+(button.label??'');
  row.innerHTML='<legend><span data-button-summary></span></legend><div class="button-definition-fields"><label>Button label<input data-button-field="label" maxlength="200" required></label><p class="hint">Unicode emoji can go in the label. Prefix custom emoji as &lt;:name:id&gt;. Button text limit: 80 characters.</p><div class="button-definition-options"><label data-button-style-setting>Style<select data-button-field="style"><option value="primary">Primary</option><option value="secondary">Secondary</option><option value="success">Success</option><option value="danger">Danger</option><option value="link">Link</option></select></label><label>Action<select data-button-field="action"><option value="connect">Connect</option><option value="map-rules">Map &amp; Rules</option><option value="copy-address">Copy Address</option><option value="announcements-thread">Announcements thread</option><option value="changelog-thread">Changelog thread</option><option value="external-https-url">External HTTPS URL</option></select></label></div><label data-button-destination>HTTPS destination<input data-button-field="destination" type="url" maxlength="2048" pattern="https://.*" title="Enter a public HTTPS URL" placeholder="https://example.com" autocomplete="url"></label><p class="hint" data-button-action-help></p><div class="button-definition-preview"><span data-button-preview class="preview-action preview-button-secondary"></span><span data-button-preview-action></span></div><label class="checkbox"><input type="checkbox" data-button-field="visible"> Enabled everywhere</label><p class="hint">This global switch hides the button in every placement. Remove it from a row or accessory to change placement.</p><p class="hint" data-button-usage></p><div class="card-layout-property-actions"><button type="button" class="secondary" data-button-move="up" aria-label="Move button up">↑</button><button type="button" class="secondary" data-button-move="down" aria-label="Move button down">↓</button><button type="button" class="secondary" data-button-duplicate>Duplicate</button><button type="button" class="secondary" data-button-create-row>Create Button Row</button><button type="button" class="secondary" data-button-add-to-selected-row hidden>Add to selected row</button><button type="button" class="danger" data-button-remove>Remove</button></div></div>';
  row.querySelector('[data-button-field="label"]').value=row.dataset.initialDisplayLabel;
  for(const key of ['style','action','destination']){const control=row.querySelector('[data-button-field="'+key+'"]');if(control)control.value=button[key]??'';}
  row.querySelector('[data-button-field="visible"]').checked=button.visible!==false;
  const action=row.querySelector('[data-button-field="action"]');const style=row.querySelector('[data-button-field="style"]');const linkStyle=style.querySelector('option[value="link"]');const sync=(enforceStyle=false)=>{const isLink=action.value.includes('thread')||action.value==='external-https-url';const external=action.value==='external-https-url';row.querySelector('[data-button-destination]').hidden=!external;row.querySelector('[data-button-field="destination"]').required=external;row.querySelector('[data-button-style-setting]').hidden=isLink;linkStyle.disabled=!isLink;if(enforceStyle){if(isLink)style.value='link';else if(style.value==='link')style.value='secondary';}const incompatible=isLink?style.value!=='link':style.value==='link';const help=action.value==='connect'?'Connect runs the server’s configured connection action.':action.value==='map-rules'?'Map & Rules opens the server’s map and rules action.':action.value==='copy-address'?'Copy Address copies the server address for the user.':action.value==='announcements-thread'?'Opens the configured announcements thread when available.':action.value==='changelog-thread'?'Opens the configured changelog thread when available.':'Link buttons open a public HTTPS destination.';row.querySelector('[data-button-action-help]').textContent=help+(incompatible?' Saved style/action combination is incompatible; choosing this action again will set the compatible style.':'');};
  action.addEventListener('change',()=>sync(true));sync();buttonLibrary.append(row);return row;
};
const readButtonDefinitions=()=>Array.from(buttonLibrary?.querySelectorAll('[data-button-definition]')??[]).map((row)=>{const displayedLabel=row.querySelector('[data-button-field="label"]').value;const unchanged=displayedLabel===row.dataset.initialDisplayLabel;return {id:row.dataset.buttonDefinition,label:unchanged?row.dataset.savedLabel:displayedLabel,emoji:unchanged?(row.dataset.savedEmoji||null):null,style:row.querySelector('[data-button-field="style"]').value,action:row.querySelector('[data-button-field="action"]').value,destination:row.querySelector('[data-button-field="destination"]').value||null,visible:row.querySelector('[data-button-field="visible"]').checked};});
const buttonDisplayLabel=(button)=>{const combined=(button.emoji?button.emoji+' ':'')+(button.label||'Button');return combined.replace(/^<a?:([A-Za-z0-9_]{2,32}):\d{17,20}>\s*/,':$1 ');};
const buttonActionLabel=(button)=>({connect:'Connect', 'map-rules':'Map & Rules','copy-address':'Copy Address','announcements-thread':'Announcements thread','changelog-thread':'Changelog thread','external-https-url':'External HTTPS URL'}[button.action]||button.action);
const buttonUsage=(id)=>{const usages=[];layoutNodes().forEach((node)=>{if(node.dataset.layoutElement==='button_row'){const n=Array.from(node._content.querySelectorAll('[data-row-button] select')).filter((s)=>s.value===id).length;if(n)usages.push((read(node,'label').value||'Button Row')+(n>1?' ×'+n:''));}else if((node.dataset.layoutElement==='text'||node.dataset.layoutElement==='section')&&read(node,'accessoryButtonId')?.value===id)usages.push((read(node,'label').value||node.dataset.layoutElement)+' accessory');});return usages;};
const buttonOptionLabel=(button)=>buttonDisplayLabel(button)+' · '+buttonActionLabel(button)+' · '+(button.style||'secondary')+' · '+(button.visible===false?'Disabled':'Enabled');
const buttonPlacementOptionLabel=(button,node)=>{const count=node.dataset.layoutElement==='button_row'?Array.from(node._content.querySelectorAll('[data-row-button] select')).filter((select)=>select.value===button.id).length:0;return buttonOptionLabel(button)+(count?' · Already in this row ×'+count:'');};
const refreshButtonLibrary=()=>{const defs=readButtonDefinitions();buttonDefinitions=defs;if(buttonLibraryCount)buttonLibraryCount.textContent=defs.length?' ('+defs.length+')':'';if(buttonLibraryEmpty)buttonLibraryEmpty.hidden=defs.length>0;defs.forEach((item)=>{const row=buttonLibrary?.querySelector('[data-button-definition="'+CSS.escape(item.id)+'"]');if(!row)return;const label=buttonDisplayLabel(item)||'Button';row.querySelector('[data-button-summary]').textContent=label+' · '+buttonActionLabel(item)+' · '+(item.style||'secondary')+' · '+(item.visible===false?'Disabled':'Enabled');row.querySelector('[data-button-usage]').textContent=buttonUsage(item.id).length?'Placed in: '+buttonUsage(item.id).join(', '):'Not placed yet.';const preview=row.querySelector('[data-button-preview]');preview.textContent=label;preview.className='preview-action preview-button-'+(item.style||'secondary');row.querySelector('[data-button-preview-action]').textContent=buttonActionLabel(item);row.querySelector('[data-button-move="up"]').disabled=!row.previousElementSibling;row.querySelector('[data-button-move="down"]').disabled=!row.nextElementSibling;row.querySelector('[data-button-move="up"]').setAttribute('aria-label','Move '+label+' up');row.querySelector('[data-button-move="down"]').setAttribute('aria-label','Move '+label+' down');const add=row.querySelector('[data-button-add-to-selected-row]');const selected=layoutNodes().find((n)=>n.dataset.layoutId===selectedLayoutId);add.hidden=selected?.dataset.layoutElement!=='button_row';});};
const addButtonDefinition=(button={})=>renderButtonDefinition({id:crypto.randomUUID(),label:'New button',emoji:null,style:'secondary',action:'copy-address',destination:null,visible:true,...button});
const restoreButtonLibrary=(buttons)=>{buttonDefinitions=Array.isArray(buttons)?structuredClone(buttons):[];buttonLibrary?.replaceChildren();buttonDefinitions.forEach(renderButtonDefinition);};
const refreshButtonReferences=()=>layoutNodes().forEach((node)=>{const accessory=read(node,'accessoryButtonId');const refresh=(select,includeNone)=>{const selected=select.value;select.replaceChildren();if(includeNone){const option=document.createElement('option');option.value='';option.textContent='None';select.append(option);}buttonDefinitions.forEach((button)=>{const option=document.createElement('option');option.value=button.id;option.textContent=buttonPlacementOptionLabel(button,node);select.append(option);});select.value=buttonDefinitions.some((button)=>button.id===selected)?selected:'';};if(accessory)refresh(accessory,true);node._content.querySelectorAll('[data-row-button] select').forEach((select)=>refresh(select,false));});
const syncFeedSeparator = (node) => {
  const separator=node._content.querySelector('[data-feed-separator]');const rows=feedRows(node);
  if(!separator)return;
  const enabled=read(node,'updatesSeparatorEnabled').checked;
  separator.hidden=!enabled;
  if(enabled&&rows[0])rows[0].after(separator);
};
const originalElements = new Map();
let activeLayoutHost = layoutEditors;
let selectedLayoutId = null;
let removed = null;
let initial = '';
const serializeForm=()=>{const entries=Array.from(new FormData(cardForm).entries());entries.sort(([left],[right])=>left.localeCompare(right));return new URLSearchParams(entries).toString();};
let initialLayout = null;
let invalidLayout = false;
let overComponentBudget = false;
let invalidButtonPlacement = false;
let submitted = Boolean(cardForm?.querySelector('[data-submitted-edits]'));
const selectionKey = 'office-card-element:' + window.location.pathname;
const escapeText = (value) => { const element = document.createElement('span');element.textContent=String(value);return element.innerHTML; };
const serializeElement = (node) => {
  const base = { id: node.dataset.layoutId, type: node.dataset.layoutElement, label: read(node,'label').value, visible: read(node,'visible').checked };
  if (base.type === 'text' || base.type === 'section') {
    Object.assign(base,{template:read(node,'template').value,style:read(node,'style').value,timestampMode:read(node,'timestampMode').value});
    if(base.type==='text') {
      const destination=read(node,'accessoryDestination').value;
      const buttonAccessory=read(node,'accessoryButtonId');
      if(destination!=='none'&&!buttonAccessory?.value) base.accessory={type:'thread_link',destination,enabled:read(node,'accessoryEnabled').checked,label:read(node,'accessoryLabel').value,visibility:read(node,'accessoryVisibility').value};
      base.conditionalVisibility={mode:read(node,'visibilityMode').value,source:read(node,'visibilitySource').value};
      base.emptyBehavior=read(node,'emptyBehavior').value;base.emptyText=read(node,'emptyText').value;base.previewLength=Number(read(node,'previewLength').value);
    }
    if(base.type === 'section') base.thumbnailUrl=read(node,'thumbnailUrl').value || null;
    const buttonAccessory=read(node,'accessoryButtonId');if(buttonAccessory?.value)base.accessoryButtonId=buttonAccessory.value;
  } else if(base.type === 'gallery') base.items=Array.from(node._content.querySelectorAll('[data-gallery-item]')).map((item)=>({id:item.dataset.itemId,source:item.querySelector('[data-layout-field="source"]').value,url:item.querySelector('[data-layout-field="url"]').value||null,description:item.querySelector('[data-layout-field="description"]').value}));
  else if(base.type === 'button_row') base.buttonIds=Array.from(node._content.querySelectorAll('[data-row-button]')).map((item)=>item.querySelector('select').value).filter(Boolean);
  else if(base.type === 'separator') Object.assign(base,{divider:read(node,'divider').checked,spacing:Number(read(node,'spacing').value)});
  else if(base.type === 'updates') { const field=(name)=>read(node,name); Object.assign(base,{showHeading:field('updatesShowHeading').checked,title:field('updatesTitle').value,headingStyle:field('headingStyle').value,feedOrder:feedRows(node).map((row)=>row.dataset.feedOrderItem),separator:{enabled:field('updatesSeparatorEnabled').checked,divider:field('updatesSeparatorDivider').checked,spacing:Number(field('updatesSeparatorSpacing').value)},emptyBehavior:field('emptyBehavior').value,announcements:{visible:field('announcementsVisible').checked,displayLabel:field('announcementsLabel').value,textStyle:field('announcementsStyle').value,emptyPlaceholder:field('announcementsEmpty').value,showTimestamp:field('announcementsTimestamp').checked,timestampMode:field('announcementsTimestampMode').value,showNew:field('announcementsNew').checked,showOpenButton:field('announcementsOpen').checked,openButtonLabel:field('announcementsButton').value,latestMessageLength:Number(field('announcementsLength').value)},changelog:{visible:field('changelogVisible').checked,displayLabel:field('changelogLabel').value,textStyle:field('changelogStyle').value,emptyPlaceholder:field('changelogEmpty').value,showTimestamp:field('changelogTimestamp').checked,timestampMode:field('changelogTimestampMode').value,showNew:field('changelogNew').checked,showOpenButton:field('changelogOpen').checked,openButtonLabel:field('changelogButton').value,latestMessageLength:Number(field('changelogLength').value)}}); }
  if(base.type==='updates'){
    base.blocks=updateBlockRows(node).map(serializeUpdateBlock);
    base.feedOrder=[...new Set([...base.blocks.filter((block)=>block.type==='feed').map((block)=>block.feed),'ANNOUNCEMENTS','CHANGELOG'])].slice(0,2);
  }
  return base;
};
const saveLayout = () => {
  if(!layoutJson||invalidLayout)return;
  const elements=layoutNodes().map(serializeElement);
  const placed=[];elements.forEach((element)=>{if(element.type==='button_row')placed.push(...element.buttonIds);if((element.type==='text'||element.type==='section')&&element.accessoryButtonId)placed.push(element.accessoryButtonId);});
  const definitionIds=readButtonDefinitions().map((button)=>button.id);
  invalidButtonPlacement=placed.some((id)=>!definitionIds.includes(id))||elements.some((element)=>element.type==='button_row'&&(element.buttonIds.length<1||element.buttonIds.length>5));
  let count=1;
  elements.forEach((element)=>{
    if(!element.visible)return;
    if(element.type==='section'||element.type==='actions'){count+=3;return;}
    if(element.type==='button_row'){const defs=readButtonDefinitions();count+=1+element.buttonIds.filter((id)=>defs.find((item)=>item.id===id)?.visible!==false).length;return;}
    if(element.type==='text'){count+=element.accessoryButtonId||element.accessory?.enabled?3:1;return;}
    if(element.type!=='updates'){count++;return;}
    (element.blocks||[]).forEach((block)=>{
      if(!block.visible)return;
      if(block.type==='heading'){if(element.showHeading)count++;return;}
      if(block.type==='feed'){const config=block.feed==='ANNOUNCEMENTS'?element.announcements:element.changelog;if(config.visible)count+=config.showOpenButton?4:2;return;}
      count++;
    });
  });
  overComponentBudget=count>40;
  layoutJson.value=JSON.stringify({version:3,buttons:readButtonDefinitions(),elements});
};
const announce = (text) => { const status=document.getElementById('card-layout-status');if(status) status.textContent=text; };
const refreshRows = () => {
  buttonDefinitions=readButtonDefinitions();
  layoutNodes().filter((node)=>node.dataset.layoutElement==='button_row').forEach((node)=>node._content.querySelectorAll('[data-row-button] select').forEach((select)=>{
    const selected=select.value;const options=buttonDefinitions.map((button)=>'<option value="'+button.id+'">'+escapeText(buttonPlacementOptionLabel(button,node))+'</option>').join('');select.innerHTML=options;select.value=selected;
  }));
  layoutNodes().forEach((node,index,nodes)=>{
    const selected=node.dataset.layoutId===selectedLayoutId;
    node.classList.toggle('is-selected',selected);
    const select=node.querySelector('[data-select-layout]'); select.setAttribute('aria-pressed',String(selected));
    const label=read(node,'label').value;node.querySelector('.card-layout-row-copy strong').textContent=({'Card description':'Description','Card currentMap':'Current map','Card serverAddress':'Connect command'}[label]||label||'Untitled element');
    const type=node.dataset.layoutElement;
    const summary=type==='text'||type==='section'?read(node,'template').value.replace(/\s+/g,' '):type==='gallery'?node._content.querySelectorAll('[data-gallery-item]').length+' image(s)':type==='button_row'?Array.from(node._content.querySelectorAll('[data-row-button] select')).map((select)=>buttonDefinitions.find((item)=>item.id===select.value)?.label||'Choose button').join(' → ')||'No buttons placed':type==='separator'?(read(node,'divider').checked?'Divider':'Spacing only')+' · '+(read(node,'spacing').value==='2'?'Large':'Small'):type==='updates'?Array.from(node._content.querySelectorAll('[data-feed-order-item]')).map((row)=>row.dataset.feedOrderItem==='ANNOUNCEMENTS'?'Announcements':'Changelog').join(' → '):'Connect and Map & Rules';
    node.querySelector('.card-layout-row-summary').textContent=(read(node,'visible').checked?'Visible · ':'Hidden · ')+summary;
    node.querySelector('[data-layout-move="up"]').disabled=index===0;
    node.querySelector('[data-layout-move="down"]').disabled=index===nodes.length-1;
    node.querySelector('[data-layout-remove]').disabled=nodes.length===1;
    node.querySelector('[data-layout-duplicate]').disabled=nodes.length>=35||type==='actions'||type==='button_row'||type==='updates';
    if(type==='button_row')node._content.querySelector('[data-row-buttons]')?.querySelectorAll('[data-row-button]').forEach((row,i,rows)=>{row.querySelector('[data-row-move="up"]').disabled=i===0;row.querySelector('[data-row-move="down"]').disabled=i===rows.length-1;});
    if(type==='gallery') {
      const items=Array.from(node._content.querySelectorAll('[data-gallery-item]'));
      items.forEach((item,i)=>{item.querySelector('legend').textContent='Image '+(i+1);item.querySelector('[data-gallery-move="up"]').disabled=i===0;item.querySelector('[data-gallery-move="down"]').disabled=i===items.length-1;item.querySelector('[data-gallery-remove]').disabled=items.length===1;});
      node._content.querySelector('[data-gallery-add]').disabled=items.length>=10;
    }
    if(type==='updates') {
      const blocks=updateBlockRows(node);
      blocks.forEach((block,i)=>{
        block.querySelector('[data-update-move="up"]').disabled=i===0;
        block.querySelector('[data-update-move="down"]').disabled=i===blocks.length-1;
        const duplicate=block.querySelector('[data-update-duplicate]');
        if(duplicate)duplicate.disabled=blocks.length>=25;
        const items=Array.from(block.querySelectorAll('[data-gallery-item]'));
        items.forEach((item,j)=>{
          item.querySelector('legend').textContent='Image '+(j+1);
          item.querySelector('[data-gallery-move="up"]').disabled=j===0;
          item.querySelector('[data-gallery-move="down"]').disabled=j===items.length-1;
          item.querySelector('[data-gallery-remove]').disabled=items.length===1;
        });
        const add=block.querySelector('[data-update-gallery-add]');
        if(add)add.disabled=items.length>=10;
      });
      node._content.querySelectorAll('[data-update-add]').forEach((button)=>{
        const kind=button.dataset.updateAdd;
        button.disabled=blocks.length>=25||(kind==='heading'&&blocks.some((b)=>b.dataset.updateBlock==='heading'))||
          (kind==='ANNOUNCEMENTS'||kind==='CHANGELOG')&&blocks.some((b)=>b.dataset.updateBlock==='feed'&&b.dataset.updateFeed===kind);
      });
      const rows=feedRows(node);
      rows.forEach((row,i)=>{row.querySelector('[data-feed-move="up"]').disabled=i===0;row.querySelector('[data-feed-move="down"]').disabled=i===rows.length-1;});
      syncFeedSeparator(node);
      const separatorEnabled=read(node,'updatesSeparatorEnabled').checked;
      node._content.querySelector('[data-add-updates-separator]').hidden=separatorEnabled;
      node._content.querySelector('[data-updates-separator-settings]').hidden=!separatorEnabled;
      const headingVisible=read(node,'updatesShowHeading').checked;
        node._content.querySelector('[data-updates-heading]').hidden=!headingVisible;
        read(node,'updatesTitle').required=headingVisible;
      for(const feed of ['announcements','changelog']){
        const key=feed==='announcements'?'ANNOUNCEMENTS':'CHANGELOG';
        const enabled=read(node,feed+'Visible').checked;
        const detail=node._content.querySelector('.updates-feed-settings[data-feed="'+key+'"]');
        if(detail)detail.hidden=!enabled;
        const open=read(node,feed+'Open').checked;
        const label=node._content.querySelector('[data-open-label="'+feed+'"]');
        if(label){label.hidden=!open;read(node,feed+'Button').required=open;}
      }
    }
  });
  cardForm?.querySelectorAll('[data-add-layout]').forEach((button)=>{button.disabled=invalidLayout||layoutNodes().length>=(button.dataset.addLayout==='updates'?33:35)||(button.dataset.addLayout==='actions'&&layoutNodes().some((node)=>node.dataset.layoutElement==='actions'));});
  refreshButtonLibrary();
};
const updateDirtyState = () => {
  if(!cardForm||!initial)return;
  saveLayout();
  const dirty=submitted||serializeForm()!==initial;
  cardForm.dataset.dirty=String(dirty);
  if(dirtyStatus)dirtyStatus.textContent=invalidLayout?(layoutJson?.dataset.savedLayoutInvalid==='true'&&!submitted?'Saved card layout is invalid. Restore defaults to recover; saving replaces the card layout.':'Submitted layout is invalid. Discard changes to reload saved configuration.'):overComponentBudget?'Discord allows at most 40 nested components. Hide or remove elements to save.':dirty?'Unsaved changes across the full configuration. Save changes to apply them.':'All changes saved.';
  const save=cardForm.querySelector('button[type="submit"]');if(save&&cardForm.dataset.saving!=='true')save.disabled=!dirty||invalidLayout||overComponentBudget||invalidButtonPlacement;
  const discard=cardForm.querySelector('[data-discard-server-changes]');if(discard)discard.disabled=!dirty;
  refreshRows();updateCardPreview();
};
const selectElement = (id, focus=false) => {
  const node=layoutNodes().find((node)=>node.dataset.layoutId===id);if(!node||!layoutProperties)return;
  const old=layoutNodes().find((node)=>node.dataset.layoutId===selectedLayoutId);
  if(old)old.append(old._content);
  selectedLayoutId=id;try{sessionStorage.setItem(selectionKey,id);}catch{}
  const heading=document.createElement('div');heading.className='card-layout-property-header';const title=document.createElement('h3');title.textContent='Element Properties';heading.append(title);
  layoutProperties.replaceChildren(heading,node._content);node._content.hidden=false;
  showPropertiesPanel('elements');refreshButtonLibrary();
  refreshRows();
  if(focus)node._content.querySelector('[data-layout-field="label"]')?.focus();
};
const newElement = (type) => {
  const base={id:crypto.randomUUID(),type,label:{text:'Text',section:'Text and thumbnail',gallery:'Image gallery',separator:'Separator',actions:'Action buttons',button_row:'Button Row',updates:'Community Updates'}[type],visible:true};
  if(type==='text'||type==='section')Object.assign(base,{template:'{servername}',style:'normal',timestampMode:'plain',...(type==='text'?{conditionalVisibility:{mode:'always',source:'ANNOUNCEMENTS'},emptyBehavior:'fallback',emptyText:'No updates yet.',previewLength:140}: {})});
  if(type==='section')base.thumbnailUrl=null;
  if(type==='button_row')base.buttonIds=buttonDefinitions.length?[buttonDefinitions[0].id]:[];
  if(type==='gallery')base.items=[{id:crypto.randomUUID(),source:'map',url:null,description:'{currentmap} map artwork'}];
  if(type==='separator')Object.assign(base,{divider:true,spacing:1});
  if(type==='updates')Object.assign(base,{blocks:[makeUpdateBlock('ANNOUNCEMENTS'),makeUpdateBlock('CHANGELOG')],showHeading:false,title:'Latest Updates',headingStyle:'normal',feedOrder:['ANNOUNCEMENTS','CHANGELOG'],separator:{enabled:false,divider:true,spacing:1},emptyBehavior:'show_placeholders',announcements:{visible:true,displayLabel:'Announcements',textStyle:'normal',emptyPlaceholder:'No announcements yet.',showTimestamp:true,timestampMode:'plain',showNew:false,showOpenButton:true,openButtonLabel:'Open',latestMessageLength:240},changelog:{visible:true,displayLabel:'Changelog',textStyle:'normal',emptyPlaceholder:'No changelog entries yet.',showTimestamp:true,timestampMode:'plain',showNew:false,showOpenButton:true,openButtonLabel:'Open',latestMessageLength:240}});
  return base;
};
const addGalleryItem = (node,item,holder=node._content.querySelector('[data-gallery-items]')) => {
  const fieldset=document.createElement('fieldset');fieldset.dataset.galleryItem='true';fieldset.dataset.itemId=item.id;
  fieldset.innerHTML='<legend>Image</legend><label>Image source<select data-layout-field="source"><option value="map">Automatic current map artwork</option><option value="fallback">Bundled fallback artwork</option><option value="custom">Custom HTTPS URL</option></select></label><label>Custom HTTPS URL<input data-layout-field="url" type="url" maxlength="500" placeholder="https://..."></label><label>Image description<input data-layout-field="description" maxlength="1024"></label><div class="card-layout-property-actions"><button type="button" class="secondary" data-gallery-move="up" aria-label="Move image up">Up</button><button type="button" class="secondary" data-gallery-move="down" aria-label="Move image down">Down</button><button type="button" class="danger" data-gallery-remove>Remove image</button></div>';
  for(const key of ['source','url','description'])fieldset.querySelector('[data-layout-field="'+key+'"]').value=item[key]??'';
  holder.append(fieldset);
};

/** Ordered child components; feed controls remain live and shared with the existing thread service. */
const makeUpdateBlock = (kind) => {
  const base = { id:crypto.randomUUID(), visible:true };
  if(kind==='heading')return {...base,type:'heading'};
  if(kind==='ANNOUNCEMENTS'||kind==='CHANGELOG')return {...base,type:'feed',feed:kind};
  if(kind==='text')return {...base,type:'text',template:'New update text',style:'normal',timestampMode:'plain'};
  if(kind==='separator')return {...base,type:'separator',divider:true,spacing:1};
  return {...base,type:'gallery',items:[{id:crypto.randomUUID(),source:'map',url:null,description:'{currentmap} map artwork'}]};
};
const resolveUpdateBlocks = (element) => {
  if(Array.isArray(element.blocks))return element.blocks;
  const blocks=[makeUpdateBlock('heading')];
  (element.feedOrder||['ANNOUNCEMENTS','CHANGELOG']).forEach((feed,index)=>{
    if(index&&element.separator?.enabled)blocks.push({...makeUpdateBlock('separator'),divider:element.separator.divider,spacing:element.separator.spacing});
    blocks.push(makeUpdateBlock(feed));
  });
  return blocks;
};
const serializeUpdateBlock = (row) => {
  const type=row.dataset.updateBlock;
  const base={id:row.dataset.updateBlockId,type,visible:row.querySelector('[data-block-field="visible"]').checked};
  const field=(name)=>row.querySelector('[data-block-field="'+name+'"]');
  if(type==='feed')base.feed=row.dataset.updateFeed;
  if(type==='text')Object.assign(base,{template:field('template').value,style:field('style').value,timestampMode:field('timestampMode').value});
  if(type==='separator')Object.assign(base,{divider:field('divider').checked,spacing:Number(field('spacing').value)});
  if(type==='gallery')base.items=Array.from(row.querySelectorAll('[data-gallery-item]')).map((item)=>({
    id:item.dataset.itemId,
    source:item.querySelector('[data-layout-field="source"]').value,
    url:item.querySelector('[data-layout-field="url"]').value||null,
    description:item.querySelector('[data-layout-field="description"]').value,
  }));
  return base;
};
const renderUpdateBlock = (node,block) => {
  const row=document.createElement('div');
  row.className='updates-block-row';
  row.dataset.updateBlock=block.type;
  row.dataset.updateBlockId=block.id;
  if(block.type==='feed')row.dataset.updateFeed=block.feed;
  const name=block.type==='feed'?(block.feed==='ANNOUNCEMENTS'?'Announcements':'Changelog'):
    ({heading:'Heading',text:'Text',separator:'Separator',gallery:'Gallery'}[block.type]||'Block');
  row.innerHTML='<div class="updates-block-row-header"><strong>'+name+'</strong>'+
    '<label class="checkbox"><input data-block-field="visible" type="checkbox"> Show</label>'+
    '<div class="updates-block-row-actions"><button type="button" class="secondary" data-update-move="up" aria-label="Move '+name+' up">↑</button>'+
    '<button type="button" class="secondary" data-update-move="down" aria-label="Move '+name+' down">↓</button>'+
    (block.type==='text'||block.type==='separator'||block.type==='gallery'?'<button type="button" class="secondary" data-update-duplicate>Duplicate</button>':'')+
    '<button type="button" class="danger" data-update-remove aria-label="Remove '+name+'">Remove</button></div></div>'+
    '<div class="updates-block-config"></div>';
  row.querySelector('[data-block-field="visible"]').checked=block.visible!==false;
  const config=row.querySelector('.updates-block-config');
  if(block.type==='heading')config.innerHTML='<p class="hint">Edit the heading text and style in Heading settings below. Drag its position using ↑ and ↓.</p>';
  if(block.type==='feed')config.innerHTML='<p class="hint">Edit the label, Open button and excerpt in '+name+' settings below.</p>';
  if(block.type==='text'){
    config.innerHTML='<div class="description-toolbar" role="group" aria-label="Updates text formatting">'+[['Bold','**'],['Italic','*'],['Underline','__'],['Strikethrough','~~'],['Inline code',String.fromCharCode(96)],['Spoiler','||']].map(([label,marker])=>'<button type="button" class="secondary" data-update-markdown="'+escapeText(marker)+'">'+label+'</button>').join('')+'<button type="button" class="secondary" data-update-clear-format>Clear formatting</button></div>'+
      '<label>Text content<textarea data-block-field="template" maxlength="500" rows="3"></textarea></label>'+
      '<label>Text style<select data-block-field="style"><option value="large">Large heading</option><option value="medium">Medium heading</option><option value="small">Small heading</option><option value="normal">Normal text</option><option value="subtext">Subtext</option></select></label>'+
      '<label>Timestamp style<select data-block-field="timestampMode"><option value="plain">Plain relative time</option><option value="discord_native">Discord native relative timestamp</option></select></label>'+
      '<label>Insert placeholder<select data-update-placeholder>'+placeholders.map(([name,description])=>'<option value="{'+name+'}">{'+name+'} — '+escapeText(description)+'</option>').join('')+'</select></label>'+
      '<button type="button" class="secondary" data-update-insert>Insert placeholder</button>';
    config.querySelector('[data-block-field="template"]').value=block.template||'';
    config.querySelector('[data-block-field="style"]').value=block.style||'normal';
    config.querySelector('[data-block-field="timestampMode"]').value=block.timestampMode||'plain';
  }
  if(block.type==='separator'){
    config.innerHTML='<label class="checkbox"><input data-block-field="divider" type="checkbox"> Visible divider (uncheck for spacing only)</label>'+
      '<label>Spacing<select data-block-field="spacing"><option value="1">Small</option><option value="2">Large</option></select></label>';
    config.querySelector('[data-block-field="divider"]').checked=block.divider===true;
    config.querySelector('[data-block-field="spacing"]').value=String(block.spacing||1);
  }
  if(block.type==='gallery'){
    config.innerHTML='<div data-gallery-items></div><button type="button" class="secondary" data-update-gallery-add>Add image</button>'+
      '<p class="hint">1–10 images. Choose automatic map artwork, fallback, or custom HTTPS image links.</p>';
    (block.items||[]).forEach((item)=>addGalleryItem(node,item,config.querySelector('[data-gallery-items]')));
  }
  node._content.querySelector('[data-updates-blocks]').append(row);
  return row;
};

const syncTextAccessory = (node) => {
  if(node?.dataset.layoutElement!=='text')return;
  const threadAccessory=node._content.querySelector('[data-thread-accessory]');
  if(threadAccessory)threadAccessory.hidden=Boolean(read(node,'accessoryButtonId')?.value);
};
const renderLayoutElement = (element) => {
  const node=document.createElement('div');node.className='card-layout-row';node.dataset.layoutElement=element.type;node.dataset.layoutId=element.id;
  const icon={text:'T',section:'▣',gallery:'▧',separator:'─',actions:'▤',updates:'↻'}[element.type]||'•';
  node.innerHTML='<button type="button" class="card-layout-row-main" data-select-layout aria-pressed="false"><span class="card-layout-row-icon" aria-hidden="true">'+icon+'</span><span class="card-layout-row-copy"><strong></strong><span class="card-layout-row-summary"></span></span></button><div class="card-layout-row-actions"><button type="button" class="secondary" data-layout-move="up" aria-label="Move element up">↑</button><button type="button" class="secondary" data-layout-move="down" aria-label="Move element down">↓</button><details class="layout-row-menu"><summary aria-label="Element actions">⋯</summary><div><button type="button" class="secondary" data-layout-duplicate>Duplicate</button><button type="button" class="danger" data-layout-remove>Remove</button></div></details></div>';
  const content=document.createElement('div');content.className='card-layout-content';content.hidden=true;node._content=content;
  content.innerHTML='<label>Friendly label<input data-layout-field="label" maxlength="80" required></label><label class="checkbox"><input type="checkbox" data-layout-field="visible"> Visible in Discord</label>';
  if(element.type==='text'||element.type==='section') {
    content.innerHTML+='<div class="description-toolbar" role="group" aria-label="Text formatting">'+[['Bold','**'],['Italic','*'],['Underline','__'],['Strikethrough','~~'],['Inline code',String.fromCharCode(96)],['Spoiler','||']].map(([label,marker])=>'<button type="button" class="secondary" data-layout-markdown="'+escapeText(marker)+'">'+label+'</button>').join('')+'<button type="button" class="secondary" data-layout-clear-format>Clear formatting</button></div><label>Text template<textarea data-layout-field="template" rows="6" maxlength="500"></textarea></label><label>Text style<select data-layout-field="style"><option value="normal">Normal text</option><option value="large">Large heading</option><option value="medium">Medium heading</option><option value="small">Small heading</option><option value="subtext">Subtext</option></select></label><label>Timestamp style<select data-layout-field="timestampMode"><option value="plain">Plain relative time</option><option value="discord_native">Discord native relative timestamp</option></select></label><label>Insert placeholder<select data-layout-placeholder>'+placeholders.map(([name,description])=>'<option value="{'+name+'}">{'+name+'} — '+escapeText(description)+'</option>').join('')+'</select></label><button type="button" class="secondary" data-layout-insert>Insert placeholder</button>';
  if(element.type==='text') content.innerHTML+='<fieldset data-thread-accessory><legend>Thread link accessory</legend><label>Destination<select data-layout-field="accessoryDestination"><option value="none">None</option><option value="ANNOUNCEMENTS">Announcements thread</option><option value="CHANGELOG">Changelog thread</option></select></label><label class="checkbox"><input type="checkbox" data-layout-field="accessoryEnabled"> Show Open button</label><label>Button label<input data-layout-field="accessoryLabel" maxlength="80"></label><label>Button visibility<select data-layout-field="accessoryVisibility"><option value="thread_exists">When thread exists</option><option value="message_exists">Only when a message exists</option><option value="never">Never</option></select></label></fieldset><fieldset><legend>Conditional visibility</legend><label>Show row<select data-layout-field="visibilityMode"><option value="always">Always</option><option value="thread_exists">When source thread exists</option><option value="message_exists">When source has a message</option><option value="any_update_visible">When any update message exists</option></select></label><label>Source<select data-layout-field="visibilitySource"><option value="ANNOUNCEMENTS">Announcements</option><option value="CHANGELOG">Changelog</option></select></label></fieldset><fieldset><legend>Empty messages</legend><label>When source is empty<select data-layout-field="emptyBehavior"><option value="fallback">Show fallback text</option><option value="hide">Hide row</option></select></label><label>Fallback text<input data-layout-field="emptyText" maxlength="240"></label><label>Maximum preview length<input data-layout-field="previewLength" type="number" min="40" max="1000" step="1"></label></fieldset>';
   if(element.type==='text'||element.type==='section') content.innerHTML+='<fieldset><legend>Right-side accessory</legend><label>Reusable button<select data-layout-field="accessoryButtonId"><option value="">None</option>'+buttonDefinitions.map((button)=>'<option value="'+button.id+'">'+escapeText(buttonDisplayLabel(button))+'</option>').join('')+'</select></label><p class="hint">Choose one accessory. A reusable button replaces the thread link; on a thumbnail Section it replaces the thumbnail.</p></fieldset>';
  }
  if(element.type==='button_row')content.innerHTML+='<fieldset><legend>Buttons · left to right</legend><div data-row-buttons></div><button type="button" class="secondary" data-row-button-add>Add button reference</button><p class="hint">Up to five buttons per row. Reorder them here with the arrow controls.</p></fieldset>';
  if(element.type==='section')content.innerHTML+='<label>Thumbnail HTTPS URL<input data-layout-field="thumbnailUrl" type="url" maxlength="500" placeholder="Use default server thumbnail"></label><p class="hint">Blank uses the thumbnail in Appearance. Convert to a text block to remove the thumbnail.</p><button type="button" class="secondary" data-layout-convert-text>Remove thumbnail / use text block</button>';
  if(element.type==='text'||element.type==='section')content.querySelector('[data-layout-field="accessoryButtonId"]')?.setAttribute('value',element.accessoryButtonId||'');
  if(element.type==='button_row'){
    const holder=content.querySelector('[data-row-buttons]');
     (element.buttonIds||[]).forEach((id)=>{const row=document.createElement('div');row.dataset.rowButton='true';row.innerHTML='<label>Button<select></select></label><button type="button" class="secondary" data-row-move="up" aria-label="Move button up">↑</button><button type="button" class="secondary" data-row-move="down" aria-label="Move button down">↓</button><button type="button" class="danger" data-row-remove>Remove</button>';const select=row.querySelector('select');buttonDefinitions.forEach((button)=>{const option=document.createElement('option');option.value=button.id;option.textContent=buttonDisplayLabel(button);select.append(option);});select.value=id;holder.append(row);});
  }
  if(element.type==='gallery')content.innerHTML+='<div data-gallery-items></div><button type="button" class="secondary" data-gallery-add>Add image</button><p class="hint">Automatic artwork follows the current map’s canonical asset, then your configured fallback in Appearance. Each gallery supports up to 10 images.</p>';
  if(element.type==='separator')content.innerHTML+='<label class="checkbox"><input type="checkbox" data-layout-field="divider"> Visible divider (disable for spacing only)</label><label>Native Discord spacing<select data-layout-field="spacing"><option value="1">Small</option><option value="2">Large</option></select></label>';
  if(element.type==='actions')content.innerHTML+='<p class="hint">This legacy fixed row is preserved. Remove it and add a Button Row to configure buttons independently.</p>';
  if(element.type==='updates')content.innerHTML+='<fieldset class="updates-block-builder"><legend>Updates element layout</legend><p class="hint">Arrange the heading, feeds, text, galleries and separators independently. Changes appear in the live preview.</p><div data-updates-blocks></div><div class="layout-add-actions" aria-label="Add Latest Updates element"><button type="button" class="secondary" data-update-add="text">+ Text</button><button type="button" class="secondary" data-update-add="separator">+ Separator</button><button type="button" class="secondary" data-update-add="gallery">+ Gallery</button><button type="button" class="secondary" data-update-add="heading">+ Heading</button><button type="button" class="secondary" data-update-add="ANNOUNCEMENTS">+ Announcements</button><button type="button" class="secondary" data-update-add="CHANGELOG">+ Changelog</button></div></fieldset><label class="checkbox"><input type="checkbox" data-layout-field="updatesShowHeading"> Show heading</label><div data-updates-heading><label>Heading text<input data-layout-field="updatesTitle" maxlength="80"></label><label>Heading style<select data-layout-field="headingStyle"><option value="normal">Normal</option><option value="heading">Heading</option><option value="subtext">Small text</option></select></label><button type="button" class="secondary" data-reset-heading>Restore heading defaults</button></div><label>When entries are empty<select data-layout-field="emptyBehavior"><option value="show_placeholders">Show configured placeholder</option><option value="hide_empty_entries">Hide empty row</option></select></label><fieldset class="updates-feed-order" hidden><legend>Feed order</legend>'+['ANNOUNCEMENTS','CHANGELOG'].map((feed)=>'<div class="updates-feed-order-row" data-feed-order-item="'+feed+'"><strong>'+(feed==='ANNOUNCEMENTS'?'Announcements':'Changelog')+'</strong><label class="checkbox"><input type="checkbox" data-layout-field="'+feed.toLowerCase()+'Visible"> Show</label><div><button type="button" class="secondary" data-feed-move="up" data-feed="'+feed+'" aria-label="Move '+feed+' up">↑</button><button type="button" class="secondary" data-feed-move="down" data-feed="'+feed+'" aria-label="Move '+feed+' down">↓</button></div></div>').join('')+'<div class="updates-feed-separator" data-feed-separator hidden><span aria-hidden="true">─</span><strong>Separator</strong><span>Between feed rows</span></div><button type="button" class="secondary" data-add-updates-separator>Add separator</button><button type="button" class="secondary" data-reset-feed-order>Restore default row order</button></fieldset><fieldset data-updates-separator-settings hidden><legend>Separator</legend><input type="checkbox" data-layout-field="updatesSeparatorEnabled" hidden><label class="checkbox"><input type="checkbox" data-layout-field="updatesSeparatorDivider"> Visible divider</label><label>Native Discord spacing<select data-layout-field="updatesSeparatorSpacing"><option value="1">Small</option><option value="2">Large</option></select></label><button type="button" class="secondary" data-remove-updates-separator>Remove separator</button></fieldset>'+['announcements','changelog'].map((feed)=>'<details class="updates-feed-settings" data-feed="'+feed.toUpperCase()+'"><summary>'+(feed==='announcements'?'Announcements':'Changelog')+' settings</summary><div class="card-layout-content"><label>Display label<input data-layout-field="'+feed+'Label" maxlength="80" required></label><label class="checkbox"><input type="checkbox" data-layout-field="'+feed+'Open"> Show Open button</label><label data-open-label="'+feed+'">Open button label<input data-layout-field="'+feed+'Button" maxlength="80" required></label><details class="updates-advanced"><summary>Advanced formatting</summary><div class="card-layout-content"><label>Message excerpt style<select data-layout-field="'+feed+'Style"><option value="normal">Normal</option><option value="heading">Heading</option><option value="subtext">Small text</option></select></label><label>Empty row text<input data-layout-field="'+feed+'Empty" maxlength="240"></label><label class="checkbox"><input type="checkbox" data-layout-field="'+feed+'Timestamp"> Show timestamp</label><label>Timestamp style<select data-layout-field="'+feed+'TimestampMode"><option value="plain">Plain relative time</option><option value="discord_native">Discord native relative timestamp</option></select></label><label class="checkbox"><input type="checkbox" data-layout-field="'+feed+'New"> Show NEW indicator</label><label>Maximum excerpt length<input data-layout-field="'+feed+'Length" type="number" min="40" max="1000" step="1"></label></div></details><button type="button" class="secondary" data-reset-feed="'+feed+'">Restore '+(feed==='announcements'?'Announcements':'Changelog')+' defaults</button></div></details>').join('');
  content.innerHTML+='<div class="card-layout-property-actions"><button type="button" class="secondary" data-layout-restore>Restore element</button></div>';
  for(const key of ['label','template','style','timestampMode','thumbnailUrl','spacing']){const control=read(node,key);if(control)control.value=element[key]??'';}
  for(const key of ['visible','divider']){const control=read(node,key);if(control)control.checked=element[key]===true;}
  if(element.type==='text'){
    const accessory=element.accessory||{};const set=(key,value)=>{const control=read(node,key);if(!control)return;if(control.type==='checkbox')control.checked=value===true;else control.value=String(value??'');};
    set('accessoryDestination',accessory.destination||'none');set('accessoryEnabled',accessory.enabled===true);set('accessoryLabel',accessory.label||'Open');set('accessoryVisibility',accessory.visibility||'thread_exists');set('visibilityMode',element.conditionalVisibility?.mode||'always');set('visibilitySource',element.conditionalVisibility?.source||'ANNOUNCEMENTS');set('emptyBehavior',element.emptyBehavior||'fallback');set('emptyText',element.emptyText||'No updates yet.');set('previewLength',element.previewLength||140);
  }
  if(element.type==='text'||element.type==='section'){const control=read(node,'accessoryButtonId');if(control)control.value=element.accessoryButtonId||'';}
  syncTextAccessory(node);
  if(element.type==='gallery')(element.items??[]).forEach((item)=>addGalleryItem(node,item));
  if(element.type==='updates'){const set=(key,value)=>{const control=read(node,key);if(control){if(control.type==='checkbox')control.checked=value===true;else control.value=String(value??'');}};set('updatesShowHeading',element.showHeading);set('updatesTitle',element.title);set('headingStyle',element.headingStyle);set('emptyBehavior',element.emptyBehavior);set('updatesSeparatorEnabled',element.separator?.enabled);set('updatesSeparatorDivider',element.separator?.divider);set('updatesSeparatorSpacing',element.separator?.spacing??1);for(const [feed,key] of [['announcements','announcements'],['changelog','changelog']]){const config=element[key];for(const [suffix,property] of [['Visible','visible'],['Label','displayLabel'],['Style','textStyle'],['Empty','emptyPlaceholder'],['Timestamp','showTimestamp'],['TimestampMode','timestampMode'],['New','showNew'],['Open','showOpenButton'],['Button','openButtonLabel'],['Length','latestMessageLength']])set(feed+suffix,config[property]);}for(const feed of element.feedOrder??['ANNOUNCEMENTS','CHANGELOG']){const row=node._content.querySelector('[data-feed-order-item="'+feed+'"]');if(row)node._content.querySelector('.updates-feed-order').append(row);}syncFeedSeparator(node);resolveUpdateBlocks(element).forEach((block)=>renderUpdateBlock(node,block));}
  node.append(content);activeLayoutHost.append(node);return node;
};
const rebuild = (layout, selected=selectedLayoutId) => {
  const staging=document.createElement('div');const previousHost=activeLayoutHost;activeLayoutHost=staging;
  try{layout.elements.forEach(renderLayoutElement);}catch(error){activeLayoutHost=previousHost;throw error;}
  activeLayoutHost=previousHost;layoutEditors.replaceChildren(...Array.from(staging.children));layoutProperties.replaceChildren();selectedLayoutId=null;
  selectElement(layoutNodes().some((node)=>node.dataset.layoutId===selected)?selected:layoutNodes()[0]?.dataset.layoutId);
  refreshRows();saveLayout();
};
const previewIcon = (state, mode) => {
  const kind = mode === 'current' && state !== 'pending' && state !== 'stale' && previewRoot?.dataset.gameplayState === 'DEGRADED' ? 'warning' : state === 'online' ? 'online' : state === 'offline' || state === 'unavailable' ? 'offline' : state === 'pending' ? 'pending' : 'warning';
  const id = inputValue(kind + 'EmojiId');
  const inherited = previewRoot?.dataset[kind + 'Emoji'] ?? '';
  return /^\d{17,20}$/.test(id) ? '<:' + kind + '_dot:' + id + '>' : inherited || '•';
};

${cardPreviewScript}
const refreshUndo = () => {
  const holder=document.getElementById('card-layout-undo');if(!holder)return;
  holder.replaceChildren();if(!removed)return;
  holder.className='card-layout-undo';holder.append(document.createTextNode('Element removed. '));const undo=document.createElement('button');undo.type='button';undo.className='secondary';undo.dataset.layoutUndo='true';undo.textContent='Undo removal';undo.disabled=layoutNodes().length>=35;holder.append(undo);
};
cardForm?.addEventListener('click',(event)=>{
  if(!(event.target instanceof Element))return;
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.propertiesTab){showPropertiesPanel(button.dataset.propertiesTab);return;}
  const node=button.closest('[data-layout-element]')||layoutNodes().find((item)=>item.dataset.layoutId===selectedLayoutId);
  if(button.hasAttribute('data-button-add')){showPropertiesPanel('buttons');const row=addButtonDefinition();buttonDefinitions=readButtonDefinitions();refreshButtonReferences();updateDirtyState();row.querySelector('[data-button-field="label"]').focus();return;}
  const buttonDefinition=button.closest('[data-button-definition]');
  if(buttonDefinition&&button.dataset.buttonMove){const sibling=button.dataset.buttonMove==='up'?buttonDefinition.previousElementSibling:buttonDefinition.nextElementSibling;if(sibling){if(button.dataset.buttonMove==='up')buttonDefinition.parentElement.insertBefore(buttonDefinition,sibling);else buttonDefinition.parentElement.insertBefore(sibling,buttonDefinition);}refreshButtonReferences();updateDirtyState();button.focus();return;}
  if(buttonDefinition&&button.hasAttribute('data-button-create-row')){const definition=readButtonDefinitions().find((item)=>item.id===buttonDefinition.dataset.buttonDefinition);const element=newElement('button_row');element.label=buttonDisplayLabel(definition);element.buttonIds=[definition.id];const added=renderLayoutElement(element);layoutEditors.insertBefore(added,layoutNodes()[layoutNodes().length-1]||null);selectElement(added.dataset.layoutId,true);announce('Button Row created.');return;}
  if(buttonDefinition&&button.hasAttribute('data-button-add-to-selected-row')){const target=layoutNodes().find((item)=>item.dataset.layoutId===selectedLayoutId&&item.dataset.layoutElement==='button_row');const holder=target?._content.querySelector('[data-row-buttons]');if(holder&&holder.children.length<5){const item=document.createElement('div');item.dataset.rowButton='true';item.innerHTML='<label>Reusable button placement<select></select></label><button type="button" class="secondary" data-row-move="up" aria-label="Move button up">↑</button><button type="button" class="secondary" data-row-move="down" aria-label="Move button down">↓</button><button type="button" class="danger" data-row-remove>Remove placement</button>';holder.append(item);refreshRows();const select=item.querySelector('select');select.value=buttonDefinition.dataset.buttonDefinition;updateDirtyState();return;}announce('Select a Button Row with fewer than five placements.');return;}
  if(buttonDefinition&&button.hasAttribute('data-button-remove')){const removedId=buttonDefinition.dataset.buttonDefinition;buttonDefinition.remove();layoutNodes().forEach((layoutNode)=>{const accessory=read(layoutNode,'accessoryButtonId');if(accessory?.value===removedId)accessory.value='';layoutNode._content.querySelectorAll('[data-row-button]').forEach((row)=>{if(row.querySelector('select').value===removedId)row.remove();});});buttonDefinitions=readButtonDefinitions();refreshButtonReferences();updateDirtyState();updateCardPreview();return;}
  if(buttonDefinition&&button.hasAttribute('data-button-duplicate')){const copy=readButtonDefinitions().find((item)=>item.id===buttonDefinition.dataset.buttonDefinition);if(copy){copy.id=crypto.randomUUID();copy.label=copy.label+' copy';const added=renderButtonDefinition(copy);buttonDefinition.after(added);buttonDefinitions=readButtonDefinitions();refreshButtonReferences();}updateDirtyState();return;}
  const rowButton=button.closest('[data-row-button]');
  if(rowButton&&button.hasAttribute('data-row-remove')){rowButton.remove();refreshRows();updateDirtyState();return;}
  if(rowButton&&button.dataset.rowMove){const sibling=button.dataset.rowMove==='up'?rowButton.previousElementSibling:rowButton.nextElementSibling;if(sibling){if(button.dataset.rowMove==='up')rowButton.parentElement.insertBefore(rowButton,sibling);else rowButton.parentElement.insertBefore(sibling,rowButton);}refreshRows();updateDirtyState();return;}
  if(button.hasAttribute('data-row-button-add')&&node){const holder=node._content.querySelector('[data-row-buttons]');if(!holder||holder.children.length>=5||!buttonDefinitions.length)return;const row=document.createElement('div');row.dataset.rowButton='true';row.innerHTML='<label>Reusable button placement<select></select></label><button type="button" class="secondary" data-row-move="up" aria-label="Move placement up">↑</button><button type="button" class="secondary" data-row-move="down" aria-label="Move placement down">↓</button><button type="button" class="danger" data-row-remove>Remove placement</button>';const select=row.querySelector('select');buttonDefinitions.forEach((item)=>{const option=document.createElement('option');option.value=item.id;option.textContent=buttonOptionLabel(item);select.append(option);});holder.append(row);refreshRows();updateDirtyState();return;}
  if(button.dataset.updateAdd&&node){const blocks=updateBlockRows(node);const kind=button.dataset.updateAdd;if(blocks.length>=25||((kind==='heading'||kind==='ANNOUNCEMENTS'||kind==='CHANGELOG')&&blocks.some((b)=>b.dataset.updateBlock===(kind==='heading'?'heading':'feed')&&(kind==='heading'||b.dataset.updateFeed===kind))))return;renderUpdateBlock(node,makeUpdateBlock(kind));announce('Updates element added.');}
  else if(button.dataset.updateMove&&node){const block=button.closest('[data-update-block]');if(!block)return;const sibling=button.dataset.updateMove==='up'?block.previousElementSibling:block.nextElementSibling;if(sibling){if(button.dataset.updateMove==='up')block.parentElement.insertBefore(block,sibling);else block.parentElement.insertBefore(sibling,block);announce('Updates element moved.');}button.focus();}
  else if(button.hasAttribute('data-update-remove')&&node){button.closest('[data-update-block]')?.remove();announce('Updates element removed.');}
  else if(button.hasAttribute('data-update-duplicate')&&node){if(updateBlockRows(node).length>=25)return;const block=button.closest('[data-update-block]');if(!block||!['text','separator','gallery'].includes(block.dataset.updateBlock))return;const clone=serializeUpdateBlock(block);clone.id=crypto.randomUUID();if(clone.items)clone.items=clone.items.map((item)=>({...item,id:crypto.randomUUID()}));const added=renderUpdateBlock(node,clone);block.after(added);announce('Updates element duplicated.');}
  else if(button.hasAttribute('data-update-clear-format')&&node){const block=button.closest('[data-update-block]');const control=block?.querySelector('[data-block-field="template"]');if(control&&applyTemplateFormatting(control,'',true)){control.focus();control.dispatchEvent(new Event('input',{bubbles:true}));}}
  else if((button.hasAttribute('data-update-insert')||button.dataset.updateMarkdown)&&node){
    const block=button.closest('[data-update-block]');const control=block?.querySelector('[data-block-field="template"]');if(!control)return;
    const start=control.selectionStart,end=control.selectionEnd,marker=button.dataset.updateMarkdown;
    const insertion=marker?marker+(control.value.slice(start,end)||'text')+marker:block.querySelector('[data-update-placeholder]').value;
    if(control.value.length-(end-start)+insertion.length>500){announce('Text would exceed 500 characters.');return;}
    if(marker)applyTemplateFormatting(control,marker);else control.setRangeText(insertion,start,end,'end');control.focus();control.dispatchEvent(new Event('input',{bubbles:true}));
  }
  else if(button.hasAttribute('data-update-gallery-add')&&node){const block=button.closest('[data-update-block]');const holder=block?.querySelector('[data-gallery-items]');if(holder&&holder.children.length<10)addGalleryItem(node,makeUpdateBlock('gallery').items[0],holder);}
  else if(button.hasAttribute('data-select-layout')){selectElement(node.dataset.layoutId);if(window.innerWidth<=760)layoutProperties.scrollIntoView({block:'start'});return;}
  if(button.dataset.addLayout){const type=button.dataset.addLayout;const preset=type==='updates';if(layoutNodes().length>=(preset?33:35)||invalidLayout||(type==='actions'&&layoutNodes().some((n)=>n.dataset.layoutElement==='actions')))return;const menu=button.closest('.layout-add-menu');if(menu)menu.open=false;if(preset){const rows=[{label:'Announcement preview',template:'{announcements.preview}',feed:'ANNOUNCEMENTS',fallback:'No announcements yet.'},{label:'Changelog preview',template:'{changelog.preview}',feed:'CHANGELOG',fallback:'No changelog entries yet.'}];let added;for(const row of rows){const element=newElement('text');element.label=row.label;element.template=row.template;if(row.feed){element.accessory={type:'thread_link',destination:row.feed,enabled:true,label:'Open',visibility:'thread_exists'};element.emptyText=row.fallback;element.conditionalVisibility={mode:'always',source:row.feed};}added=renderLayoutElement(element);}selectElement(added.dataset.layoutId,true);announce('Community Updates text rows added. Each row can be moved and edited independently.');}else{const added=renderLayoutElement(newElement(type));selectElement(added.dataset.layoutId,true);announce('Element added.');}}
  else if(button.dataset.layoutMove&&node){const next=button.dataset.layoutMove==='up'?node.previousElementSibling:node.nextElementSibling;if(next){if(button.dataset.layoutMove==='up')layoutEditors.insertBefore(node,next);else layoutEditors.insertBefore(next,node);announce('Element moved.');}node.querySelector('[data-layout-move="'+button.dataset.layoutMove+'"]').focus();}
  else if(button.hasAttribute('data-reset-heading')&&node){const defaults=newElement('updates');read(node,'updatesShowHeading').checked=defaults.showHeading;read(node,'updatesTitle').value=defaults.title;read(node,'headingStyle').value=defaults.headingStyle;refreshRows();announce('Heading defaults restored.');}
  else if(button.hasAttribute('data-add-updates-separator')&&node){read(node,'updatesSeparatorEnabled').checked=true;refreshRows();announce('Separator added between Community Updates feeds.');}
  else if(button.hasAttribute('data-remove-updates-separator')&&node){read(node,'updatesSeparatorEnabled').checked=false;refreshRows();announce('Community Updates separator removed.');}
  else if(button.dataset.resetFeed&&node){const defaults=newElement('updates')[button.dataset.resetFeed];const prefix=button.dataset.resetFeed;for(const [suffix,property] of [['Visible','visible'],['Label','displayLabel'],['Style','textStyle'],['Empty','emptyPlaceholder'],['Timestamp','showTimestamp'],['TimestampMode','timestampMode'],['New','showNew'],['Open','showOpenButton'],['Button','openButtonLabel'],['Length','latestMessageLength']]){const control=read(node,prefix+suffix);if(control.type==='checkbox')control.checked=defaults[property]===true;else control.value=String(defaults[property]??'');}refreshRows();announce('Feed defaults restored.');}
  else if(button.hasAttribute('data-reset-feed-order')&&node){for(const feed of ['ANNOUNCEMENTS','CHANGELOG']){const row=node._content.querySelector('[data-feed-order-item="'+feed+'"]');node._content.querySelector('.updates-feed-order').append(row);}syncFeedSeparator(node);refreshRows();announce('Default feed order restored.');}
  else if(button.dataset.feedMove&&node){const row=button.closest('[data-feed-order-item]');const rows=feedRows(node);const index=rows.indexOf(row);const next=rows[button.dataset.feedMove==='up'?index-1:index+1];if(next){if(button.dataset.feedMove==='up')row.parentElement.insertBefore(row,next);else row.parentElement.insertBefore(next,row);syncFeedSeparator(node);announce('Community Updates feed order changed.');}button.focus();refreshRows();}
  else if(button.hasAttribute('data-layout-duplicate')&&node){if(layoutNodes().length>=35||node.dataset.layoutElement==='actions'||node.dataset.layoutElement==='updates')return;const copy=serializeElement(node);copy.id=crypto.randomUUID();copy.label=(copy.label+' copy').slice(0,80);if(copy.items)copy.items=copy.items.map((item)=>({...item,id:crypto.randomUUID()}));const added=renderLayoutElement(copy);layoutEditors.insertBefore(added,node.nextElementSibling);selectElement(added.dataset.layoutId);announce('Element duplicated.');}
  else if(button.hasAttribute('data-layout-remove')&&node){if(layoutNodes().length<=1)return;removed={element:serializeElement(node),index:layoutNodes().indexOf(node)};const next=node.nextElementSibling||node.previousElementSibling;node.remove();if(node.dataset.layoutId===selectedLayoutId){selectedLayoutId=null;selectElement(next.dataset.layoutId);}refreshUndo();announce('Element removed. Undo is available.');}
  else if(button.hasAttribute('data-layout-undo')&&removed){if(layoutNodes().length>=35)return;const next=layoutNodes()[removed.index];const added=renderLayoutElement(removed.element);if(next)layoutEditors.insertBefore(added,next);removed=null;refreshUndo();selectElement(added.dataset.layoutId);announce('Removal undone.');}
  else if(button.hasAttribute('data-gallery-add')&&node){if(node._content.querySelectorAll('[data-gallery-item]').length>=10)return;addGalleryItem(node,newElement('gallery').items[0]);}
  else if((button.dataset.galleryMove||button.hasAttribute('data-gallery-remove'))&&node){const item=button.closest('[data-gallery-item]');if(!item)return;const holder=item.parentElement;if(button.hasAttribute('data-gallery-remove')){if(holder.children.length>1)item.remove();}else{const next=button.dataset.galleryMove==='up'?item.previousElementSibling:item.nextElementSibling;if(next){if(button.dataset.galleryMove==='up')holder.insertBefore(item,next);else holder.insertBefore(next,item);}}}
  else if(button.hasAttribute('data-layout-clear-format')){const control=read(node,'template');if(applyTemplateFormatting(control,'',true)){control.focus();control.dispatchEvent(new Event('input',{bubbles:true}));}}
  else if(button.hasAttribute('data-layout-insert')||button.dataset.layoutMarkdown){const control=read(node,'template');const start=control.selectionStart,end=control.selectionEnd;const marker=button.dataset.layoutMarkdown;const insertion=marker?marker+(control.value.slice(start,end)||'text')+marker:node._content.querySelector('[data-layout-placeholder]').value;if(control.value.length-(end-start)+insertion.length>500){announce('Formatting would exceed the 500-character template limit.');return;}if(marker)applyTemplateFormatting(control,marker);else control.setRangeText(insertion,start,end,'end');control.focus();control.dispatchEvent(new Event('input',{bubbles:true}));}
  else if(button.hasAttribute('data-layout-restore')&&node){const original=originalElements.get(node.dataset.layoutId)||{...newElement(node.dataset.layoutElement),id:node.dataset.layoutId};const index=layoutNodes().indexOf(node);const selected=node.dataset.layoutId;const added=renderLayoutElement(original);node.remove();layoutEditors.insertBefore(added,layoutNodes()[index]||null);selectElement(selected);announce('Element restored.');}
  else if(button.hasAttribute('data-layout-convert-text')&&node){const element=serializeElement(node);element.type='text';delete element.thumbnailUrl;const index=layoutNodes().indexOf(node);const added=renderLayoutElement(element);node.remove();layoutEditors.insertBefore(added,layoutNodes()[index]||null);selectElement(element.id);}
  else if(button.hasAttribute('data-reset-card-profile')){let defaults,layout;try{defaults=JSON.parse(button.dataset.defaults);layout=JSON.parse(button.dataset.defaultLayout);}catch{return;}for(const[name,value]of Object.entries(defaults)){const control=formControl(name);if(control?.type==='checkbox'){control.value='1';control.checked=value===true;}else if(control)control.value=String(value);}restoreButtonLibrary(layout.buttons);invalidLayout=false;layoutJson.dataset.layoutValid='true';layoutJson.dataset.savedLayoutInvalid='false';rebuild(layout);removed=null;refreshUndo();announce('Card defaults restored. Save to replace the current card layout.');}
  else if(button.hasAttribute('data-discard-server-changes')){if(submitted){cardForm.dataset.dirty='false';window.location.reload();return;}cardForm.reset();invalidLayout=initialLayout===null;if(initialLayout){restoreButtonLibrary(initialLayout.buttons);rebuild(initialLayout);}removed=null;refreshUndo();announce('Unsaved changes discarded.');}
  else if(button.hasAttribute('data-expand-preview')){const expanded=previewRoot.classList.toggle('is-expanded');button.setAttribute('aria-expanded',String(expanded));button.textContent=expanded?'Narrow preview':'Widen preview';previewRoot.scrollIntoView({block:'start'});return;}
  else return;
  refreshRows();refreshUndo();updateDirtyState();
});
cardForm?.addEventListener('invalid',(event)=>{
  const control=event.target;if(!(control instanceof HTMLInputElement||control instanceof HTMLTextAreaElement||control instanceof HTMLSelectElement))return;
  event.preventDefault();const node=layoutNodes().find((node)=>node._content.contains(control));if(node)selectElement(node.dataset.layoutId);
  let parent=control.parentElement;while(parent&&parent!==cardForm){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}
  control.focus();announce(control.validationMessage||'Review the selected field before saving.');
},true);
cardForm?.addEventListener('input',updateDirtyState);
cardForm?.addEventListener('change',(event)=>{if(event.target?.id==='card-preview-mode'){updateCardPreview();return;}const node=event.target?.closest?.('[data-layout-element]');if(event.target?.matches?.('[data-layout-field="accessoryButtonId"]'))syncTextAccessory(node);updateDirtyState();});
window.addEventListener('beforeunload',(event)=>{if(cardForm?.dataset.dirty!=='true'||cardForm?.dataset.saving==='true')return;event.preventDefault();event.returnValue='';});
cardForm?.addEventListener('submit',(event)=>{if(invalidLayout){event.preventDefault();announce('Invalid layout data. Discard the malformed draft before saving.');return;}saveLayout();if(invalidButtonPlacement){event.preventDefault();announce('Every placement must reference an existing button. Button Rows can contain one to five placements.');return;}if(overComponentBudget){event.preventDefault();announce('Too many Discord components. Hide or remove elements before saving.');return;}cardForm.dataset.saving='true';const save=cardForm.querySelector('button[type="submit"]');save.disabled=true;save.textContent='Saving…';if(dirtyStatus)dirtyStatus.textContent='Saving changes…';});
const sectionLinks=Array.from(document.querySelectorAll('.game-server-section-nav a'));
const updateActiveSection=()=>sectionLinks.forEach((link)=>{if(link.hash===(window.location.hash||'#server-settings'))link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});
window.addEventListener('hashchange',updateActiveSection);updateActiveSection();
const fitPreview=()=>{if(previewRoot)previewRoot.dataset.tall=String(previewRoot.getBoundingClientRect().height>window.innerHeight-220);};
if(previewRoot){new ResizeObserver(fitPreview).observe(previewRoot);window.addEventListener('resize',fitPreview);fitPreview();}
if(layoutEditors&&layoutJson){
  try{if(layoutJson.dataset.layoutValid!=='true')throw new Error('Invalid layout');const persisted=JSON.parse(layoutJson.value);const elements=Array.isArray(persisted)?persisted:persisted.elements;if(!Array.isArray(elements)||!elements.length||elements.length>35)throw new Error('Invalid layout');restoreButtonLibrary(persisted.buttons);initialLayout={version:3,buttons:buttonDefinitions,elements};elements.forEach((element)=>originalElements.set(element.id,structuredClone(element)));let selected;try{selected=sessionStorage.getItem(selectionKey);}catch{}rebuild(initialLayout,selected);}
  catch(error){console.error('Card Designer layout initialization failed',error);invalidLayout=true;layoutJson.dataset.layoutValid='false';const savedInvalid=layoutJson.dataset.savedLayoutInvalid==='true'&&!submitted;layoutProperties.textContent=savedInvalid?'The saved card layout is invalid and is preserved. Restore card defaults to recover; saving replaces the entire card layout.':'The submitted layout is invalid and is preserved. Discard changes to reload the saved configuration.';announce(savedInvalid?'Saved layout is invalid. Restore card defaults to recover.':'Invalid submitted draft preserved. Discard changes to reload the saved configuration.');}
  initial=serializeForm();updateDirtyState();
}
`;
