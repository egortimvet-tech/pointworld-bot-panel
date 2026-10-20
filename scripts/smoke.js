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

let regSent = 0
let loginSent = false
let authed = false

const send = (cmd) => {
  console.log(`[${ms()}] SEND: ${cmd}`)
  bot.chat(cmd)
}

const authNow = () => {
  if (authed) return
  if (regSent === 0) {
    regSent++
    send('/register ' + PASSWORD + ' ' + PASSWORD)
  } else if (!loginSent) {
    loginSent = true
    send('/login ' + PASSWORD)
  }
}

bot.on('login', () => console.log(`[${ms()}] LOGIN OK`))
bot.on('spawn', () => {
  console.log(`[${ms()}] SPAWN OK`)
  setTimeout(authNow, 700)
})
bot.on('messagestr', (s) => {
  console.log(`[${ms()}] CHAT: ${s}`)
  if (!authed && /\/register/i.test(s) && /используй/i.test(s)) setTimeout(authNow, 350)
  if (!authed && /\/login/i.test(s) && /используй/i.test(s)) setTimeout(authNow, 350)
  if (!authed && /уже зарегистрирован/i.test(s)) {
    loginSent = false
    console.log(`[${ms()}]   -> уже зарегистрирован: шлю /login немедленно`)
    setTimeout(authNow, 250)
  }
  if (/успешно (зарегистр|вош)|registered success/i.test(s)) authed = true
  if (!authed && /logged in|login success/i.test(s)) authed = true
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
}, 40000)
