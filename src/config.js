const fs = require('fs')
const path = require('path')

const DATA_DIR = path.join(__dirname, '..', 'data')
try {
  fs.mkdirSync(DATA_DIR, { recursive: true })
} catch (err) {}

const NICKNAMES = [
  'ZxsVant',
  'Toypch',
  'FanSp1dyk',
  'Qwezlok',
  'IxLoona',
  'BlysterX',
  'VrednOT',
  'Keevzik',
  'Melphted',
  'Nolvis3',
  'RugBoltz',
  'SkorPio',
  'TavZilly',
  'UmkaVex',
  'FlyntoZ',
  'Kholod1k',
  'YuzzyFex',
  'Waxlykod',
  'Glukhoz',
  'ZepKarn',
  'Myshkin1',
  'Oxblyzt',
  'PiratokZ',
  'ChazyVolt',
  'EphZynk',
  'Volchok9',
  'GryaznOff',
  'DashKa_v',
  'LutikFur',
  'BumbleZx'
]

module.exports = {
  HOST: process.env.MC_HOST || 'PointWorld.aternos.me',
  PORT: parseInt(process.env.MC_PORT || '49528', 10),
  PASSWORD: process.env.MC_PASSWORD || 'mamba_1234',
  MAX_ONLINE: Math.max(1, parseInt(process.env.MAX_ONLINE || '8', 10)),
  NICKNAMES,
  DATA_DIR
}
