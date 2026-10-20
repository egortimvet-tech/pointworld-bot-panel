const mineflayer = require('mineflayer')
const { HOST, PORT, PASSWORD } = require('../src/config')

const T0 = Date.now()
const ms = () => ((Date.now() - T0) / 1000).toFixed(1) + 's'

const bot = mineflayer.createBot({
  host: HOST,
  port: PORT,
  username: 'ProbeQx1',
  auth: 'offline',
  hideErrors: true
})

let regSent = false
let authed = false

if (process.argv.includes('--login')) regSent = true

const send = (cmd) => {
  console.log(`[${ms()}] SEND: ${cmd}`)
  bot.chat(cmd)
}

const authNow = () => {
  if (authed) return
  if (!regSent) {
    regSent = true
    send('/register ' + PASSWORD + ' ' + PASSWORD)
  } else {
    send('/login ' + PASSWORD)
  }
}

bot.on('login', () => console.log(`[${ms()}] LOGIN OK`))
bot.on('spawn', () => {
  console.log(`[${ms()}] SPAWN OK`)
  setTimeout(authNow, 300)
})
bot.on('messagestr', (s) => {
  console.log(`[${ms()}] CHAT: ${s}`)
  if (!authed && /\/register/i.test(s) && !regSent) setTimeout(authNow, 250)
  if (!authed && /\/login/i.test(s) && regSent) setTimeout(authNow, 250)
})

bot.on('kicked', (r) => console.log(`[${ms()}] KICKED: ${r}`))
bot.on('error', (e) => console.log(`[${ms()}] ERROR: ${e.message}`))
bot.on('end', () => {
  console.log(`[${ms()}] END`)
  process.exit(0)
})

setTimeout(() => {
  console.log(`[${ms()}] TIMEOUT, exit`)
  process.exit(0)
}, 70000)
