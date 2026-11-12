import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

let map;
let tileLayer;
let markers;
let selectedPopup;
let markerSignature;

export function validCoordinates(item) {
  const lat = Number(item.latitude);
  const lon = Number(item.longitude);
  return item.latitude !== null && item.latitude !== undefined && item.longitude !== null && item.longitude !== undefined &&
    Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0);
}

export function renderWithdrawalMap(element, withdrawals, onOpen) {
  if (!map) {
    map = L.map(element, { zoomControl: true, preferCanvas: true }).setView([-19.79, -42.14], 11);
    markers = L.layerGroup().addTo(map);
  }
  map.invalidateSize();
  const online = navigator.onLine;
  if (online && !tileLayer) {
    tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
  } else if (!online && tileLayer) {
    map.removeLayer(tileLayer);
    tileLayer = null;
  }
  const located = withdrawals.filter(validCoordinates);
  const signature = JSON.stringify(located.map(item => [item.id, item.name, item.latitude, item.longitude]));
  if (signature === markerSignature) return { plotted: located.length, total: withdrawals.length, online };
  markerSignature = signature;
  map.closePopup();
  markers.clearLayers();
  const bounds = [];
  for (const item of located) {
    const point = [Number(item.latitude), Number(item.longitude)];
    bounds.push(point);
    const marker = L.marker(point, { icon: L.divIcon({ className: 'withdrawal-map-marker', html: '<span class="withdrawal-map-pin" aria-hidden="true"><span>●</span></span>', iconSize: [30, 36], iconAnchor: [15, 34] }), title: item.name });
    marker.on('click', () => {
      if (selectedPopup?.id === item.id && selectedPopup.popup.isOpen()) {
        map.closePopup();
        onOpen(item.id);
        return;
      }
      const popup = document.createElement('button');
      popup.type = 'button';
      popup.className = 'withdrawal-map-popup';
      popup.textContent = item.name;
      popup.addEventListener('click', () => onOpen(item.id));
      const leafletPopup = L.popup({ closeButton: false, offset: [0, -28] }).setLatLng(point).setContent(popup);
      selectedPopup = { id: item.id, popup: leafletPopup };
      leafletPopup.openOn(map);
    });
    marker.addTo(markers);
  }
  if (bounds.length === 1) map.setView(bounds[0], 15);
  else if (bounds.length > 1) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
  return { plotted: bounds.length, total: withdrawals.length, online };
}
