const $ = (selector) => document.querySelector(selector);
const boroughs = ['Bronx', 'Brooklyn', 'Manhattan', 'Queens', 'Staten Island'];
const boroughCenters = {
  Bronx: [40.843, -73.865], Brooklyn: [40.660, -73.950], Manhattan: [40.783, -73.970],
  Queens: [40.728, -73.798], 'Staten Island': [40.581, -74.149]
};
const state = {
  centers: [], nta: null, extra: {mapped_fixed: [], unmapped_fixed: [], mobile: []},
  map: null, markers: null, neighborhoods: null, markerMode: 'centers',
  borough: '', ntaCode: '', ntaName: '', filtered: [], extraFiltered: []
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function yesNo(value) { return value === 'Y' ? 'Yes' : value === 'N' ? 'No' : 'Not reported'; }
function needLabel(value) { return value === 'very high' ? 'Very high need' : value === 'high' ? 'High need' : 'No district category'; }
function serviceSummary(center) {
  const items = [];
  if (center.workstations > 0) items.push(`${center.workstations} computers`);
  if (center.wifi_mbps > 0) items.push(`Wi-Fi ${center.wifi_mbps} Mbps`);
  if (center.literacy) items.push('Digital literacy');
  return items;
}
function matchFilters(center, ignoreLocation = false, ignoreFunding = false) {
  const query = $('#search').value.trim().toLowerCase();
  const cc = center.connected_communities;
  if (query && ![center.name, center.address, center.postcode, center.nta, center.analysis_nta,
    center.operator, cc?.name, cc?.address].some(value => String(value || '').toLowerCase().includes(query))) return false;
  if (!ignoreLocation && state.borough && center.borough !== state.borough) return false;
  if (!ignoreLocation && state.ntaCode && center.analysis_nta !== state.ntaCode) return false;
  if (!ignoreFunding && $('#funding').value === 'cc' && !cc) return false;
  if (!ignoreFunding && $('#funding').value === 'other' && cc) return false;
  if ($('#type').value && center.type !== $('#type').value) return false;
  if ($('#computers').checked && !(center.workstations > 0)) return false;
  if ($('#wifi').checked && !(center.wifi_mbps >= 100)) return false;
  if ($('#literacy').checked && !center.literacy) return false;
  if ($('#staffed').checked && !center.staffed) return false;
  if ($('#wheelchair').checked && center.wheelchair !== 'Y') return false;
  return true;
}
function extraType(entry) {
  if (entry.type === 'Library') return 'Library';
  if (entry.type === 'Older Adult Center') return 'Older adult center';
  if (entry.type === 'Recreation Center Media Lab') return 'Parks & recreation';
  return 'Community center';
}
function matchExtra(entry, ignoreLocation = false, ignoreFunding = false) {
  if (!ignoreFunding && $('#funding').value === 'other') return false;
  if (!ignoreLocation && state.borough && entry.borough !== state.borough) return false;
  if (!ignoreLocation && state.ntaCode && entry.nta !== state.ntaCode) return false;
  const query = $('#search').value.trim().toLowerCase();
  if (query && ![entry.name, entry.address, entry.nta].some(value => String(value || '').toLowerCase().includes(query))) return false;
  if ($('#type').value && extraType(entry) !== $('#type').value) return false;
  // The separate CC list has no 2024 PCC service fields to test these filters.
  if (['computers','wifi','literacy','staffed','wheelchair'].some(id => $(`#${id}`).checked)) return false;
  return true;
}

function renderBoroughChart() {
  const counts = Object.fromEntries(boroughs.map(borough => [borough, {all: 0, cc: 0}]));
  state.centers.filter(center => matchFilters(center, true, true)).forEach(center => {
    counts[center.borough].all++;
    if (center.connected_communities) counts[center.borough].cc++;
  });
  state.extra.mapped_fixed.filter(entry => matchExtra(entry, true, true)).forEach(entry => {
    counts[entry.borough].cc++;
  });
  const max = Math.max(1, ...Object.values(counts).map(value => value.all));
  const chart = $('#borough-bars');
  chart.innerHTML = boroughs.map(borough => {
    const {all, cc} = counts[borough];
    const selected = state.borough === borough;
    return `<button type="button" class="borough-row${selected ? ' selected' : ''}" data-borough="${borough}" aria-pressed="${selected}" ${all || cc ? '' : 'disabled'}><span class="borough-name">${borough}</span><span class="borough-pair"><span class="borough-track"><span class="borough-fill" style="width:${100 * all / max}%"></span></span><span class="borough-track cc-track"><span class="borough-fill cc-fill" style="width:${100 * cc / max}%"></span></span></span><strong>${all}<small>${cc} CC</small></strong></button>`;
  }).join('');
  chart.querySelectorAll('button[data-borough]').forEach(button => button.addEventListener('click', () => selectBorough(button.dataset.borough)));
  $('#borough-reset').hidden = !state.borough;
}
function selectBorough(borough, showSites = false) {
  state.borough = state.borough === borough && !showSites ? '' : borough;
  state.ntaCode = '';
  state.ntaName = '';
  if (showSites) {
    state.markerMode = 'centers';
    $('input[name="map-mode"][value="centers"]').checked = true;
  }
  render();
  if (!state.borough) { state.map.setView([40.716, -73.94], 10); return; }
  if (showSites) { state.map.setView(boroughCenters[borough], 12); return; }
  const bounds = L.latLngBounds([]);
  state.neighborhoods.eachLayer(layer => {
    if (layer.feature.properties.borough === borough) bounds.extend(layer.getBounds());
  });
  if (bounds.isValid()) state.map.fitBounds(bounds, {padding:[30,30], maxZoom:11});
}
function clearAreaSelection() {
  state.borough = '';
  state.ntaCode = '';
  state.ntaName = '';
  render();
}
function sortedCenters(centers) {
  const value = $('#sort').value;
  return [...centers].sort((a,b) => {
    if (value === 'workstations') return (b.workstations ?? -1) - (a.workstations ?? -1) || a.name.localeCompare(b.name);
    if (value === 'wifi') return (b.wifi_mbps ?? -1) - (a.wifi_mbps ?? -1) || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  });
}
function renderList() {
  const list = $('#center-list');
  const centers = sortedCenters(state.filtered);
  $('#list-count').textContent = centers.length;
  if (!centers.length) {
    list.innerHTML = '<div class="empty">No public computer centers match these filters. Try clearing a filter or selecting another neighborhood.</div>';
    return;
  }
  list.innerHTML = centers.map(center => {
    const flags = serviceSummary(center).slice(0,3);
    const badge = center.connected_communities ? '<span class="card-badge">Connected Communities</span>' : '';
    const warning = center.location_conflict ? '<span class="card-warning">Location review</span>' : '';
    return `<button type="button" class="center-card" data-id="${escapeHtml(center.id)}"><div class="card-top"><span class="card-type">${escapeHtml(center.type)} · ${escapeHtml(center.borough)}</span>${badge}</div><h4>${escapeHtml(center.name)}</h4><p>${escapeHtml(center.address)}</p><div class="card-flags">${flags.map(flag => `<span>${escapeHtml(flag)}</span>`).join('')}${center.need ? `<span class="need-flag">${needLabel(center.need)}</span>` : ''}${warning}</div></button>`;
  }).join('');
  list.querySelectorAll('.center-card').forEach(button => button.addEventListener('click', () => openDetail(button.dataset.id, true)));
}
function renderSupplementary() {
  const fixed = state.extra.unmapped_fixed;
  const mapped = [...state.extraFiltered].sort((a,b) => a.name.localeCompare(b.name));
  const mobile = state.extra.mobile;
  $('#extra-panel').hidden = !mapped.length;
  $('#extra-summary').textContent = `${mapped.length} Connected Communities locations shown separately`;
  $('#extra-list').innerHTML = mapped.map(item => `<button type="button" class="supplementary-card extra-card" data-extra-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.borough)} · ${escapeHtml(item.type)} · ${escapeHtml(needLabel(item.need))}</span><small>${escapeHtml(item.address)}</small></button>`).join('');
  $('#extra-list').querySelectorAll('.extra-card').forEach(button => button.addEventListener('click', () => openExtraDetail(button.dataset.extraId, true)));
  $('#unmapped-panel').hidden = !fixed.length;
  $('#unmapped-summary').textContent = `${fixed.length} additional locations · location review`;
  $('#mobile-summary').textContent = `${mobile.length} mobile service listings · no map points`;
  $('#unmapped-list').innerHTML = fixed.map(item => `<div class="supplementary-card"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.borough)} · ${escapeHtml(item.type)}</span><small>${escapeHtml(item.address)}</small></div>`).join('');
  $('#mobile-list').innerHTML = mobile.map(item => `<div class="supplementary-card"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.borough)}</span></div>`).join('');
}
function markerStyle(center) {
  const citywide = state.map.getZoom() <= 10;
  const highlighted = $('#funded-toggle').checked && center.connected_communities;
  const conflict = center.location_conflict;
  return {
    radius: citywide ? (highlighted ? 5.1 : 3.5) : (highlighted ? 7 : 5.2),
    color: conflict ? '#c58130' : highlighted ? '#df684c' : '#fffdf9',
    weight: conflict || highlighted ? (citywide ? 2.3 : 3) : (citywide ? .8 : 1.2),
    fillColor: '#116e72', fillOpacity: conflict ? .65 : .92,
    dashArray: conflict ? '3 2' : undefined
  };
}
function renderMarkers() {
  state.markers.clearLayers();
  const fragment = L.layerGroup();
  const showSites = state.markerMode === 'centers';
  $('#marker-legend').textContent = showSites ? 'Public computer center' : 'Borough total · select to see locations';
  if (showSites) {
    const ordered = [...state.filtered].sort((a,b) => Boolean(a.connected_communities) - Boolean(b.connected_communities));
    ordered.forEach(center => {
      const marker = L.circleMarker([center.lat, center.lon], {...markerStyle(center), bubblingMouseEvents:false});
      const note = center.location_conflict ? ' · location needs review' : '';
      marker.bindTooltip(`${escapeHtml(center.name)}${note}`, {direction:'top', offset:[0,-5]});
      marker.on('click', () => openDetail(center.id, false));
      marker.addTo(fragment);
    });
    state.extraFiltered.forEach(entry => {
      const icon = L.divIcon({className:'cc-only-marker', html:'<span></span>', iconSize:[18,18], iconAnchor:[9,9]});
      L.marker([entry.lat, entry.lon], {icon, keyboard:true, title:`${entry.name}: additional Connected Communities site`})
        .bindTooltip(escapeHtml(entry.name), {direction:'top', offset:[0,-8]})
        .on('click', () => openExtraDetail(entry.id, false)).addTo(fragment);
    });
  } else {
    boroughs.forEach(borough => {
      const count = state.filtered.filter(center => center.borough === borough).length
        + state.extraFiltered.filter(entry => entry.borough === borough).length;
      if (!count) return;
      const icon = L.divIcon({className:'borough-marker', html:`<div class="borough-bubble"><strong>${count}</strong><span>${borough}</span></div>`, iconSize:[82,82], iconAnchor:[41,41]});
      L.marker(boroughCenters[borough], {icon, keyboard:true, title:`${borough}: ${count} matching sites. Select to see individual sites.`})
        .on('click', () => selectBorough(borough, true)).addTo(fragment);
    });
  }
  fragment.addTo(state.markers);
}
function renderDistrictSummary() {
  $('#nta-active').hidden = !state.ntaCode;
  $('#district-summary').hidden = !state.ntaCode;
  if (!state.ntaCode) return;
  const feature = state.nta.features.find(item => item.properties.code === state.ntaCode);
  const props = feature?.properties || {};
  const centers = state.centers.filter(center => center.analysis_nta === state.ntaCode);
  const extraCount = state.extra.mapped_fixed.filter(entry => entry.nta === state.ntaCode).length;
  const ccCount = centers.filter(center => center.connected_communities).length + extraCount;
  $('#nta-active-label').textContent = `${state.ntaName} · ${state.ntaCode}`;
  $('#district-summary').innerHTML = `<strong>${escapeHtml(needLabel(props.need))}</strong><span>${centers.length} public computer centers · ${ccCount} Connected Communities locations</span><small>Counts use the original 2020 NTA boundaries and reviewed point locations.</small>`;
}
function render() {
  state.filtered = state.centers.filter(center => matchFilters(center));
  state.extraFiltered = state.extra.mapped_fixed.filter(entry => matchExtra(entry));
  renderBoroughChart();
  renderList();
  renderSupplementary();
  renderMarkers();
  renderDistrictSummary();
  const ccShown = state.filtered.filter(center => center.connected_communities).length + state.extraFiltered.length;
  $('#coverage-summary').textContent = `${state.filtered.length} public computer centers shown · ${ccShown} Connected Communities locations shown`;
  if (state.neighborhoods) state.neighborhoods.setStyle(ntaStyle);
}
function ntaStyle(feature) {
  const active = state.ntaCode === feature.properties.code;
  const need = feature.properties.need;
  const needOn = $('#district-toggle').checked && Boolean(need);
  const allBorders = $('#nta-toggle').checked;
  return {
    color: active ? '#9b422d' : needOn ? '#ad694f' : '#64858b',
    weight: active ? 2.2 : needOn ? .85 : allBorders ? .7 : 0,
    opacity: active ? .95 : needOn ? .65 : allBorders ? .4 : 0,
    fillColor: need === 'very high' ? '#d86b55' : '#eabf67',
    fillOpacity: needOn ? (active ? .38 : need === 'very high' ? .24 : .21) : 0,
  };
}
function setupMap() {
  state.map = L.map('map', {preferCanvas:true, zoomControl:false, minZoom:9}).setView([40.716,-73.94], 10);
  L.control.zoom({position:'topright'}).addTo(state.map);
  const attribution = 'Basemap: <a href="https://www.arcgis.com/home/item.html?id=a2cd9acac9184a2f8057539b210d6bae">Esri Light Gray Canvas</a> · Esri, HERE, Garmin, <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>, GIS User Community';
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {maxNativeZoom:16, maxZoom:19, attribution}).addTo(state.map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {maxNativeZoom:16, maxZoom:19, opacity:.85}).addTo(state.map);
  state.neighborhoods = L.geoJSON(state.nta, {
    style: ntaStyle,
    bubblingMouseEvents: false,
    onEachFeature(feature, layer) {
      const {code, name, need} = feature.properties;
      layer.bindTooltip(`${escapeHtml(name)} · ${escapeHtml(code)}${need ? ` · ${escapeHtml(needLabel(need))}` : ''}`, {sticky:true});
      layer.on('click', () => {
        const wasViewingNta = Boolean(state.ntaCode);
        state.borough = feature.properties.borough;
        state.ntaCode = code;
        state.ntaName = name;
        render();
        if (!wasViewingNta) state.map.fitBounds(layer.getBounds(), {padding:[25,25], maxZoom:13});
      });
    }
  }).addTo(state.map);
  state.markers = L.layerGroup().addTo(state.map);
  state.map.on('zoomend', renderMarkers);
  state.map.on('click', () => { if (state.ntaCode || state.borough) clearAreaSelection(); });
  render();
}
function detailsHtml(center) {
  const services = [
    ['Public computers', center.workstations == null ? 'Not reported' : `${center.workstations} workstations`],
    ['Wi-Fi download', center.wifi_mbps == null ? 'Not reported' : `${center.wifi_mbps} Mbps reported`],
    ['Digital literacy', center.literacy ? 'Reported' : 'Not reported / no'],
    ['Technology courses', center.courses ? 'Reported' : 'Not reported / no'],
    ['Staffed', center.staffed ? 'Yes' : 'No / not reported'],
    ['Wheelchair accessible', yesNo(center.wheelchair)],
    ['Language access', yesNo(center.language)],
    ['Assistive technology', yesNo(center.assistive)],
    ['Device loaning', center.device_loan ? 'Reported' : 'Not reported / no']
  ];
  const url = /^https?:\/\//i.test(center.url || '') ? center.url : null;
  const cc = center.connected_communities;
  const ccHtml = cc ? `<div class="detail-section"><h3>CONNECTED COMMUNITIES LIST</h3><div class="detail-row"><span>Listing</span><strong>${escapeHtml(cc.name)}</strong></div><div class="detail-row"><span>Facility type</span><strong>${escapeHtml(cc.type)}</strong></div><div class="detail-row"><span>Listed address</span><strong>${escapeHtml(cc.address)}</strong></div><div class="note-box">This source identifies the site as part of Connected Communities. The PCC service details below come from the separate 2024 public file.</div></div>` : '';
  const positionNote = center.location_conflict ? `<div class="note-box">Location needs review: this point falls in ${escapeHtml(center.geometry_nta)} but the 2024 PCC record lists ${escapeHtml(center.nta)}. It is excluded from district counts until resolved.</div>` : '';
  const correctedNote = center.location_corrected ? `<div class="note-box">The 2024 PCC point was outside its listed NTA. This preview places the marker at the reviewed street address using NYC Planning GeoSearch.${center.location_note ? ` ${escapeHtml(center.location_note)}` : ''}${center.location_source_url ? ` <a href="${escapeHtml(center.location_source_url)}" target="_blank" rel="noopener noreferrer">Address source ↗</a>` : ''}</div>` : '';
  const ntag = center.analysis_nta ? `NTA ${escapeHtml(center.analysis_nta)}` : 'NTA assignment under review';
  return `<div class="drawer-inner"><div class="detail-type">${escapeHtml(center.type)} · ${escapeHtml(center.borough)}</div><h2>${escapeHtml(center.name)}</h2><p class="detail-address">${escapeHtml(center.address)}</p><div class="detail-tags"><span>2024 city PCC listing</span>${cc ? '<span class="cc-tag">Connected Communities</span>' : ''}<span>${ntag}</span>${center.need ? `<span>${escapeHtml(needLabel(center.need))}</span>` : ''}</div>${positionNote}${correctedNote}${ccHtml}<div class="detail-section"><h3>REPORTED ACCESS & SERVICES</h3>${services.map(([label,value]) => `<div class="detail-row"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}<div class="note-box">The city file does not identify on-site technical support. “Staffed” is not treated as tech support. Wi-Fi figures are reported download speeds, not verified user speeds.</div></div><div class="detail-section"><h3>DATA NOTES</h3><div class="detail-row"><span>City record ID</span><strong>${escapeHtml(center.id)}</strong></div><div class="detail-row"><span>Oversight agency</span><strong>${escapeHtml(center.agency)}</strong></div><div class="detail-row"><span>2020 NTA code in city file</span><strong>${escapeHtml(center.nta || 'Not listed')}</strong></div>${center.source_borough ? `<div class="note-box">The city file's borough field says ${escapeHtml(center.source_borough)}. The map uses ${escapeHtml(center.borough)} from its address city; this discrepancy has not been resolved.</div>` : ''}<div class="detail-links"><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(center.address)}" target="_blank" rel="noopener noreferrer">Open directions ↗</a>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Site website ↗</a>` : ''}</div></div></div>`;
}
function openDrawer() { $('#detail-drawer').hidden = false; $('#scrim').hidden = false; }
function closeDrawers() { $('#detail-drawer').hidden = true; $('#scrim').hidden = true; }
function openDetail(identifier, pan) {
  const center = state.centers.find(item => String(item.id) === String(identifier));
  if (!center) return;
  $('#detail-content').innerHTML = detailsHtml(center);
  openDrawer();
  if (pan) state.map.panTo([center.lat, center.lon]);
}
function openExtraDetail(identifier, pan) {
  const entry = state.extra.mapped_fixed.find(item => item.id === identifier);
  if (!entry) return;
  const note = entry.location_note ? `<div class="note-box">${escapeHtml(entry.location_note)}${entry.location_source_url ? ` <a href="${escapeHtml(entry.location_source_url)}" target="_blank" rel="noopener noreferrer">Address source ↗</a>` : ''}</div>` : '';
  const boroughNote = entry.source_borough ? `<div class="note-box">The supplied list says ${escapeHtml(entry.source_borough)}; this preview uses ${escapeHtml(entry.borough)} based on the reviewed location.</div>` : '';
  $('#detail-content').innerHTML = `<div class="drawer-inner"><div class="detail-type">${escapeHtml(entry.type)} · ${escapeHtml(entry.borough)}</div><h2>${escapeHtml(entry.name)}</h2><p class="detail-address">${escapeHtml(entry.address)}</p><div class="detail-tags"><span class="cc-tag">Connected Communities</span><span>NTA ${escapeHtml(entry.nta)}</span>${entry.need ? `<span>${escapeHtml(needLabel(entry.need))}</span>` : ''}</div><div class="note-box">We could not confidently pair this location with a public computer center in the 2024 list, so service details from that list are not shown.</div>${note}${boroughNote}<div class="detail-section"><h3>LOCATION</h3><div class="detail-row"><span>2020 NTA</span><strong>${escapeHtml(entry.nta)}</strong></div><div class="detail-row"><span>Listed address</span><strong>${escapeHtml(entry.source_address)}</strong></div><div class="detail-links"><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(entry.address)}" target="_blank" rel="noopener noreferrer">Open directions ↗</a></div></div></div>`;
  openDrawer();
  if (pan) state.map.panTo([entry.lat, entry.lon]);
}
function resetFilters() {
  $('#search').value = '';
  $('#type').value = '';
  $('#funding').value = '';
  ['computers','wifi','literacy','staffed','wheelchair'].forEach(id => $(`#${id}`).checked = false);
  state.borough = '';
  state.ntaCode = '';
  state.ntaName = '';
  render();
  state.map.setView([40.716,-73.94],10);
}
function wireControls() {
  ['search','funding','type','computers','wifi','literacy','staffed','wheelchair'].forEach(id => $(`#${id}`).addEventListener(id === 'search' ? 'input' : 'change', render));
  document.querySelectorAll('input[name="map-mode"]').forEach(input => input.addEventListener('change', event => {state.markerMode=event.target.value;renderMarkers();}));
  ['district-toggle','funded-toggle','nta-toggle'].forEach(id => $(`#${id}`).addEventListener('change', () => {state.neighborhoods.setStyle(ntaStyle);renderMarkers();}));
  $('#borough-reset').addEventListener('click', () => selectBorough(state.borough));
  $('#sort').addEventListener('change', renderList);
  $('#clear-nta').addEventListener('click', clearAreaSelection);
  $('#clear-filters').addEventListener('click', resetFilters);
  $('#detail-close').addEventListener('click', closeDrawers);
  $('#scrim').addEventListener('click', closeDrawers);
  document.addEventListener('keydown', event => {if (event.key === 'Escape') closeDrawers();});
}
async function start() {
  try {
    const responses = await Promise.all([
      fetch('./centers.json?v=release-1'), fetch('./nta.geojson?v=release-1'), fetch('./connected_extra.json?v=release-1')
    ]);
    if (responses.some(response => !response.ok)) throw new Error('Map data could not be loaded.');
    [state.centers, state.nta, state.extra] = await Promise.all(responses.map(response => response.json()));
    if (!window.L) throw new Error('Map library could not be loaded.');
    wireControls();
    setupMap();
  } catch (error) {
    $('#map').innerHTML = `<div class="error-message">${escapeHtml(error.message)} Try reloading the page.</div>`;
    console.error(error);
  }
}
start();
