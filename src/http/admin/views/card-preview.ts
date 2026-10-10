/** Browser-only approximation built from the same normalized layout envelope used at save time. */
export const cardPreviewScript = String.raw`
const previewFailedImages = new Set();
const updateCardPreview = () => {
  if (!(previewRoot instanceof HTMLElement)) return;
  const output = document.getElementById('card-preview-lines');
  if (!output) return;
  let current = {};
  try { current = JSON.parse(previewRoot.dataset.currentValues ?? '{}'); } catch {}
  const mode = document.getElementById('card-preview-mode')?.value ?? 'current';
  const state = mode !== 'current' ? (mode === 'missing' ? 'unavailable' : mode) : previewRoot.dataset.stale === 'true' ? 'stale' : previewRoot.dataset.hostingState === 'PENDING' ? 'pending' : previewRoot.dataset.hostingState === 'STOPPED' ? 'offline' : previewRoot.dataset.hostingState === 'STARTING' ? 'starting' : previewRoot.dataset.hostingState === 'RUNNING' && previewRoot.dataset.gameplayState === 'AVAILABLE' ? 'online' : 'unavailable';
  const values = { ...current };
  if (mode !== 'current') Object.assign(values, { playercount: '0/5', players: '0', maxplayers: '5', location: 'Dallas', currentmap: 'aim_redline_fp', lastupdated: 'Just now' });
  if (mode === 'missing') Object.assign(values, { playercount: 'Unknown', players: '', maxplayers: '', location: '', currentmap: 'Unknown', lastupdated: '' });
  const label = inputValue(state + 'StatusLabel', current.status ?? 'Unavailable');
  Object.assign(values, { status: label, statusicon: previewIcon(state, mode), online: previewIcon(state, mode) + ' ' + label, servername: inputValue('displayName', current.servername) });
  const host = inputValue('connectDomain') || previewRoot.dataset.rawHost || '';
  values.serverip = host;
  values.serveraddress = host ? host + (values.serverport ? ':' + values.serverport : '') : 'Unavailable';
  values.severaddress = values.serveraddress;
  const sourceStatus = document.getElementById('card-preview-source');
  const configurationStatus = cardForm?.dataset.dirty === 'true' ? 'unsaved configuration edits' : 'saved configuration';
  if (sourceStatus) sourceStatus.textContent = mode === 'current' ? 'Current cached telemetry · ' + (previewRoot.dataset.rawMap || 'No map observed') + ' · ' + configurationStatus + '. Updates use cached Discord messages.' : 'Example telemetry and example Updates · ' + configurationStatus;
  const https = (value) => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; } };
  const fallback = previewRoot.dataset.fallbackImage ?? '';
  const knownMap = mode === 'current' ? previewRoot.dataset.mapKnown === 'true' : mode !== 'missing' && previewRoot.dataset.exampleMapKnown === 'true';
  const mapImage = knownMap ? (mode === 'current' ? previewRoot.dataset.mapImage : previewRoot.dataset.exampleMapImage) : https(inputValue('imageUrl')) || fallback;
  const appendText = (parent, content) => {
    String(content).split('\n').forEach((line) => {
      const heading = line.match(/^(#{1,3}|-#)\s+(.*)$/);
      const element = document.createElement(heading ? heading[1] === '-#' ? 'small' : 'h' + heading[1].length : 'p');
      appendInlineMarkdown(element, heading ? heading[2] : line || '\u200b');
      parent.append(element);
    });
  };
  const media = (url, description, thumbnail = false) => {
    const figure = document.createElement('figure');
    figure.className = thumbnail ? 'preview-thumbnail-frame' : 'preview-media-item';
    const imageUrl = https(url);
    const placeholder = document.createElement('div');
    placeholder.className = 'preview-artwork';
    placeholder.textContent = description + ' · image unavailable';
    if (!imageUrl || previewFailedImages.has(imageUrl)) { figure.append(placeholder); return figure; }
    const img = document.createElement('img');
    img.src = imageUrl; img.alt = description; img.referrerPolicy = 'no-referrer';
    if (thumbnail) img.className = 'preview-thumbnail';
    img.addEventListener('error', () => { previewFailedImages.add(imageUrl); img.replaceWith(placeholder); }, { once: true });
    figure.append(img);
    return figure;
  };
  const actions = () => {
    const row = document.createElement('div'); row.className = 'preview-action-row';
    [['showConnectButton','connectButtonLabel','Connect','▶'],['showMapRulesButton','mapRulesButtonLabel','Map & Rules','🗺']].forEach(([visible,name,fallbackLabel,icon],index) => {
      if (!formControl(visible)?.checked) return;
      const button = document.createElement('span'); button.className = 'preview-action' + (index ? ' secondary' : '');
      button.textContent = icon + ' ' + inputValue(name, fallbackLabel); row.append(button);
    });
    return row;
  };
  output.replaceChildren();
  const accent = inputValue('accentColor');
  output.style.borderLeftColor = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#2b8aef';
  let elements;
  try { const parsed = JSON.parse(layoutJson?.value ?? '{}'); elements = Array.isArray(parsed) ? parsed : parsed.elements; } catch {}
  if (!Array.isArray(elements)) {
    const error = document.createElement('p'); error.className = 'warning'; error.textContent = 'Layout data cannot be previewed. Your draft is preserved; discard or correct it before saving.';output.append(error);return;
  }
  let threads=[];try{threads=JSON.parse(previewRoot.dataset.updateThreads ?? '[]')}catch{}
  const previewUpdateRows = (element) => (element.feedOrder||['ANNOUNCEMENTS','CHANGELOG']).map((type)=>{const config=type==='ANNOUNCEMENTS'?element.announcements:element.changelog;if(!config?.visible)return null;const thread=Array.isArray(threads)?threads.find((item)=>item.type===type):undefined;const source=(mode==='current'?(thread?.latestMessageText??''):'Example '+(type==='ANNOUNCEMENTS'?'announcement.':'changelog entry.')).trim();if(!source&&element.emptyBehavior==='hide_empty_entries')return null;return {type,config,thread,source:source.slice(0,config.latestMessageLength)};}).filter(Boolean);
  if (sourceStatus && elements.some((element) => element?.type === 'gallery' && element.items?.some((item) => item.source === 'map'))) sourceStatus.textContent += ' Automatic artwork: ' + (knownMap ? 'canonical map asset.' : https(inputValue('imageUrl')) ? 'configured fallback image.' : 'bundled fallback banner.');
  elements.forEach((element, index) => {
    if (!element || element.visible === false) return;
    const text = resolveLineTemplate(element.template ?? '', values);
    if (element.type === 'text') {
      if (!text.trim()) return;
      const block = document.createElement('div'); block.dataset.previewElement = element.id;
      appendText(block, styleLineText(text, element.style ?? 'normal')); output.append(block);
    } else if (element.type === 'section') {
      const section = document.createElement('div');section.className = 'preview-section';section.dataset.previewElement = element.id;
      const body = document.createElement('div'); appendText(body, styleLineText(text, element.style ?? 'normal')); section.append(body);
      section.append(media(element.thumbnailUrl || inputValue('thumbnailImageUrl') || previewRoot.dataset.defaultThumbnail, 'Server thumbnail', true)); output.append(section);
    } else if (element.type === 'gallery') {
      const gallery = document.createElement('div');gallery.className = 'preview-media-gallery';gallery.dataset.previewElement = element.id;
      (element.items ?? []).forEach((item) => {
        const url = item.source === 'map' ? mapImage : item.source === 'fallback' ? fallback : item.url || fallback;
        const description = resolveLineTemplate(item.description || values.currentmap + ' map artwork', values);
        gallery.append(media(url, description));
      });output.append(gallery);
    } else if (element.type === 'separator') {
      const following=elements[index+1];if(element.label==='Updates separator'&&following?.type==='updates'&&(following.visible===false||previewUpdateRows(following).length===0))return;
      const divider = document.createElement(element.divider ? 'hr' : 'div');divider.dataset.previewElement = element.id;
      divider.className = (element.divider ? 'preview-separator' : 'preview-separator-space') + (element.spacing === 2 ? ' preview-separator-large' : ''); output.append(divider);
    } else if (element.type === 'actions') { const row = actions();row.dataset.previewElement = element.id;if(row.children.length) output.append(row); }
    else if (element.type === 'updates') {
      const relativeTime=(value)=>{const date=new Date(value);if(Number.isNaN(date.getTime()))return '';const seconds=(date.getTime()-Date.now())/1000;const units=[['year',31536000],['month',2592000],['week',604800],['day',86400],['hour',3600],['minute',60],['second',1]];const [unit,size]=units.find(([,size])=>Math.abs(seconds)>=size)||units[units.length-1];return new Intl.RelativeTimeFormat(undefined,{numeric:'auto'}).format(Math.round(seconds/size),unit);};
      const entries=previewUpdateRows(element);
      const addHeading=()=>{
        if(!element.showHeading)return;
        const heading=document.createElement('div');heading.className='preview-update-heading';heading.dataset.discordComponent='TextDisplay';heading.dataset.previewElement=element.id;
        appendText(heading,styleLineText(element.title||'',element.headingStyle==='heading'?'large':element.headingStyle==='subtext'?'subtext':'normal'));output.append(heading);
      };
      const addFeed=({type,config,thread,source})=>{
        const validThread=thread&&/^\d{17,20}$/.test(thread.threadId)&&/^\d{17,20}$/.test(previewRoot.dataset.guildId||'');
        const hasButton=config.showOpenButton&&(validThread||mode!=='current');
        const label=config.displayLabel+(mode==='current'&&thread?.notificationExpiresAt&&new Date(thread.notificationExpiresAt)>new Date()?' 🆕':'');
        const title=document.createElement('div');
        title.className=(hasButton?'preview-section':'preview-text-display')+' preview-updates preview-update-title';
        title.dataset.previewElement=element.id;title.dataset.discordComponent=hasButton?'Section':'TextDisplay';
        if(hasButton){
          const titleText=document.createElement('div');titleText.dataset.discordComponent='TextDisplay';appendText(titleText,label);title.append(titleText);
          const button=document.createElement('span');button.className='preview-action secondary';button.textContent=config.openButtonLabel;button.dataset.discordAccessory='Button';title.append(button);
        }else appendText(title,label);
        output.append(title);
        const content=source||config.emptyPlaceholder;
        const formatted=styleLineText(content,config.textStyle==='heading'?'large':config.textStyle==='subtext'?'subtext':'normal');
        let time='';if(config.showTimestamp&&source&&mode==='current'&&thread?.latestMessageAt)time=relativeTime(thread.latestMessageAt);
        const summary=document.createElement('div');summary.className='preview-text-display preview-updates preview-update-summary';
        summary.dataset.previewElement=element.id;summary.dataset.discordComponent='TextDisplay';
        appendText(summary,[formatted,time?'-# '+time:''].filter(Boolean).join('\n'));output.append(summary);
      };
      const addSeparator=(divider,spacing)=>{
        const line=document.createElement(divider?'hr':'div');line.className=(divider?'preview-separator':'preview-separator-space')+(spacing===2?' preview-separator-large':'');line.dataset.previewElement=element.id;line.dataset.discordComponent='Separator';output.append(line);
      };
      if(Array.isArray(element.blocks)){
        element.blocks.forEach((block)=>{
          if(block.visible===false)return;
          if(block.type==='heading')addHeading();
          else if(block.type==='feed'){const entry=entries.find((row)=>row.type===block.feed);if(entry)addFeed(entry);}
          else if(block.type==='text'){const text=resolveLineTemplate(block.template||'',values);if(text.trim()){const display=document.createElement('div');display.dataset.previewElement=block.id;display.dataset.discordComponent='TextDisplay';appendText(display,styleLineText(text,block.style||'normal'));output.append(display);}}
          else if(block.type==='separator')addSeparator(block.divider,block.spacing);
          else if(block.type==='gallery'){
            const gallery=document.createElement('div');gallery.className='preview-media-gallery';gallery.dataset.previewElement=block.id;gallery.dataset.discordComponent='MediaGallery';
            (block.items||[]).forEach((item)=>{
              const url=item.source==='map'?mapImage:item.source==='fallback'?fallback:item.url||fallback;
              gallery.append(media(url,resolveLineTemplate(item.description||values.currentmap+' map artwork',values)));
            });
            output.append(gallery);
          }
        });
      }else if(entries.length){
        addHeading();
        entries.forEach((entry,index)=>{
          if(index&&element.separator?.enabled)addSeparator(element.separator.divider,element.separator.spacing);
          addFeed(entry);
        });
      }
    }
  });
  document.getElementById('card-preview-artwork')?.replaceChildren();
  document.getElementById('card-preview-actions')?.replaceChildren();
};
`;
