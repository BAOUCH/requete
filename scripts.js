import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@latest/+esm";

let db;
let conn; 
let totalPointsCount;
let map;

async function getDb() {
  if (window._db) return window._db;
 
  const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

  const worker_url = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], {
      type: "text/javascript",
    })
  );

  const worker = new Worker(worker_url);
  const logger = new duckdb.ConsoleLogger();
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(worker_url);
  window._db = db;
  return db;
}

// Initialiser une seule fois
async function init() {
  if (window._initCompleted) return; // Vérifie si l'initialisation est déjà faite

  try {
    showLoadingBar();
    updateLoadingBar(10); // Démarrage

    const mapElement = document.getElementById('map');
    if (!mapElement) {
      console.error('L\'élément de la carte est introuvable.');
      return;
    }

    updateLoadingBar(20); // Chargement de la carte
    if (map) {
      map.remove();
    }

    map = L.map('map', {
      center: [30.961, -8.413],
      zoom: 11,
      minZoom: 10,  
      maxBounds: [
        [30.000, -11.000],
        [37.000, -4.000],
      ],
      maxBoundsViscosity: 1.0,
      
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

    updateLoadingBar(40); // Chargement de la base de données
    db = await getDb();
    conn = await db.connect();

    updateLoadingBar(50);
    const geoJSONData = await loadGeoJSON();
    const geoJSONData2 = await loadGeoJSON2();
    const geoJSONData3 = await loadGeoJSON3();

    const features = geoJSONData.features.map(feature => ({
      geometry: JSON.stringify(feature.geometry),
      properties: JSON.stringify(feature.properties),
    }));
    const features2 = geoJSONData2.features.map(feature => ({
      geometry: JSON.stringify(feature.geometry),
      properties: JSON.stringify(feature.properties),
    }));
    const features3 = geoJSONData3.features.map(feature => ({
      geometry: JSON.stringify(feature.geometry),
      properties: JSON.stringify(feature.properties),
    }));
    updateLoadingBar(70);
    await conn.query(`CREATE TABLE IF NOT EXISTS ptouche (geometry JSON, properties JSON);`);
    for (const feature of features) {
      await conn.query(`INSERT INTO ptouche VALUES ('${feature.geometry}', '${feature.properties}');`);
    }

    await conn.query(`CREATE TABLE IF NOT EXISTS surfanal (geometry JSON, properties JSON);`);
    for (const feature of features2) {
      await conn.query(`INSERT INTO surfanal VALUES ('${feature.geometry}', '${feature.properties}');`);
    }

    await conn.query(`CREATE TABLE IF NOT EXISTS epicentre (geometry JSON, properties JSON);`);
    for (const feature of features3) {
      await conn.query(`INSERT INTO epicentre VALUES ('${feature.geometry}', '${feature.properties}');`);
    }
    updateLoadingBar(80);
    window._initCompleted = true; // Marque l'initialisation comme terminée
    updateLoadingBar(90);
    setTimeout(hideLoadingBar, 500); // Cache la barre après un délai
  } catch (error) {
    console.error('Erreur lors de l\'initialisation:', error);
    hideLoadingBar();
  }
}

async function loadGeoJSON() {
  const response = await fetch('ptouche.geojson');
  if (!response.ok) throw new Error('Erreur lors du chargement du GeoJSON');
  return await response.json();
}

async function loadGeoJSON2() {
  const response2 = await fetch('surfanal.geojson');
  if (!response2.ok) throw new Error('Erreur lors du chargement du GeoJSON');
  return await response2.json();
}

async function loadGeoJSON3() {
  const response3 = await fetch('epicentre.geojson');
  if (!response3.ok) throw new Error('Erreur lors du chargement du GeoJSON');
  return await response3.json();
}


async function queryGeoJSON() {
  try {
    const selectedCommune = document.getElementById("commune").value;
    const pointSlider = document.getElementById("pointSlider");
    const sliderValue = pointSlider.value;

    // Determine the LIMIT clause
    const limitClause = sliderValue === "100" 
      ? '' 
      : `LIMIT ${Math.ceil(Number(totalPointsCount) * (sliderValue / 100))}`;

    // Modify the base query to handle ALL communes
    const communeFilter = selectedCommune === 'ALL' 
      ? '' 
      : `WHERE JSON_EXTRACT_STRING(s.properties, '$.Nom_Commun') = '${selectedCommune}'`;

    const query = `
      INSTALL spatial;
      LOAD spatial;
      SELECT p.*
      FROM ptouche AS p
      JOIN surfanal AS s
      ON ST_Contains(ST_GeomFromGeoJSON(s.geometry), ST_GeomFromGeoJSON(p.geometry))
      ${communeFilter}
      ${limitClause};
    `;

    const result = await conn.query(query);
    console.log(result.toArray());
    displayResultsOnMap(result.toArray());
  } catch (error) {
    console.error('Erreur:', error);
    
  }
}


async function queryGeoJSON1() {
  try {
    const distanceInput = document.getElementById("distanceInput").value;
    const distanceThreshold = parseFloat(distanceInput);

    if (isNaN(distanceThreshold) || distanceThreshold <= 0) {
      alert("Veuillez entrer une distance valide.");
      return;
    }

    // Récupérer les données de l'épicentre
    const epicenterData = await conn.query("SELECT * FROM epicentre;");
    const epicenter = JSON.parse(epicenterData.toArray()[0].geometry).coordinates;

    // Créer un groupe de points
    const geoJsonGroupPoints = L.featureGroup();

    // Récupérer tous les points
    const pointsData = await conn.query("SELECT * FROM ptouche;");

    // Traiter chaque point
    pointsData.toArray().forEach(row => {
      const geometry = JSON.parse(row.geometry);
      const latlng = [geometry.coordinates[1], geometry.coordinates[0]];

      // Calculer la distance entre le point et l'épicentre
      const distance = map.distance([epicenter[1], epicenter[0]], latlng);

      // Déterminer la couleur en fonction de la distance
      const pointColor = distance <= distanceThreshold ? 'red' : 'blue';

      // Créer un cercle marker pour le point
      L.circleMarker(latlng, {
        radius: 5,
        color: pointColor,
        fillColor: pointColor,
        weight: 1,
        fillOpacity: 0.8
      }).addTo(geoJsonGroupPoints);
    });

    // Supprimer les couches existantes
    map.eachLayer((layer) => {
      if (!(layer instanceof L.TileLayer)) {
        map.removeLayer(layer);
      }
    });

    // Ajouter le groupe de points à la carte
    geoJsonGroupPoints.addTo(map);

    // Ajouter un cercle autour de l'épicentre
    L.circle([epicenter[1], epicenter[0]], {
      radius: distanceThreshold,
      color: 'green',
      fillOpacity: 0.2
    }).addTo(map);

    // Ajouter un marqueur pour l'épicentre
    L.marker([epicenter[1], epicenter[0]], {
      icon: L.icon({
        iconUrl: 'explosion.png',
        iconSize: [16, 16],
      })
    }).addTo(map);

    // Ajuster la vue pour montrer tous les points
    map.fitBounds(geoJsonGroupPoints.getBounds());

  } catch (error) {
    console.error("Erreur lors de l'analyse par distance :", error);
    alert(`Erreur : ${error.message}`);
  }
}

function addLegend() {
  const legend = L.control({ position: 'bottomright' });

  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'legend');
    div.innerHTML = `
      <h4>Légende:</h4>
      <i style="background: red"></i> Batiment inclus <br>
      <i style="background: blue"></i> Batiment non inclus<br>
      <i style="background: green; opacity: 0.5"></i> Cercle de recherche<br>
      <img src="explosion.png" style="width:16px; height:16px; border:1px solid #000;"> Épicentre<br>
      <img src="accueil.png" style="width:16px; height:16px; border:1px solid #000;"> Batiment<br>
    `;
    return div;
  };

  legend.addTo(map);
}

function displayResultsOnMap(data) {
  if (map) {
    map.eachLayer((layer) => {
      map.removeLayer(layer);

      // Ajouter une couche de tuiles OpenStreetMap
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    });
  } else {
    // Créer une nouvelle carte si elle n'existe pas encore
    

    // Ajouter une couche de tuiles OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  }

  // Définir une icône personnalisée pour les points
  const buildingIcon = L.icon({
    iconUrl: 'accueil.png', // Remplacez par le chemin de votre icône
    iconSize: [8, 8], // Taille de l'icône
    iconAnchor: [12, 12] // Point d'ancrage
  });

  const epicenterIcon = L.icon({
    iconUrl: 'explosion.png', // Remplacez par le chemin de votre icône
    iconSize: [8, 8], // Taille de l'icône
    iconAnchor: [12, 12] // Point d'ancrage
  });

  // Créer un groupe pour toutes les géométries GeoJSON des points
  const geoJsonGroupPoints = L.featureGroup();

  data.forEach(row => {
    const geometry = JSON.parse(row.geometry); // Convertir la géométrie en JSON
    const geoJsonLayer = L.geoJSON(geometry, {
      pointToLayer: (feature, latlng) => {
        return L.marker(latlng, { icon: buildingIcon }); // Utiliser l'icône personnalisée
      }
    });
    geoJsonLayer.addTo(geoJsonGroupPoints); // Ajouter la couche au groupe des points
  });

  geoJsonGroupPoints.addTo(map); // Ajouter le groupe à la carte

  // Charger et afficher le fichier surfanal.geojson
  loadGeoJSON2().then(geoJSONData2 => {
    const geoJsonGroupSurfanal = L.geoJSON(geoJSONData2, {
      style: {
        color: 'blue', // Couleur pour les polygones de surfanal
        weight: 2,
        fillOpacity: 0.3
      }
    });

    geoJsonGroupSurfanal.addTo(map); // Ajouter les polygones à la carte

    // Charger et afficher le fichier epicentre.geojson
    loadGeoJSON3().then(geoJSONData3 => {
      const geoJsonGroupEpicentre = L.featureGroup();

      geoJSONData3.features.forEach(feature => {
        const geometry = feature.geometry; // Géométrie du point
        if (geometry.type === "Point") {
          const coordinates = geometry.coordinates;
          const latlng = [coordinates[1], coordinates[0]]; // Convertir en [lat, lng]

          // Ajouter un marqueur avec l'icône d'épicentre
          const marker = L.marker(latlng, { icon: epicenterIcon });
          marker.addTo(geoJsonGroupEpicentre);
        }
      });

      geoJsonGroupEpicentre.addTo(map); // Ajouter les épicentres à la carte

      // Ajuster la vue pour contenir tous les éléments
      const combinedBounds = geoJsonGroupPoints.getBounds()
        .extend(geoJsonGroupSurfanal.getBounds())
        .extend(geoJsonGroupEpicentre.getBounds());

      if (combinedBounds.isValid()) {
        map.fitBounds(combinedBounds);
      } else {
        map.setView([51.505, -0.09], 13);
      }
    }).catch(error => {
      console.error('Erreur lors du chargement de epicentre.geojson:', error);
    });
  }).catch(error => {
    console.error('Erreur lors du chargement de surfanal.geojson:', error);
  });
}

// Initialisation unique
init().then(() => {
  countTotalPoints();
  addLegend();
});

// Gestionnaire pour le bouton de mise à jour
document.getElementById("updateMap").addEventListener("click", () => {
  queryGeoJSON();
});

document.getElementById("updateMap1").addEventListener("click", () => {
  queryGeoJSON1();
});


document.getElementById("pointSlider").addEventListener("input", (e) => {
  document.getElementById("limitDisplay").textContent = `${e.target.value}%`;
});


// Fonction pour compter le nombre total de points
async function countTotalPoints() {
  try {
    const query = `
      INSTALL spatial;
      LOAD spatial;
      SELECT COUNT(*) as total
      FROM ptouche AS p
      JOIN surfanal AS s
      ON ST_Contains(ST_GeomFromGeoJSON(s.geometry), ST_GeomFromGeoJSON(p.geometry));
    `;

    const result = await conn.query(query);
    totalPointsCount = result.toArray()[0].total;
    console.log(Number(totalPointsCount))
  } catch (error) {
    console.error('Erreur lors du comptage des points:', error);
  }
}


function showLoadingBar() {
  const overlay = document.getElementById('loadingOverlay');
  overlay.style.visibility = 'visible';
}

function hideLoadingBar() {
  const overlay = document.getElementById('loadingOverlay');
  overlay.style.visibility = 'hidden';
}

function updateLoadingBar(progress) {
  const loadingBar = document.getElementById('loadingBar');
  loadingBar.style.width = `${progress}%`;
}







// Appeler la fonction de comptage après l'initialisation
