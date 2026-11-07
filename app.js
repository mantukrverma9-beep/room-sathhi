// These are the parts of the page that change when a renter or owner uses the site.
const grid = document.querySelector('#listingGrid');
const count = document.querySelector('#resultCount');
const empty = document.querySelector('#emptyState');
const listingDialog = document.querySelector('#listingDialog');
const listingForm = document.querySelector('#listingForm');
const toast = document.querySelector('#toast');
let activeType = 'Any';
let searchTimer;
let currentAccount = null;
let staticPreview = location.hostname.endsWith('github.io');
let staticListingsCache = [];
let authMode = 'login';
let pendingListing = false;
let editingListing = null;
let myListingsCache = [];
let locationData = null;
let pinOffices = [];

// Escape user-entered text before putting it inside the page's HTML.
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
function money(value) { return Number(value).toLocaleString('en-IN'); }

// Turn one saved room into a clickable card in the search results.
function card(item) {
  const amenities = (item.amenities || []).slice(0, 2).map(escapeHtml).join(' <span>·</span> ');
  const location = [item.district, item.state, item.pincode].filter(Boolean).join(' · ');

  return `
    <article class="listing-card">
      <button
        class="listing-open"
        data-listing="${escapeHtml(item.id)}"
        aria-label="View details for ${escapeHtml(item.title)}"
      >
        <span class="listing-image">
          <img
            loading="lazy"
            src="${escapeHtml(item.image)}"
            alt="${escapeHtml(item.title)}"
          >
          <span class="type-pill">${escapeHtml(item.type)}</span>
          ${item.video ? '<span class="video-pill">▶ Video tour</span>' : ''}
        </span>
        <span class="listing-info">
          <span class="listing-location">⌖ ${escapeHtml(item.area)}, ${escapeHtml(item.city)}</span>
          <span class="location-sub">${escapeHtml(location)}</span>
          <span class="listing-title">${escapeHtml(item.title)}</span>
          <span class="listing-meta">
            <span>${escapeHtml(item.gender || 'Any')}</span>
            <span>${item.furnished ? 'Furnished' : 'Unfurnished'}</span>
            ${amenities ? `<span>${amenities}</span>` : ''}
          </span>
          <span class="listing-bottom">
            <span class="price">₹${money(item.rent)} <small>/ month</small></span>
            <span class="host">Hosted by ${escapeHtml(item.owner)}</span>
          </span>
          <span class="card-details-link">See photos, deposit &amp; house rules <b>→</b></span>
        </span>
      </button>
    </article>`;
}
async function loadListings() {
  const params = new URLSearchParams();
  const q = document.querySelector('#searchQ').value.trim();
  const budget = document.querySelector('#searchBudget').value;
  if (q) params.set('q', q);
  if (activeType !== 'Any') params.set('type', activeType);
  if (budget) params.set('maxRent', budget);
  try {
    let listings;
    if (staticPreview) {
      listings = await loadStaticListings(q, budget);
    } else {
      try {
        const response = await fetch(`/api/listings?${params}`);
        if (!response.ok) throw new Error('Backend is not available.');
        listings = await response.json();
      } catch {
        staticPreview = true;
        showStaticPreviewNotice();
        listings = await loadStaticListings(q, budget);
      }
    }
    grid.innerHTML = listings.map(card).join('');
    count.textContent = `${listings.length} ${listings.length === 1 ? 'place' : 'places'} to explore`;
    empty.hidden = listings.length > 0;
  } catch (err) {
    grid.innerHTML = `<div class="loading-card">Couldn't load places. Please refresh and try again.</div>`;
    count.textContent = 'Places are temporarily unavailable';
  }
}

async function loadStaticListings(query = '', budget = '') {
  const response = await fetch('data/listings.json');
  if (!response.ok) throw new Error('Sample listings could not be loaded from this GitHub Pages site.');
  staticListingsCache = await response.json();
  const search = query.toLowerCase();
  const maxRent = Number(budget) || Infinity;
  return staticListingsCache.filter(item => {
    const text = [item.title, item.city, item.area, item.district, item.state, item.pincode, item.type]
      .filter(Boolean).join(' ').toLowerCase();
    return item.available !== false
      && (!search || text.includes(search))
      && (activeType === 'Any' || item.type === activeType)
      && Number(item.rent) <= maxRent;
  });
}

function showStaticPreviewNotice() {
  document.querySelector('#hostingNotice').hidden = false;
}

function showToast(message) { toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 3200); }
function setAccount(user) {
  currentAccount = user;
  document.querySelector('#loginBtn').textContent = user ? 'Log out' : 'Log in';
  document.querySelector('#myListingsBtn').hidden = !user;
  document.querySelector('#adminReviewBtn').hidden = !user?.isAdmin;
}

function showLinkMessage(container, message, url) {
  container.replaceChildren(document.createTextNode(message));
  if (!url) return;
  const link = document.createElement('a');
  link.href = url;
  link.textContent = ' Open the local link';
  link.rel = 'noreferrer';
  container.append(link);
}

function renderAdminListing(item) {
  return `<article class="manage-card">
    <img src="${escapeHtml(item.image)}" alt="">
    <div class="manage-card-copy"><b>${escapeHtml(item.title)}</b>
      <small>${escapeHtml(item.area)}, ${escapeHtml(item.city)}, ${escapeHtml(item.state)} · ₹${money(item.rent)}/month</small>
      <small>Owner: ${escapeHtml(item.owner)}</small>
    </div>
    <div class="manage-actions">
      <button class="button button-green admin-approve" data-id="${escapeHtml(item.id)}">Approve</button>
      <button class="delete-listing admin-reject" data-id="${escapeHtml(item.id)}">Reject</button>
    </div>
  </article>`;
}

async function loadAdminQueue() {
  const container = document.querySelector('#adminQueue');
  container.innerHTML = '<div class="loading-card">Loading listings to review…</div>';
  try {
    const response = await fetch('/api/admin/listings');
    const items = await response.json();
    if (!response.ok) throw new Error(items.error || 'Could not load the review queue.');
    container.innerHTML = items.length
      ? items.map(renderAdminListing).join('')
      : '<div class="manage-empty"><h3>Nothing to review</h3><p>New listings will appear here.</p></div>';
  } catch (error) {
    container.innerHTML = `<div class="details-error">${escapeHtml(error.message)}</div>`;
  }
}

// India and Chhattisgarh location suggestions. The fields also accept typed text.
function fillOptions(list, values) {
  list.replaceChildren(...values.map(value => { const option = document.createElement('option'); option.value = value; return option; }));
}
async function loadLocationHints() {
  try {
    const response = await fetch('/api/locations');
    if (!response.ok) throw new Error('Could not load location suggestions.');
    locationData = await response.json();
  } catch {
    try {
      const [statesResponse, districtsResponse] = await Promise.all([
        fetch('data/india-states.json'),
        fetch('data/chhattisgarh-locations.json')
      ]);
      if (!statesResponse.ok || !districtsResponse.ok) return;
      locationData = {
        states: await statesResponse.json(),
        chhattisgarh: await districtsResponse.json()
      };
      staticPreview = true;
      showStaticPreviewNotice();
    } catch { /* Address fields still accept typed locations without suggestions. */ }
  }
  if (!locationData) return;
  fillOptions(document.querySelector('#indiaStates'), locationData.states);
  fillOptions(document.querySelector('#cgDistricts'), locationData.chhattisgarh.map(item => item.district));
  updateCityHints();
}
function updateCityHints() {
  const state = document.querySelector('#listingState').value.trim().toLowerCase();
  const district = document.querySelector('#listingDistrict').value.trim().toLowerCase();
  if (state !== 'chhattisgarh' || !locationData) { fillOptions(document.querySelector('#cgCities'), []); return; }
  const chosenDistrict = locationData.chhattisgarh.find(item => item.district.toLowerCase() === district);
  const cities = chosenDistrict ? chosenDistrict.cities : locationData.chhattisgarh.flatMap(item => item.cities);
  fillOptions(document.querySelector('#cgCities'), [...new Set(cities)].sort());
}
function choosePostOffice(index) {
  const office = pinOffices[Number(index)];
  if (!office) return;
  document.querySelector('#listingState').value = office.State || 'Chhattisgarh';
  document.querySelector('#listingDistrict').value = office.District || '';
  document.querySelector('#listingCity').value = office.Block || office.District || '';
  document.querySelector('#listingArea').value = office.Name || '';
  updateCityHints();
}
async function findPinLocation() {
  const pin = document.querySelector('#listingPincode').value.trim();
  const status = document.querySelector('#pinLookupStatus');
  const officeSelect = document.querySelector('#pinOffice');
  if (!/^\d{6}$/.test(pin)) { status.textContent = 'Enter a 6 digit PIN code first.'; return; }
  const button = document.querySelector('#lookupPin'); button.disabled = true; status.textContent = 'Looking up postal areas…'; officeSelect.hidden = true;
  try {
    const response = await fetch(`https://api.postalpincode.in/pincode/${encodeURIComponent(pin)}`);
    const result = await response.json(); const offices = result[0]?.Status === 'Success' ? result[0].PostOffice || [] : [];
    if (!offices.length) { status.textContent = 'No post office found for that PIN. You can still enter the location yourself.'; return; }
    pinOffices = offices;
    officeSelect.replaceChildren(...offices.map((office, index) => {
      const option = document.createElement('option'); option.value = String(index);
      option.textContent = `${office.Name} · ${office.Block || office.District}, ${office.District}, ${office.State}`;
      return option;
    }));
    officeSelect.hidden = offices.length < 2;
    choosePostOffice(0);
    status.textContent = offices.length > 1 ? `Found ${offices.length} post offices. Choose the one nearest your room.` : 'Location filled from the PIN code. Please check the details.';
  } catch {
    status.textContent = 'PIN lookup needs an internet connection. You can enter the location yourself.';
  } finally { button.disabled = false; }
}
function updateRentMinimum() {
  const type = document.querySelector('#listingType').value;
  const min = type === 'PG' ? 1500 : type === 'Flat' ? 5000 : 1;
  const rent = document.querySelector('#listingRent');
  rent.min = String(min);
  document.querySelector('#rentHint').textContent = type === 'PG' ? 'PG rent starts at ₹1,500/month.' : type === 'Flat' ? 'Flat rent starts at ₹5,000/month.' : 'Enter monthly rent.';
  rent.setCustomValidity(rent.value && Number(rent.value) < min ? `Minimum rent for ${type} is ₹${money(min)} per month.` : '');
}
async function openListing(target = null) {
  if (staticPreview) {
    showToast('GitHub Pages is a read-only preview. Login and posting need the Node.js backend.');
    return;
  }
  if (!currentAccount) { pendingListing = true; document.querySelector('#loginDialog').showModal(); return; }
  listingForm.reset(); previewUrls.forEach(URL.revokeObjectURL); previewUrls = [];
  document.querySelector('#photoPreview').innerHTML = ''; document.querySelector('#videoName').textContent = 'Optional short room tour.';
  document.querySelector('#formError').textContent = ''; editingListing = target;
  document.querySelector('#listingDialog h2').innerHTML = target ? 'Edit your <em>place.</em>' : 'List your <em>place.</em>';
  document.querySelector('.submit-listing').innerHTML = target ? 'Save changes <span>→</span>' : 'Publish listing <span>→</span>';
  document.querySelector('#existingMediaNote').textContent = target && ((target.photos || []).length || target.video) ? 'Current photos/video stay unless you choose replacements.' : '';
  if (target) {
    for (const key of ['title', 'state', 'district', 'city', 'area', 'pincode', 'type', 'gender', 'rent', 'deposit', 'phone']) if (listingForm.elements[key]) listingForm.elements[key].value = target[key] ?? '';
    listingForm.elements.amenities.value = (target.amenities || []).join(', ');
    listingForm.elements.rules.value = (target.rules || []).join('\n');
    listingForm.elements.furnished.checked = Boolean(target.furnished);
  }
  updateRentMinimum(); listingDialog.showModal();
}
async function openDetails(id) {
  const content = document.querySelector('#detailsContent');
  content.innerHTML = '<div class="loading-card">Loading the place details…</div>';
  document.querySelector('#detailsDialog').showModal();
  try {
    if (staticPreview) {
      const item = staticListingsCache.find(listing => listing.id === id);
      if (!item) throw new Error('This sample place could not be found.');
      content.innerHTML = renderDetails(item);
      return;
    }
    const response = await fetch(`/api/listings?id=${encodeURIComponent(id)}`);
    const found = await response.json();
    if (!response.ok || !found.length) throw new Error('This place is no longer available.');
    content.innerHTML = renderDetails(found[0]);
  } catch (err) { content.innerHTML = `<div class="details-error">${escapeHtml(err.message)}</div>`; }
}

function renderDetails(item) {
  const photos = (item.photos?.length ? item.photos : [item.image]).slice(0, 5);
  const phone = (item.phone || '').replace(/[^+\d]/g, '');
  const fullAddress = [item.district, item.state, item.pincode && `PIN ${item.pincode}`, 'India']
    .filter(Boolean)
    .join(' · ');
  const amenities = (item.amenities || []).map(name => `<span>✓ ${escapeHtml(name)}</span>`).join('');
  const rules = (item.rules || []).map(rule => `<li>${escapeHtml(rule)}</li>`).join('');

  const photoGallery = photos.map((photo, index) => `
    <img
      class="${index === 0 ? 'gallery-main' : ''}"
      src="${escapeHtml(photo)}"
      alt="${escapeHtml(item.title)} — photo ${index + 1}"
    >
  `).join('');

  const videoTour = item.video ? `
    <div class="tour-video">
      <video controls preload="metadata" src="${escapeHtml(item.video)}">
        Your browser does not support video playback.
      </video>
      <small>Room video tour</small>
    </div>
  ` : '';

  const contactButton = phone
    ? `<a class="button button-dark host-contact" href="tel:${escapeHtml(phone)}">Call host ↗</a>`
    : '<small class="host-private">Host has not shared a public phone number.</small>';

  return `
    <div class="details-layout">
      <div class="details-media">
        <div class="details-gallery">${photoGallery}</div>
        ${videoTour}
      </div>
      <div class="details-copy">
        <span class="type-pill details-type">${escapeHtml(item.type)}</span>
        <div class="listing-location">⌖ ${escapeHtml(item.area)}, ${escapeHtml(item.city)}</div>
        <div class="location-sub details-address">${escapeHtml(fullAddress)}</div>
        <h2>${escapeHtml(item.title)}</h2>
        <div class="details-price">₹${money(item.rent)} <small>/ month</small></div>

        <div class="details-facts">
          <div><small>DEPOSIT</small><b>₹${money(item.deposit)}</b></div>
          <div><small>WHO CAN STAY</small><b>${escapeHtml(item.gender || 'Any')}</b></div>
          <div><small>FURNISHING</small><b>${item.furnished ? 'Furnished' : 'Unfurnished'}</b></div>
        </div>

        <h3>Amenities</h3>
        <div class="amenity-list">${amenities || '<span>Ask the host about amenities.</span>'}</div>

        <h3>House rules</h3>
        <ul class="rules-list">${rules || '<li>Please confirm house rules with the host before booking.</li>'}</ul>

        <div class="host-card">
          <span class="host-avatar">${escapeHtml(item.owner.slice(0, 1).toUpperCase())}</span>
          <span><b>${escapeHtml(item.owner)}</b><small>Host</small></span>
          ${contactButton}
        </div>
      </div>
    </div>`;
}

function renderManagedListing(item) {
  const statusLabel = item.status === 'pending'
    ? 'Waiting for admin review'
    : !item.available
      ? 'Marked rented'
      : 'Available';
  const statusClass = item.status === 'pending' ? 'is-pending' : item.available ? 'is-available' : 'is-rented';
  return `
    <article class="manage-card">
      <img src="${escapeHtml(item.image)}" alt="">
      <div class="manage-card-copy">
        <b>${escapeHtml(item.title)}</b>
        <small>${escapeHtml(item.area)}, ${escapeHtml(item.city)}, ${escapeHtml(item.district || '')} · ₹${money(item.rent)}/month</small>
        <span class="status-pill ${statusClass}">
          ${statusLabel}
        </span>
      </div>
      <div class="manage-actions">
        <button class="button button-outline edit-listing" data-id="${escapeHtml(item.id)}">Edit details</button>
        <button class="button button-outline availability-toggle" data-id="${escapeHtml(item.id)}" data-available="${!item.available}">
          ${item.available ? 'Mark rented' : 'Mark available'}
        </button>
        <button class="delete-listing" data-id="${escapeHtml(item.id)}">Remove listing</button>
      </div>
    </article>`;
}

function renderEmptyOwnerDashboard() {
  return `
    <div class="manage-empty">
      <span>⌂</span>
      <h3>No listings yet</h3>
      <p>Your published rooms will appear here.</p>
      <button class="button button-green" id="firstListing">Add a place <span>→</span></button>
    </div>`;
}

async function loadMyListings() {
  const container = document.querySelector('#myListingsContent'); container.innerHTML = '<div class="loading-card">Loading your places…</div>';
  try {
    const response = await fetch('/api/my-listings'); const items = await response.json();
    if (!response.ok) throw new Error(items.error || 'Could not load your listings.');
    myListingsCache = items;
    container.innerHTML = items.length
      ? items.map(renderManagedListing).join('')
      : renderEmptyOwnerDashboard();
  } catch (err) { container.innerHTML = `<div class="details-error">${escapeHtml(err.message)}</div>`; }
}
async function uploadFile(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });

  const response = await fetch('/api/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mimeType: file.type, dataBase64: dataUrl })
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || `Could not upload ${file.name}.`);
  }

  return result.url;
}

// Search and filter controls.
document.querySelector('#searchForm').addEventListener('submit', event => {
  event.preventDefault();
  loadListings();
  document.querySelector('#discover').scrollIntoView({ behavior: 'smooth' });
});
document.querySelector('#searchBudget').addEventListener('change', loadListings);
document.querySelector('#searchQ').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadListings, 350);
});
document.querySelectorAll('.filter-chip').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach(chip => chip.classList.remove('active'));
    button.classList.add('active');
    activeType = button.dataset.filter;
    document.querySelector('#searchType').value = activeType;
    loadListings();
  });
});
document.querySelector('#searchType').addEventListener('change', event => {
  activeType = event.target.value;
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.filter === activeType);
  });
  loadListings();
});

// Owner forms and dialog close buttons.
['listTop', 'listSection', 'listBottom'].forEach(id => {
  document.querySelector(`#${id}`).addEventListener('click', openListing);
});
document.querySelector('#listingType').addEventListener('change', updateRentMinimum);
document.querySelector('#listingRent').addEventListener('input', updateRentMinimum);
document.querySelector('#listingState').addEventListener('input', updateCityHints);
document.querySelector('#listingDistrict').addEventListener('input', updateCityHints);
document.querySelector('#lookupPin').addEventListener('click', findPinLocation);
document.querySelector('#pinOffice').addEventListener('change', event => {
  choosePostOffice(event.target.value);
});
document.querySelector('#closeDialog').addEventListener('click', () => listingDialog.close());
document.querySelector('#closeDetails').addEventListener('click', () => document.querySelector('#detailsDialog').close());
document.querySelector('#closeMyListings').addEventListener('click', () => document.querySelector('#myListingsDialog').close());
document.querySelector('#adminReviewBtn').addEventListener('click', () => {
  document.querySelector('#adminDialog').showModal();
  loadAdminQueue();
});
document.querySelector('#closeAdmin').addEventListener('click', () => document.querySelector('#adminDialog').close());
document.querySelector('#adminQueue').addEventListener('click', async event => {
  const button = event.target.closest('.admin-approve, .admin-reject');
  if (!button) return;
  const status = button.classList.contains('admin-approve') ? 'approved' : 'rejected';
  button.disabled = true;
  try {
    const response = await fetch(`/api/admin/listings/${encodeURIComponent(button.dataset.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not review listing.');
    await loadAdminQueue();
    await loadListings();
    showToast(status === 'approved' ? 'Listing approved.' : 'Listing rejected.');
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  }
});
document.querySelector('#myListingsBtn').addEventListener('click', () => {
  document.querySelector('#myListingsDialog').showModal();
  loadMyListings();
});
grid.addEventListener('click', event => {
  const button = event.target.closest('[data-listing]');
  if (button) openDetails(button.dataset.listing);
});
grid.addEventListener('error', event => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || image.dataset.fallbackUsed) return;
  image.dataset.fallbackUsed = 'true';
  image.src = 'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=1000&q=85';
}, true);
document.querySelector('#myListingsContent').addEventListener('click', async event => {
  const addButton = event.target.closest('#firstListing');
  if (addButton) {
    document.querySelector('#myListingsDialog').close();
    openListing();
    return;
  }
  const editButton = event.target.closest('.edit-listing');
  if (editButton) {
    const item = myListingsCache.find(listing => listing.id === editButton.dataset.id);
    if (item) {
      document.querySelector('#myListingsDialog').close();
      openListing(item);
    }
    return;
  }
  const toggle = event.target.closest('.availability-toggle');
  const remove = event.target.closest('.delete-listing');
  if (toggle) {
    const response = await fetch(`/api/listings/${encodeURIComponent(toggle.dataset.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ available: toggle.dataset.available === 'true' })
    });
    const result = await response.json();
    if (!response.ok) {
      showToast(result.error || 'Could not update listing.');
      return;
    }
    await loadMyListings();
    await loadListings();
    showToast(result.available ? 'Listing is available again.' : 'Listing marked as rented.');
  } else if (remove && window.confirm('Remove this listing? This cannot be undone.')) {
    const response = await fetch(`/api/listings/${encodeURIComponent(remove.dataset.id)}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) {
      showToast(result.error || 'Could not remove listing.');
      return;
    }
    await loadMyListings();
    await loadListings();
    showToast('Listing removed.');
  }
});
let previewUrls = [];
document.querySelector('#photoFiles').addEventListener('change', event => {
  previewUrls.forEach(URL.revokeObjectURL); previewUrls = [];
  const files = [...event.target.files]; const preview = document.querySelector('#photoPreview');
  if (files.length > 5) { event.target.value = ''; preview.innerHTML = ''; document.querySelector('#formError').textContent = 'Choose no more than 5 photos.'; return; }
  if (files.some(file => file.size > 8 * 1024 * 1024)) { event.target.value = ''; preview.innerHTML = ''; document.querySelector('#formError').textContent = 'Each photo must be smaller than 8 MB.'; return; }
  document.querySelector('#formError').textContent = '';
  previewUrls = files.map(file => URL.createObjectURL(file));
  preview.innerHTML = previewUrls.map((src, i) => `<img src="${src}" alt="Selected room photo ${i + 1}">`).join('');
});
document.querySelector('#videoFile').addEventListener('change', event => {
  const file = event.target.files[0];
  if (file && file.size > 25 * 1024 * 1024) { event.target.value = ''; document.querySelector('#videoName').textContent = 'Video must be smaller than 25 MB.'; document.querySelector('#formError').textContent = 'Choose a video smaller than 25 MB.'; return; }
  document.querySelector('#videoName').textContent = file ? `Selected: ${file.name}` : 'Optional short room tour.'; document.querySelector('#formError').textContent = '';
});
document.querySelector('#browseBtn').addEventListener('click', () => document.querySelector('#discover').scrollIntoView({ behavior: 'smooth' }));
document.querySelector('#loginBtn').addEventListener('click', async () => {
  if (staticPreview) {
    showToast('Login needs the Node.js backend. This GitHub Pages version is for browsing only.');
    return;
  }
  if (!currentAccount) { authMode = 'login'; updateAuthMode(); document.querySelector('#loginDialog').showModal(); return; }
  await fetch('/api/auth/logout', { method: 'POST' }); setAccount(null); showToast('You are logged out.');
});
document.querySelector('#closeLogin').addEventListener('click', () => document.querySelector('#loginDialog').close());
function updateAuthMode() {
  const registering = authMode === 'register';
  document.querySelectorAll('.auth-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.mode === authMode));
  document.querySelector('#authNameWrap').hidden = !registering;
  document.querySelector('#authNameWrap input').required = registering;
  document.querySelector('#authTitle').innerHTML = registering ? 'Make yourself <em>at home.</em>' : 'Welcome <em>back.</em>';
  document.querySelector('#authIntro').textContent = registering ? 'Create an account to publish and manage your place.' : 'Log in to publish your place and manage your listings.';
  document.querySelector('#authSubmit').innerHTML = registering ? 'Create account <span>→</span>' : 'Log in <span>→</span>';
  document.querySelector('#authForm [name="password"]').autocomplete = registering ? 'new-password' : 'current-password';
  document.querySelector('#authError').textContent = '';
  document.querySelector('#authInfo').textContent = '';
  document.querySelector('#resendVerificationBtn').hidden = true;
  document.querySelector('#forgotPasswordBtn').hidden = registering;
}
document.querySelectorAll('.auth-tab').forEach(tab => tab.addEventListener('click', () => { authMode = tab.dataset.mode; updateAuthMode(); }));
document.querySelector('#authForm').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; const error = document.querySelector('#authError'); error.textContent = ''; document.querySelector('#authInfo').textContent = '';
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    const response = await fetch(`/api/auth/${authMode === 'register' ? 'register' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not sign in.');
    if (authMode === 'register') {
      showLinkMessage(document.querySelector('#authInfo'), result.message, result.previewUrl);
      form.reset();
      return;
    }
    setAccount(result.user); document.querySelector('#loginDialog').close(); form.reset(); showToast(`Welcome, ${result.user.name}!`);
    if (pendingListing) { pendingListing = false; openListing(); }
  } catch (err) {
    error.textContent = err.message;
    document.querySelector('#resendVerificationBtn').hidden = !err.message.toLowerCase().includes('verify your email');
  }
});
document.querySelector('#resendVerificationBtn').addEventListener('click', async () => {
  const email = document.querySelector('#authForm [name="email"]').value.trim();
  const info = document.querySelector('#authInfo');
  const error = document.querySelector('#authError');
  error.textContent = ''; info.textContent = '';
  try {
    const response = await fetch('/api/auth/resend-verification', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not prepare a verification link.');
    showLinkMessage(info, result.message, result.previewUrl);
  } catch (err) { error.textContent = err.message; }
});
document.querySelector('#forgotPasswordBtn').addEventListener('click', async () => {
  const email = document.querySelector('#authForm [name="email"]').value.trim();
  const info = document.querySelector('#authInfo');
  const error = document.querySelector('#authError');
  info.textContent = ''; error.textContent = '';
  if (!email) { error.textContent = 'Enter your email address first.'; return; }
  try {
    const response = await fetch('/api/auth/forgot-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not prepare a reset link.');
    showLinkMessage(info, result.message, result.previewUrl);
  } catch (err) { error.textContent = err.message; }
});
document.querySelector('#closeReset').addEventListener('click', () => document.querySelector('#resetDialog').close());
document.querySelector('#resetForm').addEventListener('submit', async event => {
  event.preventDefault();
  const token = new URLSearchParams(location.search).get('reset');
  const error = document.querySelector('#resetError');
  error.textContent = '';
  if (!token) { error.textContent = 'This reset link is missing its token.'; return; }
  try {
    const response = await fetch('/api/auth/reset-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: event.currentTarget.elements.password.value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not reset the password.');
    document.querySelector('#resetDialog').close();
    document.querySelector('#loginDialog').showModal();
    showToast(result.message);
    history.replaceState({}, '', '/');
  } catch (err) { error.textContent = err.message; }
});
document.querySelector('#mobileMenu').addEventListener('click', () => document.querySelector('#how').scrollIntoView({ behavior: 'smooth' }));
listingForm.addEventListener('submit', async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(listingForm).entries());
  const photoFiles = [...document.querySelector('#photoFiles').files];
  const videoFile = document.querySelector('#videoFile').files[0];
  delete data.photoFiles; delete data.videoFile;
  data.furnished = listingForm.elements.furnished.checked;
  const error = document.querySelector('#formError'); error.textContent = '';
  const submitButton = listingForm.querySelector('.submit-listing'); submitButton.disabled = true;
  try {
    if (photoFiles.length > 5) throw new Error('Choose no more than 5 photos.');
    if (photoFiles.some(file => file.size > 8 * 1024 * 1024)) throw new Error('Each photo must be smaller than 8 MB.');
    if (videoFile && videoFile.size > 25 * 1024 * 1024) throw new Error('Video must be smaller than 25 MB.');
    if (photoFiles.length || videoFile) { submitButton.textContent = 'Uploading media…'; if (photoFiles.length) { data.photos = []; for (const file of photoFiles) data.photos.push(await uploadFile(file)); } if (videoFile) data.video = await uploadFile(videoFile); }
    if (editingListing) { if (!data.photos) data.photos = editingListing.photos || []; if (data.video === undefined) data.video = editingListing.video || ''; }
    submitButton.innerHTML = 'Publishing…';
    const response = await fetch(editingListing ? `/api/listings/${encodeURIComponent(editingListing.id)}` : '/api/listings', { method: editingListing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not publish listing.');
    const wasEditing = Boolean(editingListing); editingListing = null; listingDialog.close(); activeType = 'Any'; document.querySelector('#searchType').value = 'Any';
    document.querySelectorAll('.filter-chip').forEach(x => x.classList.toggle('active', x.dataset.filter === 'Any'));
    document.querySelector('#searchQ').value = ''; document.querySelector('#searchBudget').value = '';
    await loadListings(); document.querySelector('#discover').scrollIntoView({ behavior: 'smooth' });
    showToast(result.status === 'pending'
      ? 'Listing sent for review. Renters can see it after approval.'
      : wasEditing ? 'Your listing details are updated.' : 'Your place is live in this local demo.');
  } catch (err) { error.textContent = err.message; }
  finally { submitButton.disabled = false; submitButton.innerHTML = 'Publish listing <span>→</span>'; }
});
loadListings();
if (staticPreview) showStaticPreviewNotice();
fetch('/api/auth/me').then(r => r.json()).then(data => setAccount(data.user)).catch(() => setAccount(null));
loadLocationHints();
const pageParams = new URLSearchParams(location.search);
const verificationToken = pageParams.get('verify');
if (verificationToken) {
  fetch(`/api/auth/verify?token=${encodeURIComponent(verificationToken)}`)
    .then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not verify email.');
      showToast(result.message);
      document.querySelector('#loginDialog').showModal();
      history.replaceState({}, '', '/');
    })
    .catch(error => { document.querySelector('#authError').textContent = error.message; document.querySelector('#loginDialog').showModal(); });
} else if (pageParams.has('reset')) {
  document.querySelector('#resetDialog').showModal();
}
