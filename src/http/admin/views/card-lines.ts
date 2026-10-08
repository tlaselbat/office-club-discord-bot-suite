import { resolveCardTemplate, styleCardLine } from '../../../modules/game-servers/renderer.js';
import { CARD_PLACEHOLDERS } from '../../../modules/game-servers/card-profile.js';
import { cardPreviewScript } from './card-preview.js';

/** One set of authoritative element controls; selecting a row moves its controls into the panel. */
export const cardLineScript = String.raw`
const resolveLineTemplate = ${resolveCardTemplate.toString()};
const styleLineText = ${styleCardLine.toString()};
const placeholders = ${JSON.stringify(CARD_PLACEHOLDERS)};
const layoutEditors = document.getElementById('card-layout-editors');
const layoutProperties = document.getElementById('card-layout-properties');
const layoutJson = document.getElementById('card-layout-json');
const previewRoot = document.getElementById('card-template-preview');
const cardForm = layoutEditors?.closest('form');
const dirtyStatus = document.getElementById('card-config-dirty-status');
const formControl = (name) => cardForm?.querySelector('[name="' + name + '"]');
const inputValue = (name, fallback = '') => formControl(name)?.value ?? fallback;
const layoutNodes = () => Array.from(layoutEditors?.querySelectorAll('[data-layout-element]') ?? []);
const read = (node, field) => node._content.querySelector('[data-layout-field="' + field + '"]');
const originalElements = new Map();
let selectedLayoutId = null;
let removed = null;
let initial = '';
let initialLayout = null;
let invalidLayout = false;
let submitted = Boolean(cardForm?.querySelector('[data-submitted-edits]'));
const selectionKey = 'office-card-element:' + window.location.pathname;
const escapeText = (value) => { const element = document.createElement('span');element.textContent=String(value);return element.innerHTML; };
const serializeElement = (node) => {
  const base = { id: node.dataset.layoutId, type: node.dataset.layoutElement, label: read(node,'label').value, visible: read(node,'visible').checked };
  if (base.type === 'text' || base.type === 'section') {
    Object.assign(base,{template:read(node,'template').value,style:read(node,'style').value});
    if(base.type === 'section') base.thumbnailUrl=read(node,'thumbnailUrl').value || null;
  } else if(base.type === 'gallery') base.items=Array.from(node._content.querySelectorAll('[data-gallery-item]')).map((item)=>({id:item.dataset.itemId,source:item.querySelector('[data-layout-field="source"]').value,url:item.querySelector('[data-layout-field="url"]').value||null,description:item.querySelector('[data-layout-field="description"]').value}));
  else if(base.type === 'separator') Object.assign(base,{divider:read(node,'divider').checked,spacing:Number(read(node,'spacing').value)});
  else if(base.type === 'updates') { const field=(name)=>read(node,name); Object.assign(base,{title:field('updatesTitle').value,headingStyle:field('headingStyle').value,emptyBehavior:field('emptyBehavior').value,announcements:{visible:field('announcementsVisible').checked,displayLabel:field('announcementsLabel').value,textStyle:field('announcementsStyle').value,emptyPlaceholder:field('announcementsEmpty').value,showTimestamp:field('announcementsTimestamp').checked,showOpenButton:field('announcementsOpen').checked,openButtonLabel:field('announcementsButton').value,latestMessageLength:Number(field('announcementsLength').value)},changelog:{visible:field('changelogVisible').checked,displayLabel:field('changelogLabel').value,textStyle:field('changelogStyle').value,emptyPlaceholder:field('changelogEmpty').value,showTimestamp:field('changelogTimestamp').checked,showOpenButton:field('changelogOpen').checked,openButtonLabel:field('changelogButton').value,latestMessageLength:Number(field('changelogLength').value)}}); }
  return base;
};
const saveLayout = () => { if(layoutJson && !invalidLayout) layoutJson.value=JSON.stringify({version:2,elements:layoutNodes().map(serializeElement)}); };
const announce = (text) => { const status=document.getElementById('card-layout-status');if(status) status.textContent=text; };
const refreshRows = () => {
  layoutNodes().forEach((node,index,nodes)=>{
    const selected=node.dataset.layoutId===selectedLayoutId;
    node.classList.toggle('is-selected',selected);
    const select=node.querySelector('[data-select-layout]'); select.setAttribute('aria-pressed',String(selected));
    const label=read(node,'label').value;node.querySelector('.card-layout-row-copy strong').textContent=({'Card description':'Description','Card currentMap':'Current map','Card serverAddress':'Connect command'}[label]||label||'Untitled element');
    const type=node.dataset.layoutElement;
    const summary=type==='text'||type==='section'?read(node,'template').value.replace(/\s+/g,' '):type==='gallery'?node._content.querySelectorAll('[data-gallery-item]').length+' image(s)':type==='separator'?(read(node,'divider').checked?'Divider':'Spacing only')+' · '+(read(node,'spacing').value==='2'?'Large':'Small'):'Connect and Map & Rules';
    node.querySelector('.card-layout-row-summary').textContent=(read(node,'visible').checked?'Visible · ':'Hidden · ')+summary;
    node.querySelector('[data-layout-move="up"]').disabled=index===0;
    node.querySelector('[data-layout-move="down"]').disabled=index===nodes.length-1;
    node.querySelector('[data-layout-remove]').disabled=nodes.length===1;node._content.querySelector('[data-layout-remove]').disabled=nodes.length===1;
    node.querySelector('[data-layout-duplicate]').disabled=nodes.length>=35||type==='actions'||type==='updates';
    if(type==='gallery') {
      const items=Array.from(node._content.querySelectorAll('[data-gallery-item]'));
      items.forEach((item,i)=>{item.querySelector('legend').textContent='Image '+(i+1);item.querySelector('[data-gallery-move="up"]').disabled=i===0;item.querySelector('[data-gallery-move="down"]').disabled=i===items.length-1;item.querySelector('[data-gallery-remove]').disabled=items.length===1;});
      node._content.querySelector('[data-gallery-add]').disabled=items.length>=10;
    }
  });
  cardForm?.querySelectorAll('[data-add-layout]').forEach((button)=>{button.disabled=invalidLayout||layoutNodes().length>=35||((button.dataset.addLayout==='actions'||button.dataset.addLayout==='updates')&&layoutNodes().some((node)=>node.dataset.layoutElement===button.dataset.addLayout));});
};
const updateDirtyState = () => {
  if(!cardForm||!initial)return;
  saveLayout();
  const dirty=submitted||new URLSearchParams(new FormData(cardForm)).toString()!==initial;
  cardForm.dataset.dirty=String(dirty);
  if(dirtyStatus)dirtyStatus.textContent=dirty?'Unsaved changes. Save changes to apply them.':'All changes saved.';
  const save=cardForm.querySelector('button[type="submit"]');if(save&&cardForm.dataset.saving!=='true')save.disabled=!dirty||invalidLayout;
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
  refreshRows();
  if(focus)node._content.querySelector('[data-layout-field="label"]')?.focus();
};
const newElement = (type) => {
  const base={id:crypto.randomUUID(),type,label:{text:'Text',section:'Text and thumbnail',gallery:'Image gallery',separator:'Separator',actions:'Action buttons',updates:'Community Updates'}[type],visible:true};
  if(type==='text'||type==='section')Object.assign(base,{template:'{servername}',style:'normal'});
  if(type==='section')base.thumbnailUrl=null;
  if(type==='gallery')base.items=[{id:crypto.randomUUID(),source:'map',url:null,description:'{currentmap} map artwork'}];
  if(type==='separator')Object.assign(base,{divider:true,spacing:1});
  if(type==='updates')Object.assign(base,{title:'**Latest Updates**',headingStyle:'normal',emptyBehavior:'show_placeholders',announcements:{visible:true,displayLabel:'📢 **Announcements**',textStyle:'normal',emptyPlaceholder:'No announcements yet.',showTimestamp:true,showOpenButton:true,openButtonLabel:'Open',latestMessageLength:240},changelog:{visible:true,displayLabel:'🛠 **Changelog**',textStyle:'normal',emptyPlaceholder:'No changelog entries yet.',showTimestamp:true,showOpenButton:true,openButtonLabel:'Open',latestMessageLength:240}});
  return base;
};
const addGalleryItem = (node,item) => {
  const fieldset=document.createElement('fieldset');fieldset.dataset.galleryItem='true';fieldset.dataset.itemId=item.id;
  fieldset.innerHTML='<legend>Image</legend><label>Image source<select data-layout-field="source"><option value="map">Automatic current map artwork</option><option value="fallback">Bundled fallback artwork</option><option value="custom">Custom HTTPS URL</option></select></label><label>Custom HTTPS URL<input data-layout-field="url" type="url" maxlength="500" placeholder="https://..."></label><label>Image description<input data-layout-field="description" maxlength="1024"></label><div class="card-layout-property-actions"><button type="button" class="secondary" data-gallery-move="up" aria-label="Move image up">Up</button><button type="button" class="secondary" data-gallery-move="down" aria-label="Move image down">Down</button><button type="button" class="danger" data-gallery-remove>Remove image</button></div>';
  for(const key of ['source','url','description'])fieldset.querySelector('[data-layout-field="'+key+'"]').value=item[key]??'';
  node._content.querySelector('[data-gallery-items]').append(fieldset);
};
const renderLayoutElement = (element) => {
  const node=document.createElement('div');node.className='card-layout-row';node.dataset.layoutElement=element.type;node.dataset.layoutId=element.id;
  const icon={text:'T',section:'▣',gallery:'▧',separator:'─',actions:'▤',updates:'↻'}[element.type]||'•';
  node.innerHTML='<button type="button" class="card-layout-row-main" data-select-layout aria-pressed="false"><span class="card-layout-row-icon" aria-hidden="true">'+icon+'</span><span class="card-layout-row-copy"><strong></strong><span class="card-layout-row-summary"></span></span></button><div class="card-layout-row-actions"><button type="button" class="secondary" data-layout-move="up" aria-label="Move element up">↑</button><button type="button" class="secondary" data-layout-move="down" aria-label="Move element down">↓</button><details class="layout-row-menu"><summary aria-label="Element actions">⋯</summary><div><button type="button" class="secondary" data-layout-duplicate>Duplicate</button><button type="button" class="danger" data-layout-remove>Remove</button></div></details></div>';
  const content=document.createElement('div');content.className='card-layout-content';content.hidden=true;node._content=content;
  content.innerHTML='<label>Friendly label<input data-layout-field="label" maxlength="80" required></label><label class="checkbox"><input type="checkbox" data-layout-field="visible"> Visible in Discord</label>';
  if(element.type==='text'||element.type==='section') {
    content.innerHTML+='<div class="description-toolbar" role="group" aria-label="Text formatting">'+[['Bold','**'],['Italic','*'],['Underline','__'],['Strikethrough','~~'],['Inline code',String.fromCharCode(96)]].map(([label,marker])=>'<button type="button" class="secondary" data-layout-markdown="'+escapeText(marker)+'">'+label+'</button>').join('')+'</div><label>Text template<textarea data-layout-field="template" rows="6" maxlength="500"></textarea></label><label>Text style<select data-layout-field="style"><option value="large">Large heading</option><option value="medium">Medium heading</option><option value="small">Small heading</option><option value="normal">Normal text</option><option value="subtext">Subtext</option></select></label><label>Insert placeholder<select data-layout-placeholder>'+placeholders.map(([name,description])=>'<option value="{'+name+'}">{'+name+'} — '+escapeText(description)+'</option>').join('')+'</select></label><button type="button" class="secondary" data-layout-insert>Insert placeholder</button>';
  }
  if(element.type==='section')content.innerHTML+='<label>Thumbnail HTTPS URL<input data-layout-field="thumbnailUrl" type="url" maxlength="500" placeholder="Use default server thumbnail"></label><p class="hint">Blank uses the thumbnail in Appearance. Convert to a text block to remove the thumbnail.</p><button type="button" class="secondary" data-layout-convert-text>Remove thumbnail / use text block</button>';
  if(element.type==='gallery')content.innerHTML+='<div data-gallery-items></div><button type="button" class="secondary" data-gallery-add>Add image</button><p class="hint">Automatic artwork follows the current map’s canonical asset, then your configured fallback in Appearance. Each gallery supports up to 10 images.</p>';
  if(element.type==='separator')content.innerHTML+='<label class="checkbox"><input type="checkbox" data-layout-field="divider"> Visible divider (disable for spacing only)</label><label>Native Discord spacing<select data-layout-field="spacing"><option value="1">Small</option><option value="2">Large</option></select></label>';
  if(element.type==='actions')content.innerHTML+='<p class="hint">Labels and enabled buttons are configured once in Action Buttons.</p><button type="button" class="secondary" data-open-button-settings>Edit button settings</button>';
  if(element.type==='updates')content.innerHTML+='<label>Section title<input data-layout-field="updatesTitle" maxlength="80" required></label><label>Heading style<select data-layout-field="headingStyle"><option value="normal">Normal</option><option value="heading">Heading</option><option value="subtext">Subtext</option></select></label><label>Empty behavior<select data-layout-field="emptyBehavior"><option value="show_placeholders">Show placeholders</option><option value="hide_empty_entries">Hide empty entries</option></select></label>'+['announcements','changelog'].map((feed)=>'<details open><summary>'+ (feed==='announcements'?'Announcements':'Changelog') +' settings</summary><div class="card-layout-content"><label class="checkbox"><input type="checkbox" data-layout-field="'+feed+'Visible"> Show feed</label><label>Display label<input data-layout-field="'+feed+'Label" maxlength="80" required></label><label>Entry text style<select data-layout-field="'+feed+'Style"><option value="normal">Normal</option><option value="heading">Heading</option><option value="subtext">Subtext</option></select></label><label>Empty placeholder<input data-layout-field="'+feed+'Empty" maxlength="240"></label><label class="checkbox"><input type="checkbox" data-layout-field="'+feed+'Timestamp"> Show relative timestamp</label><label class="checkbox"><input type="checkbox" data-layout-field="'+feed+'Open"> Show Open button</label><label>Open button label<input data-layout-field="'+feed+'Button" maxlength="80" required></label><label>Latest message excerpt length<input data-layout-field="'+feed+'Length" type="number" min="40" max="1000" step="1"></label></div></details>').join('');
  content.innerHTML+='<div class="card-layout-property-actions"><button type="button" class="secondary" data-layout-restore>Restore element</button><button type="button" class="danger" data-layout-remove>Remove element</button></div>';
  for(const key of ['label','template','style','thumbnailUrl','spacing']){const control=read(node,key);if(control)control.value=element[key]??'';}
  for(const key of ['visible','divider']){const control=read(node,key);if(control)control.checked=element[key]===true;}
  if(element.type==='gallery')(element.items??[]).forEach((item)=>addGalleryItem(node,item));
  if(element.type==='updates'){const set=(key,value)=>{const control=read(node,key);if(control){if(control.type==='checkbox')control.checked=value===true;else control.value=String(value??'');}};set('updatesTitle',element.title);set('headingStyle',element.headingStyle);set('emptyBehavior',element.emptyBehavior);for(const [feed,key] of [['announcements','announcements'],['changelog','changelog']]){const config=element[key];for(const [suffix,property] of [['Visible','visible'],['Label','displayLabel'],['Style','textStyle'],['Empty','emptyPlaceholder'],['Timestamp','showTimestamp'],['Open','showOpenButton'],['Button','openButtonLabel'],['Length','latestMessageLength']])set(feed+suffix,config[property]);}}
  node.append(content);layoutEditors.append(node);return node;
};
const rebuild = (layout, selected=selectedLayoutId) => {
  layoutEditors.replaceChildren();layoutProperties.replaceChildren();selectedLayoutId=null;
  layout.elements.forEach(renderLayoutElement);
  selectElement(layoutNodes().some((node)=>node.dataset.layoutId===selected)?selected:layoutNodes()[0]?.dataset.layoutId);
  refreshRows();saveLayout();
};
const appendInlineMarkdown = (parent, content) => {
  const pattern = /(\x60[^\x60\n]+\x60|\*\*\*[^\n]+?\*\*\*|\*\*[^\n]+?\*\*|__[^\n]+?__|~~[^\n]+?~~|\*[^\n]+?\*)/g;
  let offset = 0;
  for (const match of content.matchAll(pattern)) {
    parent.append(document.createTextNode(content.slice(offset, match.index)));
    const token = match[0];
    const marker = token.startsWith('\x60') ? '\x60' : token.startsWith('***') ? '***' : token.startsWith('**') ? '**' : token.startsWith('__') ? '__' : token.startsWith('~~') ? '~~' : '*';
    const element = document.createElement(marker === '\x60' ? 'code' : marker === '*' ? 'em' : marker === '__' ? 'u' : marker === '~~' ? 's' : 'strong');
    const inner = token.slice(marker.length, -marker.length);
    if (marker === '\x60') element.textContent = inner;
    else if (marker === '***') { const italic = document.createElement('em'); appendInlineMarkdown(italic, inner); element.append(italic); }
    else appendInlineMarkdown(element, inner);
    parent.append(element);
    offset = match.index + token.length;
  }
  parent.append(document.createTextNode(content.slice(offset)));
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
  const node=button.closest('[data-layout-element]')||layoutNodes().find((node)=>node.dataset.layoutId===selectedLayoutId);
  if(button.hasAttribute('data-select-layout')){selectElement(node.dataset.layoutId);if(window.innerWidth<=760)layoutProperties.scrollIntoView({block:'start'});return;}
  if(button.dataset.addLayout){const type=button.dataset.addLayout;if(layoutNodes().length>=35||invalidLayout||(type==='actions'&&layoutNodes().some((n)=>n.dataset.layoutElement==='actions')))return;const menu=button.closest('.layout-add-menu');if(menu)menu.open=false;const added=renderLayoutElement(newElement(type));selectElement(added.dataset.layoutId,true);announce('Element added.');}
  else if(button.dataset.layoutMove&&node){const next=button.dataset.layoutMove==='up'?node.previousElementSibling:node.nextElementSibling;if(next){if(button.dataset.layoutMove==='up')layoutEditors.insertBefore(node,next);else layoutEditors.insertBefore(next,node);announce('Element moved.');}node.querySelector('[data-layout-move="'+button.dataset.layoutMove+'"]').focus();}
  else if(button.hasAttribute('data-layout-duplicate')&&node){if(layoutNodes().length>=35||node.dataset.layoutElement==='actions'||node.dataset.layoutElement==='updates')return;const copy=serializeElement(node);copy.id=crypto.randomUUID();copy.label=(copy.label+' copy').slice(0,80);if(copy.items)copy.items=copy.items.map((item)=>({...item,id:crypto.randomUUID()}));const added=renderLayoutElement(copy);layoutEditors.insertBefore(added,node.nextElementSibling);selectElement(added.dataset.layoutId);announce('Element duplicated.');}
  else if(button.hasAttribute('data-layout-remove')&&node){if(layoutNodes().length<=1)return;removed={element:serializeElement(node),index:layoutNodes().indexOf(node)};const next=node.nextElementSibling||node.previousElementSibling;node.remove();if(node.dataset.layoutId===selectedLayoutId){selectedLayoutId=null;selectElement(next.dataset.layoutId);}refreshUndo();announce('Element removed. Undo is available.');}
  else if(button.hasAttribute('data-layout-undo')&&removed){if(layoutNodes().length>=35)return;const next=layoutNodes()[removed.index];const added=renderLayoutElement(removed.element);if(next)layoutEditors.insertBefore(added,next);removed=null;refreshUndo();selectElement(added.dataset.layoutId);announce('Removal undone.');}
  else if(button.hasAttribute('data-gallery-add')&&node){if(node._content.querySelectorAll('[data-gallery-item]').length>=10)return;addGalleryItem(node,newElement('gallery').items[0]);}
  else if((button.dataset.galleryMove||button.hasAttribute('data-gallery-remove'))&&node){const item=button.closest('[data-gallery-item]');if(!item)return;const holder=item.parentElement;if(button.hasAttribute('data-gallery-remove')){if(holder.children.length>1)item.remove();}else{const next=button.dataset.galleryMove==='up'?item.previousElementSibling:item.nextElementSibling;if(next){if(button.dataset.galleryMove==='up')holder.insertBefore(item,next);else holder.insertBefore(next,item);}}}
  else if(button.hasAttribute('data-layout-insert')||button.dataset.layoutMarkdown){const control=read(node,'template');const start=control.selectionStart,end=control.selectionEnd;const marker=button.dataset.layoutMarkdown;const insertion=marker?marker+(control.value.slice(start,end)||'text')+marker:node._content.querySelector('[data-layout-placeholder]').value;if(control.value.length-(end-start)+insertion.length>500){announce('Formatting would exceed the 500-character template limit.');return;}control.setRangeText(insertion,start,end,'end');control.focus();}
  else if(button.hasAttribute('data-layout-restore')&&node){const original=originalElements.get(node.dataset.layoutId)||{...newElement(node.dataset.layoutElement),id:node.dataset.layoutId};const index=layoutNodes().indexOf(node);const selected=node.dataset.layoutId;const added=renderLayoutElement(original);node.remove();layoutEditors.insertBefore(added,layoutNodes()[index]||null);selectElement(selected);announce('Element restored.');}
  else if(button.hasAttribute('data-layout-convert-text')&&node){const element=serializeElement(node);element.type='text';delete element.thumbnailUrl;const index=layoutNodes().indexOf(node);const added=renderLayoutElement(element);node.remove();layoutEditors.insertBefore(added,layoutNodes()[index]||null);selectElement(element.id);}
  else if(button.hasAttribute('data-open-button-settings')){const settings=document.getElementById('card-button-settings');settings.open=true;settings.scrollIntoView({block:'center'});settings.querySelector('input')?.focus();return;}
  else if(button.hasAttribute('data-reset-card-profile')){let defaults,layout;try{defaults=JSON.parse(button.dataset.defaults);layout=JSON.parse(button.dataset.defaultLayout);}catch{return;}for(const[name,value]of Object.entries(defaults)){const control=formControl(name);if(control?.type==='checkbox')control.checked=value===true;else if(control)control.value=String(value);}invalidLayout=false;rebuild(layout);removed=null;refreshUndo();announce('Card defaults restored. Save to apply.');}
  else if(button.hasAttribute('data-discard-server-changes')){if(submitted){cardForm.dataset.dirty='false';window.location.reload();return;}cardForm.reset();invalidLayout=initialLayout===null;if(initialLayout)rebuild(initialLayout);removed=null;refreshUndo();announce('Unsaved changes discarded.');}
  else if(button.hasAttribute('data-expand-preview')){const expanded=previewRoot.classList.toggle('is-expanded');button.setAttribute('aria-expanded',String(expanded));button.textContent=expanded?'Close expanded preview':'Expand preview';previewRoot.scrollIntoView({block:'start'});return;}
  else return;
  refreshUndo();updateDirtyState();
});
cardForm?.addEventListener('invalid',(event)=>{
  const control=event.target;if(!(control instanceof HTMLInputElement||control instanceof HTMLTextAreaElement||control instanceof HTMLSelectElement))return;
  event.preventDefault();const node=layoutNodes().find((node)=>node._content.contains(control));if(node)selectElement(node.dataset.layoutId);
  let parent=control.parentElement;while(parent&&parent!==cardForm){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}
  control.focus();announce(control.validationMessage||'Review the selected field before saving.');
},true);
cardForm?.addEventListener('input',updateDirtyState);
cardForm?.addEventListener('change',(event)=>{if(event.target?.id==='card-preview-mode'){updateCardPreview();return;}updateDirtyState();});
window.addEventListener('beforeunload',(event)=>{if(cardForm?.dataset.dirty!=='true'||cardForm?.dataset.saving==='true')return;event.preventDefault();event.returnValue='';});
cardForm?.addEventListener('submit',(event)=>{if(invalidLayout){event.preventDefault();announce('Invalid layout data. Discard the malformed draft before saving.');return;}saveLayout();cardForm.dataset.saving='true';const save=cardForm.querySelector('button[type="submit"]');save.disabled=true;save.textContent='Saving…';if(dirtyStatus)dirtyStatus.textContent='Saving changes…';});
const sectionLinks=Array.from(document.querySelectorAll('.game-server-section-nav a'));
const updateActiveSection=()=>sectionLinks.forEach((link)=>{if(link.hash===(window.location.hash||'#server-settings'))link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});
window.addEventListener('hashchange',updateActiveSection);updateActiveSection();
const fitPreview=()=>{if(previewRoot)previewRoot.dataset.tall=String(previewRoot.getBoundingClientRect().height>window.innerHeight-220);};
if(previewRoot){new ResizeObserver(fitPreview).observe(previewRoot);window.addEventListener('resize',fitPreview);fitPreview();}
if(layoutEditors&&layoutJson){
  try{const persisted=JSON.parse(layoutJson.value);const elements=Array.isArray(persisted)?persisted:persisted.elements;if(!Array.isArray(elements)||!elements.length||elements.length>35)throw new Error('Invalid layout');initialLayout={version:2,elements};elements.forEach((element)=>originalElements.set(element.id,structuredClone(element)));let selected;try{selected=sessionStorage.getItem(selectionKey);}catch{}rebuild(initialLayout,selected);}
  catch{invalidLayout=true;layoutProperties.textContent='The draft layout could not be loaded. It is preserved for validation; discard it to reload the saved configuration.';announce('Invalid layout draft preserved.');}
  initial=new URLSearchParams(new FormData(cardForm)).toString();updateDirtyState();
}
`;
