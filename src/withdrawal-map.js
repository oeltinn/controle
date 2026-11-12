import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import marker from 'leaflet/dist/images/marker-icon.png';
import retina from 'leaflet/dist/images/marker-icon-2x.png';
import shadow from 'leaflet/dist/images/marker-shadow.png';

const icon = L.icon({ iconUrl: marker, iconRetinaUrl: retina, shadowUrl: shadow,
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] });
let map;
let pins;

export function drawMap(container, entries, openDetails) {
  if (!map) {
    map = L.map(container, { scrollWheelZoom: false }).setView([-19.757, -42.076], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    pins = L.featureGroup().addTo(map);
  }
  map.invalidateSize();
  pins.clearLayers();
  for (const { item, point } of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = item.name;
    button.addEventListener('click', () => openDetails(item.id));
    L.marker([point.latitude, point.longitude], { icon, alt: item.name })
      .bindPopup(button).addTo(pins);
  }
  if (entries.length) map.fitBounds(pins.getBounds(), { padding: [32, 32], maxZoom: 16 });
}
