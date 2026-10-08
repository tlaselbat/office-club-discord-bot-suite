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
  if (sourceStatus) sourceStatus.textContent = mode === 'current' ? 'Current cached telemetry · ' + (previewRoot.dataset.rawMap || 'No map observed') + '. Updates use cached Discord messages.' : 'Example telemetry and Updates · unsaved card configuration';
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
  if (sourceStatus && elements.some((element) => element?.type === 'gallery' && element.items?.some((item) => item.source === 'map'))) sourceStatus.textContent += ' Automatic artwork: ' + (knownMap ? 'canonical map asset.' : https(inputValue('imageUrl')) ? 'configured fallback image.' : 'bundled fallback banner.');
  elements.forEach((element) => {
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
      const divider = document.createElement(element.divider ? 'hr' : 'div');divider.dataset.previewElement = element.id;
      divider.className = (element.divider ? 'preview-separator' : 'preview-separator-space') + (element.spacing === 2 ? ' preview-separator-large' : ''); output.append(divider);
    } else if (element.type === 'actions') { const row = actions();row.dataset.previewElement = element.id;if(row.children.length) output.append(row); }
    else if (element.type === 'updates') {
      const threads = (()=>{try{return JSON.parse(previewRoot.dataset.updateThreads ?? '[]')}catch{return []}})();
      const entries = ['announcements','changelog'].map((feed,index)=>{const config=element[feed];if(!config?.visible)return null;const type=index?'CHANGELOG':'ANNOUNCEMENTS';const thread=Array.isArray(threads)?threads.find((item)=>item.type===type):undefined;const source=mode==='current'?(thread?.latestMessageText||''):'Example '+(index?'changelog entry.':'announcement.');if(!source&&element.emptyBehavior==='hide_empty_entries')return null;return {config,thread,index,source:source.slice(0,config.latestMessageLength),type};}).filter(Boolean);
      if(entries.length){const heading=document.createElement('div');heading.className='preview-update-heading';appendText(heading,styleLineText(element.title||'Latest Updates',element.headingStyle==='heading'?'large':element.headingStyle||'normal'));heading.dataset.previewElement=element.id;output.append(heading);entries.forEach(({config,thread,index,source})=>{const section=document.createElement('div');section.className='preview-section preview-updates';section.dataset.previewElement=element.id;const body=document.createElement('div');const label=config.displayLabel+(mode==='current'&&thread?.notificationExpiresAt&&new Date(thread.notificationExpiresAt)>new Date()?' 🆕':'');appendText(body,styleLineText(label,config.textStyle==='heading'?'large':config.textStyle||'normal'));appendText(body,source||config.emptyPlaceholder);if(config.showTimestamp&&mode==='current'&&thread?.latestMessageAt){const time=document.createElement('small');time.textContent=new Date(thread.latestMessageAt).toLocaleString();body.append(time);}section.append(body);if(config.showOpenButton&&(thread||mode!=='current')){const button=document.createElement('span');button.className='preview-action secondary';button.textContent=config.openButtonLabel;section.append(button);}output.append(section);});}
    }
  });
  document.getElementById('card-preview-artwork')?.replaceChildren();
  document.getElementById('card-preview-actions')?.replaceChildren();
};
`;
