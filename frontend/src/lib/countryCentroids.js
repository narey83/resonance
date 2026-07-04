// <copyright file="countryCentroids.js" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

// Approximate geographic centroids keyed by country name as returned by ip-api.com
const CENTROIDS = {
  Afghanistan: [33.93, 67.71],
  Albania: [41.15, 20.17],
  Algeria: [28.03, 1.66],
  Andorra: [42.55, 1.6],
  Angola: [-11.2, 17.87],
  Argentina: [-38.42, -63.62],
  Armenia: [40.07, 45.04],
  Australia: [-25.27, 133.78],
  Austria: [47.52, 14.55],
  Azerbaijan: [40.14, 47.58],
  Bahrain: [26, 50.55],
  Bangladesh: [23.68, 90.36],
  Belarus: [53.71, 27.95],
  Belgium: [50.5, 4.47],
  Belize: [17.19, -88.5],
  Benin: [9.31, 2.32],
  Bolivia: [-16.29, -63.59],
  'Bosnia and Herzegovina': [43.92, 17.68],
  Botswana: [-22.33, 24.68],
  Brazil: [-14.24, -51.93],
  Bulgaria: [42.73, 25.49],
  'Burkina Faso': [12.36, -1.56],
  Cambodia: [12.57, 104.99],
  Cameroon: [3.85, 11.5],
  Canada: [56.13, -106.35],
  Chile: [-35.68, -71.54],
  China: [35.86, 104.2],
  Colombia: [4.57, -74.3],
  Congo: [-0.23, 15.83],
  'Costa Rica': [9.75, -83.75],
  Croatia: [45.1, 15.2],
  Cuba: [21.52, -77.78],
  Cyprus: [35.13, 33.43],
  'Czech Republic': [49.82, 15.47],
  Czechia: [49.82, 15.47],
  Denmark: [56.26, 9.5],
  'Dominican Republic': [18.74, -70.16],
  Ecuador: [-1.83, -78.18],
  Egypt: [26.82, 30.8],
  'El Salvador': [13.79, -88.9],
  Estonia: [58.6, 25.01],
  Ethiopia: [9.15, 40.49],
  Finland: [61.92, 25.75],
  France: [46.23, 2.21],
  Georgia: [42.31, 43.36],
  Germany: [51.17, 10.45],
  Ghana: [7.95, -1.02],
  Greece: [39.07, 21.82],
  Guatemala: [15.78, -90.23],
  Honduras: [15.2, -86.24],
  'Hong Kong': [22.4, 114.11],
  Hungary: [47.16, 19.5],
  Iceland: [64.96, -19.02],
  India: [20.59, 78.96],
  Indonesia: [-0.79, 113.92],
  Iran: [32.43, 53.69],
  Iraq: [33.22, 43.68],
  Ireland: [53.41, -8.24],
  Israel: [31.05, 34.85],
  Italy: [41.87, 12.57],
  Jamaica: [18.11, -77.3],
  Japan: [36.2, 138.25],
  Jordan: [30.59, 36.24],
  Kazakhstan: [48.02, 66.92],
  Kenya: [-0.02, 37.91],
  Kosovo: [42.6, 20.9],
  Kuwait: [29.31, 47.48],
  Kyrgyzstan: [41.2, 74.77],
  Laos: [19.86, 102.5],
  Latvia: [56.88, 24.6],
  Lebanon: [33.85, 35.86],
  Libya: [26.34, 17.23],
  Lithuania: [55.17, 23.88],
  Luxembourg: [49.82, 6.13],
  Malaysia: [4.21, 108],
  Malta: [35.94, 14.38],
  Mexico: [23.63, -102.55],
  Moldova: [47.41, 28.37],
  Monaco: [43.73, 7.4],
  Mongolia: [46.86, 103.85],
  Montenegro: [42.71, 19.37],
  Morocco: [31.79, -7.09],
  Mozambique: [-18.67, 35.53],
  Myanmar: [21.92, 95.96],
  Nepal: [28.39, 84.12],
  Netherlands: [52.13, 5.29],
  'New Zealand': [-40.9, 174.89],
  Nicaragua: [12.87, -85.21],
  Nigeria: [9.08, 8.68],
  'North Macedonia': [41.61, 21.75],
  Norway: [60.47, 8.47],
  Oman: [21.51, 55.92],
  Pakistan: [30.38, 69.35],
  Palestine: [31.95, 35.23],
  Panama: [8.54, -80.78],
  Paraguay: [-23.44, -58.44],
  Peru: [-9.19, -75.02],
  Philippines: [12.88, 121.77],
  Poland: [51.92, 19.15],
  Portugal: [39.4, -8.22],
  'Puerto Rico': [18.22, -66.59],
  Qatar: [25.35, 51.18],
  Romania: [45.94, 24.97],
  Russia: [61.52, 105.32],
  'Saudi Arabia': [23.89, 45.08],
  Senegal: [14.5, -14.45],
  Serbia: [44.02, 21.01],
  Singapore: [1.35, 103.82],
  Slovakia: [48.67, 19.7],
  Slovenia: [46.15, 14.99],
  Somalia: [5.15, 46.2],
  'South Africa': [-30.56, 22.94],
  'South Korea': [35.91, 127.77],
  Spain: [40.46, -3.75],
  'Sri Lanka': [7.87, 80.77],
  Sudan: [12.86, 30.22],
  Sweden: [60.13, 18.64],
  Switzerland: [46.82, 8.23],
  Syria: [34.8, 38.99],
  Taiwan: [23.7, 120.96],
  Tajikistan: [38.86, 71.28],
  Tanzania: [-6.37, 34.89],
  Thailand: [15.87, 100.99],
  Tunisia: [33.89, 9.54],
  Turkey: [38.96, 35.24],
  Turkmenistan: [38.97, 59.56],
  Uganda: [1.37, 32.29],
  Ukraine: [48.38, 31.17],
  'United Arab Emirates': [23.42, 53.85],
  'United Kingdom': [55.38, -3.44],
  'United States': [37.09, -95.71],
  Uruguay: [-32.52, -55.77],
  Uzbekistan: [41.38, 64.59],
  Venezuela: [6.42, -66.59],
  Vietnam: [14.06, 108.28],
  Yemen: [15.55, 48.52],
  Zambia: [-13.13, 27.85],
  Zimbabwe: [-19.02, 29.15],
};

export const getCentroid = (countryName) => {
  if (!countryName) return null;
  const coords = CENTROIDS[countryName];
  if (!coords) return null;
  return { lat: coords[0], lon: coords[1] };
};
