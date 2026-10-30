'use strict';
// Bunkers do radio da missao da Nasdara (DayZ Badlands): onde cada um fica (x = leste, z = norte, em metros)
// e a cidade mais proxima. Lista conferida em 2026-10-21; se o jogo mudar os bunkers, e esta lista que precisa
// ser atualizada.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NasdaraBunkers = factory();
}(this, () => ({
  size: 16384, // lado do mapa, em metros
  step: 100, // lado de um quadrado da grade do mapa do jogo, em metros
  bunkers: [
    { x: 7216.4, z: 5707, near: { name: "Bustanshahr", m: 150, dir: "NW" } },
    { x: 9167.9, z: 11945.6, near: { name: "Kamar Zir", m: 250, dir: "W" } },
    { x: 11203.5, z: 9662.2, near: { name: "Pesh Dasht", m: 250, dir: "NW" } },
    { x: 6797.3, z: 10515.4, near: { name: "OKB-754", m: 450, dir: "N" } },
    { x: 10742.8, z: 4027.9, near: { name: "Terminal Nas", m: 300, dir: "NW" } },
    { x: 7630.2, z: 8752.5, near: { name: "Pir Kalay", m: 100, dir: "NW" } },
    { x: 11494.5, z: 11022.9, near: { name: "Dashtabad Airbase", m: 600, dir: "NW" } },
    { x: 10419.6, z: 8056.4, near: { name: "Shah Yailaq", m: 200, dir: "SE" } },
    { x: 4584.3, z: 10884.1, near: { name: "Khorramabad", m: 50, dir: "NW" } },
    { x: 10087.6, z: 4239.2, near: { name: "Ziarat District", m: 100, dir: "NW" } },
    { x: 10959.4, z: 7783.5, near: { name: "Gard Abad", m: 200, dir: "NW" } },
    { x: 7381.8, z: 7383.1, near: { name: "Sabzabad", m: 550, dir: "E" } },
    { x: 10555.9, z: 6135.3, near: { name: "Sarman-Naft refinery", m: 300, dir: "NW" } },
    { x: 8830.4, z: 5132.9, near: { name: "Jui Bar District", m: 550, dir: "NW" } },
    { x: 8541.9, z: 4795.5, near: { name: "Jui Bar District", m: 650, dir: "W" } },
    { x: 8741.6, z: 7560.6, near: { name: "Payan Kalay", m: 600, dir: "W" } },
    { x: 13323.5, z: 14238, near: { name: "Marz-e Lut", m: 1550, dir: "N" } },
    { x: 3861.6, z: 9775.4, near: { name: "Tor Dara", m: 550, dir: "NW" } },
    { x: 6559.8, z: 7361.5, near: { name: "Sabzabad", m: 300, dir: "W" } },
    { x: 9633.5, z: 5440.7, near: { name: "Jui Bar District", m: 850, dir: "NE" } },
    { x: 2863.2, z: 6381.6, near: { name: "Sar-e Deh", m: 200, dir: "NW" } },
    { x: 5719.4, z: 8969.6, near: { name: "Anar Juy", m: 200, dir: "SE" } },
    { x: 6713.5, z: 3980.5, near: { name: "Gul Dara", m: 500, dir: "SW" } },
  ],
})));
